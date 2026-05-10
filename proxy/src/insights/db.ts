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
  -- Per-session extraction cache. The extract phase runs an LLM call per
  -- session to produce the structured Extracted shape; that's the most
  -- expensive stage of the pipeline by far. Persisting each result the moment
  -- it's produced (rather than only at the final pipeline tx) means a
  -- container kill mid-run doesn't throw away every prior LLM call.
  -- Keyed on (session_id, ended_at) so a session that gains new requests
  -- (different ended_at) re-extracts; a stable session reuses the cached row.
  CREATE TABLE IF NOT EXISTS insights_extracts (
    session_id TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, ended_at)
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
  const usersRaw = (allUsersStmt.all() as { json: string }[])
    .map((r) => parseRow<User>(r))
    .filter((x): x is User => x != null);
  const sessions = (allSessionsStmt.all() as { json: string }[])
    .map((r) => parseRow<SessionMeta>(r))
    .filter((x): x is SessionMeta => x != null);
  const clusters = (allClustersStmt.all() as { json: string }[])
    .map((r) => parseRow<Cluster>(r))
    .filter((x): x is Cluster => x != null);

  // Nothing analyzed yet — let the API translate to 404 so the UI shows the
  // "no data" empty state instead of an empty-but-non-null dataset.
  if (sessions.length === 0) return null;

  // Per-user aggregates. The persisted user rows from `analyzeOneSession`
  // are minted at zero (sessionCount=0, totalCostUsd=0, …) — the rollup
  // pass would normally fill them in, but until then the Insights tab
  // would show every engineer at $0 / 0 sessions / 0% win rate. Recompute
  // these from `sessions` on every read so the page renders correctly
  // mid-fanout. Once rollup runs, the recomputed values still match the
  // persisted ones exactly (same formulas), so this stays correct after
  // rollup too. Persona / sessionsLast7d / topFrictionLabel are kept from
  // the persisted row when present (rollup writes them) and otherwise
  // derived from the live session set.
  const users = recomputeLiveUserMetrics(usersRaw, sessions);

  const generatedAt =
    parseRow<string>(getMetaStmt.get("generatedAt") as { json: string } | undefined) ??
    new Date().toISOString();
  const config =
    parseRow<Dataset["config"]>(
      getMetaStmt.get("config") as { json: string } | undefined,
    ) ?? {
      maxSessions: null,
      users: users.length,
      model: "",
      embeddingModel: null,
      apiBaseUrl: "",
    };
  // Aggregates are only finalized at rollup. Until then, derive a minimum
  // viable view so the Insights page can render counters and per-session
  // panels live as session tasks complete. The rollup pass overwrites with
  // the full corpus-wide computation.
  const aggregates =
    parseRow<Aggregates>(
      getMetaStmt.get("aggregates") as { json: string } | undefined,
    ) ?? deriveProvisionalAggregates(sessions, users);

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

