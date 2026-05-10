import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { db, np } from "./db.js";
import { estimateCost } from "./catalog.js";

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
  capped: number;
  sessions: number;
  requests: number;
};

// Prepared statements live at module scope: SQLite caches by SQL string but
// reusing a single Statement object also avoids the per-row allocation churn
// that becomes visible when seeding tens of thousands of rows.
const getImportStmt = db.prepare(
  `SELECT sha256, mtime, size, imported_at FROM seed_imports WHERE file_path = ?`,
);
const upsertImportStmt = db.prepare(
  `INSERT INTO seed_imports (file_path, sha256, mtime, size, imported_at, session_count, request_count)
   VALUES (@file_path, @sha256, @mtime, @size, @imported_at, @session_count, @request_count)
   ON CONFLICT(file_path) DO UPDATE SET
     sha256 = excluded.sha256,
     mtime = excluded.mtime,
     size = excluded.size,
     imported_at = excluded.imported_at,
     session_count = excluded.session_count,
     request_count = excluded.request_count`,
);
const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE id = ?`);
const insertSessionStmt = db.prepare(
  `INSERT INTO sessions (id, user_id, created_at, updated_at, request_count,
     total_input_tokens, total_output_tokens,
     total_cache_read_tokens, total_cache_creation_tokens, total_cost)
   VALUES (@id, @user_id, @created_at, @updated_at, @request_count,
     @total_input_tokens, @total_output_tokens,
     @total_cache_read_tokens, @total_cache_creation_tokens, @total_cost)`,
);
// Subagent transcripts re-record the same Anthropic requestId that the parent
// session already imported — INSERT OR IGNORE keeps the first copy and silently
// drops dupes instead of rolling back the file.
const insertRequestStmt = db.prepare(
  `INSERT OR IGNORE INTO requests (
     id, session_id, user_id, provider, model, status, error, streamed,
     started_at, finished_at, latency_ms,
     input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost,
     request_json, response_json, tool_calls_json, finish_reason
   ) VALUES (
     @id, @session_id, @user_id, @provider, @model, @status, @error, @streamed,
     @started_at, @finished_at, @latency_ms,
     @input_tokens, @output_tokens, @cache_read_tokens, @cache_creation_tokens, @cost,
     @request_json, @response_json, @tool_calls_json, @finish_reason
   )`,
);
const sessionCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM sessions`);

