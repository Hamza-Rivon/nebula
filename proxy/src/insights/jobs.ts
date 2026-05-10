import { nanoid } from "nanoid";
import { db, np } from "../db.js";
import { publishEvent } from "../events.js";
import {
  runAnalyzeAll,
  runAnalyzeSession,
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
// hits the cancel endpoint, we add the id here. The runner inspects this set
// on every progress callback (every parse iteration, every embed/extract
// resolution) and throws CancelledError to unwind the pipeline.
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
const selectNextQueuedStmt = db.prepare(
  `SELECT * FROM analyze_jobs WHERE status = 'queued' ORDER BY started_at ASC LIMIT 1`,
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

// Per-job throttle for progress emissions. Status transitions (queued →
// running → done/error) and enqueue always emit immediately; progress events
// are coalesced so an analyze pass with 1000 sessions doesn't fan out 1000
// SSE messages.
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
  if (job.status === "done" || job.status === "error") {
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

let running = false;

export function enqueueJob(scope: string): Job {
  // Coalesce: if there's already a queued or running job with this exact scope,
  // hand back that one instead of piling up duplicates. Repeated POSTs from a
  // racy UI, or a seed step that re-enqueues "all" on every restart, both
  // collapse to a single in-flight job.
  const active = selectActiveByScopeStmt.get(scope) as any;
  if (active) return rowToJob(active);

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
  // Kick the runner asynchronously; if a job is already running, this is a no-op
  // (the runner will pick the next queued job when it finishes).
  setImmediate(() => {
    void tick();
  });
  return getJob(id)!;
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

async function tick(): Promise<void> {
  if (running) return;
  const next = selectNextQueuedStmt.get() as any;
  if (!next) return;
  running = true;
  const id = next.id as string;
  const scope = next.scope as string;

  updateStatusStmt.run(np({ id, status: "running" }));
  emit(id, true);

  const onProgress = (p: AnalyzeProgress) => {
    // Check first — throwing from onProgress unwinds the pipeline at the next
    // await boundary, so cancellation is observed within ~one stage step.
    if (cancelRequested.has(id)) throw new CancelledError();
    try {
      updateProgressStmt.run(
        np({
          id,
          stage: (p as any)?.stage ?? null,
          total: (p as any)?.total ?? null,
          done: (p as any)?.done ?? null,
        }),
      );
      emit(id);
    } catch (err) {
      // Re-raise CancelledError; swallow only DB write failures.
      if (err instanceof CancelledError) throw err;
    }
  };

  // Scope grammar: "all" | "all+force" | "session:<id>" | "session:<id>+force".
  const force = scope.endsWith("+force");
  const baseScope = force ? scope.slice(0, -"+force".length) : scope;
  const opts: AnalyzeOptions = {
    ...buildOptions(),
    onProgress,
    force,
  } as AnalyzeOptions;

  try {
    if (baseScope === "all") {
      await runAnalyzeAll(opts);
    } else if (baseScope.startsWith("session:")) {
      const sid = baseScope.slice("session:".length);
      await runAnalyzeSession(sid, opts);
    } else {
      throw new Error(`unknown scope: ${scope}`);
    }
    updateFinishStmt.run(
      np({
        id,
        status: "done",
        error: null,
        finished_at: Date.now(),
      }),
    );
    emit(id, true);
  } catch (err) {
    const cancelled = err instanceof CancelledError;
    const msg = cancelled
      ? "cancelled by user"
      : ((err as { message?: string } | null)?.message ?? String(err));
    updateFinishStmt.run(
      np({
        id,
        status: cancelled ? "cancelled" : "error",
        error: msg,
        finished_at: Date.now(),
      }),
    );
    emit(id, true);
  } finally {
    cancelRequested.delete(id);
    running = false;
    // Drain any further queued rows.
    setImmediate(() => {
      void tick();
    });
  }
}

// Cancel a job. For `queued` rows this is immediate — the row never ran, so
// we just record the terminal status and emit. For `running` rows we set the
// in-memory flag; the next progress callback throws CancelledError, the
// runner catches it and writes status='cancelled'.
//
// Returns the (possibly transitional) Job, or null when nothing matched.
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
  // Already terminal — nothing to cancel.
  return existing;
}

const deleteStmt = db.prepare(`DELETE FROM analyze_jobs WHERE id = ?`);

// Delete a job row. Refuses to delete a running job (caller must cancel
// first); for any other status the row is removed and a `job_deleted` event
// is published so subscribers can drop their cached copy.
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
