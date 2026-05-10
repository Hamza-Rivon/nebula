import { createHash } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany } from "ai";
import { z } from "zod";
import pLimit from "p-limit";
import { kmeans } from "ml-kmeans";
import { UMAP } from "umap-js";
import { db } from "../db.js";
import {
  getCachedClusterLabel,
  getCachedEmbedding,
  getSession,
  getUserIdByRaw,
  listRawUserMappings,
  putCachedClusterLabel,
  putCachedEmbeddings,
  setAggregates,
  setConfig,
  setGeneratedAt,
  upsertCluster,
  upsertSession,
  upsertTranscript,
  upsertUser,
} from "./db.js";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
import type {
  Aggregates,
  Ask,
  Cluster,
  Dataset,
  SessionMeta,
  TranscriptEvent,
  Unresolved,
  User,
  WasteFlag,
} from "./types.js";

export type AnalyzeProgress = { stage: string; done: number; total: number };

export type AnalyzeOptions = {
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  embeddingModel?: string;
  concurrency?: number;
  // When false (default), sessions that already have an analyzed
  // SessionMeta in `insights_sessions` skip the LLM extraction step:
  // their cached facets are reconstructed from storage. Set true to
  // force re-extraction across the board.
  force?: boolean;
  onProgress?: (p: AnalyzeProgress) => void;
};

// ---------- pricing ----------
// Pricing comes from the shared catalog (models.dev, refreshed on startup).
// Fallback rates only kick in when the catalog has no entry for the model —
// they're rough averages, deliberately on the high side so cost is never
// silently zero for an unknown model.
import { getMeta } from "../catalog.js";

const FALLBACK_PRICE = {
  input: 5,
  output: 15,
  cacheRead: 0.5,
  cacheWrite: 6,
};

type Price = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

function priceFor(model: string): Price {
  const meta = getMeta(model);
  if (!meta || (meta.input === 0 && meta.output === 0)) return FALLBACK_PRICE;
  return {
    input: meta.input,
    output: meta.output,
    cacheRead: meta.cacheRead,
    cacheWrite: meta.cacheWrite,
  };
}

function turnCost(
  model: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  },
): number {
  const p = priceFor(model);
  const i = usage.input_tokens ?? 0;
  const o = usage.output_tokens ?? 0;
  const cr = usage.cache_read_input_tokens ?? 0;
  const cc = usage.cache_creation_input_tokens ?? 0;
  return (
    (i * p.input + o * p.output + cr * p.cacheRead + cc * p.cacheWrite) / 1e6
  );
}

// ---------- baked names / teams ----------
const NAMES = [
  "Alex Chen", "Mira Patel", "Jonas Weber", "Priya Rao", "Léa Dubois",
  "Tomás García", "Sara Okonkwo", "Hiroshi Tanaka", "Isabella Rossi",
  "Mateo Fernández", "Yuki Sato", "Aisha Khan", "Lukas Müller",
  "Camille Laurent", "Noa Cohen", "Diego Morales", "Anya Ivanova",
  "Kwame Mensah", "Sofia Lindqvist", "Rohan Mehta", "Élodie Martin",
  "Ravi Sharma", "Olivia Brown", "Liam O'Connor", "Fatima Al-Sayed",
  "Pierre Lefèvre", "Hannah Schmidt", "Carlos Ribeiro", "Mei Lin",
  "Ahmed Hassan", "Eva Novak", "Théo Bernard", "Nadia Petrova",
  "Jamal Williams", "Charlotte Dupont", "Ezra Goldberg", "Amara Diallo",
  "Niko Korhonen", "Valentina Costa", "Quentin Roux",
];
const TEAMS = ["Strategy", "Operations", "Technology", "Financial", "Research"];

// ---------- utils ----------
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function redact(s: string): string {
  return s
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[redacted]")
    .replace(/https?:\/\/\S+/g, "[redacted]")
    .replace(/(\/[A-Za-z0-9_.-]+){2,}/g, "[redacted]");
}

function frictionLabel(tag?: string): string {
  if (!tag) return "no recurring friction";
  const map: Record<string, string> = {
    misunderstood_request: "ambiguous prompts",
    wrong_data: "wrong data assumed",
    buggy_code: "ships buggy code",
    slow_response: "slow turnarounds",
    missing_context: "doesn't give AI enough context",
    tool_loop: "gets stuck in tool loops",
    model_mismatch: "uses Opus on trivial tasks",
    ambiguous_output: "vague AI output",
    format_drift: "format drift",
    stale_info: "stale answers",
    other: "mixed friction",
  };
  return map[tag] ?? tag.replace(/_/g, " ");
}

function inferPersona(args: {
  sessionsTotal: number;
  sessionsLast7d: number;
  winRate: number;
  wastePct: number;
  modelMismatchShare: number;
}): "power" | "active" | "stuck" | "lurker" | "misuser" {
  const { sessionsTotal, sessionsLast7d, winRate, wastePct, modelMismatchShare } = args;
  if (sessionsLast7d < 1 && sessionsTotal < 4) return "lurker";
  if (wastePct >= 0.35 || modelMismatchShare > 0.5) return "misuser";
  if (sessionsTotal >= 12 && winRate >= 0.7 && wastePct < 0.2) return "power";
  if (winRate < 0.4 && sessionsTotal >= 4) return "stuck";
  return "active";
}

function categorizeToolError(content: string): string {
  const c = content.toLowerCase();
  if (c.includes("exit code")) return "Command Failed";
  if (c.includes("rejected")) return "User Rejected";
  if (c.includes("string to replace not found")) return "Edit Failed";
  if (c.includes("modified since read")) return "File Changed";
  if (c.includes("exceeds maximum")) return "File Too Large";
  if (c.includes("file not found")) return "File Not Found";
  return "Other";
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------- LLM client ----------
function makeProvider(opts: AnalyzeOptions) {
  if (!opts.apiBaseUrl || !opts.apiKey || !opts.model) return null;
  try {
    return createOpenAICompatible({
      name: "nebula-analyze",
      baseURL: opts.apiBaseUrl,
      apiKey: opts.apiKey,
    });
  } catch {
    return null;
  }
}

// Direct chat-completions JSON helper. Bypasses the AI SDK structured-output
// path because reasoning models burn the budget on hidden reasoning unless
// reasoning_effort is "low". Returns a zod-parsed object.
async function chatJSON<T>(
  opts: AnalyzeOptions,
  prompt: string,
  schema: z.ZodType<T>,
  callOpts: { maxTokens?: number; reasoningEffort?: "low" | "medium" | "high" } = {},
): Promise<T> {
  if (!opts.apiBaseUrl || !opts.apiKey || !opts.model) {
    throw new Error("LLM not configured");
  }
  const url = `${opts.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: opts.model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: callOpts.maxTokens ?? 2000,
    reasoning_effort: callOpts.reasoningEffort ?? "low",
    temperature: 0.2,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`chat ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = j.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("empty content");
  const stripped = content
    .trim()
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "");
  const parsed = JSON.parse(stripped);
  return schema.parse(parsed);
}

// ---------- session parsing from DB ----------
type AnyMsg = Record<string, any>;

interface RawParse {
  sessionId: string;
  rawUserId: string | null;
  filePath: string;
  projectName: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  userMessageCount: number;
  assistantMessageCount: number;
  turns: number;
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number };
  models: Record<string, number>;
  modelTurnCosts: { model: string; cost: number; usage: any }[];
  tools: Record<string, number>;
  toolErrors: number;
  toolErrorCategories: Record<string, number>;
  userInterruptions: number;
  branchPoints: number;
  retryLoops: number;
  abandoned: boolean;
  linesAdded: number;
  linesRemoved: number;
  filesModified: number;
  costUsd: number;
  firstPrompt: string;
  transcript: string;
  events: TranscriptEvent[];
}

const TX_MAX_EVENTS = 1500;
const TX_TEXT_CAP = 8000;
const TX_TOOL_INPUT_CAP = 4000;
const TX_TOOL_RESULT_CAP = 4000;

