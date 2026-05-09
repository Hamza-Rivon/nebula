import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { db } from "./db.js";
import { estimateCost } from "./pricing.js";

type Line = {
  type?: string;
  parentUuid?: string | null;
  uuid?: string;
  sessionId?: string;
  agentId?: string;
  requestId?: string;
  timestamp?: string;
  message?: any;
  isSidechain?: boolean;
};

export type SeedSummary = {
  scanned: number;
  imported: number;
  skipped: number;
  failed: number;
  sessions: number;
  requests: number;
};

export function seedFromDir(dir: string): SeedSummary {
  const root = resolve(dir);
  const files = walk(root).filter((p) => p.toLowerCase().endsWith(".jsonl"));
  const summary: SeedSummary = {
    scanned: files.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    sessions: 0,
    requests: 0,
  };

  const getImport = db.prepare(
    `SELECT sha256 FROM seed_imports WHERE file_path = ?`,
  );
  const upsertImport = db.prepare(
    `INSERT INTO seed_imports (file_path, sha256, imported_at, session_count, request_count)
     VALUES (@file_path, @sha256, @imported_at, @session_count, @request_count)
     ON CONFLICT(file_path) DO UPDATE SET
       sha256 = excluded.sha256,
       imported_at = excluded.imported_at,
       session_count = excluded.session_count,
       request_count = excluded.request_count`,
  );

  for (const file of files) {
    try {
      const buf = readFileSync(file);
      const sha = createHash("sha256").update(buf).digest("hex");
      const prev = getImport.get(file) as { sha256: string } | undefined;
      if (prev?.sha256 === sha) {
        summary.skipped++;
        continue;
      }

      const projection = projectFile(file, root, buf.toString("utf8"));
      if (!projection) {
        summary.failed++;
        continue;
      }

      const apply = db.transaction(() => {
        for (const sess of projection.sessions) {
          db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sess.id);
          db.prepare(
            `INSERT INTO sessions (id, user_id, created_at, updated_at, request_count, total_input_tokens, total_output_tokens, total_cost)
             VALUES (@id, @user_id, @created_at, @updated_at, @request_count, @total_input_tokens, @total_output_tokens, @total_cost)`,
          ).run(sess);
        }
        for (const r of projection.requests) {
          db.prepare(
            `INSERT INTO requests (
               id, session_id, user_id, provider, model, status, error, streamed,
               started_at, finished_at, latency_ms, input_tokens, output_tokens, cost,
               request_json, response_json, tool_calls_json, finish_reason
             ) VALUES (
               @id, @session_id, @user_id, @provider, @model, @status, @error, @streamed,
               @started_at, @finished_at, @latency_ms, @input_tokens, @output_tokens, @cost,
               @request_json, @response_json, @tool_calls_json, @finish_reason
             )`,
          ).run(r);
        }
        upsertImport.run({
          file_path: file,
          sha256: sha,
          imported_at: Date.now(),
          session_count: projection.sessions.length,
          request_count: projection.requests.length,
        });
      });
      apply();

      summary.imported++;
      summary.sessions += projection.sessions.length;
      summary.requests += projection.requests.length;
    } catch (err) {
      summary.failed++;
      console.warn(`[seed] failed to import ${file}:`, (err as Error).message);
    }
  }

  return summary;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) out.push(...walk(p));
    else if (s.isFile()) out.push(p);
  }
  return out;
}

type Projection = {
  sessions: Array<{
    id: string;
    user_id: string | null;
    created_at: number;
    updated_at: number;
    request_count: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost: number;
  }>;
  requests: Array<{
    id: string;
    session_id: string;
    user_id: string | null;
    provider: string;
    model: string;
    status: "ok" | "error";
    error: string | null;
    streamed: number;
    started_at: number;
    finished_at: number | null;
    latency_ms: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cost: number | null;
    request_json: string;
    response_json: string | null;
    tool_calls_json: string | null;
    finish_reason: string | null;
  }>;
};

