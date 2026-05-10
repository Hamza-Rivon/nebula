import { Hono } from "hono";
import { db } from "./db.js";
import { listProviders } from "./providers.js";
import { catalogStatus } from "./catalog.js";
import { subscribe as subscribeEvents, subscriberCount } from "./events.js";
import {
  insightsApi,
} from "./insights/api.js";
import {
  getSession as getInsightsSession,
  resolveInsightsUserId,
  getUser as getInsightsUser,
  listSessionsForUser,
} from "./insights/db.js";

export const api = new Hono();

api.get("/providers", (c) => {
  return c.json({ providers: listProviders() });
});

api.get("/catalog", (c) => {
  return c.json(catalogStatus());
});

// Server-Sent Events stream — UI clients open one EventSource and receive a
// `data: <json>` line per captured request (plus periodic `:hb` heartbeats so
// intermediaries don't time the connection out).
api.get("/events", (c) => {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          closed = true;
        }
      };
      // Initial comment to flush headers and confirm the connection.
      write(`:connected ${subscriberCount()}\n\n`);

      const unsub = subscribeEvents(write);
      const hb = setInterval(() => write(`:hb\n\n`), 25_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        unsub();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      // The platform fetch() Request carries an AbortSignal that fires when
      // the client disconnects; Hono exposes it via `c.req.raw.signal`.
      c.req.raw.signal?.addEventListener("abort", cleanup);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      // Disable proxy buffering (nginx and similar) so events arrive promptly.
      "x-accel-buffering": "no",
    },
  });
});

api.get("/stats", (c) => {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS request_count,
         COALESCE(SUM(input_tokens),0) AS input_tokens,
         COALESCE(SUM(output_tokens),0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens),0) AS cache_creation_tokens,
         COALESCE(SUM(cost),0) AS cost,
         COALESCE(AVG(latency_ms),0) AS avg_latency_ms,
         SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS error_count
       FROM requests`,
    )
    .get() as any;
  const sessions = db
    .prepare(`SELECT COUNT(*) AS session_count FROM sessions`)
    .get() as any;
  // tokens = input + output only (cache reads excluded so the headline matches
  // Claude Code's /status accounting). cache_tokens surfaces separately for
  // cache-efficiency views.
  const byModel = db
    .prepare(
      `SELECT model,
              COUNT(*) AS n,
              SUM(cost) AS cost,
              SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)) AS tokens,
              SUM(COALESCE(cache_read_tokens,0)) AS cache_read_tokens,
              SUM(COALESCE(cache_creation_tokens,0)) AS cache_creation_tokens
       FROM requests GROUP BY model ORDER BY n DESC LIMIT 10`,
    )
    .all();
  const byProvider = db
    .prepare(
      `SELECT provider, COUNT(*) AS n, SUM(cost) AS cost
       FROM requests GROUP BY provider ORDER BY n DESC`,
    )
    .all();
  const recent = db
    .prepare(
      `SELECT
         strftime('%Y-%m-%dT%H:00:00Z', started_at/1000, 'unixepoch') AS hour,
         COUNT(*) AS n,
         SUM(cost) AS cost
       FROM requests
       WHERE started_at > (CAST(strftime('%s','now') AS INTEGER) - 86400) * 1000
       GROUP BY hour ORDER BY hour ASC`,
    )
    .all();
  return c.json({ ...totals, ...sessions, byModel, byProvider, recent });
});

// Build a WHERE fragment for the sessions list. `alias` is prepended to each
// column name so the same builder works for plain queries and joins.
function sessionsWhere(c: any, alias = ""): { sql: string; params: any[] } {
  const a = alias ? `${alias}.` : "";
  const where: string[] = [];
  const params: any[] = [];
  const q = c.req.query("q")?.trim();
  if (q) {
    where.push(`(${a}id LIKE ? ESCAPE '\\' OR ${a}user_id LIKE ? ESCAPE '\\')`);
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    params.push(like, like);
  }
  const user = c.req.query("user");
  if (user) {
    where.push(`${a}user_id = ?`);
    params.push(user);
  }
  const since = Number(c.req.query("since") ?? 0);
  if (since > 0) {
    where.push(`${a}updated_at >= ?`);
    params.push(since);
  }
  const until = Number(c.req.query("until") ?? 0);
  if (until > 0) {
    where.push(`${a}updated_at <= ?`);
    params.push(until);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

api.get("/sessions", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  const w = sessionsWhere(c);
  const rows = db
    .prepare(
      `SELECT * FROM sessions ${w.sql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...w.params, limit, offset);
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM sessions ${w.sql}`).get(...w.params) as any
  ).n;
  return c.json({ sessions: rows, total });
});

// Header-strip metrics for the Sessions tab. Honors the same filters as
// /sessions so the strip reflects the current view.
api.get("/sessions/aggregates", (c) => {
  const w = sessionsWhere(c);
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(total_cost),0) AS total_cost,
         COALESCE(SUM(total_input_tokens + total_output_tokens),0) AS total_tokens,
         COALESCE(SUM(total_cache_read_tokens),0) AS total_cache_read_tokens,
         COALESCE(SUM(total_cache_creation_tokens),0) AS total_cache_creation_tokens,
         COALESCE(AVG(request_count),0) AS avg_requests
       FROM sessions ${w.sql}`,
    )
    .get(...w.params) as any;
  // Top model is computed across the requests inside the matched sessions.
  const wj = sessionsWhere(c, "s");
  const topModel = db
    .prepare(
      `SELECT r.model, COUNT(*) AS n
       FROM requests r
       JOIN sessions s ON s.id = r.session_id
       ${wj.sql}
       GROUP BY r.model ORDER BY n DESC LIMIT 1`,
    )
    .get(...wj.params) as { model: string; n: number } | undefined;
  return c.json({
    count: totals.count,
    total_cost: totals.total_cost,
    total_tokens: totals.total_tokens,
    total_cache_read_tokens: totals.total_cache_read_tokens,
    total_cache_creation_tokens: totals.total_cache_creation_tokens,
    avg_requests_per_session: Number(totals.avg_requests),
    top_model: topModel?.model ?? null,
  });
});

