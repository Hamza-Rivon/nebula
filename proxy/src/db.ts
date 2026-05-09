import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.NEBULA_DB_PATH ?? "./data/nebula.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0,
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
`);

const upsertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, user_id, created_at, updated_at, request_count, total_input_tokens, total_output_tokens, total_cost)
  VALUES (@id, @user_id, @now, @now, 0, 0, 0, 0)
  ON CONFLICT(id) DO UPDATE SET updated_at = @now, user_id = COALESCE(sessions.user_id, @user_id)
`);

const insertRequestStmt = db.prepare(`
  INSERT INTO requests (
    id, session_id, user_id, provider, model, status, error, streamed,
    started_at, finished_at, latency_ms, input_tokens, output_tokens, cost,
    request_json, response_json, tool_calls_json, finish_reason
  ) VALUES (
    @id, @session_id, @user_id, @provider, @model, @status, @error, @streamed,
    @started_at, @finished_at, @latency_ms, @input_tokens, @output_tokens, @cost,
    @request_json, @response_json, @tool_calls_json, @finish_reason
  )
`);

const updateSessionTotalsStmt = db.prepare(`
  UPDATE sessions SET
    request_count = request_count + 1,
    total_input_tokens = total_input_tokens + COALESCE(@in_tokens, 0),
    total_output_tokens = total_output_tokens + COALESCE(@out_tokens, 0),
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
  cost: number | null;
  request_json: string;
  response_json: string | null;
  tool_calls_json: string | null;
  finish_reason: string | null;
};

export function ensureSession(id: string, user_id: string | null): void {
  upsertSessionStmt.run({ id, user_id, now: Date.now() });
}

export function recordRequest(req: CapturedRequest): void {
  const tx = db.transaction((r: CapturedRequest) => {
    insertRequestStmt.run(r);
    updateSessionTotalsStmt.run({
      id: r.session_id,
      in_tokens: r.input_tokens,
      out_tokens: r.output_tokens,
      cost: r.cost,
      now: Date.now(),
    });
  });
  tx(req);
}
