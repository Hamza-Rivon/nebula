import { Hono } from "hono";
import {
  getDataset,
  getUser,
  getCluster,
  getSession,
  getTranscript,
  clearInsights,
} from "./db.js";
import { enqueueJob, getJob, listJobs } from "./jobs.js";

export const insightsApi = new Hono();

insightsApi.post("/analyze", async (c) => {
  let body: { all?: boolean; sessionId?: string } = {};
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
  const scope = wantsAll ? "all" : `session:${sid}`;
  const job = enqueueJob(scope);
  return c.json(job);
});

insightsApi.get("/jobs/:id", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return c.json({ error: "not_found" }, 404);
  return c.json(job);
});

insightsApi.get("/jobs", (c) => {
  return c.json({ jobs: listJobs(20) });
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
