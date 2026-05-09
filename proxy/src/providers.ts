// Provider routing. We accept OpenAI-compatible chat-completions requests
// (model = "<provider>/<model>") and forward to each provider's native endpoint.
// For non-OpenAI providers we translate request/response shapes.

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "mistral"
  | "kimi"
  | "ollama";

export type ProviderConfig = {
  id: ProviderId;
  baseUrl: string;
  apiKey: string | undefined;
  // If true, provider is natively OpenAI-compatible — pass-through.
  openaiCompat: boolean;
};

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  openai: {
    id: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
    openaiCompat: true,
  },
  groq: {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY,
    openaiCompat: true,
  },
  mistral: {
    id: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKey: process.env.MISTRAL_API_KEY,
    openaiCompat: true,
  },
  kimi: {
    id: "kimi",
    baseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1",
    apiKey: process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY,
    openaiCompat: true,
  },
  ollama: {
    id: "ollama",
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://host.docker.internal:11434/v1",
    apiKey: "ollama",
    openaiCompat: true,
  },
  anthropic: {
    id: "anthropic",
    baseUrl:
      process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
    apiKey: process.env.ANTHROPIC_API_KEY,
    openaiCompat: false,
  },
  google: {
    id: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: process.env.GOOGLE_API_KEY,
    openaiCompat: false,
  },
};

export function parseModel(model: string): { provider: ProviderId; modelId: string } {
  const slash = model.indexOf("/");
  if (slash === -1) {
    return { provider: "openai", modelId: model };
  }
  const provider = model.slice(0, slash) as ProviderId;
  const modelId = model.slice(slash + 1);
  if (!(provider in PROVIDERS)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return { provider, modelId };
}

export function listConfiguredProviders(): {
  id: ProviderId;
  configured: boolean;
}[] {
  return (Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({
    id,
    configured: Boolean(PROVIDERS[id].apiKey),
  }));
}