// Comprehensive JSONL export of a session — every captured event as one line.
// Designed for downstream data-analysis / audit pipelines: each line is a
// self-describing typed record so it can be filtered, joined, and replayed.
api.get("/sessions/:id/export.jsonl", (c) => {
  const id = c.req.param("id");
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as any;
  if (!session) return c.json({ error: "not_found" }, 404);
  const rows = db
    .prepare(
      `SELECT * FROM requests WHERE session_id = ? ORDER BY started_at ASC`,
    )
    .all(id) as any[];

  const lines: string[] = [];
  const push = (rec: Record<string, unknown>) =>
    lines.push(JSON.stringify(rec));

  push({
    type: "session",
    id: session.id,
    user_id: session.user_id,
    created_at_ms: session.created_at,
    updated_at_ms: session.updated_at,
    created_at_iso: new Date(session.created_at).toISOString(),
    summary: {
      request_count: session.request_count,
      total_input_tokens: session.total_input_tokens,
      total_output_tokens: session.total_output_tokens,
      total_cache_read_tokens: session.total_cache_read_tokens ?? 0,
      total_cache_creation_tokens: session.total_cache_creation_tokens ?? 0,
      total_cost_usd: session.total_cost,
    },
    nebula_version: 1,
  });

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const seq = i + 1;
    const req = safeJson(r.request_json) as any;
    const resp = safeJson(r.response_json) as any;

    push({
      type: "request",
      session_id: r.session_id,
      request_id: r.id,
      sequence: seq,
      provider: r.provider,
      model: r.model,
      streamed: !!r.streamed,
      status: r.status,
      error: r.error,
      started_at_ms: r.started_at,
      finished_at_ms: r.finished_at,
      latency_ms: r.latency_ms,
      finish_reason: r.finish_reason,
      tokens: {
        input: r.input_tokens,
        output: r.output_tokens,
        cache_read: r.cache_read_tokens,
        cache_creation: r.cache_creation_tokens,
      },
      cost_usd: r.cost,
      params: pickParams(req),
    });

    // Walk the input messages, emitting per-block records so analysis tools
    // can group by block type without reparsing nested arrays.
    const inputMessages: any[] = Array.isArray(req?.messages) ? req.messages : [];
    const systemPrompt = req?.system;
    if (systemPrompt) {
      emitMessageBlocks({
        push,
        sessionId: r.session_id,
        requestId: r.id,
        sequence: seq,
        role: "system",
        content: systemPrompt,
        timestampMs: r.started_at,
        direction: "input",
      });
    }
    for (const m of inputMessages) {
      emitMessageBlocks({
        push,
        sessionId: r.session_id,
        requestId: r.id,
        sequence: seq,
        role: m.role ?? "user",
        content: m.content,
        toolCalls: m.tool_calls,
        toolCallId: m.tool_call_id,
        name: m.name,
        timestampMs: r.started_at,
        direction: "input",
      });
    }

    // Output: assistant message (OpenAI shape) or content blocks (Anthropic).
    if (resp) {
      const oaiChoice = resp?.choices?.[0]?.message;
      if (oaiChoice) {
        emitMessageBlocks({
          push,
          sessionId: r.session_id,
          requestId: r.id,
          sequence: seq,
          role: oaiChoice.role ?? "assistant",
          content: oaiChoice.content,
          toolCalls: oaiChoice.tool_calls,
          timestampMs: r.finished_at ?? r.started_at,
          direction: "output",
        });
      } else if (Array.isArray(resp.content)) {
        // Anthropic native: each content block already typed.
        emitMessageBlocks({
          push,
          sessionId: r.session_id,
          requestId: r.id,
          sequence: seq,
          role: resp.role ?? "assistant",
          content: resp.content,
          timestampMs: r.finished_at ?? r.started_at,
          direction: "output",
          providerStopReason: resp.stop_reason,
          providerUsage: resp.usage,
        });
      }
    }

    push({
      type: "request_end",
      session_id: r.session_id,
      request_id: r.id,
      sequence: seq,
      finished_at_ms: r.finished_at,
      finish_reason: r.finish_reason,
      tokens: {
        input: r.input_tokens,
        output: r.output_tokens,
        cache_read: r.cache_read_tokens,
        cache_creation: r.cache_creation_tokens,
      },
      cost_usd: r.cost,
    });
  }

  return new Response(lines.join("\n") + (lines.length ? "\n" : ""), {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="nebula-session-${safeFilename(id)}.jsonl"`,
      "cache-control": "no-store",
    },
  });
});

api.get("/sessions/:id", (c) => {
  const id = c.req.param("id");
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as any;
  if (!session) return c.json({ error: "not_found" }, 404);
  const requests = db
    .prepare(
      `SELECT id, session_id, user_id, provider, model, status, error,
              streamed, started_at, finished_at, latency_ms,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
              cost, finish_reason
       FROM requests WHERE session_id = ? ORDER BY started_at ASC`,
    )
    .all(id);
  return c.json({ session, requests });
});

// Join: raw session row + analyzed insights (when present). Lets the engineer-
// grade SessionDetail page surface manager context inline without two roundtrips.
api.get("/sessions/:id/insights", (c) => {
  const id = c.req.param("id");
  const insights = getInsightsSession(id);
  return c.json({ session: insights });
});

// Per-user insights bundle: the User analytics record plus their analyzed
// sessions, optionally filtered by friction tag. The `id` parameter accepts
// either the insights id ("u3") or the raw user id ("alice").
api.get("/users/:id/insights", (c) => {
  const idOrRaw = c.req.param("id");
  const friction = c.req.query("friction")?.trim() || undefined;
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  const insightsId = resolveInsightsUserId(idOrRaw);
  if (!insightsId) {
    return c.json({ user: null, sessions: [], total: 0 });
  }
  const user = getInsightsUser(insightsId);
  const { sessions, total } = listSessionsForUser(insightsId, {
    friction,
    limit,
    offset,
  });
  return c.json({ user, sessions, total });
});

function requestsWhere(c: any): { sql: string; params: any[] } {
  const where: string[] = [];
  const params: any[] = [];
  const model = c.req.query("model");
  if (model) {
    where.push("model = ?");
    params.push(model);
  }
  const status = c.req.query("status");
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  const session = c.req.query("session");
  if (session) {
    where.push("session_id = ?");
    params.push(session);
  }
  const user = c.req.query("user");
  if (user) {
    where.push("user_id = ?");
    params.push(user);
  }
  const q = c.req.query("q")?.trim();
  if (q) {
    where.push(
      "(id LIKE ? ESCAPE '\\' OR session_id LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\')",
    );
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    params.push(like, like, like);
  }
  const since = Number(c.req.query("since") ?? 0);
  if (since > 0) {
    where.push("started_at >= ?");
    params.push(since);
  }
  const until = Number(c.req.query("until") ?? 0);
  if (until > 0) {
    where.push("started_at <= ?");
    params.push(until);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

api.get("/requests", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  const w = requestsWhere(c);
  const rows = db
    .prepare(
      `SELECT id, session_id, user_id, provider, model, status, error,
              streamed, started_at, finished_at, latency_ms,
              input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
              cost, finish_reason
       FROM requests ${w.sql} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...w.params, limit, offset);
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM requests ${w.sql}`).get(...w.params) as any
  ).n;
  return c.json({ requests: rows, total });
});

api.get("/requests/aggregates", (c) => {
  const w = requestsWhere(c);
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS count,
         COALESCE(SUM(cost),0) AS total_cost,
         COALESCE(AVG(latency_ms),0) AS avg_latency_ms,
         COALESCE(SUM(CASE WHEN status='error' THEN 1 ELSE 0 END),0) AS error_count
       FROM requests ${w.sql}`,
    )
    .get(...w.params) as any;
  // p95 — pull all matching latencies, sorted ASC, pick the right index.
  const w2sql = w.sql
    ? `${w.sql} AND latency_ms IS NOT NULL`
    : `WHERE latency_ms IS NOT NULL`;
  const allLat = db
    .prepare(`SELECT latency_ms FROM requests ${w2sql} ORDER BY latency_ms ASC`)
    .all(...w.params) as { latency_ms: number }[];
  const p95 = allLat.length
    ? allLat[Math.min(allLat.length - 1, Math.floor(0.95 * allLat.length))]!
        .latency_ms
    : 0;
  const error_rate = totals.count > 0 ? totals.error_count / totals.count : 0;
  return c.json({
    count: totals.count,
    total_cost: totals.total_cost,
    avg_latency_ms: Number(totals.avg_latency_ms),
    p95_latency_ms: p95,
    error_count: totals.error_count,
    error_rate,
  });
});

