#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { resolve, basename, dirname, join } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany } from "ai";
import { z } from "zod";
import pLimit from "p-limit";
import { kmeans } from "ml-kmeans";
import { UMAP } from "umap-js";
import type {
  Dataset,
  SessionMeta,
  User,
  Cluster,
  Aggregates,
  Ask,
  Unresolved,
  WasteFlag,
} from "../src/types.ts";

// ---------- CLI ----------
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "max-sessions": { type: "string" },
    users: { type: "string", default: "1" },
    "api-base-url": { type: "string" },
    "api-key": { type: "string" },
    "api-key-env": { type: "string" },
    model: { type: "string" },
    "embedding-model": { type: "string" },
    out: { type: "string", default: "public/sessions.json" },
    "sessions-dir": {
      type: "string",
      default: `${homedir()}/.claude/projects`,
    },
    concurrency: { type: "string", default: "8" },
    "no-cache": { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: false,
});

function required(name: string, v: string | undefined): string {
  if (!v) {
    console.error(`missing required flag: --${name}`);
    process.exit(1);
  }
  return v;
}

const argv = {
  maxSessions: values["max-sessions"]
    ? Number.parseInt(values["max-sessions"], 10)
    : null,
  users: Number.parseInt(values.users ?? "1", 10),
  apiBaseUrl: required("api-base-url", values["api-base-url"]),
  apiKey: (() => {
    const direct = values["api-key"];
    const envName = values["api-key-env"];
    const fromEnv = envName ? process.env[envName] : undefined;
    const key = direct || fromEnv;
    if (!key) {
      console.error("missing required flag: --api-key or --api-key-env");
      process.exit(1);
    }
    return key;
  })(),
  model: required("model", values.model),
  embeddingModel: values["embedding-model"] || null,
  out: resolve(values.out!),
  sessionsDir: resolve(values["sessions-dir"]!),
  concurrency: Number.parseInt(values.concurrency ?? "8", 10),
  noCache: !!values["no-cache"],
};

const CACHE_DIR = resolve(".cache");
await mkdir(CACHE_DIR, { recursive: true });

// ---------- provider ----------
const provider = createOpenAICompatible({
  name: "box",
  baseURL: argv.apiBaseUrl,
  apiKey: argv.apiKey,
});
const embedder = argv.embeddingModel
  ? provider.textEmbeddingModel(argv.embeddingModel)
  : null;

// Direct chat-completions JSON helper. Bypasses the AI SDK's structured-output
// path because gpt-oss-style reasoning models burn the budget on hidden
// reasoning unless reasoning_effort is "low". Returns a zod-parsed object.
async function chatJSON<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts: { maxTokens?: number; reasoningEffort?: "low" | "medium" | "high" } = {},
): Promise<T> {
  const url = `${argv.apiBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: argv.model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: opts.maxTokens ?? 2000,
    reasoning_effort: opts.reasoningEffort ?? "low",
    temperature: 0.2,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${argv.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${await res.text().catch(() => "")}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = j.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("empty content");
  // Strip ```json fences if present
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  const parsed = JSON.parse(stripped);
  return schema.parse(parsed);
}

// ---------- pricing ----------
const PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheCreate: number }
> = {
  "claude-opus-4-7": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheCreate: 18.75,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreate: 3.75,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheCreate: 1.25,
  },
  "claude-opus-4": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheCreate: 18.75,
  },
  "claude-sonnet-4": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreate: 3.75,
  },
};
const DEFAULT_PRICE = { input: 5, output: 15, cacheRead: 0.5, cacheCreate: 6 };

function priceFor(model: string) {
  for (const k of Object.keys(PRICING)) {
    if (model.startsWith(k)) return PRICING[k]!;
  }
  return DEFAULT_PRICE;
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
    (i * p.input + o * p.output + cr * p.cacheRead + cc * p.cacheCreate) / 1e6
  );
}