function cap(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

function safeJson(s: string | null | undefined): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Pull a list of text fragments out of an arbitrary "content" field that may be
// a string, an Anthropic block array, or a tool_result block.
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const out: string[] = [];
    for (const part of content) {
      if (typeof part === "string") out.push(part);
      else if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") out.push(p.text);
      }
    }
    return out.join("\n");
  }
  return "";
}

type SessionRow = {
  id: string;
  user_id: string | null;
  created_at: number;
};
type RequestRow = {
  id: string;
  session_id: string;
  user_id: string | null;
  provider: string;
  model: string;
  status: string;
  error: string | null;
  started_at: number;
  finished_at: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  cost: number | null;
  request_json: string;
  response_json: string | null;
};

function parseSessionFromDb(sessionId: string): RawParse | null {
  const session = db
    .prepare(`SELECT id, user_id, created_at FROM sessions WHERE id = ?`)
    .get(sessionId) as SessionRow | undefined;
  if (!session) return null;
  const requests = db
    .prepare(
      `SELECT id, session_id, user_id, provider, model, status, error,
              started_at, finished_at,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost,
              request_json, response_json
       FROM requests WHERE session_id = ? ORDER BY started_at ASC`,
    )
    .all(sessionId) as RequestRow[];

  let firstTs = "";
  let lastTs = "";
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let turns = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  const models: Record<string, number> = {};
  const modelTurnCosts: { model: string; cost: number; usage: any }[] = [];
  const tools: Record<string, number> = {};
  let toolErrors = 0;
  const toolErrorCategories: Record<string, number> = {};
  let userInterruptions = 0;
  let costUsd = 0;
  let firstPrompt = "";
  let linesAdded = 0;
  let linesRemoved = 0;
  const filesTouched = new Set<string>();
  const transcriptParts: string[] = [];
  const events: TranscriptEvent[] = [];
  let rawUserId: string | null = session.user_id ?? null;
  const toolUses: { name: string; inputHash: number; turnIdx: number }[] = [];
  // track tail tool_result errors for abandoned detection
  type TailMark = { kind: "user" | "tool_result_err" | "assistant" };
  const tail: TailMark[] = [];

  // Track which user messages were already seen for this session so we don't
  // double-count them across requests (Claude Code resends history each turn).
  const seenUserHashes = new Set<number>();
  let seenFirstPrompt = false;
  let turnIdx = 0;

  for (const r of requests) {
    if (r.user_id && !rawUserId) rawUserId = r.user_id;
    const startedIso = new Date(r.started_at).toISOString();
    const finishedIso = new Date(r.finished_at ?? r.started_at).toISOString();
    if (!firstTs) firstTs = startedIso;
    lastTs = finishedIso;

    const req = safeJson(r.request_json) ?? {};
    const resp = safeJson(r.response_json);

    // ---- input messages ----
    const inputMessages: AnyMsg[] = Array.isArray(req?.messages) ? req.messages : [];
    for (const m of inputMessages) {
      const role = m?.role ?? "user";
      if (role === "user") {
        // Anthropic input shape: content can be string or array with text/tool_result.
        const content = m?.content;
        if (typeof content === "string") {
          if (content.trim().length === 0) continue;
          const h = djb2("u|" + content);
          if (seenUserHashes.has(h)) continue;
          seenUserHashes.add(h);
          userMessageCount++;
          turns++;
          turnIdx++;
          if (!seenFirstPrompt) {
            firstPrompt = content;
            seenFirstPrompt = true;
          }
          if (/interrupted by user/i.test(content)) {
            userInterruptions++;
            transcriptParts.push(`[interrupt] ${content.slice(0, 400)}`);
            events.push({ t: startedIso, type: "interrupt", text: cap(content, TX_TEXT_CAP) });
          } else {
            transcriptParts.push(`[U] ${content.slice(0, 2000)}`);
            events.push({ t: startedIso, type: "user", text: cap(content, TX_TEXT_CAP) });
          }
          tail.push({ kind: "user" });
        } else if (Array.isArray(content)) {
          let humanText = "";
          let isHuman = false;
          for (const part of content) {
            if (part?.type === "text" && typeof part.text === "string") {
              humanText += part.text + "\n";
              if (part.text.trim().length > 0) isHuman = true;
            } else if (part?.type === "tool_result") {
              const tcontent = extractText(part.content);
              const errFlag = !!part.is_error;
              if (errFlag || /error/i.test(tcontent.slice(0, 200))) {
                const h = djb2("tr_err|" + tcontent.slice(0, 400));
                if (!seenUserHashes.has(h)) {
                  seenUserHashes.add(h);
                  toolErrors++;
                  const catg = categorizeToolError(tcontent);
                  toolErrorCategories[catg] = (toolErrorCategories[catg] ?? 0) + 1;
                  transcriptParts.push(`[error] ${tcontent.slice(0, 400)}`);
                  events.length < TX_MAX_EVENTS &&
                    events.push({
                      t: startedIso,
                      type: "tool_result",
                      result: cap(tcontent, TX_TOOL_RESULT_CAP),
                      isError: true,
                    });
                  tail.push({ kind: "tool_result_err" });
                }
              } else {
                const h = djb2("tr|" + tcontent.slice(0, 400));
                if (!seenUserHashes.has(h)) {
                  seenUserHashes.add(h);
                  transcriptParts.push(`[tool_result] ${tcontent.slice(0, 300)}`);
                  events.length < TX_MAX_EVENTS &&
                    events.push({
                      t: startedIso,
                      type: "tool_result",
                      result: cap(tcontent, TX_TOOL_RESULT_CAP),
                      isError: false,
                    });
                }
              }
            }
          }
          if (isHuman) {
            const trimmed = humanText.trim();
            const h = djb2("u|" + trimmed);
            if (!seenUserHashes.has(h)) {
              seenUserHashes.add(h);
              userMessageCount++;
              turns++;
              turnIdx++;
              if (!seenFirstPrompt) {
                firstPrompt = trimmed;
                seenFirstPrompt = true;
              }
              if (/interrupted by user/i.test(trimmed)) {
                userInterruptions++;
                transcriptParts.push(`[interrupt] ${trimmed.slice(0, 400)}`);
                events.length < TX_MAX_EVENTS &&
                  events.push({ t: startedIso, type: "interrupt", text: cap(trimmed, TX_TEXT_CAP) });
              } else {
                transcriptParts.push(`[U] ${trimmed.slice(0, 2000)}`);
                events.length < TX_MAX_EVENTS &&
                  events.push({ t: startedIso, type: "user", text: cap(trimmed, TX_TEXT_CAP) });
              }
              tail.push({ kind: "user" });
            }
          }
        }
      } else if (role === "assistant") {
        // Historic assistant turn replayed in input — already accounted for in
        // the response_json of the prior request, so skip to avoid double count.
      } else if (role === "tool") {
        // OpenAI tool message
        const content = typeof m.content === "string" ? m.content : extractText(m.content);
        const errFlag = /error/i.test(content.slice(0, 200));
        const h = djb2("oai_tr|" + content.slice(0, 400));
        if (!seenUserHashes.has(h)) {
          seenUserHashes.add(h);
          if (errFlag) {
            toolErrors++;
            const catg = categorizeToolError(content);
            toolErrorCategories[catg] = (toolErrorCategories[catg] ?? 0) + 1;
            transcriptParts.push(`[error] ${content.slice(0, 400)}`);
            events.length < TX_MAX_EVENTS &&
              events.push({
                t: startedIso,
                type: "tool_result",
                result: cap(content, TX_TOOL_RESULT_CAP),
                isError: true,
              });
            tail.push({ kind: "tool_result_err" });
          } else {
            transcriptParts.push(`[tool_result] ${content.slice(0, 300)}`);
            events.length < TX_MAX_EVENTS &&
              events.push({
                t: startedIso,
                type: "tool_result",
                result: cap(content, TX_TOOL_RESULT_CAP),
                isError: false,
              });
          }
        }
      }
    }

    // ---- assistant response ----
    if (r.status === "ok") {
      assistantMessageCount++;
      const model = r.model || "unknown";
      models[model] = (models[model] ?? 0) + 1;

      // Prefer the request row's columns (single source of truth, written at
      // ingest time) and fall back to the response JSON only when a column is
      // missing — that handles legacy rows seeded before the cache columns
      // existed. Anthropic uses resp.usage.{input,output,cache_*}_tokens;
      // OpenAI uses resp.usage.{prompt,completion}_tokens with cached split
      // under prompt_tokens_details.cached_tokens.
      const respUsage = (resp && typeof resp === "object" && (resp as any).usage) || {};
      const oaiCached = respUsage.prompt_tokens_details?.cached_tokens ?? 0;
      const oaiPrompt = respUsage.prompt_tokens ?? 0;
      const usage = {
        input_tokens:
          r.input_tokens ??
          respUsage.input_tokens ??
          Math.max(0, oaiPrompt - oaiCached),
        output_tokens:
          r.output_tokens ??
          respUsage.output_tokens ??
          respUsage.completion_tokens ??
          0,
        cache_read_input_tokens:
          r.cache_read_tokens ??
          respUsage.cache_read_input_tokens ??
          oaiCached,
        cache_creation_input_tokens:
          r.cache_creation_tokens ??
          respUsage.cache_creation_input_tokens ??
          0,
      };
      tokens.input += usage.input_tokens;
      tokens.output += usage.output_tokens;
      tokens.cacheRead += usage.cache_read_input_tokens;
      tokens.cacheCreate += usage.cache_creation_input_tokens;

      const c = r.cost != null ? r.cost : turnCost(model, usage);
      costUsd += c;
      modelTurnCosts.push({ model, cost: c, usage });

      // Walk content. Anthropic: resp.content = block[]. OpenAI: resp.choices[0].message
      const oaiChoice = resp?.choices?.[0]?.message;
      const blocks: any[] = Array.isArray(resp?.content)
        ? resp.content
        : oaiChoice
        ? buildBlocksFromOpenAi(oaiChoice)
        : [];

      for (const part of blocks) {
        if (!part || typeof part !== "object") continue;
        if (part.type === "text" && typeof part.text === "string") {
          if (part.text.trim().length > 0) {
            transcriptParts.push(`[A] ${part.text.slice(0, 2000)}`);
            events.length < TX_MAX_EVENTS &&
              events.push({
                t: finishedIso,
                type: "assistant",
                text: cap(part.text, TX_TEXT_CAP),
                model,
              });
          }
        } else if (part.type === "thinking" && typeof part.thinking === "string") {
          events.length < TX_MAX_EVENTS &&
            events.push({ t: finishedIso, type: "thinking", text: cap(part.thinking, TX_TEXT_CAP) });
        } else if (part.type === "tool_use") {
          const name = part.name ?? "unknown";
          tools[name] = (tools[name] ?? 0) + 1;
          const inputJson = JSON.stringify(part.input ?? {});
          const ih = djb2(name + "|" + inputJson);
          toolUses.push({ name, inputHash: ih, turnIdx });
          transcriptParts.push(`[tool: ${name}] ${inputJson.slice(0, 300)}`);
          events.length < TX_MAX_EVENTS &&
            events.push({
              t: finishedIso,
              type: "tool_use",
              tool: name,
              input:
                inputJson.length > TX_TOOL_INPUT_CAP
                  ? inputJson.slice(0, TX_TOOL_INPUT_CAP)
                  : part.input,
            });

          if (name === "Edit" || name === "MultiEdit") {
            const oldS = part.input?.old_string ?? "";
            const newS = part.input?.new_string ?? "";
            if (typeof oldS === "string" && typeof newS === "string") {
              const oL = oldS.split("\n").length;
              const nL = newS.split("\n").length;
              if (nL > oL) linesAdded += nL - oL;
              else linesRemoved += oL - nL;
            }
            if (typeof part.input?.file_path === "string") {
              filesTouched.add(part.input.file_path);
            }
          } else if (name === "Write") {
            const ct = part.input?.content ?? "";
            if (typeof ct === "string") linesAdded += ct.split("\n").length;
            if (typeof part.input?.file_path === "string") {
              filesTouched.add(part.input.file_path);
            }
          }
        }
      }
      tail.push({ kind: "assistant" });
    } else if (r.status === "error" && r.error) {
      transcriptParts.push(`[error] ${r.error.slice(0, 400)}`);
    }
  }

  // retry loops: same name+input within window 5 turns
  let retryLoops = 0;
  for (let i = 0; i < toolUses.length; i++) {
    for (let j = i + 1; j < toolUses.length; j++) {
      if (toolUses[j]!.turnIdx - toolUses[i]!.turnIdx > 5) break;
      if (toolUses[i]!.inputHash === toolUses[j]!.inputHash) {
        retryLoops++;
        break;
      }
    }
  }

  // abandoned: any tool_result error in tail without a subsequent user turn
  let abandoned = false;
  const tailWindow = tail.slice(-6);
  let sawError = false;
  let sawUserAfter = false;
  for (const t of tailWindow) {
    if (t.kind === "tool_result_err") sawError = true;
    if (t.kind === "user" && sawError) sawUserAfter = true;
  }
  if (sawError && !sawUserAfter) abandoned = true;

  const startedAt = firstTs || new Date(session.created_at).toISOString();
  const endedAt = lastTs || startedAt;
  const durationMinutes = Math.max(
    0,
    (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000,
  );

  const projectName = "nebula"; // proxy data has no per-project cwd

  const t: import("./types.js").Transcript = {
    sessionId,
    events,
    truncated: events.length >= TX_MAX_EVENTS,
  };
  upsertTranscript(t);

  return {
    sessionId,
    rawUserId,
    filePath: `nebula://session/${sessionId}`,
    projectName,
    startedAt,
    endedAt,
    durationMinutes,
    userMessageCount,
    assistantMessageCount,
    turns,
    tokens,
    models,
    modelTurnCosts,
    tools,
    toolErrors,
    toolErrorCategories,
    userInterruptions,
    branchPoints: 0,
    retryLoops,
    abandoned,
    linesAdded,
    linesRemoved,
    filesModified: filesTouched.size,
    costUsd,
    firstPrompt: redact(firstPrompt).slice(0, 500),
    transcript: transcriptParts.join("\n"),
    events,
  };
}

// Convert an OpenAI assistant message to Anthropic-style block list so the
// downstream walker can be uniform.
function buildBlocksFromOpenAi(msg: any): any[] {
  const blocks: any[] = [];
  if (typeof msg.content === "string" && msg.content.length > 0) {
    blocks.push({ type: "text", text: msg.content });
  } else if (Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (typeof c === "string") blocks.push({ type: "text", text: c });
      else if (c?.type === "text" && typeof c.text === "string")
        blocks.push({ type: "text", text: c.text });
    }
  }
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      const fn = tc.function ?? {};
      let parsedArgs: any = fn.arguments ?? {};
      if (typeof parsedArgs === "string") {
        try {
          parsedArgs = JSON.parse(parsedArgs);
        } catch {
          /* keep string */
        }
      }
      blocks.push({ type: "tool_use", name: fn.name, input: parsedArgs });
    }
  }
  return blocks;
}