api.get("/requests/:id", (c) => {
  const id = c.req.param("id");
  const row = db
    .prepare(`SELECT * FROM requests WHERE id = ?`)
    .get(id) as any;
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({
    ...row,
    request: safeJson(row.request_json),
    response: safeJson(row.response_json),
    tool_calls: safeJson(row.tool_calls_json),
  });
});

// Time-series with selectable bucket. bucket = minute | hour | day.
api.get("/timeseries", (c) => {
  const bucket = (c.req.query("bucket") ?? "hour") as "minute" | "hour" | "day";
  const range = Number(c.req.query("hours") ?? 24);
  const since = Date.now() - range * 3600 * 1000;
  const fmt =
    bucket === "minute"
      ? "%Y-%m-%dT%H:%M:00Z"
      : bucket === "day"
        ? "%Y-%m-%dT00:00:00Z"
        : "%Y-%m-%dT%H:00:00Z";
  const rows = db
    .prepare(
      `SELECT
         strftime('${fmt}', started_at/1000, 'unixepoch') AS bucket,
         COUNT(*) AS n,
         COALESCE(SUM(cost),0) AS cost,
         COALESCE(SUM(input_tokens),0) AS input_tokens,
         COALESCE(SUM(output_tokens),0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens),0) AS cache_creation_tokens,
         COALESCE(AVG(latency_ms),0) AS avg_latency_ms,
         SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors
       FROM requests
       WHERE started_at > ?
       GROUP BY bucket ORDER BY bucket ASC`,
    )
    .all(since);
  return c.json({ bucket, hours: range, points: rows });
});

