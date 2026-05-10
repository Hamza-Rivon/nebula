import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { gateway } from "./gateway.js";
import { api } from "./api.js";
import { seedFromDir } from "./seed.js";
import { db } from "./db.js";
import { enqueueJob, resumeQueuedJobs } from "./insights/jobs.js";
import { countUnanalyzedSessions } from "./insights/db.js";
import { bootstrapCatalog } from "./catalog.js";

// Load model metadata (pricing, context windows, display names) from the
// disk cache and refresh from models.dev in the background.
bootstrapCatalog();

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, service: "nebula-proxy" }));

// CORS for UI dev (UI in Docker hits proxy in Docker via compose network; this is for local dev).
app.use("*", async (c, next) => {
  c.res.headers.set("access-control-allow-origin", "*");
  c.res.headers.set(
    "access-control-allow-headers",
    "content-type,authorization,x-nebula-session,x-nebula-user",
  );
  c.res.headers.set(
    "access-control-allow-methods",
    "GET,POST,OPTIONS,DELETE",
  );
  if (c.req.method === "OPTIONS") return new Response(null, { status: 204 });
  await next();
});

app.route("/api", api);
app.route("/", gateway);

// Serve built UI if present (used by single-container runtime).
const uiDir = resolve(process.cwd(), "ui-dist");
if (existsSync(uiDir)) {
  app.use("/*", serveStatic({ root: "./ui-dist" }));
  app.get("*", async (c) => {
    const indexPath = resolve(uiDir, "index.html");
    const html = await Bun.file(indexPath).text();
    return c.html(html);
  });
}

const port = Number(process.env.NEBULA_PROXY_PORT ?? 8080);
const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  // 0 = no idle timeout. SSE (/api/events) holds connections open
  // indefinitely, and LLM streaming proxies routinely take >10s between
  // chunks; the default 10s would kill both.
  idleTimeout: 0,
  fetch: app.fetch,
});
console.log(`✦ Nebula proxy listening on http://${server.hostname}:${server.port}`);

// Auto-import from a seed directory when present, then auto-enqueue an "all"
// analyze job so the heavy ML pipeline runs in the background while the UI is
// already serving. In Docker compose this is /seed (mounted only when
// NEBULA_SEED_HOST_DIR is set in .env). For local dev set NEBULA_SEED_DIR.
//
// Two-phase split is intentional: the seed phase only writes raw events
// (sessions + requests) — it is fast and deterministic. The analyze phase
// (extraction, embedding, clustering) goes through the job queue, which
// dedupes by scope, so a restart that re-runs the seed will not double-queue.
const seedDir = process.env.NEBULA_SEED_DIR ?? "/seed";
const autoAnalyze = process.env.NEBULA_AUTO_ANALYZE_ON_SEED !== "0";
if (existsSync(seedDir) && statSync(seedDir).isDirectory()) {
  // Run async so listen() returns immediately and the UI is reachable.
  (async () => {
    try {
      const t0 = Date.now();
      const s = await seedFromDir(seedDir);
      console.log(
        `✦ Nebula seed: scanned=${s.scanned} imported=${s.imported} skipped=${s.skipped} capped=${s.capped} failed=${s.failed} sessions=${s.sessions} requests=${s.requests} (${Date.now() - t0}ms) from ${seedDir}`,
      );
      // Auto-enqueue only when there's actual work to do. Every container
      // restart re-runs the seed; content-addressed sha256 means a steady
      // state produces imported=0. The fan-out queue persists across restarts
      // — leftover queued session tasks just need a worker kick to drain.
      // For genuinely unanalyzed sessions (no SessionMeta yet) we enqueue a
      // fresh "all" which fans out into per-session jobs and a final rollup.
      const total = (db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }).n;
      const unanalyzed = countUnanalyzedSessions();
      // Pick up any queued session/rollup rows from a previous shutdown.
      resumeQueuedJobs();
      if (autoAnalyze && unanalyzed > 0) {
        const job = enqueueJob("all");
        console.log(
          `✦ Nebula auto-analyze: anchor ${job.id} scope=${job.scope} (${unanalyzed}/${total} sessions need analysis)`,
        );
      } else if (autoAnalyze && total > 0) {
        console.log(
          `✦ Nebula auto-analyze: skipped — all ${total} sessions already analyzed`,
        );
      }
    } catch (err) {
      console.warn(`✦ Nebula seed failed:`, (err as Error).message);
    }
  })();
}