// ---------- LLM extraction ----------
const FRICTION_VOCAB = [
  "misunderstood_request",
  "wrong_data",
  "buggy_code",
  "slow_response",
  "missing_context",
  "tool_loop",
  "model_mismatch",
  "ambiguous_output",
  "format_drift",
  "stale_info",
  "other",
] as const;

const ExtractSchema = z.object({
  goal: z.string(),
  outcome: z.enum(["fully", "mostly", "partial", "none", "unclear"]),
  session_type: z.enum([
    "single_task",
    "multi_task",
    "iterative",
    "exploration",
    "quick_q",
  ]),
  friction: z.array(z.enum(FRICTION_VOCAB)),
  primary_success: z.string(),
  brief_summary: z.string(),
  asks: z.array(
    z.object({
      intent: z.string(),
      artifact: z.string(),
      text: z.string(),
    }),
  ),
  unresolved: z.array(
    z.object({
      topic: z.string(),
      framing: z.string(),
    }),
  ),
  task_hardness: z.number().int().min(1).max(5),
});
type Extracted = z.infer<typeof ExtractSchema>;

// In-memory cache keyed by sessionId + a salt of the latest request_started_at.
// Replaces the disk cache from the bun script. A re-run on an unchanged session
// reuses the prior extraction, but new requests invalidate it.
const extractCache = new Map<string, Extracted>();

