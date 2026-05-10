// Provider runtime singleton. Wraps the loader in `config.ts` and provides
// lookup / parsing helpers used by the gateway. Providers are loaded once on
// first access; restart the proxy to pick up env or file changes.

import { loadProviders, type Provider, type ProviderKind } from "./config.js";

export type { Provider, ProviderKind };

let cached: Provider[] | null = null;

export function getProviders(): Provider[] {
  if (!cached) cached = loadProviders();
  return cached;
}

export function findProvider(id: string): Provider | undefined {
  return getProviders().find((p) => p.id === id);
}

export function findByKind(kind: ProviderKind): Provider | undefined {
  return getProviders().find((p) => p.kind === kind);
}

// Resolve the `model` string from an OpenAI-shaped request body. Supports
// `provider/model_id`. When no prefix is given, falls back to the first
// `openai`-kind provider so plain `gpt-4o` keeps working.
export function parseModel(model: string): { provider: Provider; modelId: string } {
  const slash = model.indexOf("/");
  if (slash === -1) {
    const def = findByKind("openai");
    if (!def) {
      throw new Error(
        `model "${model}" has no provider prefix and no openai-kind provider is configured`,
      );
    }
    return { provider: def, modelId: model };
  }
  const id = model.slice(0, slash);
  const provider = findProvider(id);
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return { provider, modelId: model.slice(slash + 1) };
}

export function listProviders(): {
  id: string;
  kind: ProviderKind;
  base_url: string;
  configured: boolean;
  catalog_key: string | null;
}[] {
  return getProviders().map((p) => ({
    id: p.id,
    kind: p.kind,
    base_url: p.baseUrl,
    configured: Boolean(p.apiKey) || p.id === "ollama",
    catalog_key: p.catalogKey ?? null,
  }));
}
