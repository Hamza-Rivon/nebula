import { db } from "../db.js";
import type {
  Aggregates,
  Cluster,
  Dataset,
  SessionMeta,
  Transcript,
  User,
} from "./types.js";

export type {
  Ask,
  Aggregates,
  Cluster,
  Dataset,
  Persona,
  SessionMeta,
  Transcript,
  TranscriptEvent,
  Unresolved,
  User,
  WasteFlag,
} from "./types.js";

// Schema migration runs once at module load. JSON blobs keyed by id keep the
// frontend's load path simple: `getDataset()` reconstructs the full Dataset
// shape with no per-column projection.
db.exec(`
  CREATE TABLE IF NOT EXISTS insights_meta (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS insights_users (
    id TEXT PRIMARY KEY,
    raw_user_id TEXT,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS insights_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS insights_clusters (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS insights_transcripts (
    session_id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_insights_users_raw ON insights_users(raw_user_id);
  CREATE INDEX IF NOT EXISTS idx_insights_sessions_user ON insights_sessions(user_id);
`);

const upsertMetaStmt = db.prepare(
  `INSERT INTO insights_meta (key, json, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
);
const getMetaStmt = db.prepare(`SELECT json FROM insights_meta WHERE key = ?`);

const upsertUserStmt = db.prepare(
  `INSERT INTO insights_users (id, raw_user_id, json, updated_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     raw_user_id = excluded.raw_user_id,
     json = excluded.json,
     updated_at = excluded.updated_at`,
);
const getUserStmt = db.prepare(`SELECT json FROM insights_users WHERE id = ?`);
const allUsersStmt = db.prepare(`SELECT json FROM insights_users ORDER BY id ASC`);

const upsertSessionStmt = db.prepare(
  `INSERT INTO insights_sessions (session_id, user_id, json, updated_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(session_id) DO UPDATE SET
     user_id = excluded.user_id,
     json = excluded.json,
     updated_at = excluded.updated_at`,
);
const getSessionStmt = db.prepare(
  `SELECT json FROM insights_sessions WHERE session_id = ?`,
);
const allSessionsStmt = db.prepare(
  `SELECT json FROM insights_sessions ORDER BY session_id ASC`,
);

const upsertClusterStmt = db.prepare(
  `INSERT INTO insights_clusters (id, json, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET
     json = excluded.json,
     updated_at = excluded.updated_at`,
);
const getClusterStmt = db.prepare(
  `SELECT json FROM insights_clusters WHERE id = ?`,
);
const allClustersStmt = db.prepare(
  `SELECT json FROM insights_clusters ORDER BY id ASC`,
);

const upsertTranscriptStmt = db.prepare(
  `INSERT INTO insights_transcripts (session_id, json, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(session_id) DO UPDATE SET
     json = excluded.json,
     updated_at = excluded.updated_at`,
);
const getTranscriptStmt = db.prepare(
  `SELECT json FROM insights_transcripts WHERE session_id = ?`,
);

function parseRow<T>(row: { json: string } | undefined): T | null {
  if (!row) return null;
  try {
    return JSON.parse(row.json) as T;
  } catch {
    return null;
  }
}

export function upsertUser(u: User, rawUserId: string | null): void {
  upsertMeta();
  upsertUserStmt.run(u.id, rawUserId, JSON.stringify(u), Date.now());
}

export function upsertSession(s: SessionMeta): void {
  upsertSessionStmt.run(s.sessionId, s.userId, JSON.stringify(s), Date.now());
}

export function upsertCluster(c: Cluster): void {
  upsertClusterStmt.run(c.id, JSON.stringify(c), Date.now());
}

export function upsertTranscript(t: Transcript): void {
  upsertTranscriptStmt.run(t.sessionId, JSON.stringify(t), Date.now());
}

export function setAggregates(a: Aggregates): void {
  upsertMetaStmt.run("aggregates", JSON.stringify(a), Date.now());
}

export function setConfig(c: Dataset["config"]): void {
  upsertMetaStmt.run("config", JSON.stringify(c), Date.now());
}

export function setGeneratedAt(iso: string): void {
  upsertMetaStmt.run("generatedAt", JSON.stringify(iso), Date.now());
}

function upsertMeta(): void {
  // No-op placeholder so callers can rely on a uniform code path. Reserved for
  // future meta side-effects (counters, dirty flags) without touching helpers.
}

export function getUser(id: string): User | null {
  return parseRow<User>(getUserStmt.get(id) as { json: string } | undefined);
}

export function getSession(sessionId: string): SessionMeta | null {
  return parseRow<SessionMeta>(
    getSessionStmt.get(sessionId) as { json: string } | undefined,
  );
}

export function getCluster(id: string): Cluster | null {
  return parseRow<Cluster>(
    getClusterStmt.get(id) as { json: string } | undefined,
  );
}

export function getTranscript(sessionId: string): Transcript | null {
  return parseRow<Transcript>(
    getTranscriptStmt.get(sessionId) as { json: string } | undefined,
  );
}

export function getDataset(): Dataset | null {
  const generatedAtRow = getMetaStmt.get("generatedAt") as
    | { json: string }
    | undefined;
  if (!generatedAtRow) return null;
  const generatedAt = parseRow<string>(generatedAtRow);
  const config = parseRow<Dataset["config"]>(
    getMetaStmt.get("config") as { json: string } | undefined,
  );
  const aggregates = parseRow<Aggregates>(
    getMetaStmt.get("aggregates") as { json: string } | undefined,
  );
  if (!generatedAt || !config || !aggregates) return null;

  const users = (allUsersStmt.all() as { json: string }[])
    .map((r) => parseRow<User>(r))
    .filter((x): x is User => x != null);
  const sessions = (allSessionsStmt.all() as { json: string }[])
    .map((r) => parseRow<SessionMeta>(r))
    .filter((x): x is SessionMeta => x != null);
  const clusters = (allClustersStmt.all() as { json: string }[])
    .map((r) => parseRow<Cluster>(r))
    .filter((x): x is Cluster => x != null);

  return {
    generatedAt,
    schemaVersion: 1,
    config,
    users,
    sessions,
    clusters,
    aggregates,
  };
}

export function clearInsights(): void {
  const tx = db.transaction(() => {
    db.exec(`DELETE FROM insights_meta`);
    db.exec(`DELETE FROM insights_users`);
    db.exec(`DELETE FROM insights_sessions`);
    db.exec(`DELETE FROM insights_clusters`);
    db.exec(`DELETE FROM insights_transcripts`);
  });
  tx();
}

// Lookup raw_user_id -> insights user id mapping. Used by analyze.ts so a
// re-run can preserve "u1".."uN" assignments across runs.
export function getUserIdByRaw(rawUserId: string | null): string | null {
  const row = db
    .prepare(
      `SELECT id FROM insights_users WHERE raw_user_id IS ? LIMIT 1`,
    )
    .get(rawUserId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function listRawUserMappings(): Array<{ id: string; raw_user_id: string | null }> {
  return db
    .prepare(`SELECT id, raw_user_id FROM insights_users ORDER BY id ASC`)
    .all() as Array<{ id: string; raw_user_id: string | null }>;
}