export async function seedFromDir(dir: string): Promise<SeedSummary> {
  const root = resolve(dir);
  const files = walk(root).filter((p) => p.toLowerCase().endsWith(".jsonl"));
  const summary: SeedSummary = {
    scanned: files.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    capped: 0,
    sessions: 0,
    requests: 0,
  };

  // NEBULA_MAX_SESSIONS caps the total number of sessions in the DB after a
  // seed pass. Unset = no cap (load everything). The cap reads the live
  // session count rather than counting "imported in this run" so it survives
  // restarts: if you already have 100 sessions and the cap is 100, this run
  // imports zero. Files past the cap are reported as `capped` (not failed,
  // not skipped) so the operator can tell them apart in the boot log.
  const maxSessionsRaw = process.env.NEBULA_MAX_SESSIONS;
  const maxSessions =
    maxSessionsRaw && Number.isFinite(Number(maxSessionsRaw))
      ? Math.max(0, Math.floor(Number(maxSessionsRaw)))
      : null;
  let sessionCount = (sessionCountStmt.get() as { n: number }).n;

  // Yield to the event loop every YIELD_EVERY files so HTTP handlers and the
  // job runner can interleave with a long seed pass on cold boot.
  const YIELD_EVERY = 16;
  let i = 0;

  for (const file of files) {
    if (maxSessions != null && sessionCount >= maxSessions) {
      summary.capped++;
      continue;
    }
    if (++i % YIELD_EVERY === 0) {
      await new Promise<void>((r) => setImmediate(r));
    }
    try {
      const stat = statSync(file);
      const mtime = stat.mtimeMs;
      const size = stat.size;
      const prev = getImportStmt.get(file) as
        | { sha256: string; mtime: number; size: number; imported_at: number }
        | undefined;

      // Fast-path: the seed_imports row was written with this exact mtime+size
      // last time, so the file content is unchanged. We avoid reading a single
      // byte. This collapses the warm-restart cost from O(total file bytes) to
      // O(stat per file) — the dominant win on `restart: unless-stopped`.
      if (prev && prev.mtime === mtime && prev.size === size) {
        summary.skipped++;
        continue;
      }

      // Slow path: stream the file, hashing and parsing in one pass. We never
      // hold the full Buffer or full text — only the current line being built
      // up in `lineBuf` and the parsed `Line[]` (object form, not raw text).
      // For a 50 MB JSONL this drops ~150 MB of transient JS heap vs the old
      // readFileSync + toString + split path.
      const lines: Line[] = [];
      const hasher = createHash("sha256");
      const decoder = new TextDecoder();
      let lineBuf = "";
      const stream = Bun.file(file).stream();
      for await (const chunk of stream) {
        hasher.update(chunk);
        lineBuf += decoder.decode(chunk, { stream: true });
        let nl;
        while ((nl = lineBuf.indexOf("\n")) >= 0) {
          const raw = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          const trimmed = raw.trim();
          if (!trimmed) continue;
          try {
            lines.push(JSON.parse(trimmed));
          } catch {
            // skip malformed lines
          }
        }
      }
      // Flush trailing line (file without final \n).
      const tail = lineBuf.trim();
      if (tail) {
        try {
          lines.push(JSON.parse(tail));
        } catch {
          /* skip */
        }
      }
      const sha = hasher.digest("hex");

      // Content-hash fallback: mtime/size differed (touched, copied, etc.) but
      // bytes are identical. Refresh the cache row so next boot takes the
      // fast-path, and skip the projection.
      if (prev && prev.sha256 === sha) {
        upsertImportStmt.run(
          np({
            file_path: file,
            sha256: sha,
            mtime,
            size,
            imported_at: prev.imported_at,
            session_count: 0,
            request_count: 0,
          }),
        );
        summary.skipped++;
        continue;
      }

      const projection = projectLines(file, root, lines);
      // Eagerly drop the parsed lines now that projection has the slim form.
      lines.length = 0;
      if (!projection) {
        summary.failed++;
        continue;
      }

      const projSessions = projection.sessions;
      const projRequests = projection.requests;
      const apply = db.transaction(() => {
        for (const sess of projSessions) {
          deleteSessionStmt.run(sess.id);
          insertSessionStmt.run(np(sess));
        }
        for (const r of projRequests) {
          insertRequestStmt.run(np(r));
        }
        upsertImportStmt.run(
          np({
            file_path: file,
            sha256: sha,
            mtime,
            size,
            imported_at: Date.now(),
            session_count: projSessions.length,
            request_count: projRequests.length,
          }),
        );
      });
      apply();

      summary.imported++;
      summary.sessions += projSessions.length;
      summary.requests += projRequests.length;
      sessionCount += projSessions.length;
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
    total_cache_read_tokens: number;
    total_cache_creation_tokens: number;
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
    cache_read_tokens: number | null;
    cache_creation_tokens: number | null;
    cost: number | null;
    request_json: string;
    response_json: string | null;
    tool_calls_json: string | null;
    finish_reason: string | null;
  }>;
};

function projectLines(
  file: string,
  root: string,
  lines: Line[],
): Projection | null {
  if (lines.length === 0) return null;

  const first = lines[0];
  const isSubagent =
    /\/subagents\//.test(file) ||
    basename(file).startsWith("agent-") ||
    (!!first.agentId && first.isSidechain === true);

  let sessionId: string;
  if (isSubagent && first.agentId) {
    sessionId = `agent-${first.agentId}`;
  } else {
    sessionId = first.sessionId ?? basename(file).replace(/\.jsonl$/i, "");
  }
  // The seed corpus is one human's local Claude transcripts, so every session
  // would otherwise collapse onto a single user. Hash the top-level project
  // directory into a small pool of synthetic engineers so the manager
  // dashboard has a leaderboard worth showing — and so all sessions from the
  // same project consistently belong to the same fake teammate.
  const userId = syntheticEngineerFor(projectKey(file, root));

  const groups = new Map<string, Line[]>();
  const ungroupedUserAssistant: Line[] = [];
  // Index lookup for O(1) firstAssistantIdx instead of indexOf in inner loop.
  const uaIndex = new Map<Line, number>();
  for (const ln of lines) {
    const rid = ln.requestId;
    if (rid) {
      let g = groups.get(rid);
      if (!g) {
        g = [];
        groups.set(rid, g);
      }
      g.push(ln);
    }
    if (ln.type === "user" || ln.type === "assistant") {
      uaIndex.set(ln, ungroupedUserAssistant.length);
      ungroupedUserAssistant.push(ln);
    }
  }

  const requests: Projection["requests"] = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
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

  // Iterate request groups in chronological order so the per-request `messages`
  // slice contains exactly the new turns added since the last request — not the
  // full conversation history. Without this, request_json scales O(N²) in the
  // session length: a 200-turn session writes ~200 MB of `messages` arrays
  // across its requests, and that bloat dominates DB size and seed memory.
  const orderedGroups = Array.from(groups.entries()).sort((a, b) => {
    const ta = parseTs(a[1].find((g) => g.type === "assistant")?.timestamp) ?? 0;
    const tb = parseTs(b[1].find((g) => g.type === "assistant")?.timestamp) ?? 0;
    return ta - tb;
  });
  // UUIDs that have already been emitted into a prior request's `messages`.
  // Requests are deltas: only lines not yet seen go into request_json.
  const emittedUuids = new Set<string>();

  for (const [requestId, group] of orderedGroups) {
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
    // Keep the four buckets separate. cache_read is the prefix re-read every
    // turn; folding it into input_tokens grossly inflates "total tokens" and
    // bills it at the wrong rate.
    const inTokens = Number(usage.input_tokens ?? 0);
    const outTokens = Number(usage.output_tokens ?? 0);
    const cacheReadTokens = Number(usage.cache_read_input_tokens ?? 0);
    const cacheCreationTokens = Number(usage.cache_creation_input_tokens ?? 0);
    const cost = estimateCost(model, {
      input: inTokens,
      output: outTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheCreationTokens,
    });

    const startedAt = parseTs(firstAssistant.timestamp) ?? Date.now();
    const finishedAt = parseTs(lastAssistant.timestamp) ?? startedAt;

    // Delta-only messages for this request: lines that appear before this
    // request's first assistant line AND haven't already been emitted into a
    // prior request of this session. Walks the running emittedUuids set so the
    // total `messages` payload across the whole session is proportional to the
    // session size, not its square.
    const firstAssistantIdx = uaIndex.get(firstAssistant) ?? 0;
    const messages: Array<{ role: string; content: any }> = [];
    for (let i = 0; i < firstAssistantIdx; i++) {
      const ln = ungroupedUserAssistant[i]!;
      if (ln.requestId === requestId) continue;
      if (!ln.uuid) continue;
      if (emittedUuids.has(ln.uuid)) continue;
      emittedUuids.add(ln.uuid);
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
      else if (typeof c === "string")
        mergedContent.push({ type: "text", text: c });
    }
    const stopReason: string | null = lastAssistant.message?.stop_reason ?? null;

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
      cache_read_tokens: cacheReadTokens,
      cache_creation_tokens: cacheCreationTokens,
      cost,
      request_json: requestJson,
      response_json: responseJson,
      tool_calls_json: toolCallsJson,
      finish_reason: stopReason,
    });

    totalIn += inTokens;
    totalOut += outTokens;
    totalCacheRead += cacheReadTokens;
    totalCacheCreation += cacheCreationTokens;
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
    total_cache_read_tokens: totalCacheRead,
    total_cache_creation_tokens: totalCacheCreation,
    total_cost: totalCost,
  };

  return { sessions: [session], requests };
}