// ---------- baked names / teams ----------
const NAMES = [
  "Alex Chen",
  "Mira Patel",
  "Jonas Weber",
  "Priya Rao",
  "Léa Dubois",
  "Tomás García",
  "Sara Okonkwo",
  "Hiroshi Tanaka",
  "Isabella Rossi",
  "Mateo Fernández",
  "Yuki Sato",
  "Aisha Khan",
  "Lukas Müller",
  "Camille Laurent",
  "Noa Cohen",
  "Diego Morales",
  "Anya Ivanova",
  "Kwame Mensah",
  "Sofia Lindqvist",
  "Rohan Mehta",
  "Élodie Martin",
  "Ravi Sharma",
  "Olivia Brown",
  "Liam O'Connor",
  "Fatima Al-Sayed",
  "Pierre Lefèvre",
  "Hannah Schmidt",
  "Carlos Ribeiro",
  "Mei Lin",
  "Ahmed Hassan",
  "Eva Novak",
  "Théo Bernard",
  "Nadia Petrova",
  "Jamal Williams",
  "Charlotte Dupont",
  "Ezra Goldberg",
  "Amara Diallo",
  "Niko Korhonen",
  "Valentina Costa",
  "Quentin Roux",
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

// Map a friction tag to manager-readable language. Falls back to a sentence-cased version.
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

// Decide a manager-facing persona from per-user metrics. Returns one of
// "power" | "active" | "stuck" | "lurker" | "misuser".
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

// ---------- discover ----------
async function readFirstLine(filePath: string): Promise<string | null> {
  const file = Bun.file(filePath);
  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      const nl = acc.indexOf("\n");
      if (nl >= 0) {
        await reader.cancel();
        return acc.slice(0, nl);
      }
    }
    return acc.length > 0 ? acc : null;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

async function discoverSessions(
  dir: string,
): Promise<{ filePath: string; firstTs: string }[]> {
  const out: { filePath: string; firstTs: string }[] = [];

  async function walk(d: string): Promise<void> {
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
    try {
      entries = (await readdir(d, { withFileTypes: true })) as any;
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        const line = await readFirstLine(p);
        let ts = "";
        if (line) {
          try {
            const obj = JSON.parse(line);
            if (typeof obj.timestamp === "string") ts = obj.timestamp;
          } catch {}
        }
        if (!ts) {
          const stat = await Bun.file(p).stat?.();
          ts = stat?.mtime
            ? new Date(stat.mtime).toISOString()
            : new Date(0).toISOString();
        }
        out.push({ filePath: p, firstTs: ts });
      }
    }
  }

  await walk(dir);
  out.sort((a, b) => a.firstTs.localeCompare(b.firstTs));
  return out;
}

// ---------- session parsing ----------
type AnyMsg = Record<string, any>;

interface RawParse {
  sessionId: string;
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
  toolUses: { name: string; inputHash: number; turnIdx: number; cost: number }[];
  lastTurnsErr: boolean[];
  hasReplyAfterErrors: boolean;
}

function parseUserContent(content: any): { isHuman: boolean; text: string } {
  if (typeof content === "string") {
    return content.trim().length > 0
      ? { isHuman: true, text: content }
      : { isHuman: false, text: "" };
  }
  if (Array.isArray(content)) {
    let text = "";
    let isHuman = false;
    for (const part of content) {
      if (part?.type === "text" && typeof part.text === "string") {
        text += part.text + "\n";
        if (part.text.trim().length > 0) isHuman = true;
      } else if (part?.type === "tool_result") {
        const tcontent =
          typeof part.content === "string"
            ? part.content
            : Array.isArray(part.content)
              ? part.content
                  .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
                  .join("\n")
              : "";
        text += `[tool_result] ${tcontent}\n`;
      }
    }
    return { isHuman, text: text.trim() };
  }
  return { isHuman: false, text: "" };
}

async function parseJsonl(filePath: string): Promise<AnyMsg[]> {
  const text = await readFile(filePath, "utf-8");
  const out: AnyMsg[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {}
  }
  return out;
}

// Build a structured transcript from a chain of message nodes. The frontend
// renders this in the SessionDrawer / TranscriptViewer so partners can dig
// into the actual conversation rather than just the summary. We cap text per
// event and total event count to keep the JSON file size reasonable.
interface TranscriptEvt {
  t: string;
  type: "user" | "assistant" | "tool_use" | "tool_result" | "thinking" | "interrupt";
  text?: string;
  tool?: string;
  input?: unknown;
  result?: string;
  isError?: boolean;
  model?: string;
}

const TX_MAX_EVENTS = 1500;
const TX_TEXT_CAP = 8000;
const TX_TOOL_INPUT_CAP = 4000;
const TX_TOOL_RESULT_CAP = 4000;

