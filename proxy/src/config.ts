// Provider configuration loader. Two modes:
//
//   1. Env-driven (default): a small set of well-known providers — openai,
//      anthropic, google, groq, mistral, kimi, ollama — gated on the presence
//      of their API key env var. Plus an optional generic "openai-compatible"
//      slot from OPENAI_COMPATIBLE_BASE_URL/_API_KEY.
//
//   2. File-driven: when NEBULA_PROVIDERS_FILE points at a JSON file, that
//      file fully replaces the env-driven defaults. The file can declare any
//      number of providers — multiple OpenAI-compatible upstreams, multiple
//      Anthropic-compatible endpoints, etc. — each with its own id and
//      credentials.
//
// JSON file shape:
//   {
//     "providers": [
//       { "id": "openai",     "kind": "openai",    "baseUrl": "https://api.openai.com/v1", "apiKeyEnv": "OPENAI_API_KEY" },
//       { "id": "internal",   "kind": "openai",    "baseUrl": "https://llm.internal/v1",   "apiKey":    "abc..." },
//       { "id": "claude-eu",  "kind": "anthropic", "baseUrl": "https://eu.anthropic.com/v1", "apiKeyEnv": "ANTHROPIC_EU_KEY", "catalogKey": "anthropic" }
//     ]
//   }

import { readFileSync, existsSync } from "node:fs";

export type ProviderKind = "openai" | "anthropic" | "google";

export type Provider = {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  // models.dev provider key. Defaults to `id` when unset.
  catalogKey?: string;
};

type FileEntry = {
  id?: string;
  kind?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  catalogKey?: string;
};

export function loadProviders(): Provider[] {
  const file = process.env.NEBULA_PROVIDERS_FILE;
  if (file && existsSync(file)) {
    return loadFromFile(file);
  }
  return loadFromEnv();
}

function loadFromFile(path: string): Provider[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`Failed to read NEBULA_PROVIDERS_FILE=${path}: ${(e as Error).message}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${path}: ${(e as Error).message}`);
  }
  const list = Array.isArray(parsed?.providers) ? parsed.providers : [];
  const out: Provider[] = [];
  const seen = new Set<string>();
  for (const entry of list as FileEntry[]) {
    const p = normalize(entry);
    if (!p) continue;
    if (seen.has(p.id)) {
      throw new Error(`Duplicate provider id in ${path}: ${p.id}`);
    }
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function normalize(entry: FileEntry): Provider | null {
  if (!entry.id || typeof entry.id !== "string") return null;
  if (!entry.baseUrl || typeof entry.baseUrl !== "string") return null;
  const kind = entry.kind as ProviderKind | undefined;
  if (kind !== "openai" && kind !== "anthropic" && kind !== "google") return null;
  const apiKey =
    entry.apiKey ?? (entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : undefined);
  return {
    id: entry.id,
    kind,
    baseUrl: entry.baseUrl.replace(/\/+$/, ""),
    apiKey,
    catalogKey: entry.catalogKey,
  };
}

function loadFromEnv(): Provider[] {
  const out: Provider[] = [];

  // openai
  if (process.env.OPENAI_API_KEY) {
    out.push({
      id: "openai",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
      catalogKey: "openai",
    });
  }

  // anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    out.push({
      id: "anthropic",
      kind: "anthropic",
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
      apiKey: process.env.ANTHROPIC_API_KEY,
      catalogKey: "anthropic",
    });
  }

  // google
  if (process.env.GOOGLE_API_KEY) {
    out.push({
      id: "google",
      kind: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: process.env.GOOGLE_API_KEY,
      catalogKey: "google",
    });
  }

  // groq (openai-compatible)
  if (process.env.GROQ_API_KEY) {
    out.push({
      id: "groq",
      kind: "openai",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
      catalogKey: "groq",
    });
  }

  // mistral (openai-compatible)
  if (process.env.MISTRAL_API_KEY) {
    out.push({
      id: "mistral",
      kind: "openai",
      baseUrl: "https://api.mistral.ai/v1",
      apiKey: process.env.MISTRAL_API_KEY,
      catalogKey: "mistral",
    });
  }

  // kimi / moonshot (openai-compatible)
  const kimiKey = process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY;
  if (kimiKey) {
    out.push({
      id: "kimi",
      kind: "openai",
      baseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1",
      apiKey: kimiKey,
      catalogKey: "moonshotai",
    });
  }

  // generic openai-compatible upstream (single slot). Any third-party or
  // self-hosted service speaking /v1/chat/completions.
  const ocBase = process.env.OPENAI_COMPATIBLE_BASE_URL;
  const ocKey = process.env.OPENAI_COMPATIBLE_API_KEY;
  if (ocBase) {
    out.push({
      id: "openai-compatible",
      kind: "openai",
      baseUrl: ocBase,
      apiKey: ocKey,
      // No models.dev key — pricing/discovery comes from upstream only.
    });
  }

  // ollama — included even without a key since it's typically local.
  out.push({
    id: "ollama",
    kind: "openai",
    baseUrl:
      process.env.OLLAMA_BASE_URL ?? "http://host.docker.internal:11434/v1",
    apiKey: "ollama",
  });

  return out;
}
