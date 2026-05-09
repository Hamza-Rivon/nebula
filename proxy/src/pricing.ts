// Per-million-token USD pricing. Used for cost estimation only — best-effort,
// not a billing source of truth. Keep canonical model IDs (no provider prefix).
type Price = { input: number; output: number };

export const PRICING: Record<string, Price> = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 1.1, output: 4.4 },
  "o3-mini": { input: 1.1, output: 4.4 },

  // Anthropic
  "claude-opus-4-5": { input: 15, output: 75 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-3-5-sonnet-latest": { input: 3, output: 15 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4 },

  // Google
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },

  // Groq (rough)
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },

  // Mistral
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-small-latest": { input: 0.2, output: 0.6 },

  // Kimi / Moonshot (api.moonshot.ai, best-effort public pricing)
  "kimi-k2.6":        { input: 0.6, output: 2.5 },
  "kimi-k2.5":        { input: 0.5, output: 2.0 },
  "moonshot-v1-8k":   { input: 0.15, output: 0.6 },
  "moonshot-v1-32k":  { input: 0.3, output: 1.2 },
  "moonshot-v1-128k": { input: 0.6, output: 2.4 },
  "moonshot-v1-auto": { input: 0.6, output: 2.4 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const key = model.toLowerCase();
  const price =
    PRICING[key] ??
    PRICING[key.replace(/-\d{8}$/, "")] ?? // strip date suffix
    null;
  if (!price) return 0;
  return (
    (inputTokens / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output
  );
}
