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
  -- Content-addressed cache for the analyze pipeline. Identical text + model
  -- pairs reuse the previously-computed embedding instead of hitting the API
  -- again. Survives container restarts; this is what makes a re-analyze with
  -- no new transcripts essentially free.
  CREATE TABLE IF NOT EXISTS insights_embeddings (
    text_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    vector_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (text_hash, model)
  );
  -- Same idea for the per-cluster LLM labeling pass: identical sample bag +
  -- model = identical label, so we don't pay the per-cluster round-trip on
  -- repeat runs.
  CREATE TABLE IF NOT EXISTS insights_cluster_labels (
    samples_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    label TEXT NOT NULL,
    domain TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (samples_hash, model)
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
    // Drop the content caches too — otherwise a "Clear" followed by a re-
    // analyze would silently reuse old vectors / labels and the user wouldn't
    // see a true rebuild.
    db.exec(`DELETE FROM insights_embeddings`);
    db.exec(`DELETE FROM insights_cluster_labels`);
  });
  tx();
}

// ---- analyze-pipeline content caches ---------------------------------------

const getEmbeddingStmt = db.prepare(
  `SELECT vector_json FROM insights_embeddings WHERE text_hash = ? AND model = ?`,
);
const upsertEmbeddingStmt = db.prepare(
  `INSERT INTO insights_embeddings (text_hash, model, vector_json, updated_at)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(text_hash, model) DO UPDATE SET
     vector_json = excluded.vector_json,
     updated_at = excluded.updated_at`,
);

export function getCachedEmbedding(
  textHash: string,
  model: string,
): number[] | null {
  const row = getEmbeddingStmt.get(textHash, model) as
    | { vector_json: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.vector_json);
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

// Persist many embeddings in a single transaction — much faster than N
// individual statements when warming the cache after a fresh analyze run.
export function putCachedEmbeddings(
  rows: Array<{ textHash: string; model: string; vector: number[] }>,
): void {
  if (rows.length === 0) return;
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const r of rows) {
      upsertEmbeddingStmt.run(
        r.textHash,
        r.model,
        JSON.stringify(r.vector),
        now,
      );
    }
  });
  tx();
}

const getClusterLabelStmt = db.prepare(
  `SELECT label, domain FROM insights_cluster_labels WHERE samples_hash = ? AND model = ?`,
);
const upsertClusterLabelStmt = db.prepare(
  `INSERT INTO insights_cluster_labels (samples_hash, model, label, domain, updated_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(samples_hash, model) DO UPDATE SET
     label = excluded.label,
     domain = excluded.domain,
     updated_at = excluded.updated_at`,
);

export function getCachedClusterLabel(
  samplesHash: string,
  model: string,
): { label: string; domain: string } | null {
  const row = getClusterLabelStmt.get(samplesHash, model) as
    | { label: string; domain: string }
    | undefined;
  return row ?? null;
}

export function putCachedClusterLabel(
  samplesHash: string,
  model: string,
  label: string,
  domain: string,
): void {
  upsertClusterLabelStmt.run(samplesHash, model, label, domain, Date.now());
}

// Number of captured sessions that have no SessionMeta yet — i.e. work the
// next analyze pass would actually do. Used by the boot path to skip
// auto-enqueue when the persisted insights are already up to date with the
// session corpus.
export function countUnanalyzedSessions(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM sessions s
       LEFT JOIN insights_sessions i ON i.session_id = s.id
       WHERE i.session_id IS NULL`,
    )
    .get() as { n: number };
  return row.n;
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

// Resolve an insights user id from either an insights id ("u3") or a raw
// user id ("alice"). Returns null when nothing matches.
export function resolveInsightsUserId(idOrRaw: string): string | null {
  const direct = db
    .prepare(`SELECT id FROM insights_users WHERE id = ?`)
    .get(idOrRaw) as { id: string } | undefined;
  if (direct) return direct.id;
  const byRaw = db
    .prepare(`SELECT id FROM insights_users WHERE raw_user_id = ?`)
    .get(idOrRaw) as { id: string } | undefined;
  return byRaw?.id ?? null;
}

// Sessions for a user, with optional friction-tag filter. The friction list
// lives in JSON inside the session blob, so we filter by substring after
// loading. Cheap: a single user has tens of sessions, not thousands.
export function listSessionsForUser(
  userId: string,
  opts: { friction?: string; limit?: number; offset?: number } = {},
): { sessions: SessionMeta[]; total: number } {
  const rows = db
    .prepare(
      `SELECT json FROM insights_sessions WHERE user_id = ?
       ORDER BY json_extract(json, '$.startedAt') DESC`,
    )
    .all(userId) as { json: string }[];
  let parsed = rows
    .map((r) => parseRow<SessionMeta>(r))
    .filter((x): x is SessionMeta => x != null);
  if (opts.friction) {
    parsed = parsed.filter((s) => s.friction.includes(opts.friction!));
  }
  const total = parsed.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? parsed.length;
  return { sessions: parsed.slice(offset, offset + limit), total };
}

// Sessions filtered by friction across all users. Used by the deep-link
// flow from the Insights drawer.
export function listSessionsByFriction(
  friction: string,
  opts: { limit?: number; offset?: number } = {},
): { sessions: SessionMeta[]; total: number } {
  const rows = db
    .prepare(
      `SELECT json FROM insights_sessions WHERE instr(json, ?) > 0
       ORDER BY json_extract(json, '$.startedAt') DESC`,
    )
    .all(`"${friction}"`) as { json: string }[];
  const parsed = rows
    .map((r) => parseRow<SessionMeta>(r))
    .filter((x): x is SessionMeta => x != null && x.friction.includes(friction));
  const total = parsed.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? parsed.length;
  return { sessions: parsed.slice(offset, offset + limit), total };
}