async function chunkSummarize(opts: AnalyzeOptions, transcript: string): Promise<string> {
  const chunkSize = 25000;
  const chunks: string[] = [];
  for (let i = 0; i < transcript.length; i += chunkSize) {
    chunks.push(transcript.slice(i, i + chunkSize));
  }
  const summaries: string[] = [];
  for (const c of chunks) {
    try {
      const object = await chatJSON(
        opts,
        `Summarize the following partial Claude Code session transcript in <= 400 words, preserving user goals, key tool actions, and any errors. Respond with JSON {"summary": "..."}.\n\nTranscript chunk:\n\n${c}`,
        z.object({ summary: z.string() }),
        { maxTokens: 1500 },
      );
      summaries.push(object.summary);
    } catch {
      summaries.push(c.slice(0, 1000));
    }
  }
  return summaries.join("\n---\n");
}

function extractFallback(raw: RawParse): Extracted {
  return {
    goal: raw.firstPrompt.slice(0, 200) || "(extraction unavailable)",
    outcome: "unclear",
    session_type: "single_task",
    friction: [],
    primary_success: "",
    brief_summary:
      "LLM extraction unavailable; using deterministic fallback. " +
      `Session has ${raw.turns} turns and ${raw.toolErrors} tool errors.`,
    asks: raw.firstPrompt
      ? [
          {
            intent: "other",
            artifact: "request",
            text: raw.firstPrompt.slice(0, 200),
          },
        ]
      : [],
    unresolved: [],
    task_hardness: 3,
  };
}

async function extractFacets(
  raw: RawParse,
  opts: AnalyzeOptions,
  llmAvailable: boolean,
): Promise<Extracted> {
  const cacheKey = `${raw.sessionId}|${raw.endedAt}`;
  const cached = extractCache.get(cacheKey);
  if (cached) return cached;
  // Persisted-cache short-circuit: if this session already has an analyzed
  // SessionMeta in storage and the caller didn't set force=true, reconstruct
  // the Extracted shape from it and skip the LLM call. This is what makes
  // re-analyze cheap: only newly-seeded sessions hit the model.
  if (!opts.force) {
    const stored = getSession(raw.sessionId);
    if (stored) {
      const reconstructed: Extracted = {
        goal: stored.goal,
        outcome: stored.outcome,
        session_type: stored.sessionType,
        friction: stored.friction.filter((f): f is (typeof FRICTION_VOCAB)[number] =>
          (FRICTION_VOCAB as readonly string[]).includes(f),
        ),
        primary_success: stored.primarySuccess,
        brief_summary: stored.briefSummary,
        asks: stored.asks.map((a) => ({
          intent: a.intent,
          artifact: a.artifact,
          text: a.text,
        })),
        unresolved: stored.unresolved.map((u) => ({
          topic: u.topic,
          framing: u.framing,
        })),
        // task_hardness isn't persisted on SessionMeta; medium is a safe
        // neutral fallback (only used for wrong_model waste detection).
        task_hardness: 3,
      };
      extractCache.set(cacheKey, reconstructed);
      return reconstructed;
    }
  }
  if (!llmAvailable) {
    const f = extractFallback(raw);
    extractCache.set(cacheKey, f);
    return f;
  }
  let transcript = raw.transcript;
  if (transcript.length > 30000) {
    try {
      transcript = await chunkSummarize(opts, transcript);
    } catch {
      transcript = transcript.slice(0, 30000);
    }
  }
  const prompt = `You analyze a Claude Code coding-assistant session and extract structured facets.

The transcript uses markers: [U]=user message, [A]=assistant text, [tool: NAME]=tool invocation, [tool_result]=tool output, [error]=tool error.

Required fields:
- goal: 1 sentence describing what the user was trying to accomplish.
- outcome: one of fully|mostly|partial|none|unclear.
- session_type: single_task|multi_task|iterative|exploration|quick_q.
- friction: subset of [${FRICTION_VOCAB.join(", ")}]. Empty array if smooth.
- primary_success: 1 sentence on what was actually achieved (or "" if nothing).
- brief_summary: 2-3 sentences covering shape of the session.
- asks: each distinct user request as {intent, artifact, text}. intent ∈ {compare,draft,debug,synthesize,analyze,implement,research,format,explain,other}. artifact = noun phrase. text = 1-sentence ask.
- unresolved: only fill if outcome != fully. Each = {topic, framing} representing a question/gap not closed.
- task_hardness: 1 (trivial) to 5 (very hard, multi-step research/debugging).

Transcript:
${transcript.slice(0, 30000)}`;

  try {
    const object = await chatJSON(opts, prompt, ExtractSchema, { maxTokens: 3000 });
    extractCache.set(cacheKey, object);
    return object;
  } catch {
    const f = extractFallback(raw);
    extractCache.set(cacheKey, f);
    return f;
  }
}

// ---------- embeddings ----------
function stubEmbed(text: string): number[] {
  const dim = 1024;
  const seed = djb2(text);
  const rnd = mulberry32(seed);
  const v = new Array<number>(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const x = rnd() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i]! *= inv;
  return v;
}

async function embedTexts(
  texts: string[],
  opts: AnalyzeOptions,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const provider = makeProvider(opts);
  const embedder =
    provider && opts.embeddingModel ? provider.textEmbeddingModel(opts.embeddingModel) : null;
  // No real embedder configured — `stubEmbed` is deterministic from the text,
  // so caching it would just waste DB rows. Compute on the fly.
  if (!embedder) return texts.map((t) => stubEmbed(t));

  const modelKey = opts.embeddingModel ?? "default";
  const out: (number[] | null)[] = new Array<number[] | null>(texts.length).fill(null);
  const hashes = texts.map((t) => sha256Hex(t));

  // Phase 1: serve everything we can from disk. Identical text + model →
  // identical vector, so a re-analyze pass with no new transcripts pays
  // O(N hash + lookups) instead of O(N API calls).
  const missIndices: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const cached = getCachedEmbedding(hashes[i]!, modelKey);
    if (cached) out[i] = cached;
    else missIndices.push(i);
  }

  if (missIndices.length === 0) {
    return out as number[][];
  }

  // Phase 2: embed the misses in batches, then persist them so the next run
  // hits the cache. Within one call, dedupe identical missing texts so we
  // don't pay twice for the same string in the same batch.
  const uniqueMisses = new Map<string, { text: string; indices: number[] }>();
  for (const i of missIndices) {
    const h = hashes[i]!;
    const e = uniqueMisses.get(h);
    if (e) e.indices.push(i);
    else uniqueMisses.set(h, { text: texts[i]!, indices: [i] });
  }
  const uniqueEntries = Array.from(uniqueMisses.entries());
  const batchSize = 32;
  let useStub = false;
  const persistRows: Array<{ textHash: string; model: string; vector: number[] }> = [];
  for (let i = 0; i < uniqueEntries.length; i += batchSize) {
    const batch = uniqueEntries.slice(i, i + batchSize);
    const batchTexts = batch.map(([, v]) => v.text);
    if (useStub) {
      for (let k = 0; k < batch.length; k++) {
        const v = stubEmbed(batchTexts[k]!);
        for (const idx of batch[k]![1].indices) out[idx] = v;
      }
      continue;
    }
    try {
      const { embeddings } = await embedMany({ model: embedder, values: batchTexts });
      for (let k = 0; k < embeddings.length; k++) {
        const vec = embeddings[k] as number[];
        const [hash, info] = batch[k]!;
        for (const idx of info.indices) out[idx] = vec;
        persistRows.push({ textHash: hash, model: modelKey, vector: vec });
      }
    } catch {
      // Fall back to deterministic stub for the rest of the run; don't cache
      // stub vectors since they're free to recompute and we don't want them
      // to poison the persistent cache for the real model.
      useStub = true;
      for (let k = 0; k < batch.length; k++) {
        const v = stubEmbed(batchTexts[k]!);
        for (const idx of batch[k]![1].indices) out[idx] = v;
      }
    }
  }

  if (persistRows.length > 0) putCachedEmbeddings(persistRows);
  return out as number[][];
}