function extractTranscriptEvents(chain: AnyMsg[]): TranscriptEvt[] {
  const events: TranscriptEvt[] = [];
  const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

  for (const node of chain) {
    if (events.length >= TX_MAX_EVENTS) break;
    const t = typeof node.timestamp === "string" ? node.timestamp : "";
    if (node.type === "user") {
      const content = node.message?.content;
      if (typeof content === "string") {
        if (content.trim().length === 0) continue;
        if (/interrupted by user/i.test(content)) {
          events.push({ t, type: "interrupt", text: cap(content, TX_TEXT_CAP) });
        } else {
          events.push({ t, type: "user", text: cap(content, TX_TEXT_CAP) });
        }
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string") {
            if (part.text.trim().length === 0) continue;
            if (/interrupted by user/i.test(part.text)) {
              events.push({ t, type: "interrupt", text: cap(part.text, TX_TEXT_CAP) });
            } else {
              events.push({ t, type: "user", text: cap(part.text, TX_TEXT_CAP) });
            }
          } else if (part?.type === "tool_result") {
            const tcontent =
              typeof part.content === "string"
                ? part.content
                : Array.isArray(part.content)
                  ? part.content
                      .map((q: any) => (typeof q?.text === "string" ? q.text : ""))
                      .join("\n")
                  : "";
            events.push({
              t,
              type: "tool_result",
              result: cap(tcontent, TX_TOOL_RESULT_CAP),
              isError: !!part.is_error,
            });
          }
        }
      }
      continue;
    }
    if (node.type === "assistant") {
      const msg = node.message ?? {};
      const model = typeof msg.model === "string" ? msg.model : undefined;
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const part of content) {
        if (events.length >= TX_MAX_EVENTS) break;
        if (part?.type === "text" && typeof part.text === "string") {
          if (part.text.trim().length === 0) continue;
          events.push({ t, type: "assistant", text: cap(part.text, TX_TEXT_CAP), model });
        } else if (part?.type === "thinking" && typeof part.thinking === "string") {
          events.push({ t, type: "thinking", text: cap(part.thinking, TX_TEXT_CAP) });
        } else if (part?.type === "tool_use") {
          const inputJson = JSON.stringify(part.input ?? {});
          events.push({
            t,
            type: "tool_use",
            tool: part.name ?? "unknown",
            input: inputJson.length > TX_TOOL_INPUT_CAP ? inputJson.slice(0, TX_TOOL_INPUT_CAP) : part.input,
          });
        }
      }
    }
  }
  return events;
}

function pickLeafChain(msgs: AnyMsg[]): AnyMsg[] {
  // filter to message-like nodes (have uuid + parentUuid keys)
  const nodes = msgs.filter(
    (m) => typeof m.uuid === "string" && (m.type === "user" || m.type === "assistant"),
  );
  if (nodes.length === 0) return [];
  const byUuid = new Map<string, AnyMsg>();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    byUuid.set(n.uuid, n);
    const p = n.parentUuid ?? "__root__";
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(n.uuid);
  }
  // find leaves
  const leaves: string[] = [];
  for (const n of nodes) {
    if (!children.has(n.uuid)) leaves.push(n.uuid);
  }
  // for each leaf walk up, count user turns
  let bestChain: AnyMsg[] = [];
  let bestUserCount = -1;
  for (const leaf of leaves) {
    const chain: AnyMsg[] = [];
    let cur: string | null = leaf;
    while (cur) {
      const node = byUuid.get(cur);
      if (!node) break;
      chain.push(node);
      cur = node.parentUuid ?? null;
    }
    chain.reverse();
    const userCount = chain.filter((n) => n.type === "user").length;
    if (userCount > bestUserCount) {
      bestUserCount = userCount;
      bestChain = chain;
    }
  }
  return bestChain;
}

