// Translate OpenAI chat-completions <-> Google Gemini generateContent API.
// MVP: text + function calls.

type OAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<any> | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

type OAIRequest = {
  model: string;
  messages: OAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: Array<{
    type: "function";
    function: { name: string; description?: string; parameters?: object };
  }>;
};

export function oaiToGoogle(req: OAIRequest) {
  const systemBits: string[] = [];
  const contents: any[] = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") systemBits.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: m.name ?? "tool",
              response: safeParse(m.content as string),
            },
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const parts: any[] = [];
      if (typeof m.content === "string" && m.content)
        parts.push({ text: m.content });
      for (const tc of m.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: safeParse(tc.function.arguments),
          },
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : "" }],
    });
  }

  const body: any = { contents };
  if (systemBits.length) {
    body.systemInstruction = { parts: [{ text: systemBits.join("\n\n") }] };
  }
  body.generationConfig = {};
  if (req.temperature !== undefined)
    body.generationConfig.temperature = req.temperature;
  if (req.max_tokens !== undefined)
    body.generationConfig.maxOutputTokens = req.max_tokens;
  if (req.tools?.length) {
    body.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }
  return body;
}

export function googleToOAI(resp: any, requestedModel: string) {
  const cand = resp.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const textParts: string[] = [];
  const toolCalls: any[] = [];
  for (const p of parts) {
    if (p.text) textParts.push(p.text);
    if (p.functionCall) {
      toolCalls.push({
        id: `call_${Math.random().toString(36).slice(2, 12)}`,
        type: "function",
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args ?? {}),
        },
      });
    }
  }
  const finish_reason =
    cand?.finishReason === "STOP"
      ? toolCalls.length
        ? "tool_calls"
        : "stop"
      : cand?.finishReason === "MAX_TOKENS"
        ? "length"
        : "stop";
  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textParts.join("") || null,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason,
      },
    ],
    usage: {
      prompt_tokens: resp.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: resp.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: resp.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}

export function googleStreamToOAI(
  source: ReadableStream<Uint8Array>,
  requestedModel: string,
  onFinal: (final: {
    text: string;
    tool_calls: any[];
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    finish_reason: string;
  }) => void,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let buf = "";
  let text = "";
  const toolCalls: any[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let stop = "stop";

  function chunk(delta: any, finish?: string): Uint8Array {
    const payload = {
      id,
      object: "chat.completion.chunk",
      created,
      model: requestedModel,
      choices: [{ index: 0, delta, finish_reason: finish ?? null }],
    };
    return enc.encode(`data: ${JSON.stringify(payload)}\n\n`);
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      controller.enqueue(chunk({ role: "assistant" }));
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let evt: any;
            try {
              evt = JSON.parse(data);
            } catch {
              continue;
            }
            const cand = evt.candidates?.[0];
            const parts = cand?.content?.parts ?? [];
            for (const p of parts) {
              if (p.text) {
                text += p.text;
                controller.enqueue(chunk({ content: p.text }));
              } else if (p.functionCall) {
                const tcIndex = toolCalls.length;
                const callId = `call_${Math.random().toString(36).slice(2, 12)}`;
                toolCalls.push({
                  id: callId,
                  type: "function",
                  function: {
                    name: p.functionCall.name,
                    arguments: JSON.stringify(p.functionCall.args ?? {}),
                  },
                });
                controller.enqueue(
                  chunk({
                    tool_calls: [
                      {
                        index: tcIndex,
                        id: callId,
                        type: "function",
                        function: {
                          name: p.functionCall.name,
                          arguments: JSON.stringify(p.functionCall.args ?? {}),
                        },
                      },
                    ],
                  }),
                );
              }
            }
            if (cand?.finishReason)
              stop =
                cand.finishReason === "STOP"
                  ? toolCalls.length
                    ? "tool_calls"
                    : "stop"
                  : cand.finishReason === "MAX_TOKENS"
                    ? "length"
                    : "stop";
            if (evt.usageMetadata) {
              // Google's cachedContentTokenCount is a subset of promptTokenCount
              // (the cached portion). Split it out so totals stay correct.
              const cached = evt.usageMetadata.cachedContentTokenCount ?? 0;
              const promptTotal =
                evt.usageMetadata.promptTokenCount ?? inputTokens + cacheReadTokens;
              cacheReadTokens = cached;
              inputTokens = Math.max(0, promptTotal - cached);
              outputTokens =
                evt.usageMetadata.candidatesTokenCount ?? outputTokens;
            }
          }
        }
      } finally {
        controller.enqueue(chunk({}, stop));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
        onFinal({
          text,
          tool_calls: toolCalls,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          cache_creation_tokens: 0,
          finish_reason: stop,
        });
      }
    },
  });
}

function safeParse(s: unknown): unknown {
  if (typeof s !== "string") return s ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}
