import { Hono } from "hono";
import { db } from "./db.js";
import { listConfiguredProviders, PROVIDERS } from "./providers.js";

export const api = new Hono();

api.get("/providers", (c) => {
  return c.json({
    providers: listConfiguredProviders().map((p) => ({
      id: p.id,
      configured: p.configured,
      base_url: PROVIDERS[p.id].baseUrl,
    })),
  });
});

api.get("/stats", (c) => {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS request_count,
         COALESCE(SUM(input_tokens),0) AS input_tokens,
         COALESCE(SUM(output_tokens),0) AS output_tokens,
         COALESCE(SUM(cost),0) AS cost,
         COALESCE(AVG(latency_ms),0) AS avg_latency_ms,
         SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS error_count
       FROM requests`,
    )
    .get() as any;
  const sessions = db
    .prepare(`SELECT COUNT(*) AS session_count FROM sessions`)
    .get() as any;
  const byModel = db
    .prepare(
      `SELECT model, COUNT(*) AS n, SUM(cost) AS cost, SUM(input_tokens+output_tokens) AS tokens
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

api.get("/sessions", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  const rows = db
    .prepare(
      `SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as any).n;
  return c.json({ sessions: rows, total });
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
      tokens: { input: r.input_tokens, output: r.output_tokens },
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
      tokens: { input: r.input_tokens, output: r.output_tokens },
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
              input_tokens, output_tokens, cost, finish_reason
       FROM requests WHERE session_id = ? ORDER BY started_at ASC`,
    )
    .all(id);
  return c.json({ session, requests });
});

api.get("/requests", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  const model = c.req.query("model");
  const status = c.req.query("status");
  const session = c.req.query("session");
  const where: string[] = [];
  const params: any[] = [];
  if (model) {
    where.push("model = ?");
    params.push(model);
  }
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (session) {
    where.push("session_id = ?");
    params.push(session);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, session_id, user_id, provider, model, status, error,
              streamed, started_at, finished_at, latency_ms,
              input_tokens, output_tokens, cost, finish_reason
       FROM requests ${w} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM requests ${w}`).get(...params) as any
  ).n;
  return c.json({ requests: rows, total });
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

  const result = Object.values(byTool)
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
  return c.json({ tools: result });
});

api.get("/users", (c) => {
  const rows = db
    .prepare(
      `SELECT
         COALESCE(user_id, '(anonymous)') AS user_id,
         COUNT(*) AS request_count,
         COUNT(DISTINCT session_id) AS session_count,
         COALESCE(SUM(cost),0) AS cost,
         COALESCE(SUM(input_tokens+output_tokens),0) AS tokens,
         COALESCE(AVG(latency_ms),0) AS avg_latency_ms,
         SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors,
         MAX(started_at) AS last_seen
       FROM requests
       GROUP BY user_id
       ORDER BY request_count DESC
       LIMIT 50`,
    )
    .all();
  return c.json({ users: rows });
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
