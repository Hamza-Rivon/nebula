import { Hono } from "hono";
import {
  getDataset,
  getUser,
  getCluster,
  getSession,
  getTranscript,
  clearInsights,
  resolveInsightsUserId,
  listSessionsForUser,
  listSessionsByFriction,
} from "./db.js";
import {
  cancelJob,
  deleteJob,
  enqueueJob,
  getJob,
  jobCounts,
  listJobs,
  listJobsFiltered,
} from "./jobs.js";

export const insightsApi = new Hono();

insightsApi.post("/analyze", async (c) => {
  let body: { all?: boolean; sessionId?: string; force?: boolean } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    body = {};
  }
  const wantsAll = body.all === true;
  const sid = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (wantsAll === !!sid) {
    return c.json(
      { error: "invalid_request", hint: "provide exactly one of {all:true} or {sessionId:'...'}" },
      400,
    );
  }
  const force = body.force === true;
  const base = wantsAll ? "all" : `session:${sid}`;
  // Encode the force bit in the scope string so jobs.ts can read it back.
  const scope = force ? `${base}+force` : base;
  const job = enqueueJob(scope);
  return c.json(job);
});

insightsApi.get("/jobs/:id", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return c.json({ error: "not_found" }, 404);
  return c.json(job);
});

insightsApi.get("/jobs", (c) => {
  // Filterable listing for the queue view: with N=1k+ session task rows the
  // simple `LIMIT 20` from before is no longer enough. Defaults preserve the
  // old behaviour for any existing callers.
  const scopePrefix = c.req.query("scope")?.trim();
  const status = c.req.query("status")?.trim();
  const limitRaw = Number(c.req.query("limit") ?? 50);
  const offsetRaw = Number(c.req.query("offset") ?? 0);
  const limit = Math.min(Math.max(1, isFinite(limitRaw) ? limitRaw : 50), 500);
  const offset = Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0);
  if (!scopePrefix && !status && offset === 0 && limit <= 20) {
    return c.json({ jobs: listJobs(limit), total: undefined, counts: jobCounts() });
  }
  const result = listJobsFiltered({
    scopePrefix: scopePrefix && scopePrefix.length > 0 ? scopePrefix : undefined,
    status: (status as any) || undefined,
    limit,
    offset,
  });
  return c.json({ ...result, counts: jobCounts() });
});

insightsApi.get("/jobs/stats", (c) => {
  return c.json({ counts: jobCounts() });
});

// Cancel a queued or running job. Idempotent against terminal rows: hitting
// this on an already-done job just returns its current state.
insightsApi.post("/jobs/:id/cancel", (c) => {
  const job = cancelJob(c.req.param("id"));
  if (!job) return c.json({ error: "not_found" }, 404);
  return c.json(job);
});

// Delete a job row outright. Refuses while running — the caller should cancel
// first and let the runner write a terminal status before pruning the row.
insightsApi.delete("/jobs/:id", (c) => {
  const result = deleteJob(c.req.param("id"));
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    return c.json({ error: result.reason }, status);
  }
  return c.json({ ok: true });
});

insightsApi.get("/insights", (c) => {
  const ds = getDataset();
  if (!ds) {
    return c.json(
      {
        error: "no_insights",
        hint: "POST /api/analyze with {all:true} to populate",
      },
      404,
    );
  }
  return c.json(ds);
});

insightsApi.get("/insights/users/:id", (c) => {
  const user = getUser(c.req.param("id"));
  if (!user) return c.json({ error: "not_found" }, 404);
  return c.json(user);
});

insightsApi.get("/insights/clusters/:id", (c) => {
  const cluster = getCluster(c.req.param("id"));
  if (!cluster) return c.json({ error: "not_found" }, 404);
  return c.json(cluster);
});

insightsApi.get("/insights/sessions/:sessionId", (c) => {
  const sid = c.req.param("sessionId");
  const session = getSession(sid);
  if (!session) return c.json({ error: "not_found" }, 404);
  const transcript = getTranscript(sid);
  return c.json({ session, transcript });
});

insightsApi.delete("/insights", (c) => {
  clearInsights();
  return c.json({ ok: true });
});

// Filter analyzed sessions by friction tag (and optionally by user). Used by
// the click-through from the Insights drawer's friction chips.
insightsApi.get("/insights/sessions", (c) => {
  const friction = c.req.query("friction")?.trim();
  const userParam = c.req.query("user")?.trim();
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  if (userParam) {
    const uid = resolveInsightsUserId(userParam);
    if (!uid) return c.json({ sessions: [], total: 0 });
    return c.json(listSessionsForUser(uid, { friction, limit, offset }));
  }
  if (!friction) {
    return c.json(
      { error: "missing_param", hint: "provide ?friction=<tag> or ?user=<id>" },
      400,
    );
  }
  return c.json(listSessionsByFriction(friction, { limit, offset }));
});
