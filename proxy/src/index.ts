import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { gateway } from "./gateway.js";
import { api } from "./api.js";
import { seedFromDir } from "./seed.js";

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
  app.use(
    "/*",
    serveStatic({
      root: "./ui-dist",
      rewriteRequestPath: (p) => (p.startsWith("/api") || p.startsWith("/v1") ? p : p),
    }),
  );
  app.get("*", async (c) => {
    const indexPath = resolve(uiDir, "index.html");
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(indexPath, "utf8");
    return c.html(html);
  });
}

const seedDir = process.env.NEBULA_SEED_DIR;
if (seedDir) {
  try {
    if (existsSync(seedDir) && statSync(seedDir).isDirectory()) {
      const t0 = Date.now();
      const s = seedFromDir(seedDir);
      console.log(
        `✦ Nebula seed: scanned=${s.scanned} imported=${s.imported} skipped=${s.skipped} failed=${s.failed} sessions=${s.sessions} requests=${s.requests} (${Date.now() - t0}ms) from ${seedDir}`,
      );
    } else {
      console.warn(`✦ Nebula seed: NEBULA_SEED_DIR=${seedDir} not found or not a directory; skipping`);
    }
  } catch (err) {
    console.warn(`✦ Nebula seed failed:`, (err as Error).message);
  }
}

const port = Number(process.env.NEBULA_PROXY_PORT ?? 8080);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`✦ Nebula proxy listening on http://0.0.0.0:${info.port}`);
});
