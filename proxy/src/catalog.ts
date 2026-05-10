// Single source of truth for model metadata: pricing, context window, display
// name. Pulled from https://models.dev (a community catalog), cached on disk so
// restarts don't always require network. Used by:
//   - gateway.ts → cost estimation per request
//   - seed.ts    → cost backfill on import
//   - analyze.ts → cost / waste calculations in the insights pipeline
//   - gateway.ts /v1/models → fallback when an upstream doesn't expose a list
//
// The catalog is keyed by (catalogKey, modelId) — `catalogKey` is the
// models.dev provider key (e.g. "openai", "anthropic", "moonshotai"). A
// secondary index by modelId alone supports legacy DB rows that stored model
// strings without a provider prefix (e.g. seeded transcripts).

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type ModelMeta = {
  catalogKey: string;
  modelId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  contextWindow: number | null;
  displayName: string;
};

export type Usage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

const MODELS_API_URL = "https://models.dev/api.json";
const CACHE_PATH = resolve(
  process.env.NEBULA_CATALOG_CACHE_PATH ?? "./data/cache/models.dev.json",
);
// Refresh in background after a day; serve stale immediately if older.
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

type Catalog = {
  byPair: Map<string, ModelMeta>;       // `${catalogKey}/${modelId}`
  byModelId: Map<string, ModelMeta[]>;  // modelId → all meta entries (any provider)
  byProvider: Map<string, ModelMeta[]>; // catalogKey → models
};

let catalog: Catalog = emptyCatalog();
let fetchedAt: number | null = null;
let source: "remote" | "cache" | "none" = "none";

function emptyCatalog(): Catalog {
  return { byPair: new Map(), byModelId: new Map(), byProvider: new Map() };
}

export function bootstrapCatalog(): void {
  // Step 1: read disk cache synchronously so first requests have data.
  if (existsSync(CACHE_PATH)) {
    try {
      const raw = readFileSync(CACHE_PATH, "utf8");
      const parsed = parseCatalog(raw);
      if (parsed) {
        catalog = parsed;
        fetchedAt = statSync(CACHE_PATH).mtimeMs;
        source = "cache";
      }
    } catch {
      // ignore — we'll try the network
    }
  }

  // Step 2: refresh in background if missing or stale.
  const stale = !fetchedAt || Date.now() - fetchedAt > REFRESH_AFTER_MS;
  if (stale) {
    void refreshCatalog();
  }
}

async function refreshCatalog(): Promise<void> {
  try {
    const resp = await fetch(MODELS_API_URL);
    if (!resp.ok) return;
    const text = await resp.text();
    const parsed = parseCatalog(text);
    if (!parsed) return;
    catalog = parsed;
    fetchedAt = Date.now();
    source = "remote";
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, text, "utf8");
  } catch {
    // Network failed; keep whatever we have.
  }
}

function parseCatalog(json: string): Catalog | null {
  let root: any;
  try {
    root = JSON.parse(json);
  } catch {
    return null;
  }
  if (!root || typeof root !== "object") return null;

  const c = emptyCatalog();
  for (const [providerKey, providerVal] of Object.entries<any>(root)) {
    const models = providerVal?.models;
    if (!models || typeof models !== "object") continue;
    for (const [modelId, modelVal] of Object.entries<any>(models)) {
      const cost = modelVal?.cost ?? {};
      const meta: ModelMeta = {
        catalogKey: providerKey,
        modelId,
        input: numOrZero(cost.input),
        output: numOrZero(cost.output),
        cacheRead: numOrZero(cost.cache_read),
        cacheWrite: numOrZero(cost.cache_write),
        contextWindow: numOrNull(modelVal?.limit?.context),
        displayName:
          typeof modelVal?.name === "string" ? modelVal.name : modelId,
      };
      c.byPair.set(`${providerKey}/${modelId}`, meta);
      pushTo(c.byModelId, modelId, meta);
      pushTo(c.byProvider, providerKey, meta);
    }
  }
  return c;
}

function numOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

// ── Public lookup API ────────────────────────────────────────────────────

// Strip an optional `provider/` prefix from a model string.
function splitModel(model: string): { prefix: string | null; id: string } {
  const slash = model.indexOf("/");
  if (slash === -1) return { prefix: null, id: model };
  return { prefix: model.slice(0, slash), id: model.slice(slash + 1) };
}

// Resolve catalog meta for a model. `model` may be `provider/id` or just `id`.
// `catalogKey` is preferred when known (it scopes the search). When neither
// prefix nor key is available, falls back to the modelId-only index — picks
// the first match (good enough for cost estimation; legacy seeded rows benefit
// from this).
export function getMeta(
  model: string,
  catalogKey?: string,
): ModelMeta | null {
  const { prefix, id } = splitModel(model);

  // Try strict (provider, id) lookup first.
  const key = catalogKey ?? prefix;
  if (key) {
    const direct = catalog.byPair.get(`${key}/${id}`);
    if (direct) return direct;
    // Try stripping common date suffixes like "-20250101".
    const stripped = id.replace(/-\d{8}$/, "");
    if (stripped !== id) {
      const hit = catalog.byPair.get(`${key}/${stripped}`);
      if (hit) return hit;
    }
  }

  // Fall back to modelId-only.
  const list = catalog.byModelId.get(id);
  if (list?.length) return list[0]!;
  const stripped = id.replace(/-\d{8}$/, "");
  if (stripped !== id) {
    const list2 = catalog.byModelId.get(stripped);
    if (list2?.length) return list2[0]!;
  }
  return null;
}

export function estimateCost(
  model: string,
  usage: Usage,
  catalogKey?: string,
): number {
  const meta = getMeta(model, catalogKey);
  if (!meta) return 0;
  const i = usage.input ?? 0;
  const o = usage.output ?? 0;
  const cr = usage.cacheRead ?? 0;
  const cw = usage.cacheWrite ?? 0;
  return (
    (i * meta.input +
      o * meta.output +
      cr * meta.cacheRead +
      cw * meta.cacheWrite) /
    1_000_000
  );
}

export function listProviderModels(catalogKey: string): ModelMeta[] {
  return catalog.byProvider.get(catalogKey) ?? [];
}

export function catalogStatus(): {
  loaded: boolean;
  entries: number;
  fetchedAt: number | null;
  source: "remote" | "cache" | "none";
} {
  return {
    loaded: catalog.byPair.size > 0,
    entries: catalog.byPair.size,
    fetchedAt,
    source,
  };
}