// Hour-of-day x day-of-week heatmap.
api.get("/heatmap", (c) => {
  const days = Number(c.req.query("days") ?? 7);
  const since = Date.now() - days * 86400 * 1000;
  const rows = db
    .prepare(
      `SELECT
         CAST(strftime('%w', started_at/1000, 'unixepoch') AS INTEGER) AS dow,
         CAST(strftime('%H', started_at/1000, 'unixepoch') AS INTEGER) AS hour,
         COUNT(*) AS n,
         COALESCE(SUM(cost),0) AS cost
       FROM requests
       WHERE started_at > ?
       GROUP BY dow, hour`,
    )
    .all(since);
  return c.json({ days, cells: rows });
});

api.get("/latency", (c) => {
  const all = db
    .prepare(
      `SELECT latency_ms FROM requests WHERE latency_ms IS NOT NULL ORDER BY latency_ms ASC`,
    )
    .all() as { latency_ms: number }[];
  const sorted = all.map((r) => r.latency_ms);
  const pct = (p: number) =>
    sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
      : 0;
  // Histogram with log-ish buckets.
  const buckets = [50, 100, 200, 400, 800, 1500, 3000, 6000, 12000];
  const labels = ["<50", "<100", "<200", "<400", "<800", "<1.5s", "<3s", "<6s", "<12s", "12s+"];
  const counts = new Array(labels.length).fill(0);
  for (const v of sorted) {
    let i = buckets.findIndex((b) => v < b);
    if (i === -1) i = labels.length - 1;
    counts[i]++;
  }
  return c.json({
    count: sorted.length,
    p50: pct(50),
    p90: pct(90),
    p95: pct(95),
    p99: pct(99),
    max: sorted[sorted.length - 1] ?? 0,
    min: sorted[0] ?? 0,
    histogram: labels.map((label, i) => ({ label, count: counts[i] })),
  });
});