function recomputeLiveUserMetrics(
  users: User[],
  sessions: SessionMeta[],
): User[] {
  if (users.length === 0) return users;
  const byUser = new Map<string, SessionMeta[]>();
  for (const s of sessions) {
    const arr = byUser.get(s.userId);
    if (arr) arr.push(s);
    else byUser.set(s.userId, [s]);
  }

  const corpusEnd = sessions.reduce(
    (acc, s) => (s.endedAt > acc ? s.endedAt : acc),
    "",
  );
  const corpusEndTs = corpusEnd ? new Date(corpusEnd).getTime() : Date.now();
  const sevenDaysMs = 7 * 86_400_000;

  return users.map((u) => {
    const userSessions = byUser.get(u.id) ?? [];
    const totalTokens = userSessions.reduce(
      (a, s) => a + s.tokens.input + s.tokens.output,
      0,
    );
    const totalCostUsd = userSessions.reduce((a, s) => a + s.costUsd, 0);
    const totalWasteUsd = userSessions.reduce((a, s) => a + s.wasteUsd, 0);
    const wizardScore =
      userSessions.length > 0
        ? userSessions.reduce((a, s) => a + s.wizardScore, 0) /
          userSessions.length
        : 0;
    const outcomes = { fully: 0, mostly: 0, partial: 0, none: 0, unclear: 0 };
    const tools: Record<string, number> = {};
    const fric: Record<string, number> = {};
    for (const s of userSessions) {
      outcomes[s.outcome]++;
      for (const [k, v] of Object.entries(s.tools)) tools[k] = (tools[k] ?? 0) + v;
      for (const f of s.friction) fric[f] = (fric[f] ?? 0) + 1;
    }
    const totalOutcomes =
      outcomes.fully +
      outcomes.mostly +
      outcomes.partial +
      outcomes.none +
      outcomes.unclear;
    const wins = outcomes.fully + outcomes.mostly;
    const winRate = totalOutcomes > 0 ? wins / totalOutcomes : 0;
    const costPerWin = wins > 0 ? totalCostUsd / wins : totalCostUsd;
    const lastActiveAt =
      userSessions
        .map((s) => s.startedAt)
        .sort()
        .at(-1) ?? new Date(0).toISOString();
    const sessionsLast7d = userSessions.filter(
      (s) => corpusEndTs - new Date(s.startedAt).getTime() <= sevenDaysMs,
    ).length;
    const topTools = Object.fromEntries(
      Object.entries(tools)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    );
    const topFrictions = Object.fromEntries(
      Object.entries(fric)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    );
    return {
      ...u,
      sessionCount: userSessions.length,
      totalTokens,
      totalCostUsd,
      totalWasteUsd,
      wizardScore,
      outcomes,
      topTools,
      topFrictions,
      winRate,
      costPerWin,
      lastActiveAt,
      sessionsLast7d,
      // persona + topFrictionLabel come from rollup when present; otherwise
      // keep whatever the partial pipeline minted (default "lurker"/"no
      // recurring friction"). Recomputing those here would duplicate logic
      // from analyze.ts for marginal benefit.
    };
  });
}

function deriveProvisionalAggregates(
  sessions: SessionMeta[],
  users: User[],
): Aggregates {
  const allTools: Record<string, number> = {};
  const modelMix: Record<string, number> = {};
  const outcomeMix: Record<string, number> = {};
  const frictionMix: Record<string, number> = {};
  const wasteByType: Record<
    string,
    { tokens: number; usd: number; sessions: number }
  > = {};
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
  const totalWins = (outcomeMix.fully ?? 0) + (outcomeMix.mostly ?? 0);
  const allOutcomes =
    (outcomeMix.fully ?? 0) +
    (outcomeMix.mostly ?? 0) +
    (outcomeMix.partial ?? 0) +
    (outcomeMix.none ?? 0) +
    (outcomeMix.unclear ?? 0);
  const adoptionPct =
    users.length > 0
      ? users.filter((u) => u.sessionsLast7d >= 2).length / users.length
      : 0;
  return {
    totalSessions: sessions.length,
    totalUsers: users.length,
    totalTokens,
    totalCostUsd: totalCost,
    totalWasteUsd: totalWaste,
    productiveUsd: Math.max(0, totalCost - totalWaste),
    firmWinRate: allOutcomes > 0 ? totalWins / allOutcomes : 0,
    adoptionPct,
    costPerLandedOutcome: totalWins > 0 ? totalCost / totalWins : totalCost,
    prevPeriodCostUsd: null,
    dateRange: { start: dateStart, end: dateEnd },
    toolCounts: allTools,
    modelMix,
    outcomeMix,
    frictionMix,
    wasteByType,
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
    db.exec(`DELETE FROM insights_extracts`);
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

const getExtractStmt = db.prepare(
  `SELECT json FROM insights_extracts WHERE session_id = ? AND ended_at = ?`,
);
const upsertExtractStmt = db.prepare(
  `INSERT INTO insights_extracts (session_id, ended_at, json, updated_at)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(session_id, ended_at) DO UPDATE SET
     json = excluded.json,
     updated_at = excluded.updated_at`,
);

export function getCachedExtract<T>(sessionId: string, endedAt: string): T | null {
  const row = getExtractStmt.get(sessionId, endedAt) as
    | { json: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.json) as T;
  } catch {
    return null;
  }
}

export function putCachedExtract(
  sessionId: string,
  endedAt: string,
  value: unknown,
): void {
  upsertExtractStmt.run(sessionId, endedAt, JSON.stringify(value), Date.now());
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
