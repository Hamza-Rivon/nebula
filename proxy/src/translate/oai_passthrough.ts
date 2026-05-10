// For natively OpenAI-compatible providers we forward the request and tee the
// response. We accumulate text + tool calls + usage from the SSE stream so
// we can persist a complete capture at the end without parsing twice.

export function teeOAIStream(
  source: ReadableStream<Uint8Array>,
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
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  const toolCalls: Record<number, { id?: string; name?: string; args: string }> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let finish = "stop";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const event = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of event.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              let evt: any;
              try {
                evt = JSON.parse(data);
              } catch {
                continue;
              }
              const choice = evt.choices?.[0];
              const delta = choice?.delta ?? {};
              if (typeof delta.content === "string") text += delta.content;
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const i = tc.index ?? 0;
                  toolCalls[i] ??= { args: "" };
                  if (tc.id) toolCalls[i].id = tc.id;
                  if (tc.function?.name)
                    toolCalls[i].name = tc.function.name;
                  if (tc.function?.arguments)
                    toolCalls[i].args += tc.function.arguments;
                }
              }
              if (choice?.finish_reason) finish = choice.finish_reason;
              if (evt.usage) {
                // OpenAI reports cached prompt tokens under
                // prompt_tokens_details.cached_tokens. They're a *subset* of
                // prompt_tokens — split them out so we don't double-count.
                const cached =
                  evt.usage.prompt_tokens_details?.cached_tokens ?? 0;
                const promptTotal = evt.usage.prompt_tokens ?? inputTokens;
                cacheReadTokens = cached;
                inputTokens = Math.max(0, promptTotal - cached);
                outputTokens = evt.usage.completion_tokens ?? outputTokens;
              }
            }
          }
        }
      } finally {
        controller.close();
        const tcArr = Object.entries(toolCalls)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, v]) => ({
            id: v.id ?? `call_${Math.random().toString(36).slice(2, 12)}`,
            type: "function" as const,
            function: { name: v.name ?? "", arguments: v.args || "{}" },
          }));
        onFinal({
          text,
          tool_calls: tcArr,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          cache_creation_tokens: 0,
          finish_reason: finish,
        });
      }
    },
  });
}