// Pool of synthetic engineers the seeded transcripts get distributed across.
// Order matters — adding a new entry shifts every project's bucket assignment,
// so the analyzer reseeds different personas after the change. Keep stable.
const SYNTHETIC_ENGINEERS = ["alex", "priya", "marcus", "sara"] as const;

function projectKey(file: string, root: string): string {
  // Top-level directory under the seed root, e.g.
  //   /seed/-Users-leo-dev-cpp-svg-watch/abc.jsonl  →  -Users-leo-dev-cpp-svg-watch
  // Subagent transcripts live deeper but their project dir is still the first
  // segment, so they map to the same engineer as their parent session.
  const rel = file.startsWith(root) ? file.slice(root.length) : file;
  const cleaned = rel.replace(/^[/\\]+/, "");
  const seg = cleaned.split(/[/\\]/)[0];
  return seg || "root";
}

function syntheticEngineerFor(projectKey: string): string {
  const h = createHash("sha256").update(projectKey).digest();
  const idx = h.readUInt32BE(0) % SYNTHETIC_ENGINEERS.length;
  return SYNTHETIC_ENGINEERS[idx]!;
}

function parseTs(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function providerFromModel(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3"))
    return "openai";
  if (m.startsWith("gemini")) return "google";
  if (m.startsWith("llama")) return "groq";
  if (m.startsWith("mistral")) return "mistral";
  if (m.startsWith("kimi") || m.startsWith("moonshot")) return "kimi";
  return "unknown";
}
