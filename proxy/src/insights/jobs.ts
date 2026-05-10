import { nanoid } from "nanoid";
import { db, np, setOnRequestRecorded } from "../db.js";
import { publishEvent } from "../events.js";
import { getAutoDrain } from "../settings.js";
import {
  analyzeOneSession,
  runRollup,
  type AnalyzeOptions,
  type AnalyzeProgress,
} from "./analyze.js";

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

// In-memory cancel signal for jobs currently in `running`. When a UI client
// hits the cancel endpoint, we add the id here. Workers consult it at await
// boundaries; the per-session pipeline doesn't need fine-grained cancellation
// (each task is a single LLM call), so we just refuse to start new work for
// a cancelled id.
const cancelRequested = new Set<string>();

export type Job = {
  id: string;
  scope: string;
  status: JobStatus;
  stage: string | null;
  total: number | null;
  done: number | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS analyze_jobs (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT,
    total INTEGER,
    done INTEGER,
    error TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_analyze_jobs_started ON analyze_jobs(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_analyze_jobs_status ON analyze_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_analyze_jobs_scope ON analyze_jobs(scope);
`);

// Recover from previous abrupt shutdowns: any row left in 'running' is stale.
db.prepare(
  `UPDATE analyze_jobs
   SET status = 'error',
       error = 'interrupted by restart',
       finished_at = ?
   WHERE status = 'running'`,
).run(Date.now());

const insertStmt = db.prepare(
  `INSERT INTO analyze_jobs (id, scope, status, stage, total, done, error, started_at, finished_at)
   VALUES (@id, @scope, @status, @stage, @total, @done, @error, @started_at, @finished_at)`,
);
const selectByIdStmt = db.prepare(`SELECT * FROM analyze_jobs WHERE id = ?`);
const selectRecentStmt = db.prepare(
  `SELECT * FROM analyze_jobs ORDER BY started_at DESC LIMIT ?`,
);
const selectActiveByScopeStmt = db.prepare(
  `SELECT * FROM analyze_jobs
   WHERE scope = ? AND status IN ('queued', 'running')
   ORDER BY started_at ASC LIMIT 1`,
);
const updateProgressStmt = db.prepare(
  `UPDATE analyze_jobs SET stage = @stage, total = @total, done = @done WHERE id = @id`,
);
const updateStatusStmt = db.prepare(
  `UPDATE analyze_jobs SET status = @status WHERE id = @id`,
);
const updateFinishStmt = db.prepare(
  `UPDATE analyze_jobs SET status = @status, error = @error, finished_at = @finished_at WHERE id = @id`,
);

// Multi-worker scheduler. Atomically claim the next queued job by id so two
// workers never grab the same row.
const claimQueuedSessionStmt = db.prepare(
  `UPDATE analyze_jobs
     SET status = 'running'
     WHERE id = (
       SELECT id FROM analyze_jobs
        WHERE status = 'queued' AND scope LIKE 'session:%'
        ORDER BY started_at ASC
        LIMIT 1
     )
     RETURNING *`,
);
const claimQueuedRollupStmt = db.prepare(
  `UPDATE analyze_jobs
     SET status = 'running'
     WHERE id = (
       SELECT id FROM analyze_jobs
        WHERE status = 'queued' AND (scope = 'rollup' OR scope = 'rollup+force')
        ORDER BY started_at ASC
        LIMIT 1
     )
     RETURNING *`,
);
const countQueuedSessionsStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM analyze_jobs
    WHERE status IN ('queued', 'running') AND scope LIKE 'session:%'`,
);
// Queued-only count (no running). kickWorkers uses this to avoid spinning
// up phantom workers that would pin activeSessionWorkers to MAX_WORKERS
// for one event-loop tick while their .finally decrements are still queued
// as microtasks — that's the race that wedged the boot path.
const countQueuedSessionsOnlyStmt = db.prepare(
  `SELECT COUNT(*) AS n FROM analyze_jobs
    WHERE status = 'queued' AND scope LIKE 'session:%'`,
);

// Live status priority for the queue table: running > queued > done >
// cancelled > error. Within each bucket, newest first by started_at.
// SQLite has no enum-aware ORDER BY so we project a numeric priority.
const STATUS_PRIORITY_SQL = `CASE status
    WHEN 'running' THEN 0
    WHEN 'queued' THEN 1
    WHEN 'done' THEN 2
    WHEN 'cancelled' THEN 3
    WHEN 'error' THEN 4
    ELSE 5
  END`;

// Per-job throttle for progress emissions.
const PROGRESS_THROTTLE_MS = 250;
const lastEmitAt = new Map<string, number>();

function emit(id: string, force = false): void {
  const now = Date.now();
  if (!force) {
    const last = lastEmitAt.get(id) ?? 0;
    if (now - last < PROGRESS_THROTTLE_MS) return;
  }
  const job = getJob(id);
  if (!job) return;
  lastEmitAt.set(id, now);
  publishEvent({ type: "job", job });
  if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
    lastEmitAt.delete(id);
  }
}

function rowToJob(row: any): Job {
  return {
    id: row.id,
    scope: row.scope,
    status: row.status as JobStatus,
    stage: row.stage ?? null,
    total: row.total ?? null,
    done: row.done ?? null,
    error: row.error ?? null,
    started_at: row.started_at,
    finished_at: row.finished_at ?? null,
  };
}

export function getJob(id: string): Job | null {
  const row = selectByIdStmt.get(id) as any;
  return row ? rowToJob(row) : null;
}

export function listJobs(limit = 20): Job[] {
  const rows = selectRecentStmt.all(limit) as any[];
  return rows.map(rowToJob);
}

// New: list with optional scope-prefix filter and pagination. The Jobs page
// uses this so 1k+ session task rows don't all rush down the wire at once.
export function listJobsFiltered(opts: {
  scopePrefix?: string;
  status?: JobStatus;
  limit: number;
  offset: number;
}): { jobs: Job[]; total: number } {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.scopePrefix) {
    where.push(`scope LIKE ?`);
    params.push(`${opts.scopePrefix}%`);
  }
  if (opts.status) {
    where.push(`status = ?`);
    params.push(opts.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db
    .prepare(`SELECT COUNT(*) AS n FROM analyze_jobs ${whereSql}`)
    .get(...params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT * FROM analyze_jobs ${whereSql}
       ORDER BY ${STATUS_PRIORITY_SQL} ASC, started_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit, opts.offset) as any[];
  return { jobs: rows.map(rowToJob), total };
}

function insertJob(scope: string): Job {
  const id = nanoid();
  const now = Date.now();
  insertStmt.run(
    np({
      id,
      scope,
      status: "queued",
      stage: null,
      total: null,
      done: null,
      error: null,
      started_at: now,
      finished_at: null,
    }),
  );
  emit(id, true);
  return getJob(id)!;
}

// Public entry. Three meaningful scope shapes:
//   "all" | "all+force"           -> fan out per-session jobs + a rollup.
//   "session:<id>" | "...+force"  -> single session task, no rollup.
//   "rollup" | "rollup+force"     -> rebuild clusters/aggregates only.
//
// Coalesces against currently active rows of the same scope so racy clicks
// or boot-time auto-enqueue don't pile up duplicates.
export function enqueueJob(scope: string): Job {
  const force = scope.endsWith("+force");
  const baseScope = force ? scope.slice(0, -"+force".length) : scope;

  if (baseScope === "all") {
    return enqueueAll(force);
  }

  // Coalesce single-session and rollup scopes.
  const active = selectActiveByScopeStmt.get(scope) as any;
  if (active) {
    kickWorkers();
    return rowToJob(active);
  }
  const job = insertJob(scope);
  kickWorkers();
  return job;
}

// Fan-out for "all": one task per session in the corpus, plus a single
// rollup task. Each session row has its own progress (1/1) so the Jobs page
// reads as a queue of tasks, not a single 1358-step job.
function enqueueAll(force: boolean): Job {
  // Coalesce: if there's already a running fan-out (rollup or session jobs
  // pending), return that as the "anchor" job — the visible signal is the
  // rollup row at the tail, so prefer that one.
  const activeRollup = selectActiveByScopeStmt.get(
    force ? "rollup+force" : "rollup",
  ) as any;
  if (activeRollup) {
    kickWorkers();
    return rowToJob(activeRollup);
  }

  const sessionIds = (
    db.prepare(`SELECT id FROM sessions ORDER BY created_at ASC`).all() as {
      id: string;
    }[]
  ).map((r) => r.id);

  // Skip sessions that already have queued/running jobs to avoid duplicates
  // when "all" is re-clicked while a previous fan-out is still draining.
  const activeSessionScopes = new Set(
    (db
      .prepare(
        `SELECT scope FROM analyze_jobs
          WHERE status IN ('queued', 'running') AND scope LIKE 'session:%'`,
      )
      .all() as { scope: string }[]).map((r) => r.scope),
  );

  const tx = db.transaction(() => {
    for (const sid of sessionIds) {
      const sessionScope = force ? `session:${sid}+force` : `session:${sid}`;
      if (activeSessionScopes.has(sessionScope)) continue;
      insertStmt.run(
        np({
          id: nanoid(),
          scope: sessionScope,
          status: "queued",
          stage: null,
          total: 1,
          done: 0,
          error: null,
          started_at: Date.now(),
          finished_at: null,
        }),
      );
    }
  });
  tx();

  const rollupScope = force ? "rollup+force" : "rollup";
  const rollup = insertJob(rollupScope);
  // Tell the UI "many rows changed" with a single event instead of 1k+
  // individual `job` events. Each per-row event triggered a setQueryData
  // burst in the live bridge that froze the manager's browser during a
  // full fan-out. The bulk event is debounced into one invalidate.
  const queuedCount = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM analyze_jobs
        WHERE status = 'queued' AND scope LIKE 'session:%'`,
    )
    .get() as { n: number }).n;
  publishEvent({ type: "jobs_bulk_changed", count: queuedCount });

  kickWorkers();
  return rollup;
}

// Auto-enqueue from the gateway capture path. Inserts a queued
// `session:<sid>` row if there isn't already an active (queued or running)
// one for that scope. Whether workers are kicked depends on the persisted
// `auto_drain` toggle: ON (default) means the session is analyzed in the
// background as soon as it's captured; OFF leaves it sitting in `queued`
// until the manager flips the toggle (or runs "Re-analyze all").
export function enqueueSessionForCapture(sessionId: string): Job | null {
  const scope = `session:${sessionId}`;
  const active = selectActiveByScopeStmt.get(scope) as any;
  if (active) return rowToJob(active);
  const job = insertJob(scope);
  if (getAutoDrain()) kickWorkers();
  return job;
}

// Public "run the queue" trigger. Idempotent — if workers are already
// draining, this is a no-op. Returns counts so the UI can react with a
// toast or progress chip.
export function runQueue(): { picked: number; remaining: number } {
  const before = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM analyze_jobs
        WHERE status IN ('queued', 'running')`,
    )
    .get() as { n: number }).n;
  kickWorkers();
  const remaining = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM analyze_jobs
        WHERE status IN ('queued', 'running')`,
    )
    .get() as { n: number }).n;
  return { picked: before, remaining };
}

function buildOptions(): AnalyzeOptions {
  const opts: AnalyzeOptions = {};
  const baseUrl = process.env.NEBULA_ANALYZE_API_BASE_URL;
  const apiKey = process.env.NEBULA_ANALYZE_API_KEY;
  const model = process.env.NEBULA_ANALYZE_MODEL;
  const embeddingModel = process.env.NEBULA_ANALYZE_EMBEDDING_MODEL;
  if (baseUrl) (opts as any).apiBaseUrl = baseUrl;
  if (apiKey) (opts as any).apiKey = apiKey;
  if (model) (opts as any).model = model;
  if (embeddingModel) (opts as any).embeddingModel = embeddingModel;
  return opts;
}

// Multi-worker scheduling. Each worker is an async loop that claims the next
// queued session task and runs it. A separate single-flight slot runs rollup
// once all session tasks have drained.
const MAX_WORKERS = Math.max(
  1,
  Number(process.env.NEBULA_ANALYZE_WORKERS ?? 8),
);
let activeSessionWorkers = 0;
let rollupRunning = false;
// Set when any worker is mid-tick — used to coalesce kicks.
let pendingKicks = 0;

function kickWorkers(): void {
  // Only spawn workers up to the number of actually-queued tasks. Spinning
  // up MAX_WORKERS unconditionally creates a race: when the queue is empty
  // (e.g. resumeQueuedJobs on boot before the fan-out commits), each worker
  // increments activeSessionWorkers synchronously, claims null, and returns
  // — but the .finally decrements fire as microtasks, so for one tick the
  // counter is pinned at MAX_WORKERS. The very next sync caller (the boot
  // fan-out) hits this `while` and no-ops, then nothing kicks again.
  const queued = (countQueuedSessionsOnlyStmt.get() as { n: number }).n;
  const target = Math.min(MAX_WORKERS, queued);
  while (activeSessionWorkers < target) {
    activeSessionWorkers++;
    void sessionWorkerLoop().finally(() => {
      activeSessionWorkers--;
      // After each session task wraps, re-evaluate whether the rollup can run.
      maybeStartRollup();
    });
  }
  maybeStartRollup();
  pendingKicks++;
}

async function sessionWorkerLoop(): Promise<void> {
  for (;;) {
    const claimed = claimQueuedSessionStmt.get() as any;
    if (!claimed) return;
    const job = rowToJob(claimed);
    if (cancelRequested.has(job.id)) {
      updateFinishStmt.run(
        np({
          id: job.id,
          status: "cancelled",
          error: "cancelled before start",
          finished_at: Date.now(),
        }),
      );
      cancelRequested.delete(job.id);
      emit(job.id, true);
      continue;
    }
    emit(job.id, true);
    await runSessionTask(job);
  }
}

async function runSessionTask(job: Job): Promise<void> {
  const force = job.scope.endsWith("+force");
  const base = force ? job.scope.slice(0, -"+force".length) : job.scope;
  const sid = base.slice("session:".length);

  updateProgressStmt.run(
    np({ id: job.id, stage: "extract", total: 1, done: 0 }),
  );
  emit(job.id, true);

  const opts: AnalyzeOptions = { ...buildOptions(), force };
  try {
    const meta = await analyzeOneSession(sid, opts);
    if (!meta) {
      updateFinishStmt.run(
        np({
          id: job.id,
          status: "error",
          error: "session not found",
          finished_at: Date.now(),
        }),
      );
    } else {
      updateProgressStmt.run(
        np({ id: job.id, stage: "extract", total: 1, done: 1 }),
      );
      updateFinishStmt.run(
        np({
          id: job.id,
          status: "done",
          error: null,
          finished_at: Date.now(),
        }),
      );
    }
  } catch (err) {
    const msg = (err as { message?: string } | null)?.message ?? String(err);
    updateFinishStmt.run(
      np({
        id: job.id,
        status: "error",
        error: msg,
        finished_at: Date.now(),
      }),
    );
  } finally {
    emit(job.id, true);
    sessionsCompletedSinceCheckpoint++;
    // Every batch of completed session tasks we may queue a checkpoint
    // rollup so clusters / per-user aggregates refresh while the fan-out
    // is still draining. Coalesces against any active rollup.
    maybeQueueCheckpointRollup();
  }
}

function maybeStartRollup(): void {
  if (rollupRunning) return;
  // No gate on remaining session jobs anymore: the rollup operates only on
  // already-analyzed sessions (see analyze.ts/runRollup), so it's safe and
  // useful to run it concurrently with the per-session fan-out. This is what
  // makes clusters / per-user aggregates update live in the Insights tab.
  const claimed = claimQueuedRollupStmt.get() as any;
  if (!claimed) return;
  rollupRunning = true;
  const job = rowToJob(claimed);
  emit(job.id, true);
  void runRollupTask(job).finally(() => {
    rollupRunning = false;
    // A rollup might've been queued while another was running — drain.
    maybeStartRollup();
  });
}

// Throttle checkpoint rollups during fan-out. We don't want to enqueue a
// fresh rollup after every session task — kmeans + UMAP + aggregate math
// over 1k+ sessions is cheap but not free. A checkpoint runs at most every
// CHECKPOINT_INTERVAL_MS, and only after CHECKPOINT_MIN_NEW sessions have
// been analyzed since the last enqueue.
const CHECKPOINT_INTERVAL_MS = 8_000;
const CHECKPOINT_MIN_NEW = 25;
let sessionsCompletedSinceCheckpoint = 0;
let lastCheckpointAt = 0;

function maybeQueueCheckpointRollup(): void {
  const remaining = (countQueuedSessionsStmt.get() as { n: number }).n;
  const queueDraining = remaining === 0;
  const now = Date.now();
  // Bypass throttle when the per-session queue is empty so the FINAL rollup
  // always reflects 100% of analyzed sessions, even if the last task landed
  // milliseconds after the previous checkpoint.
  if (!queueDraining) {
    if (now - lastCheckpointAt < CHECKPOINT_INTERVAL_MS) return;
    if (sessionsCompletedSinceCheckpoint < CHECKPOINT_MIN_NEW) return;
  } else if (sessionsCompletedSinceCheckpoint === 0) {
    return;
  }
  // Coalesce: a rollup row already queued/running absorbs this trigger.
  const active = selectActiveByScopeStmt.get("rollup") as any;
  if (active) return;
  sessionsCompletedSinceCheckpoint = 0;
  lastCheckpointAt = now;
  insertJob("rollup");
  maybeStartRollup();
}

async function runRollupTask(job: Job): Promise<void> {
  const force = job.scope.endsWith("+force");
  const onProgress = (p: AnalyzeProgress) => {
    if (cancelRequested.has(job.id)) throw new CancelledError();
    try {
      updateProgressStmt.run(
        np({
          id: job.id,
          stage: p.stage ?? null,
          total: p.total ?? null,
          done: p.done ?? null,
        }),
      );
      emit(job.id);
    } catch (err) {
      if (err instanceof CancelledError) throw err;
    }
  };

  const opts: AnalyzeOptions = {
    ...buildOptions(),
    onProgress,
    force,
  } as AnalyzeOptions;

  try {
    await runRollup(opts);
    updateFinishStmt.run(
      np({
        id: job.id,
        status: "done",
        error: null,
        finished_at: Date.now(),
      }),
    );
    publishEvent({ type: "aggregates_updated" });
  } catch (err) {
    const cancelled = err instanceof CancelledError;
    const msg = cancelled
      ? "cancelled by user"
      : ((err as { message?: string } | null)?.message ?? String(err));
    updateFinishStmt.run(
      np({
        id: job.id,
        status: cancelled ? "cancelled" : "error",
        error: msg,
        finished_at: Date.now(),
      }),
    );
  } finally {
    cancelRequested.delete(job.id);
    emit(job.id, true);
  }
}

// Cancel a job. Queued session/rollup rows transition straight to cancelled.
// Running rows: we set the in-memory flag; the rollup pipeline observes it at
// its next progress callback. Per-session tasks are short (single LLM call),
// so we let them finish — the cost of one wasted call beats unwinding the
// extract mid-flight.
export function cancelJob(id: string): Job | null {
  const existing = getJob(id);
  if (!existing) return null;
  if (existing.status === "queued") {
    updateFinishStmt.run(
      np({
        id,
        status: "cancelled",
        error: "cancelled before start",
        finished_at: Date.now(),
      }),
    );
    emit(id, true);
    return getJob(id);
  }
  if (existing.status === "running") {
    cancelRequested.add(id);
    return existing;
  }
  return existing;
}

const deleteStmt = db.prepare(`DELETE FROM analyze_jobs WHERE id = ?`);

export function deleteJob(id: string): { ok: true } | { ok: false; reason: string } {
  const existing = getJob(id);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status === "running") {
    return { ok: false, reason: "cannot delete a running job; cancel it first" };
  }
  deleteStmt.run(id);
  lastEmitAt.delete(id);
  publishEvent({ type: "job_deleted", id });
  return { ok: true };
}

// Used by index.ts boot path: resume any queued tasks left over from a
// previous restart. Respects the persisted auto_drain toggle so a manager
// who turned it off doesn't get a surprise burst of analyzes on the next
// container boot.
export function resumeQueuedJobs(): void {
  if (getAutoDrain()) kickWorkers();
}

// Surface stats for the Jobs page header at-a-glance.
export function jobCounts(): {
  queued: number;
  running: number;
  done: number;
  error: number;
  cancelled: number;
} {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM analyze_jobs GROUP BY status`,
    )
    .all() as { status: JobStatus; n: number }[];
  const out = { queued: 0, running: 0, done: 0, error: 0, cancelled: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

// Reference unused vars defensively so stricter linters don't complain.
void pendingKicks;

// Wire the gateway → analyze-queue auto-enqueue. Each captured request
// idempotently queues a session task (no worker kick — workers only spin
// up when the manager presses "Run queue" or "Re-analyze all"). See db.ts
// `setOnRequestRecorded` for the dependency-direction reasoning.
setOnRequestRecorded((sessionId) => {
  try {
    enqueueSessionForCapture(sessionId);
  } catch {
    // Never let queue failures bubble back into the gateway.
  }
});