// ---------- clustering ----------
function greedyCluster(vectors: number[][], threshold = 0.78): number[] {
  const labels = new Array<number>(vectors.length).fill(-1);
  const centroids: number[][] = [];
  const counts: number[] = [];
  for (let i = 0; i < vectors.length; i++) {
    let bestC = -1;
    let bestSim = -1;
    for (let c = 0; c < centroids.length; c++) {
      const sim = cosine(vectors[i]!, centroids[c]!);
      if (sim > bestSim) {
        bestSim = sim;
        bestC = c;
      }
    }
    if (bestSim >= threshold && bestC >= 0) {
      labels[i] = bestC;
      const cnt = counts[bestC]! + 1;
      const cent = centroids[bestC]!;
      for (let k = 0; k < cent.length; k++) {
        cent[k] = (cent[k]! * counts[bestC]! + vectors[i]![k]!) / cnt;
      }
      counts[bestC] = cnt;
    } else {
      labels[i] = centroids.length;
      centroids.push([...vectors[i]!]);
      counts.push(1);
    }
  }
  return labels;
}

function kmeansCluster(vectors: number[][], k: number): number[] {
  if (vectors.length <= k) return vectors.map((_, i) => i);
  const result = kmeans(vectors, k, { initialization: "kmeans++", seed: 42 });
  return result.clusters;
}

function clusterCount(n: number): number {
  return Math.min(14, Math.max(6, Math.round(Math.sqrt(n / 2))));
}

// ---------- user assignment ----------
function looksLikeRealHandle(raw: string): boolean {
  // Heuristic: if it contains @ or a dot in a non-uuid way, or short slug.
  if (/@/.test(raw)) return true;
  if (/^[a-z][a-z0-9._-]{1,30}$/i.test(raw) && !/^[0-9a-f-]{20,}$/i.test(raw)) return true;
  return false;
}

function assignUsers(
  raws: RawParse[],
): { users: User[]; rawById: Map<string, string>; idByRaw: Map<string | null, string> } {
  // Sort distinct raw user ids by first-seen order.
  const firstSeen = new Map<string, number>();
  for (const r of raws) {
    const key = r.rawUserId ?? "__anon__";
    if (!firstSeen.has(key)) firstSeen.set(key, new Date(r.startedAt).getTime());
  }
  const sortedRaws = Array.from(firstSeen.entries()).sort((a, b) => a[1] - b[1]).map((x) => x[0]);

  // Reuse prior id assignments where possible so re-runs are stable.
  const priorMappings = listRawUserMappings();
  const priorByRaw = new Map<string | null, string>();
  for (const m of priorMappings) priorByRaw.set(m.raw_user_id, m.id);
  const priorTaken = new Set(priorMappings.map((m) => m.id));

  const users: User[] = [];
  const idByRaw = new Map<string | null, string>();
  const rawById = new Map<string, string>();
  let nextIdx = 1;
  for (const rawKey of sortedRaws) {
    const lookupKey = rawKey === "__anon__" ? null : rawKey;
    let id = priorByRaw.get(lookupKey) ?? null;
    if (!id) {
      while (priorTaken.has(`u${nextIdx}`)) nextIdx++;
      id = `u${nextIdx++}`;
      priorTaken.add(id);
    }
    idByRaw.set(lookupKey, id);
    if (lookupKey) rawById.set(id, lookupKey);

    let displayName: string;
    if (lookupKey && looksLikeRealHandle(lookupKey)) {
      displayName = lookupKey;
    } else {
      const seedKey = lookupKey ?? "anonymous";
      const idx = djb2(seedKey) % NAMES.length;
      displayName = NAMES[idx]!;
    }
    const teamSeed = lookupKey ?? "anonymous";
    const team = TEAMS[djb2(teamSeed) % TEAMS.length]!;

    users.push({
      id,
      displayName,
      team,
      avatarSeed: id,
      sessionCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      totalWasteUsd: 0,
      wizardScore: 0,
      outcomes: { fully: 0, mostly: 0, partial: 0, none: 0, unclear: 0 },
      topTools: {},
      topFrictions: {},
      winRate: 0,
      costPerWin: 0,
      lastActiveAt: new Date(0).toISOString(),
      sessionsLast7d: 0,
      persona: "lurker",
      topFrictionLabel: "no recurring friction",
    });
  }
  return { users, rawById, idByRaw };
}