function parseSession(filePath: string, msgs: AnyMsg[]): RawParse {
  const sessionId = basename(filePath, ".jsonl");
  const projectHash = basename(dirname(filePath));

  const chain = pickLeafChain(msgs);

  const allNodes = msgs.filter(
    (m) => typeof m.uuid === "string" && (m.type === "user" || m.type === "assistant"),
  );
  // branchPoints: parents that have multiple children
  const childCount = new Map<string, number>();
  for (const n of allNodes) {
    if (!n.parentUuid) continue;
    childCount.set(n.parentUuid, (childCount.get(n.parentUuid) ?? 0) + 1);
  }
  let branchPoints = 0;
  for (const [, c] of childCount) if (c > 1) branchPoints++;

  let firstTs = "";
  let lastTs = "";
  let cwd: string | undefined;

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
  const toolUses: {
    name: string;
    inputHash: number;
    turnIdx: number;
    cost: number;
  }[] = [];
  const transcriptParts: string[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  const filesTouched = new Set<string>();

  // detect retry loops: same tool name + input hash within window k=5 turns
  let retryLoops = 0;

  // abandoned detection: examine last 3 turns for is_error in tool_result with no human reply after
  const lastErrors: { errorAt: number; humanAfter: boolean }[] = [];

  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!;
    if (typeof node.timestamp === "string") {
      if (!firstTs) firstTs = node.timestamp;
      lastTs = node.timestamp;
    }
    if (typeof node.cwd === "string") cwd = node.cwd;

    if (node.type === "user") {
      const { isHuman, text } = parseUserContent(node.message?.content);
      if (isHuman) {
        userMessageCount++;
        turns++;
        if (!firstPrompt) firstPrompt = text;
        transcriptParts.push(`[U] ${text.slice(0, 2000)}`);
        // user interruption: presence of "[Request interrupted by user]" tokens
        if (/interrupted by user/i.test(text)) userInterruptions++;
      } else {
        // tool_result-only: scan for is_error
        const arr = Array.isArray(node.message?.content) ? node.message.content : [];
        for (const p of arr) {
          if (p?.type === "tool_result") {
            const errFlag = !!p.is_error;
            const tcontent =
              typeof p.content === "string"
                ? p.content
                : Array.isArray(p.content)
                  ? p.content
                      .map((q: any) =>
                        typeof q?.text === "string" ? q.text : "",
                      )
                      .join("\n")
                  : "";
            if (errFlag || /error/i.test(tcontent.slice(0, 200))) {
              toolErrors++;
              const cat = categorizeToolError(tcontent);
              toolErrorCategories[cat] = (toolErrorCategories[cat] ?? 0) + 1;
              transcriptParts.push(`[error] ${tcontent.slice(0, 400)}`);
              lastErrors.push({ errorAt: i, humanAfter: false });
            } else {
              transcriptParts.push(`[tool_result] ${tcontent.slice(0, 300)}`);
            }
          }
        }
      }
      continue;
    }

    // assistant
    assistantMessageCount++;
    const msg = node.message ?? {};
    const model = typeof msg.model === "string" ? msg.model : "unknown";
    models[model] = (models[model] ?? 0) + 1;
    const usage = msg.usage ?? {};
    tokens.input += usage.input_tokens ?? 0;
    tokens.output += usage.output_tokens ?? 0;
    tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
    tokens.cacheCreate += usage.cache_creation_input_tokens ?? 0;
    const c = turnCost(model, usage);
    costUsd += c;
    modelTurnCosts.push({ model, cost: c, usage });

    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (part?.type === "text" && typeof part.text === "string") {
        transcriptParts.push(`[A] ${part.text.slice(0, 2000)}`);
      } else if (part?.type === "tool_use") {
        const name = part.name ?? "unknown";
        tools[name] = (tools[name] ?? 0) + 1;
        const inputJson = JSON.stringify(part.input ?? {});
        const ih = djb2(name + "|" + inputJson);
        toolUses.push({ name, inputHash: ih, turnIdx: i, cost: c });
        transcriptParts.push(
          `[tool: ${name}] ${inputJson.slice(0, 300)}`,
        );

        // line tracking via Edit/Write tool inputs
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
  }

  // retry loops: scan toolUses with same hash within window 5
  for (let i = 0; i < toolUses.length; i++) {
    for (let j = i + 1; j < toolUses.length; j++) {
      if (toolUses[j]!.turnIdx - toolUses[i]!.turnIdx > 5) break;
      if (toolUses[i]!.inputHash === toolUses[j]!.inputHash) {
        retryLoops++;
        break;
      }
    }
  }

  // abandoned: check final 3 turns
  let abandoned = false;
  if (chain.length >= 1) {
    const tail = chain.slice(-6); // grab tail
    let sawError = false;
    let sawHumanAfter = false;
    for (const t of tail) {
      if (t.type === "user") {
        const { isHuman } = parseUserContent(t.message?.content);
        if (isHuman) {
          if (sawError) sawHumanAfter = true;
        } else {
          const arr = Array.isArray(t.message?.content)
            ? t.message.content
            : [];
          for (const p of arr) {
            if (p?.type === "tool_result" && p.is_error) sawError = true;
          }
        }
      }
    }
    if (sawError && !sawHumanAfter) abandoned = true;
  }

  const startedAt = firstTs || new Date(0).toISOString();
  const endedAt = lastTs || startedAt;
  const durationMinutes = Math.max(
    0,
    (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000,
  );

  // project name
  const projectName = cwd
    ? basename(cwd)
    : projectHash.replace(/^-/, "").split("-").slice(-2).join("-") ||
      projectHash;

  return {
    sessionId,
    filePath,
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
    branchPoints,
    retryLoops,
    abandoned,
    linesAdded,
    linesRemoved,
    filesModified: filesTouched.size,
    costUsd,
    firstPrompt: redact(firstPrompt).slice(0, 500),
    transcript: transcriptParts.join("\n"),
    toolUses,
    lastTurnsErr: [],
    hasReplyAfterErrors: false,
  };
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

async function chunkSummarize(transcript: string): Promise<string> {
  const chunkSize = 25000;
  const chunks: string[] = [];
  for (let i = 0; i < transcript.length; i += chunkSize) {
    chunks.push(transcript.slice(i, i + chunkSize));
  }
  const summaries: string[] = [];
  for (const c of chunks) {
    try {
      const object = await chatJSON(
        `Summarize the following partial Claude Code session transcript in <= 400 words, preserving user goals, key tool actions, and any errors. Respond with JSON {"summary": "..."}.\n\nTranscript chunk:\n\n${c}`,
        z.object({ summary: z.string() }),
        { maxTokens: 1500 },
      );
      summaries.push(object.summary);
    } catch (err) {
      summaries.push(c.slice(0, 1000));
    }
  }
  return summaries.join("\n---\n");
}

async function extractFacets(
  raw: RawParse,
): Promise<Extracted> {
  const cachePath = join(CACHE_DIR, `extract-${raw.sessionId}.json`);
  if (!argv.noCache && existsSync(cachePath)) {
    try {
      return JSON.parse(await readFile(cachePath, "utf-8"));
    } catch {}
  }
  let transcript = raw.transcript;
  if (transcript.length > 30000) {
    transcript = await chunkSummarize(transcript);
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
    const object = await chatJSON(prompt, ExtractSchema, { maxTokens: 3000 });
    await writeFile(cachePath, JSON.stringify(object, null, 2));
    return object;
  } catch (err) {
    const fallback: Extracted = {
      goal: raw.firstPrompt.slice(0, 200) || "(extraction failed)",
      outcome: "unclear",
      session_type: "single_task",
      friction: [],
      primary_success: "",
      brief_summary:
        "LLM extraction failed; using deterministic fallback. " +
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
    return fallback;
  }
}

// ---------- embeddings ----------
async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!embedder) return [];
  const out: number[][] = [];
  const batchSize = 32;
  let useStub = false;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    if (useStub) {
      for (const t of batch) out.push(stubEmbed(t));
      continue;
    }
    try {
      const { embeddings } = await embedMany({
        model: embedder,
        values: batch,
      });
      for (const v of embeddings) out.push(v as number[]);
    } catch (err: any) {
      console.warn(
        `[embed] endpoint failed (${err?.message?.slice?.(0, 100) ?? err}); using deterministic stub for remaining ${texts.length - out.length} texts`,
      );
      useStub = true;
      for (const t of batch) out.push(stubEmbed(t));
    }
  }
  return out;
}

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
  for (let i = 0; i < dim; i++) v[i] *= inv;
  return v;
}

