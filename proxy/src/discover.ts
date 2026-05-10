// Per-provider model discovery. For each configured provider we ask the
// upstream what models it has, instead of carrying a hand-curated list.
// Results are memoized for DISCOVER_TTL_MS to keep `/v1/models` cheap.
//
// When the upstream call fails (offline, rate-limited, no `/models`
// endpoint), we fall back to whatever models.dev knows about that provider.
// If even that's empty, the provider contributes nothing to the listing —
// it doesn't break the response.

import { listProviderModels } from "./catalog.js";
import type { Provider } from "./providers.js";

export type DiscoveredModel = {
  // Fully-qualified id as exposed to clients: `<providerId>/<modelId>`.
  id: string;
  provider: string;
  modelId: string;
  source: "upstream" | "catalog";
};

const DISCOVER_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { ts: number; models: DiscoveredModel[] };
const cache = new Map<string, CacheEntry>();

export async function discoverModels(provider: Provider): Promise<DiscoveredModel[]> {
  const cached = cache.get(provider.id);
  if (cached && Date.now() - cached.ts < DISCOVER_TTL_MS) {
    return cached.models;
  }

  const upstream = await fetchUpstream(provider);
  const models =
    upstream.length > 0 ? upstream : fromCatalog(provider);
  cache.set(provider.id, { ts: Date.now(), models });
  return models;
}

async function fetchUpstream(provider: Provider): Promise<DiscoveredModel[]> {
  try {
    if (provider.kind === "openai") {
      return await fetchOpenAI(provider);
    }
    if (provider.kind === "anthropic") {
      return await fetchAnthropic(provider);
    }
    if (provider.kind === "google") {
      return await fetchGoogle(provider);
    }
  } catch {
    // ignore; we'll fall back to the catalog
  }
  return [];
}

async function fetchOpenAI(p: Provider): Promise<DiscoveredModel[]> {
  const headers: Record<string, string> = {};
  if (p.apiKey) headers["authorization"] = `Bearer ${p.apiKey}`;
  const resp = await fetch(`${p.baseUrl}/models`, { headers });
  if (!resp.ok) return [];
  const json = (await resp.json()) as any;
  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .map((m: any) => (typeof m?.id === "string" ? m.id : null))
    .filter((id: string | null): id is string => Boolean(id))
    .map((id: string) => ({
      id: `${p.id}/${id}`,
      provider: p.id,
      modelId: id,
      source: "upstream" as const,
    }));
}

async function fetchAnthropic(p: Provider): Promise<DiscoveredModel[]> {
  if (!p.apiKey) return [];
  const resp = await fetch(`${p.baseUrl}/models`, {
    headers: {
      "x-api-key": p.apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!resp.ok) return [];
  const json = (await resp.json()) as any;
  const data = Array.isArray(json?.data) ? json.data : [];
  return data
    .map((m: any) => (typeof m?.id === "string" ? m.id : null))
    .filter((id: string | null): id is string => Boolean(id))
    .map((id: string) => ({
      id: `${p.id}/${id}`,
      provider: p.id,
      modelId: id,
      source: "upstream" as const,
    }));
}

async function fetchGoogle(p: Provider): Promise<DiscoveredModel[]> {
  if (!p.apiKey) return [];
  const resp = await fetch(`${p.baseUrl}/models?key=${encodeURIComponent(p.apiKey)}`);
  if (!resp.ok) return [];
  const json = (await resp.json()) as any;
  const models = Array.isArray(json?.models) ? json.models : [];
  return models
    .map((m: any) => {
      const name = typeof m?.name === "string" ? m.name : null;
      if (!name) return null;
      // `name` comes as "models/gemini-2.5-pro" — strip the prefix.
      return name.startsWith("models/") ? name.slice("models/".length) : name;
    })
    .filter((id: string | null): id is string => Boolean(id))
    .map((id: string) => ({
      id: `${p.id}/${id}`,
      provider: p.id,
      modelId: id,
      source: "upstream" as const,
    }));
}

function fromCatalog(p: Provider): DiscoveredModel[] {
  const key = p.catalogKey ?? p.id;
  return listProviderModels(key).map((m) => ({
    id: `${p.id}/${m.modelId}`,
    provider: p.id,
    modelId: m.modelId,
    source: "catalog" as const,
  }));
}