// ---------- core pipeline ----------
async function runPipeline(
  sessionIds: string[],
  opts: AnalyzeOptions,
): Promise<{ userCount: number; sessionCount: number; clusterCount: number }> {
  const concurrency = opts.concurrency ?? 8;
  const llmAvailable = !!(opts.apiBaseUrl && opts.apiKey && opts.model);
  const onProgress = opts.onProgress ?? (() => {});

  // ---- parse ----
  onProgress({ stage: "parse", done: 0, total: sessionIds.length });
  const raws: RawParse[] = [];
  for (let i = 0; i < sessionIds.length; i++) {
    const r = parseSessionFromDb(sessionIds[i]!);
    if (r) raws.push(r);
    onProgress({ stage: "parse", done: i + 1, total: sessionIds.length });
  }

  // ---- user assignment ----
  const { users, idByRaw } = assignUsers(raws);

  // ---- LLM extraction ----
  onProgress({ stage: "extract", done: 0, total: raws.length });
  const limit = pLimit(concurrency);
  let done = 0;
  const extracted = new Map<string, Extracted>();
  await Promise.all(
    raws.map((r) =>
      limit(async () => {
        const ex = await extractFacets(r, opts, llmAvailable);
        extracted.set(r.sessionId, ex);
        done++;
        onProgress({ stage: "extract", done, total: raws.length });
      }),
    ),
  );

  // ---- collect texts for embedding/clustering ----
  const askTexts: string[] = [];
  const askKey: { sessionId: string; userId: string; idx: number; outcome: string }[] = [];
  const unresolvedTexts: string[] = [];
  const unresolvedKey: { sessionId: string; userId: string; idx: number; outcome: string }[] = [];
  for (const r of raws) {
    const ex = extracted.get(r.sessionId)!;
    const userId = idByRaw.get(r.rawUserId) ?? "u1";
    for (let i = 0; i < ex.asks.length; i++) {
      askTexts.push(ex.asks[i]!.text);
      askKey.push({ sessionId: r.sessionId, userId, idx: i, outcome: ex.outcome });
    }
    for (let i = 0; i < ex.unresolved.length; i++) {
      const u = ex.unresolved[i]!;
      unresolvedTexts.push(`${u.topic}: ${u.framing}`);
      unresolvedKey.push({ sessionId: r.sessionId, userId, idx: i, outcome: ex.outcome });
    }
  }
  const firstPrompts = raws.map((r) => r.firstPrompt || "(empty)");

  onProgress({ stage: "embed", done: 0, total: 3 });
  const askVecs = await embedTexts(askTexts, opts);
  onProgress({ stage: "embed", done: 1, total: 3 });
  const unresolvedVecs = await embedTexts(unresolvedTexts, opts);
  onProgress({ stage: "embed", done: 2, total: 3 });
  const firstPromptVecs = await embedTexts(firstPrompts, opts);
  onProgress({ stage: "embed", done: 3, total: 3 });

  // cluster asks
  let askLabels: number[] = [];
  if (askVecs.length > 0) {
    const k = Math.min(clusterCount(askVecs.length), Math.max(1, askVecs.length - 1));
    askLabels = askVecs.length <= 2 ? askVecs.map(() => 0) : kmeansCluster(askVecs, k);
  }
  let unresolvedLabels: number[] = [];
  if (unresolvedVecs.length > 0) {
    const k = Math.min(
      clusterCount(unresolvedVecs.length),
      Math.max(1, unresolvedVecs.length - 1),
    );
    unresolvedLabels =
      unresolvedVecs.length <= 2 ? unresolvedVecs.map(() => 0) : kmeansCluster(unresolvedVecs, k);
  }
  let fpLabels: number[] = [];
  if (firstPromptVecs.length > 0) {
    fpLabels = greedyCluster(firstPromptVecs, 0.85);
  }

  function buildClusters(
    type: "ask" | "unresolved",
    labels: number[],
    vecs: number[][],
    keys: { sessionId: string; userId: string; idx: number; outcome: string }[],
    sampleTexts: string[],
  ): {
    clusters: Cluster[];
    labelToClusterId: Map<number, string>;
    centroids: number[][];
  } {
    const groups = new Map<number, number[]>();
    labels.forEach((l, i) => {
      if (!groups.has(l)) groups.set(l, []);
      groups.get(l)!.push(i);
    });
    const clusters: Cluster[] = [];
    const labelToId = new Map<number, string>();
    const centroids: number[][] = [];
    let cidx = 0;
    for (const [lab, idxs] of groups) {
      const cid = `${type}-c${cidx}`;
      labelToId.set(lab, cid);
      cidx++;
      const dim = vecs[0]?.length ?? 0;
      const cent = new Array<number>(dim).fill(0);
      for (const i of idxs)
        for (let d = 0; d < dim; d++) cent[d]! += vecs[i]![d]!;
      for (let d = 0; d < dim; d++) cent[d]! /= idxs.length;
      centroids.push(cent);

      const sessionIdsSet = new Set<string>();
      const userIdsSet = new Set<string>();
      const outcomeScores: number[] = [];
      const outcomeMap: Record<string, number> = {
        fully: 1.0,
        mostly: 0.75,
        partial: 0.5,
        none: 0.0,
        unclear: 0.5,
      };
      for (const i of idxs) {
        sessionIdsSet.add(keys[i]!.sessionId);
        userIdsSet.add(keys[i]!.userId);
        outcomeScores.push(outcomeMap[keys[i]!.outcome] ?? 0.5);
      }
      const avgOutcome =
        outcomeScores.length > 0
          ? outcomeScores.reduce((a, b) => a + b, 0) / outcomeScores.length
          : 0.5;
      const unresolvedShare =
        type === "unresolved"
          ? 1
          : outcomeScores.filter((s) => s < 0.5).length / Math.max(1, outcomeScores.length);
      const severity = (1 - avgOutcome) * unresolvedShare;

      clusters.push({
        id: cid,
        label: sampleTexts[idxs[0]!]?.slice(0, 60) ?? "(unlabeled)",
        domain: "other",
        type,
        size: idxs.length,
        sessionCount: sessionIdsSet.size,
        userCount: userIdsSet.size,
        avgOutcomeScore: avgOutcome,
        unresolvedCount: type === "unresolved" ? idxs.length : 0,
        severity,
        topFrictions: [],
        centroid3d: [0, 0, 0],
        members: Array.from(sessionIdsSet),
      });
    }
    return { clusters, labelToClusterId: labelToId, centroids };
  }

  const askResult = buildClusters("ask", askLabels, askVecs, askKey, askTexts);
  const unresolvedResult = buildClusters(
    "unresolved",
    unresolvedLabels,
    unresolvedVecs,
    unresolvedKey,
    unresolvedTexts,
  );

  const askClusterIdByKey = new Map<string, string>();
  askLabels.forEach((l, i) => {
    const k = `${askKey[i]!.sessionId}:${askKey[i]!.idx}`;
    askClusterIdByKey.set(k, askResult.labelToClusterId.get(l)!);
  });
  const unrClusterIdByKey = new Map<string, string>();
  unresolvedLabels.forEach((l, i) => {
    const k = `${unresolvedKey[i]!.sessionId}:${unresolvedKey[i]!.idx}`;
    unrClusterIdByKey.set(k, unresolvedResult.labelToClusterId.get(l)!);
  });

  // ---- 3D UMAP projection ----
  const allCentroids = [...askResult.centroids, ...unresolvedResult.centroids];
  let centroid3d: number[][] = [];
  if (allCentroids.length >= 4) {
    const u = new UMAP({
      nComponents: 3,
      nNeighbors: Math.min(allCentroids.length - 1, 5),
      minDist: 0.3,
      random: mulberry32(42),
    });
    centroid3d = u.fit(allCentroids);
    let minV = Infinity;
    let maxV = -Infinity;
    for (const v of centroid3d)
      for (const x of v) {
        if (x < minV) minV = x;
        if (x > maxV) maxV = x;
      }
    const range = maxV - minV || 1;
    centroid3d = centroid3d.map((v) =>
      v.map((x) => ((x - minV) / range) * 20 - 10),
    );
  } else {
    centroid3d = allCentroids.map((_, i) => [
      Math.cos(i) * 5,
      Math.sin(i) * 5,
      ((i % 4) - 2) * 3,
    ]);
  }
  for (let i = 0; i < askResult.clusters.length; i++) {
    const v = centroid3d[i] ?? [0, 0, 0];
    askResult.clusters[i]!.centroid3d = [v[0]!, v[1]!, v[2]!];
  }
  for (let i = 0; i < unresolvedResult.clusters.length; i++) {
    const v = centroid3d[askResult.clusters.length + i] ?? [0, 0, 0];
    unresolvedResult.clusters[i]!.centroid3d = [v[0]!, v[1]!, v[2]!];
  }

  // ---- cluster labeling ----
  onProgress({
    stage: "label",
    done: 0,
    total: askResult.clusters.length + unresolvedResult.clusters.length,
  });
  const labelLimit = pLimit(concurrency);
  let labelDone = 0;
  const totalLabel = askResult.clusters.length + unresolvedResult.clusters.length;
  await Promise.all([
    ...askResult.clusters.map((c) =>
      labelLimit(async () => {
        const samples: string[] = [];
        askLabels.forEach((l, i) => {
          if (askResult.labelToClusterId.get(l) === c.id && samples.length < 8) {
            samples.push(askTexts[i]!);
          }
        });
        const { label, domain } = await labelCluster(c, samples, opts, llmAvailable);
        c.label = label;
        c.domain = domain;
        labelDone++;
        onProgress({ stage: "label", done: labelDone, total: totalLabel });
      }),
    ),
    ...unresolvedResult.clusters.map((c) =>
      labelLimit(async () => {
        const samples: string[] = [];
        unresolvedLabels.forEach((l, i) => {
          if (
            unresolvedResult.labelToClusterId.get(l) === c.id &&
            samples.length < 8
          ) {
            samples.push(unresolvedTexts[i]!);
          }
        });
        const { label, domain } = await labelCluster(c, samples, opts, llmAvailable);
        c.label = label;
        c.domain = domain;
        labelDone++;
        onProgress({ stage: "label", done: labelDone, total: totalLabel });
      }),
    ),
  ]);

  // ---- build SessionMeta + waste flags ----
  const throughputs: number[] = raws.map((r) => {
    const tu = Object.values(r.tools).reduce((a, b) => a + b, 0);
    return tu / Math.max(1, r.tokens.output);
  });
  const tpMean = throughputs.reduce((a, b) => a + b, 0) / Math.max(1, throughputs.length);
  const tpStd =
    Math.sqrt(
      throughputs.reduce((a, b) => a + (b - tpMean) ** 2, 0) /
        Math.max(1, throughputs.length),
    ) || 1;
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

  const fpClusterUsers = new Map<number, Set<string>>();
  fpLabels.forEach((l, i) => {
    const userId = idByRaw.get(raws[i]!.rawUserId) ?? "u1";
    if (!fpClusterUsers.has(l)) fpClusterUsers.set(l, new Set());
    fpClusterUsers.get(l)!.add(userId);
  });
  const redundantClusters = new Set<number>();
  for (const [l, set] of fpClusterUsers) {
    if (set.size > 5) redundantClusters.add(l);
  }

  const sessions: SessionMeta[] = raws.map((r, idx) => {
    const ex = extracted.get(r.sessionId)!;
    const userId = idByRaw.get(r.rawUserId) ?? "u1";

    const wasteFlags: WasteFlag[] = [];
    const opusCost = r.modelTurnCosts
      .filter((m) => m.model.includes("opus"))
      .reduce((a, m) => a + m.cost, 0);
    const opusTokens = r.modelTurnCosts
      .filter((m) => m.model.includes("opus"))
      .reduce(
        (a, m) => a + (m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0),
        0,
      );
    if (ex.task_hardness <= 2 && opusCost > 0) {
      const hp = priceFor("claude-haiku-4-5");
      let haikuEquivCost = 0;
      for (const m of r.modelTurnCosts) {
        if (m.model.includes("opus")) {
          const u = m.usage ?? {};
          haikuEquivCost +=
            ((u.input_tokens ?? 0) * hp.input +
              (u.output_tokens ?? 0) * hp.output +
              (u.cache_read_input_tokens ?? 0) * hp.cacheRead +
              (u.cache_creation_input_tokens ?? 0) * hp.cacheWrite) /
            1e6;
        }
      }
      const wasted = Math.max(0, opusCost - haikuEquivCost);
      if (wasted > 0) {
        wasteFlags.push({
          type: "wrong_model",
          tokensWasted: opusTokens,
          usdWasted: wasted,
          evidence: `opus used on hardness=${ex.task_hardness}`,
        });
      }
    }
    if (r.retryLoops > 0) {
      const avgPerTurn = r.costUsd / Math.max(1, r.modelTurnCosts.length);
      const wasted = avgPerTurn * r.retryLoops * 2;
      const tokensWasted = Math.round(
        ((r.tokens.input + r.tokens.output) / Math.max(1, r.modelTurnCosts.length)) *
          r.retryLoops *
          2,
      );
      wasteFlags.push({
        type: "retry_loop",
        tokensWasted,
        usdWasted: wasted,
        evidence: `${r.retryLoops} duplicate tool_use within k=5`,
      });
    }
    if (r.abandoned) {
      wasteFlags.push({
        type: "abandoned",
        tokensWasted: r.tokens.input + r.tokens.output,
        usdWasted: r.costUsd,
        evidence: "tool_result errors at end with no human reply",
      });
    }
    if (r.tokens.input > 100000) {
      const tu = Object.values(r.tools).reduce((a, b) => a + b, 0);
      const ratio = tu / Math.max(1, r.tokens.input);
      if (ratio < 0.0002) {
        const inputCost =
          (r.tokens.input * priceFor(Object.keys(r.models)[0] ?? "").input) / 1e6;
        wasteFlags.push({
          type: "context_bloat",
          tokensWasted: Math.round(r.tokens.input * 0.3),
          usdWasted: inputCost * 0.3,
          evidence: `input=${r.tokens.input} tool_uses=${tu}`,
        });
      }
    }
    if (redundantClusters.has(fpLabels[idx] ?? -1)) {
      wasteFlags.push({
        type: "redundant_prompt",
        tokensWasted: Math.round((r.tokens.input + r.tokens.output) / 2),
        usdWasted: r.costUsd / 2,
        evidence: "first prompt overlaps a high-frequency cluster",
      });
    }
    const wasteUsd = wasteFlags.reduce((a, w) => a + w.usdWasted, 0);

    const tpZ = (throughputs[idx]! - tpMean) / tpStd;
    const tpNorm = sigmoid(tpZ);
    const toolUseTotal = Object.values(r.tools).reduce((a, b) => a + b, 0);
    const firstShotSuccess = 1 - r.toolErrors / Math.max(1, toolUseTotal);
    const cacheHit = r.tokens.cacheRead / Math.max(1, r.tokens.input + r.tokens.cacheRead);
    const editEff = 1 - r.branchPoints / Math.max(1, r.turns);
    const reqTier =
      ex.task_hardness <= 2 ? "easy" : ex.task_hardness === 3 ? "med" : "hard";
    let iqHits = 0;
    let iqTotal = 0;
    for (const [m, count] of Object.entries(r.models)) {
      const tier = m.includes("opus")
        ? "hard"
        : m.includes("sonnet")
          ? "med"
          : m.includes("haiku")
            ? "easy"
            : "med";
      iqTotal += count;
      if (tier === reqTier) iqHits += count;
    }
    const modelIQ = iqTotal > 0 ? iqHits / iqTotal : 0.5;
    const wizardScore =
      0.25 * tpNorm +
      0.25 * firstShotSuccess +
      0.2 * cacheHit +
      0.15 * editEff +
      0.15 * modelIQ;

    const asks: Ask[] = ex.asks.map((a, i) => ({
      ...a,
      clusterId: askClusterIdByKey.get(`${r.sessionId}:${i}`),
    }));
    const unresolved: Unresolved[] = ex.unresolved.map((u, i) => ({
      ...u,
      clusterId: unrClusterIdByKey.get(`${r.sessionId}:${i}`),
    }));

    const meta: SessionMeta = {
      sessionId: r.sessionId,
      userId,
      filePath: r.filePath,
      projectName: r.projectName,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationMinutes: Math.round(r.durationMinutes * 10) / 10,
      userMessageCount: r.userMessageCount,
      assistantMessageCount: r.assistantMessageCount,
      turns: r.turns,
      tokens: r.tokens,
      models: r.models,
      tools: r.tools,
      toolErrors: r.toolErrors,
      toolErrorCategories: r.toolErrorCategories,
      userInterruptions: r.userInterruptions,
      branchPoints: r.branchPoints,
      retryLoops: r.retryLoops,
      abandoned: r.abandoned,
      linesAdded: r.linesAdded,
      linesRemoved: r.linesRemoved,
      filesModified: r.filesModified,
      costUsd: r.costUsd,
      wasteUsd,
      wasteFlags,
      wizardScore,
      goal: ex.goal,
      outcome: ex.outcome,
      sessionType: ex.session_type,
      friction: ex.friction,
      primarySuccess: ex.primary_success,
      briefSummary: ex.brief_summary,
      asks,
      unresolved,
      firstPrompt: r.firstPrompt,
    };
    return meta;
  });

  // ---- per-cluster topFrictions ----
  function setTopFrictions(clusters: Cluster[]) {
    for (const c of clusters) {
      const counts: Record<string, number> = {};
      for (const sid of c.members) {
        const s = sessions.find((x) => x.sessionId === sid);
        if (!s) continue;
        for (const f of s.friction) counts[f] = (counts[f] ?? 0) + 1;
      }
      c.topFrictions = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map((x) => x[0]);
    }
  }
  setTopFrictions(askResult.clusters);
  setTopFrictions(unresolvedResult.clusters);

  // ---- aggregate user metrics ----
  for (const u of users) {
    const userSessions = sessions.filter((s) => s.userId === u.id);
    u.sessionCount = userSessions.length;
    u.totalTokens = userSessions.reduce(
      (a, s) => a + s.tokens.input + s.tokens.output,
      0,
    );
    u.totalCostUsd = userSessions.reduce((a, s) => a + s.costUsd, 0);
    u.totalWasteUsd = userSessions.reduce((a, s) => a + s.wasteUsd, 0);
    u.wizardScore =
      userSessions.length > 0
        ? userSessions.reduce((a, s) => a + s.wizardScore, 0) / userSessions.length
        : 0;
    const out = { fully: 0, mostly: 0, partial: 0, none: 0, unclear: 0 };
    for (const s of userSessions) out[s.outcome]++;
    u.outcomes = out;
    const toolsAgg: Record<string, number> = {};
    const fric: Record<string, number> = {};
    for (const s of userSessions) {
      for (const [k, v] of Object.entries(s.tools)) toolsAgg[k] = (toolsAgg[k] ?? 0) + v;
      for (const f of s.friction) fric[f] = (fric[f] ?? 0) + 1;
    }
    u.topTools = Object.fromEntries(
      Object.entries(toolsAgg).sort((a, b) => b[1] - a[1]).slice(0, 5),
    );
    u.topFrictions = Object.fromEntries(
      Object.entries(fric).sort((a, b) => b[1] - a[1]).slice(0, 5),
    );

    const totalOutcomes =
      out.fully + out.mostly + out.partial + out.none + out.unclear;
    const wins = out.fully + out.mostly;
    u.winRate = totalOutcomes > 0 ? wins / totalOutcomes : 0;
    u.costPerWin = wins > 0 ? u.totalCostUsd / wins : u.totalCostUsd;
    u.lastActiveAt =
      userSessions.map((s) => s.startedAt).sort().at(-1) ??
      new Date(0).toISOString();
    u.sessionsLast7d = 0;
    u.persona = "lurker";
    u.topFrictionLabel = frictionLabel(Object.keys(u.topFrictions)[0]);
  }

  // ---- aggregates ----
  const allTools: Record<string, number> = {};
  const modelMix: Record<string, number> = {};
  const outcomeMix: Record<string, number> = {};
  const frictionMix: Record<string, number> = {};
  const wasteByType: Record<string, { tokens: number; usd: number; sessions: number }> = {};
  let totalTokens = 0;
  let totalCost = 0;
  let totalWaste = 0;
  let dateStart = "";
  let dateEnd = "";
  for (const s of sessions) {
    totalTokens += s.tokens.input + s.tokens.output;
    totalCost += s.costUsd;
    totalWaste += s.wasteUsd;
    if (!dateStart || s.startedAt < dateStart) dateStart = s.startedAt;
    if (!dateEnd || s.endedAt > dateEnd) dateEnd = s.endedAt;
    for (const [k, v] of Object.entries(s.tools)) allTools[k] = (allTools[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.models)) modelMix[k] = (modelMix[k] ?? 0) + v;
    outcomeMix[s.outcome] = (outcomeMix[s.outcome] ?? 0) + 1;
    for (const f of s.friction) frictionMix[f] = (frictionMix[f] ?? 0) + 1;
    const seenTypes = new Set<string>();
    for (const w of s.wasteFlags) {
      if (!wasteByType[w.type])
        wasteByType[w.type] = { tokens: 0, usd: 0, sessions: 0 };
      wasteByType[w.type]!.tokens += w.tokensWasted;
      wasteByType[w.type]!.usd += w.usdWasted;
      if (!seenTypes.has(w.type)) {
        wasteByType[w.type]!.sessions += 1;
        seenTypes.add(w.type);
      }
    }
  }

  const sevenDaysMs = 7 * 86_400_000;
  const endTs = dateEnd ? new Date(dateEnd).getTime() : Date.now();
  for (const u of users) {
    const userSessions = sessions.filter((s) => s.userId === u.id);
    u.sessionsLast7d = userSessions.filter(
      (s) => endTs - new Date(s.startedAt).getTime() <= sevenDaysMs,
    ).length;
    const wastePct = u.totalCostUsd > 0 ? u.totalWasteUsd / u.totalCostUsd : 0;
    const wrongModelWaste = userSessions.reduce(
      (acc, s) =>
        acc +
        s.wasteFlags
          .filter((f) => f.type === "wrong_model")
          .reduce((a, f) => a + f.usdWasted, 0),
      0,
    );
    const modelMismatchShare =
      u.totalWasteUsd > 0 ? wrongModelWaste / u.totalWasteUsd : 0;
    u.persona = inferPersona({
      sessionsTotal: u.sessionCount,
      sessionsLast7d: u.sessionsLast7d,
      winRate: u.winRate,
      wastePct,
      modelMismatchShare,
    });
  }

  const totalWins = (outcomeMix.fully ?? 0) + (outcomeMix.mostly ?? 0);
  const allOutcomes =
    (outcomeMix.fully ?? 0) +
    (outcomeMix.mostly ?? 0) +
    (outcomeMix.partial ?? 0) +
    (outcomeMix.none ?? 0) +
    (outcomeMix.unclear ?? 0);

  const aggregates: Aggregates = {
    totalSessions: sessions.length,
    totalUsers: users.length,
    totalTokens,
    totalCostUsd: totalCost,
    totalWasteUsd: totalWaste,
    productiveUsd: Math.max(0, totalCost - totalWaste),
    firmWinRate: allOutcomes > 0 ? totalWins / allOutcomes : 0,
    adoptionPct:
      users.length > 0
        ? users.filter((u) => u.sessionsLast7d >= 2).length / users.length
        : 0,
    costPerLandedOutcome: totalWins > 0 ? totalCost / totalWins : totalCost,
    prevPeriodCostUsd: null,
    dateRange: { start: dateStart, end: dateEnd },
    toolCounts: allTools,
    modelMix,
    outcomeMix,
    frictionMix,
    wasteByType,
  };

  // ---- persist ----
  onProgress({ stage: "persist", done: 0, total: 1 });
  const config: Dataset["config"] = {
    maxSessions: null,
    users: users.length,
    model: opts.model ?? "",
    embeddingModel: opts.embeddingModel ?? null,
    apiBaseUrl: opts.apiBaseUrl ?? "",
  };
  const tx = db.transaction(() => {
    for (const u of users) {
      const raw = u.id;
      // Resolve raw_user_id by reverse-lookup on idByRaw.
      let rawUid: string | null = null;
      for (const [k, v] of idByRaw) if (v === u.id) rawUid = k ?? null;
      void raw;
      upsertUser(u, rawUid);
    }
    for (const s of sessions) upsertSession(s);
    for (const c of [...askResult.clusters, ...unresolvedResult.clusters])
      upsertCluster(c);
    setAggregates(aggregates);
    setConfig(config);
    setGeneratedAt(new Date().toISOString());
  });
  tx();
  onProgress({ stage: "persist", done: 1, total: 1 });

  return {
    userCount: users.length,
    sessionCount: sessions.length,
    clusterCount: askResult.clusters.length + unresolvedResult.clusters.length,
  };
}