// Top tools by frequency, with timing aggregates from their request rows.
api.get("/tools", (c) => {
  const rows = db
    .prepare(
      `SELECT id, model, latency_ms, cost, tool_calls_json, status
       FROM requests
       WHERE tool_calls_json IS NOT NULL`,
    )
    .all() as Array<{
      id: string;
      model: string;
      latency_ms: number | null;
      cost: number | null;
      tool_calls_json: string;
      status: string;
    }>;

  const byTool: Record<
    string,
    {
      name: string;
      count: number;
      latency_sum: number;
      latency_n: number;
      cost: number;
      errors: number;
      models: Record<string, number>;
      sample_args: string[];
    }
  > = {};

  for (const r of rows) {
    let calls: any[] = [];
    try {
      calls = JSON.parse(r.tool_calls_json);
    } catch {
      continue;
    }
    for (const tc of calls) {
      const name = tc.function?.name ?? tc.name ?? "unknown";
      byTool[name] ??= {
        name,
        count: 0,
        latency_sum: 0,
        latency_n: 0,
        cost: 0,
        errors: 0,
        models: {},
        sample_args: [],
      };
      const e = byTool[name];
      e.count++;
      if (r.latency_ms != null) {
        e.latency_sum += r.latency_ms;
        e.latency_n++;
      }
      if (r.cost != null) e.cost += r.cost;
      if (r.status === "error") e.errors++;
      e.models[r.model] = (e.models[r.model] ?? 0) + 1;
      if (e.sample_args.length < 3 && tc.function?.arguments) {
        e.sample_args.push(String(tc.function.arguments).slice(0, 240));
      }
    }
  }

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
  const offset = Number(c.req.query("offset") ?? 0);
  const q = c.req.query("q")?.trim().toLowerCase();
  const errorsOnly = c.req.query("errorsOnly") === "1";

  let result = Object.values(byTool)
    .map((t) => ({
      name: t.name,
      count: t.count,
      avg_latency_ms: t.latency_n ? Math.round(t.latency_sum / t.latency_n) : 0,
      cost: t.cost,
      error_rate: t.count ? t.errors / t.count : 0,
      top_model:
        Object.entries(t.models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      sample_args: t.sample_args,
    }))
    .sort((a, b) => b.count - a.count);
  if (q) result = result.filter((t) => t.name.toLowerCase().includes(q));
  if (errorsOnly) result = result.filter((t) => t.error_rate > 0);
  const total = result.length;
  const page = result.slice(offset, offset + limit);
  return c.json({ tools: page, total });
});

api.get("/tools/aggregates", (c) => {
  const rows = db
    .prepare(
      `SELECT id, latency_ms, cost, tool_calls_json, status
       FROM requests
       WHERE tool_calls_json IS NOT NULL`,
    )
    .all() as Array<{
      id: string;
      latency_ms: number | null;
      cost: number | null;
      tool_calls_json: string;
      status: string;
    }>;
  let total_calls = 0;
  let error_calls = 0;
  let total_cost = 0;
  const names = new Set<string>();
  for (const r of rows) {
    let calls: any[] = [];
    try {
      calls = JSON.parse(r.tool_calls_json);
    } catch {
      continue;
    }
    for (const tc of calls) {
      total_calls++;
      const name = tc.function?.name ?? tc.name;
      if (name) names.add(name);
      if (r.status === "error") error_calls++;
      if (r.cost != null) total_cost += r.cost / Math.max(1, calls.length);
    }
  }
  return c.json({
    count: names.size,
    total_calls,
    total_cost,
    error_rate: total_calls > 0 ? error_calls / total_calls : 0,
  });
});

// Users-by-friction support: when ?friction=<tag> is set, restrict to the
// raw_user_ids that have at least one analyzed insights_session containing
// that tag. The intersection happens in JS to keep the SQL straightforward.
function userIdsForFriction(friction: string): Set<string> {
  // insights_sessions.json contains a SessionMeta. We loaded it via JSON_EXTRACT
  // when SQLite supports it; fall back to substring match otherwise. The
  // friction list lives at .friction[*].
  const rows = db
    .prepare(
      `SELECT s.user_id AS insights_user_id, u.raw_user_id AS raw_user_id
       FROM insights_sessions s
       JOIN insights_users u ON u.id = s.user_id
       WHERE instr(s.json, ?) > 0`,
    )
    .all(`"${friction}"`) as Array<{
      insights_user_id: string;
      raw_user_id: string | null;
    }>;
  const out = new Set<string>();
  for (const r of rows) if (r.raw_user_id) out.add(r.raw_user_id);
  return out;
}

api.get("/users", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  const q = c.req.query("q")?.trim();
  const friction = c.req.query("friction")?.trim();

  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    where.push("user_id LIKE ? ESCAPE '\\'");
    params.push(`%${q.replace(/[%_]/g, "\\$&")}%`);
  }
  if (friction) {
    const ids = userIdsForFriction(friction);
    if (ids.size === 0) {
      return c.json({ users: [], total: 0 });
    }
    const placeholders = Array.from(ids, () => "?").join(",");
    where.push(`user_id IN (${placeholders})`);
    params.push(...ids);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT
         COALESCE(user_id, '(anonymous)') AS user_id,
         COUNT(*) AS request_count,
         COUNT(DISTINCT session_id) AS session_count,
         COALESCE(SUM(cost),0) AS cost,
         COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) AS tokens,
         COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens),0) AS cache_creation_tokens,
         COALESCE(AVG(latency_ms),0) AS avg_latency_ms,
         SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
         MAX(started_at) AS last_seen
       FROM requests
       ${w}
       GROUP BY user_id
       ORDER BY request_count DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  // total = number of distinct user buckets matching the WHERE
  const total = (
    db
      .prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM requests ${w}`)
      .get(...params) as any
  ).n;
  return c.json({ users: rows, total });
});

api.get("/users/aggregates", (c) => {
  const totals = db
    .prepare(
      `SELECT
         COUNT(DISTINCT user_id) AS active,
         COALESCE(SUM(cost),0) AS total_cost,
         COALESCE(SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)),0) AS total_tokens,
         COALESCE(SUM(cache_read_tokens),0) AS total_cache_read_tokens,
         COALESCE(SUM(cache_creation_tokens),0) AS total_cache_creation_tokens
       FROM requests`,
    )
    .get() as any;
  const top = db
    .prepare(
      `SELECT user_id, SUM(cost) AS cost
       FROM requests
       GROUP BY user_id
       ORDER BY cost DESC LIMIT 1`,
    )
    .get() as { user_id: string | null; cost: number } | undefined;
  return c.json({
    active: totals.active,
    total_cost: totals.total_cost,
    total_tokens: totals.total_tokens,
    total_cache_read_tokens: totals.total_cache_read_tokens,
    total_cache_creation_tokens: totals.total_cache_creation_tokens,
    top_user_id: top?.user_id ?? null,
    top_user_cost: top?.cost ?? 0,
  });
});

api.get("/search", (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ requests: [] });
  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const rows = db
    .prepare(
      `SELECT id, session_id, user_id, provider, model, status, started_at,
              latency_ms, cost, input_tokens, output_tokens
       FROM requests
       WHERE request_json LIKE ? ESCAPE '\\'
          OR response_json LIKE ? ESCAPE '\\'
       ORDER BY started_at DESC LIMIT 100`,
    )
    .all(like, like);
  return c.json({ requests: rows, q });
});

function safeJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "session";
}

// Strip noisy/large fields from request body and keep only the parameters that
// matter for analysis (sampling, tools, response format, etc.).
function pickParams(req: unknown): Record<string, unknown> {
  if (!req || typeof req !== "object") return {};
  const r = req as Record<string, unknown>;
  const keep = [
    "temperature",
    "top_p",
    "top_k",
    "max_tokens",
    "max_completion_tokens",
    "stop",
    "stop_sequences",
    "presence_penalty",
    "frequency_penalty",
    "seed",
    "tool_choice",
    "response_format",
    "parallel_tool_calls",
    "reasoning_effort",
    "thinking",
    "anthropic_version",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (k in r) out[k] = r[k];
  if (Array.isArray(r.tools)) {
    out.tool_count = (r.tools as unknown[]).length;
    out.tool_names = (r.tools as Array<Record<string, unknown>>)
      .map((t) => {
        const fn = t.function as Record<string, unknown> | undefined;
        return (fn?.name ?? t.name) as string | undefined;
      })
      .filter(Boolean);
  }
  return out;
}

type EmitArgs = {
  push: (rec: Record<string, unknown>) => void;
  sessionId: string;
  requestId: string;
  sequence: number;
  role: string;
  content: unknown;
  toolCalls?: unknown;
  toolCallId?: string;
  name?: string;
  timestampMs: number;
  direction: "input" | "output";
  providerStopReason?: unknown;
  providerUsage?: unknown;
};

// Decompose a chat message into typed records: text, tool_use, tool_result,
// thinking, image. One record per block so analysts can filter by `type`.
function emitMessageBlocks(args: EmitArgs): void {
  const base = {
    session_id: args.sessionId,
    request_id: args.requestId,
    sequence: args.sequence,
    role: args.role,
    direction: args.direction,
    at_ms: args.timestampMs,
    at_iso: new Date(args.timestampMs).toISOString(),
  };

  // OpenAI tool message: tool_call_id + name + (string) content
  if (args.role === "tool") {
    args.push({
      type: "tool_result",
      ...base,
      tool_call_id: args.toolCallId ?? null,
      tool_name: args.name ?? null,
      content: args.content,
    });
    return;
  }

  // Content can be: string | Array<block> | null
  if (typeof args.content === "string" || args.content == null) {
    args.push({
      type: "text",
      ...base,
      text: (args.content as string | null) ?? "",
      ...(args.providerStopReason
        ? { stop_reason: args.providerStopReason }
        : {}),
      ...(args.providerUsage ? { usage: args.providerUsage } : {}),
    });
  } else if (Array.isArray(args.content)) {
    for (const blk of args.content) {
      if (typeof blk === "string") {
        args.push({ type: "text", ...base, text: blk });
        continue;
      }
      if (!blk || typeof blk !== "object") continue;
      const b = blk as Record<string, unknown>;
      const t = String(b.type ?? "unknown");
      if (t === "text") {
        args.push({ type: "text", ...base, text: String(b.text ?? "") });
      } else if (t === "tool_use") {
        args.push({
          type: "tool_call",
          ...base,
          tool_call_id: b.id,
          tool_name: b.name,
          arguments: b.input ?? {},
        });
      } else if (t === "tool_result") {
        args.push({
          type: "tool_result",
          ...base,
          tool_call_id: b.tool_use_id,
          content: b.content,
          is_error: b.is_error ?? false,
        });
      } else if (t === "thinking" || t === "redacted_thinking") {
        args.push({
          type: "thinking",
          ...base,
          text: String(b.thinking ?? b.text ?? ""),
        });
      } else if (t === "image") {
        args.push({
          type: "image",
          ...base,
          source_type:
            (b.source as Record<string, unknown> | undefined)?.type ?? null,
          media_type:
            (b.source as Record<string, unknown> | undefined)?.media_type ?? null,
        });
      } else {
        args.push({ type: "block", block_type: t, ...base, raw: b });
      }
    }
  } else {
    args.push({ type: "block", ...base, raw: args.content });
  }

  // OpenAI-shaped tool calls attached on the assistant message
  if (Array.isArray(args.toolCalls)) {
    for (const tc of args.toolCalls as Array<Record<string, unknown>>) {
      const fn = tc.function as Record<string, unknown> | undefined;
      let parsedArgs: unknown = fn?.arguments ?? {};
      if (typeof parsedArgs === "string") {
        try {
          parsedArgs = JSON.parse(parsedArgs);
        } catch {
          /* keep string */
        }
      }
      args.push({
        type: "tool_call",
        ...base,
        tool_call_id: tc.id,
        tool_name: fn?.name,
        arguments: parsedArgs,
      });
    }
  }
}

api.route("/", insightsApi);