function projectFile(
  file: string,
  root: string,
  text: string,
): Projection | null {
  const lines: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  if (lines.length === 0) return null;

  const first = lines[0];
  const isSubagent =
    /\/subagents\//.test(file) ||
    basename(file).startsWith("agent-") ||
    !!first.agentId && first.isSidechain === true;

  let sessionId: string;
  let userId: string | null = null;
  if (isSubagent && first.agentId) {
    sessionId = `agent-${first.agentId}`;
    userId = parentSessionFromPath(file, root) ?? first.sessionId ?? null;
  } else {
    sessionId =
      first.sessionId ?? basename(file).replace(/\.jsonl$/i, "");
  }

  const groups = new Map<string, Line[]>();
  const ungroupedUserAssistant: Line[] = [];
  for (const ln of lines) {
    const rid = ln.requestId;
    if (rid) {
      if (!groups.has(rid)) groups.set(rid, []);
      groups.get(rid)!.push(ln);
    }
    if (ln.type === "user" || ln.type === "assistant") {
      ungroupedUserAssistant.push(ln);
    }
  }

  const requests: Projection["requests"] = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0;
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = 0;

  for (const ln of lines) {
    const t = parseTs(ln.timestamp);
    if (t != null) {
      if (t < minTs) minTs = t;
      if (t > maxTs) maxTs = t;
    }
  }

  for (const [requestId, group] of groups) {
    const assistants = group.filter((g) => g.type === "assistant");
    if (assistants.length === 0) continue;

    const firstAssistant = assistants[0];
    const lastAssistant = assistants[assistants.length - 1];
    const model: string = firstAssistant.message?.model ?? "unknown";

    // Pick the assistant line with the largest output_tokens for usage —
    // Anthropic transcripts often repeat partial usage on intermediate blocks
    // and the full count only on the final one.
    let usageLine = lastAssistant;
    let bestOut = -1;
    for (const a of assistants) {
      const out = Number(a.message?.usage?.output_tokens ?? 0);
      if (out > bestOut) {
        bestOut = out;
        usageLine = a;
      }
    }
    const usage = usageLine.message?.usage ?? {};
    const inTokens =
      Number(usage.input_tokens ?? 0) +
      Number(usage.cache_read_input_tokens ?? 0) +
      Number(usage.cache_creation_input_tokens ?? 0);
    const outTokens = Number(usage.output_tokens ?? 0);
    const cost = estimateCost(model, inTokens, outTokens);

    const startedAt =
      parseTs(firstAssistant.timestamp) ?? Date.now();
    const finishedAt =
      parseTs(lastAssistant.timestamp) ?? startedAt;

    // Reconstruct request messages: every user/assistant line that appears
    // before this requestId's first assistant line and isn't part of this
    // requestId group. Dedup by uuid.
    const firstAssistantIdx = ungroupedUserAssistant.indexOf(firstAssistant);
    const seenUuids = new Set<string>();
    const messages: Array<{ role: string; content: any }> = [];
    for (let i = 0; i < firstAssistantIdx; i++) {
      const ln = ungroupedUserAssistant[i];
      if (ln.requestId === requestId) continue;
      if (ln.uuid && seenUuids.has(ln.uuid)) continue;
      if (ln.uuid) seenUuids.add(ln.uuid);
      const msg = ln.message;
      if (!msg) continue;
      messages.push({
        role: msg.role ?? ln.type ?? "user",
        content: msg.content,
      });
    }

    // Merge assistant content blocks across all lines of this requestId group.
    const mergedContent: any[] = [];
    for (const a of assistants) {
      const c = a.message?.content;
      if (Array.isArray(c)) mergedContent.push(...c);
      else if (typeof c === "string") mergedContent.push({ type: "text", text: c });
    }
    const stopReason: string | null =
      lastAssistant.message?.stop_reason ?? null;

    const toolUses = mergedContent.filter(
      (b) => b && typeof b === "object" && b.type === "tool_use",
    );

    const requestJson = JSON.stringify({ model, messages });
    const responseJson = JSON.stringify({
      id: firstAssistant.message?.id,
      role: "assistant",
      model,
      content: mergedContent,
      stop_reason: stopReason,
      usage,
    });
    const toolCallsJson = toolUses.length ? JSON.stringify(toolUses) : null;

    requests.push({
      id: requestId,
      session_id: sessionId,
      user_id: userId,
      provider: providerFromModel(model),
      model,
      status: "ok",
      error: null,
      streamed: 0,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: finishedAt - startedAt,
      input_tokens: inTokens,
      output_tokens: outTokens,
      cost,
      request_json: requestJson,
      response_json: responseJson,
      tool_calls_json: toolCallsJson,
      finish_reason: stopReason,
    });

    totalIn += inTokens;
    totalOut += outTokens;
    totalCost += cost;
  }

  if (requests.length === 0) return null;

  const session = {
    id: sessionId,
    user_id: userId,
    created_at: Number.isFinite(minTs) ? minTs : Date.now(),
    updated_at: maxTs || Date.now(),
    request_count: requests.length,
    total_input_tokens: totalIn,
    total_output_tokens: totalOut,
    total_cost: totalCost,
  };

  return { sessions: [session], requests };
}

function parentSessionFromPath(file: string, root: string): string | null {
  // <root>/<parentSessionUuid>/subagents/agent-xxx.jsonl
  let cur = dirname(file);
  while (cur && cur !== root && cur !== dirname(cur)) {
    const name = basename(cur);
    if (/^[0-9a-f-]{8,}$/i.test(name) && name.includes("-")) return name;
    cur = dirname(cur);
  }
  return null;
}

function parseTs(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function providerFromModel(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
  if (m.startsWith("gemini")) return "google";
  if (m.startsWith("llama")) return "groq";
  if (m.startsWith("mistral")) return "mistral";
  if (m.startsWith("kimi") || m.startsWith("moonshot")) return "kimi";
  return "unknown";
}