// ---------- clustering ----------
function greedyCluster(
  vectors: number[][],
  threshold = 0.78,
): number[] {
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
  if (vectors.length <= k) {
    return vectors.map((_, i) => i);
  }
  const result = kmeans(vectors, k, { initialization: "kmeans++", seed: 42 });
  return result.clusters;
}

function clusterCount(n: number): number {
  // 6..14
  return Math.min(14, Math.max(6, Math.round(Math.sqrt(n / 2))));
}

// ---------- main ----------
async function main() {
  console.log(`[discover] scanning ${argv.sessionsDir}`);
  let files = await discoverSessions(argv.sessionsDir);
  console.log(`[discover] found ${files.length} sessions`);
  if (argv.maxSessions !== null) files = files.slice(0, argv.maxSessions);
  console.log(`[discover] processing ${files.length} sessions`);

  // user assignment — round-robin over time-sorted files so every mock user has
  // activity spread across the full timeline, not bunched at one end.
  const userCount = Math.max(1, argv.users);
  const users: User[] = [];
  const fileToUser = new Map<string, string>();
  for (let u = 0; u < userCount; u++) {
    const id = `u${u + 1}`;
    const name = NAMES[u % NAMES.length]!;
    const team = TEAMS[u % TEAMS.length]!;
    users.push({
      id,
      displayName: name,
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
  for (let i = 0; i < files.length; i++) {
    const id = `u${(i % userCount) + 1}`;
    fileToUser.set(files[i]!.filePath, id);
  }

  // parse all sessions (no LLM) + emit per-session transcripts to public/transcripts/*.json
  const transcriptsDir = resolve(dirname(argv.out), "transcripts");
  await mkdir(transcriptsDir, { recursive: true });
  const raws: RawParse[] = [];
  let parsed = 0;
  let lastPct = -1;
  for (const f of files) {
    try {
      const msgs = await parseJsonl(f.filePath);
      const r = parseSession(f.filePath, msgs);
      raws.push(r);
      // Write transcript JSON for the frontend session viewer (full observability,
      // not just the summary that lives in sessions.json).
      const events = extractTranscriptEvents(pickLeafChain(msgs));
      const transcript = {
        sessionId: r.sessionId,
        events,
        truncated: events.length >= 1500,
      };
      await writeFile(
        join(transcriptsDir, `${r.sessionId}.json`),
        JSON.stringify(transcript),
      );
    } catch (err) {
      console.error(`[parse] failed ${f.filePath}:`, err);
    }
    parsed++;
    const pct = Math.floor((parsed / files.length) * 20) * 5;
    if (pct !== lastPct) {
      lastPct = pct;
      console.log(`[parse] [${parsed}/${files.length}] ${pct}%`);
    }
  }

  // LLM extraction with concurrency
  const limit = pLimit(argv.concurrency);
  console.log(`[extract] ${raws.length} sessions, concurrency=${argv.concurrency}`);
  let done = 0;
  lastPct = -1;
  const extracted: Map<string, Extracted> = new Map();
  await Promise.all(
    raws.map((r) =>
      limit(async () => {
        const ex = await extractFacets(r);
        extracted.set(r.sessionId, ex);
        done++;
        const pct = Math.floor((done / raws.length) * 20) * 5;
        if (pct !== lastPct) {
          lastPct = pct;
          console.log(`[extract] [${done}/${raws.length}] ${pct}%`);
        }
      }),
    ),
  );

  // Collect texts to embed (asks + first prompts), and a separate set for unresolved
  const askTexts: string[] = [];
  const askKey: { sessionId: string; userId: string; idx: number; outcome: string }[] = [];
  const unresolvedTexts: string[] = [];
  const unresolvedKey: { sessionId: string; userId: string; idx: number; outcome: string }[] = [];

  for (const r of raws) {
    const ex = extracted.get(r.sessionId)!;
    const userId = fileToUser.get(r.filePath) ?? "u1";
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

  // first prompt vectors for redundant_prompt detector (cluster the redacted firstPrompt)
  const firstPrompts = raws.map((r) => r.firstPrompt || "(empty)");

  console.log(`[embed] asks=${askTexts.length} unresolved=${unresolvedTexts.length} firstPrompts=${firstPrompts.length}`);
  const askVecs = await embedTexts(askTexts);
  const unresolvedVecs = await embedTexts(unresolvedTexts);
  const firstPromptVecs = await embedTexts(firstPrompts);

  // cluster asks
  let askLabels: number[] = [];
  if (askVecs.length > 0) {
    const k = Math.min(clusterCount(askVecs.length), Math.max(1, askVecs.length - 1));
    askLabels = askVecs.length <= 2 ? askVecs.map(() => 0) : kmeansCluster(askVecs, k);
  }
  // cluster unresolved
  let unresolvedLabels: number[] = [];
  if (unresolvedVecs.length > 0) {
    const k = Math.min(clusterCount(unresolvedVecs.length), Math.max(1, unresolvedVecs.length - 1));
    unresolvedLabels =
      unresolvedVecs.length <= 2 ? unresolvedVecs.map(() => 0) : kmeansCluster(unresolvedVecs, k);
  }

  // first prompt clusters (for redundant prompt detector)
  let fpLabels: number[] = [];
  if (firstPromptVecs.length > 0) {
    fpLabels = greedyCluster(firstPromptVecs, 0.85);
  }

  // build cluster maps
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
      // centroid in embedding space
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

  const askResult = buildClusters(
    "ask",
    askLabels,
    askVecs,
    askKey,
    askTexts,
  );
  const unresolvedResult = buildClusters(
    "unresolved",
    unresolvedLabels,
    unresolvedVecs,
    unresolvedKey,
    unresolvedTexts,
  );

  // Assign clusterId on session asks/unresolved (transform extracted -> SessionMeta later)
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

  // 3D UMAP on union of centroids
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
    // scale to [-10, 10]
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

  // ---------- cluster labeling via LLM ----------
  async function labelCluster(
    cluster: Cluster,
    samples: string[],
  ): Promise<{ label: string; domain: Cluster["domain"] }> {
    const cachePath = join(CACHE_DIR, `cluster-${cluster.id}.json`);
    if (!argv.noCache && existsSync(cachePath)) {
      try {
        return JSON.parse(await readFile(cachePath, "utf-8"));
      } catch {}
    }
    const allowedDomains: Cluster["domain"][] = [
      "strategy",
      "code",
      "research",
      "writing",
      "data",
      "ops",
      "other",
    ];
    try {
      const object = await chatJSON(
        `Given these sample user requests, output a JSON object {"label": "...", "domain": "..."}.
- label: short noun phrase, 3-6 words, no quotes, no leading verbs like "add" or "fix" — describe the topic.
- domain: one of strategy|code|research|writing|data|ops|other.

Samples:
${samples.slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
        z.object({ label: z.string(), domain: z.string() }),
        { maxTokens: 200 },
      );
      const dom = (object.domain ?? "other").toLowerCase();
      const safeDomain = (allowedDomains as string[]).includes(dom)
        ? (dom as Cluster["domain"])
        : "other";
      const result = { label: object.label || "Untitled", domain: safeDomain };
      await writeFile(cachePath, JSON.stringify(result, null, 2));
      return result;
    } catch {
      return { label: cluster.label || "Untitled", domain: "other" };
    }
  }

  // gather samples per cluster (asks)
  console.log(`[label] labeling ${askResult.clusters.length + unresolvedResult.clusters.length} clusters`);
  const labelLimit = pLimit(argv.concurrency);
  await Promise.all([
    ...askResult.clusters.map((c) =>
      labelLimit(async () => {
        const samples: string[] = [];
        askLabels.forEach((l, i) => {
          if (askResult.labelToClusterId.get(l) === c.id && samples.length < 8) {
            samples.push(askTexts[i]!);
          }
        });
        const { label, domain } = await labelCluster(c, samples);
        c.label = label;
        c.domain = domain;
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
        const { label, domain } = await labelCluster(c, samples);
        c.label = label;
        c.domain = domain;
      }),
    ),
  ]);

  // ---------- build SessionMeta + waste flags ----------
  // First, compute throughput-per-token z-scores for wizardScore normalization
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
  function sigmoid(x: number) {
    return 1 / (1 + Math.exp(-x));
  }

  // detect redundant_prompt clusters where size > 5 across distinct users
  const fpClusterUsers = new Map<number, Set<string>>();
  fpLabels.forEach((l, i) => {
    const userId = fileToUser.get(raws[i]!.filePath) ?? "u1";
    if (!fpClusterUsers.has(l)) fpClusterUsers.set(l, new Set());
    fpClusterUsers.get(l)!.add(userId);
  });
  const redundantClusters = new Set<number>();
  for (const [l, set] of fpClusterUsers) {
    if (set.size > 5) redundantClusters.add(l);
  }

  const sessions: SessionMeta[] = raws.map((r, idx) => {
    const ex = extracted.get(r.sessionId)!;
    const userId = fileToUser.get(r.filePath) ?? "u1";

    const wasteFlags: WasteFlag[] = [];
    // wrong_model: opus + hardness <=2
    const opusCost = r.modelTurnCosts
      .filter((m) => m.model.includes("opus"))
      .reduce((a, m) => a + m.cost, 0);
    const opusTokens = r.modelTurnCosts
      .filter((m) => m.model.includes("opus"))
      .reduce((a, m) => a + (m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0), 0);
    if (ex.task_hardness <= 2 && opusCost > 0) {
      // approximate haiku cost: same tokens at haiku rates
      const hp = PRICING["claude-haiku-4-5"]!;
      let haikuEquivCost = 0;
      for (const m of r.modelTurnCosts) {
        if (m.model.includes("opus")) {
          const u = m.usage ?? {};
          haikuEquivCost +=
            ((u.input_tokens ?? 0) * hp.input +
              (u.output_tokens ?? 0) * hp.output +
              (u.cache_read_input_tokens ?? 0) * hp.cacheRead +
              (u.cache_creation_input_tokens ?? 0) * hp.cacheCreate) /
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
    // retry_loop: each loop ~ avg cost per turn
    if (r.retryLoops > 0) {
      const avgPerTurn =
        r.costUsd / Math.max(1, r.modelTurnCosts.length);
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
    // abandoned: full session cost
    if (r.abandoned) {
      wasteFlags.push({
        type: "abandoned",
        tokensWasted: r.tokens.input + r.tokens.output,
        usdWasted: r.costUsd,
        evidence: "tool_result errors at end with no human reply",
      });
    }
    // context_bloat: > 100k input AND tool_use ratio bottom quartile (heuristic: ratio < 0.0001)
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
    // redundant_prompt: if first prompt cluster has > 5 distinct users
    if (redundantClusters.has(fpLabels[idx] ?? -1)) {
      wasteFlags.push({
        type: "redundant_prompt",
        tokensWasted: Math.round((r.tokens.input + r.tokens.output) / 2),
        usdWasted: r.costUsd / 2,
        evidence: "first prompt overlaps a high-frequency cluster",
      });
    }
    const wasteUsd = wasteFlags.reduce((a, w) => a + w.usdWasted, 0);

    // wizardScore
    const tpZ = (throughputs[idx]! - tpMean) / tpStd;
    const tpNorm = sigmoid(tpZ);
    const toolUseTotal = Object.values(r.tools).reduce((a, b) => a + b, 0);
    const firstShotSuccess = 1 - r.toolErrors / Math.max(1, toolUseTotal);
    const cacheHit = r.tokens.cacheRead / Math.max(1, r.tokens.input + r.tokens.cacheRead);
    const editEff = 1 - r.branchPoints / Math.max(1, r.turns);
    // modelIQ: sonnet=med, opus=hard, haiku=easy. hardness 1-2=easy, 3=med, 4-5=hard
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

  // ---------- per-cluster topFrictions ----------
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

  // ---------- aggregate user metrics ----------
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
    const tools: Record<string, number> = {};
    const fric: Record<string, number> = {};
    for (const s of userSessions) {
      for (const [k, v] of Object.entries(s.tools)) tools[k] = (tools[k] ?? 0) + v;
      for (const f of s.friction) fric[f] = (fric[f] ?? 0) + 1;
    }
    u.topTools = Object.fromEntries(
      Object.entries(tools).sort((a, b) => b[1] - a[1]).slice(0, 5),
    );
    u.topFrictions = Object.fromEntries(
      Object.entries(fric).sort((a, b) => b[1] - a[1]).slice(0, 5),
    );

    // win rate, cost-per-win, last active
    const totalOutcomes =
      out.fully + out.mostly + out.partial + out.none + out.unclear;
    const wins = out.fully + out.mostly;
    u.winRate = totalOutcomes > 0 ? wins / totalOutcomes : 0;
    u.costPerWin = wins > 0 ? u.totalCostUsd / wins : u.totalCostUsd;
    u.lastActiveAt = userSessions
      .map((s) => s.startedAt)
      .sort()
      .at(-1) ?? new Date(0).toISOString();
    // sessionsLast7d gets filled after dateRange.end is known
    u.sessionsLast7d = 0;
    u.persona = "lurker";
    u.topFrictionLabel = frictionLabel(Object.keys(u.topFrictions)[0]);
  }

  // ---------- aggregates ----------
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

  // Compute persona/last-7d on each user now that we know dateEnd.
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

  const dataset: Dataset = {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    config: {
      maxSessions: argv.maxSessions,
      users: argv.users,
      model: argv.model,
      embeddingModel: argv.embeddingModel,
      apiBaseUrl: argv.apiBaseUrl,
    },
    users,
    sessions,
    clusters: [...askResult.clusters, ...unresolvedResult.clusters],
    aggregates,
  };

  await mkdir(dirname(argv.out), { recursive: true });
  await writeFile(argv.out, JSON.stringify(dataset, null, 2));

  console.log("");
  console.log("=== summary ===");
  console.log(`sessions: ${sessions.length}`);
  console.log(`users:    ${users.length}`);
  console.log(`tokens:   ${totalTokens.toLocaleString()}`);
  console.log(`cost:     $${totalCost.toFixed(4)}`);
  console.log(`waste:    $${totalWaste.toFixed(4)}`);
  console.log(`clusters (ask):        ${askResult.clusters.length}`);
  console.log(`clusters (unresolved): ${unresolvedResult.clusters.length}`);
  console.log(`out: ${argv.out}`);
}

await main();
