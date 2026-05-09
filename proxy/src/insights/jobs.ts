import { nanoid } from "nanoid";
import { db } from "../db.js";
import {
  runAnalyzeAll,
  runAnalyzeSession,
  type AnalyzeOptions,
  type AnalyzeProgress,
} from "./analyze.js";

export type JobStatus = "queued" | "running" | "done" | "error";

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
const updateProgressStmt = db.prepare(
  `UPDATE analyze_jobs SET stage = @stage, total = @total, done = @done WHERE id = @id`,
);
const updateStatusStmt = db.prepare(
  `UPDATE analyze_jobs SET status = @status WHERE id = @id`,
);
const updateFinishStmt = db.prepare(
  `UPDATE analyze_jobs SET status = @status, error = @error, finished_at = @finished_at WHERE id = @id`,
);

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
  const id = nanoid();
  const now = Date.now();
  insertStmt.run({
    id,
    scope,
    status: "queued",
    stage: null,
    total: null,
    done: null,
    error: null,
    started_at: now,
    finished_at: null,
  });
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

  updateStatusStmt.run({ id, status: "running" });

  const onProgress = (p: AnalyzeProgress) => {
    try {
      updateProgressStmt.run({
        id,
        stage: (p as any)?.stage ?? null,
        total: (p as any)?.total ?? null,
        done: (p as any)?.done ?? null,
      });
    } catch {
      /* swallow — progress updates are best-effort */
    }
  };

  const opts: AnalyzeOptions = { ...buildOptions(), onProgress } as AnalyzeOptions;

  try {
    if (scope === "all") {
      await runAnalyzeAll(opts);
    } else if (scope.startsWith("session:")) {
      const sid = scope.slice("session:".length);
      await runAnalyzeSession(sid, opts);
    } else {
      throw new Error(`unknown scope: ${scope}`);
    }
    updateFinishStmt.run({
      id,
      status: "done",
      error: null,
      finished_at: Date.now(),
    });
  } catch (err) {
    const msg =
      (err as { message?: string } | null)?.message ?? String(err);
    updateFinishStmt.run({
      id,
      status: "error",
      error: msg,
      finished_at: Date.now(),
    });
  } finally {
    running = false;
    // Drain any further queued rows.
    setImmediate(() => {
      void tick();
    });
  }
}