async function labelCluster(
  cluster: Cluster,
  samples: string[],
  opts: AnalyzeOptions,
  llmAvailable: boolean,
): Promise<{ label: string; domain: Cluster["domain"] }> {
  const allowedDomains: Cluster["domain"][] = [
    "strategy",
    "code",
    "research",
    "writing",
    "data",
    "ops",
    "other",
  ];
  const safeDomainOf = (raw: string): Cluster["domain"] => {
    const dom = raw.toLowerCase();
    return (allowedDomains as string[]).includes(dom)
      ? (dom as Cluster["domain"])
      : "other";
  };
  if (!llmAvailable || samples.length === 0) {
    return { label: cluster.label || "Untitled", domain: "other" };
  }

  // Content-addressed: identical sample bag (in canonical order, capped at 8)
  // produces the same label + domain on the configured model. Re-analyzing a
  // stable corpus reuses every label without a single LLM call.
  const canonicalSamples = samples.slice(0, 8);
  const samplesHash = sha256Hex(
    JSON.stringify([...canonicalSamples].sort()),
  );
  const modelKey = opts.model ?? "default";
  const cached = getCachedClusterLabel(samplesHash, modelKey);
  if (cached) {
    return { label: cached.label, domain: safeDomainOf(cached.domain) };
  }

  try {
    const object = await chatJSON(
      opts,
      `Given these sample user requests, output a JSON object {"label": "...", "domain": "..."}.
- label: short noun phrase, 3-6 words, no quotes, no leading verbs like "add" or "fix" — describe the topic.
- domain: one of strategy|code|research|writing|data|ops|other.

Samples:
${canonicalSamples.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
      z.object({ label: z.string(), domain: z.string() }),
      { maxTokens: 200 },
    );
    const label = object.label || "Untitled";
    const domain = safeDomainOf(object.domain ?? "other");
    putCachedClusterLabel(samplesHash, modelKey, label, domain);
    return { label, domain };
  } catch {
    return { label: cluster.label || "Untitled", domain: "other" };
  }
}

// ---------- public entry points ----------
export async function runAnalyzeAll(
  opts: AnalyzeOptions,
): Promise<{ userCount: number; sessionCount: number; clusterCount: number }> {
  const sessionRows = db
    .prepare(`SELECT id FROM sessions ORDER BY created_at ASC`)
    .all() as { id: string }[];
  const ids = sessionRows.map((r) => r.id);
  return runPipeline(ids, opts);
}

export async function runAnalyzeSession(
  sessionId: string,
  opts: AnalyzeOptions,
): Promise<void> {
  await runPipeline([sessionId], opts);
}

// keep getUserIdByRaw imported (not currently called but kept for symmetry/
// the other agent might rely on it); reference here so tsc treats as used.
void getUserIdByRaw;
