import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { publishEvent } from "./events.js";

const DB_PATH = process.env.NEBULA_DB_PATH ?? "./data/nebula.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// bun:sqlite requires the `@` (or `$`/`:`) prefix on object keys when SQL uses
// prefixed placeholders — passing plain keys silently binds null. `np()`
// rewrites a plain object into the prefixed shape bun:sqlite expects.
type Bind = string | number | bigint | boolean | null | Uint8Array;
export function np<T extends Record<string, Bind>>(obj: T): Record<string, Bind> {
  const out: Record<string, Bind> = {};
  for (const k in obj) out["@" + k] = obj[k];
  return out;
}

// Token accounting note: `input_tokens` is *fresh* (uncached) input only — the
// content the model had to read from scratch on this turn. Cache reads/writes
// live in their own columns because:
//   - cache_read is the prefix re-read every turn; summing it into input
//     inflates "total tokens" by the conversation length × cached prefix size
//     (e.g. 100 turns × 100k cached prefix = 10M phantom tokens).
//   - they're billed at very different rates, so the cost formula needs them
//     split anyway.
// Headline "total tokens" displayed to users = input + output. Cache stats are
// a secondary metric (cache hit rate, $ saved by cache).
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
    total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    user_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    streamed INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    latency_ms INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_creation_tokens INTEGER,
    cost REAL,
    request_json TEXT NOT NULL,
    response_json TEXT,
    tool_calls_json TEXT,
    finish_reason TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
  CREATE INDEX IF NOT EXISTS idx_requests_started ON requests(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_requests_model ON requests(model);
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

  CREATE TABLE IF NOT EXISTS seed_imports (
    file_path TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    mtime REAL NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    imported_at INTEGER NOT NULL,
    session_count INTEGER NOT NULL,
    request_count INTEGER NOT NULL
  );
`);

// Idempotent migrations for existing volumes. SQLite has no
// `ADD COLUMN IF NOT EXISTS`, so we read table_info and only ALTER when missing.
{
  const seedCols = db
    .prepare(`PRAGMA table_info(seed_imports)`)
    .all() as Array<{ name: string }>;
  const haveSeed = new Set(seedCols.map((c) => c.name));
  if (!haveSeed.has("mtime")) {
    db.exec(`ALTER TABLE seed_imports ADD COLUMN mtime REAL NOT NULL DEFAULT 0`);
  }
  if (!haveSeed.has("size")) {
    db.exec(`ALTER TABLE seed_imports ADD COLUMN size INTEGER NOT NULL DEFAULT 0`);
  }

  const reqCols = db
    .prepare(`PRAGMA table_info(requests)`)
    .all() as Array<{ name: string }>;
  const haveReq = new Set(reqCols.map((c) => c.name));
  if (!haveReq.has("cache_read_tokens")) {
    db.exec(`ALTER TABLE requests ADD COLUMN cache_read_tokens INTEGER`);
  }
  if (!haveReq.has("cache_creation_tokens")) {
    db.exec(`ALTER TABLE requests ADD COLUMN cache_creation_tokens INTEGER`);
  }

  const sessCols = db
    .prepare(`PRAGMA table_info(sessions)`)
    .all() as Array<{ name: string }>;
  const haveSess = new Set(sessCols.map((c) => c.name));
  if (!haveSess.has("total_cache_read_tokens")) {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN total_cache_read_tokens INTEGER NOT NULL DEFAULT 0`,
    );
  }
  if (!haveSess.has("total_cache_creation_tokens")) {
    db.exec(
      `ALTER TABLE sessions ADD COLUMN total_cache_creation_tokens INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

const upsertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, user_id, created_at, updated_at, request_count,
    total_input_tokens, total_output_tokens,
    total_cache_read_tokens, total_cache_creation_tokens, total_cost)
  VALUES (@id, @user_id, @now, @now, 0, 0, 0, 0, 0, 0)
  ON CONFLICT(id) DO UPDATE SET updated_at = @now, user_id = COALESCE(sessions.user_id, @user_id)
`);

const insertRequestStmt = db.prepare(`
  INSERT INTO requests (
    id, session_id, user_id, provider, model, status, error, streamed,
    started_at, finished_at, latency_ms,
    input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost,
    request_json, response_json, tool_calls_json, finish_reason
  ) VALUES (
    @id, @session_id, @user_id, @provider, @model, @status, @error, @streamed,
    @started_at, @finished_at, @latency_ms,
    @input_tokens, @output_tokens, @cache_read_tokens, @cache_creation_tokens, @cost,
    @request_json, @response_json, @tool_calls_json, @finish_reason
  )
`);

const updateSessionTotalsStmt = db.prepare(`
  UPDATE sessions SET
    request_count = request_count + 1,
    total_input_tokens = total_input_tokens + COALESCE(@in_tokens, 0),
    total_output_tokens = total_output_tokens + COALESCE(@out_tokens, 0),
    total_cache_read_tokens = total_cache_read_tokens + COALESCE(@cache_read_tokens, 0),
    total_cache_creation_tokens = total_cache_creation_tokens + COALESCE(@cache_creation_tokens, 0),
    total_cost = total_cost + COALESCE(@cost, 0),
    updated_at = @now
  WHERE id = @id
`);

export type CapturedRequest = {
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
};

export function ensureSession(id: string, user_id: string | null): void {
  upsertSessionStmt.run(np({ id, user_id, now: Date.now() }));
}

export function recordRequest(req: CapturedRequest): void {
  const tx = db.transaction((r: CapturedRequest) => {
    insertRequestStmt.run(np(r));
    updateSessionTotalsStmt.run(
      np({
        id: r.session_id,
        in_tokens: r.input_tokens,
        out_tokens: r.output_tokens,
        cache_read_tokens: r.cache_read_tokens,
        cache_creation_tokens: r.cache_creation_tokens,
        cost: r.cost,
        now: Date.now(),
      }),
    );
  });
  tx(req);
  // Fan out to live UI subscribers. Done outside the transaction so a slow
  // or failing subscriber can't roll back the write.
  publishEvent({
    type: "request",
    request_id: req.id,
    session_id: req.session_id,
    user_id: req.user_id,
    provider: req.provider,
    model: req.model,
    status: req.status,
    cost: req.cost,
    input_tokens: req.input_tokens,
    output_tokens: req.output_tokens,
    latency_ms: req.latency_ms,
    started_at: req.started_at,
    finished_at: req.finished_at,
  });
}
