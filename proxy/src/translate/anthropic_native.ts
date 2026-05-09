// Anthropic-native passthrough: tee the upstream SSE stream while sniffing for
// usage + tool_use blocks. Bytes are forwarded unchanged so the client (e.g.
// OpenCode) sees a normal Anthropic Messages stream.

export type AnthropicCapture = {
  text: string;
  tool_calls: Array<{
    id: string;
    name: string;
    input: unknown;
  }>;
  input_tokens: number;
  output_tokens: number;
  finish_reason: string;
  response: any;
};

export function teeAnthropicStream(
  source: ReadableStream<Uint8Array>,
  onFinal: (cap: AnthropicCapture) => void,
): ReadableStream<Uint8Array> {
  const dec = new TextDecoder();
  let buf = "";
  let textAcc = "";
  const toolUses: Record<number, { id: string; name: string; argsBuf: string }> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = "stop";
  let messageId = "";

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
            const dataLines = event
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim());
            if (!dataLines.length) continue;
            const data = dataLines.join("\n");
            if (!data || data === "[DONE]") continue;
            let evt: any;
            try {
              evt = JSON.parse(data);
            } catch {
              continue;
            }
            if (evt.type === "message_start") {
              messageId = evt.message?.id ?? messageId;
              inputTokens = evt.message?.usage?.input_tokens ?? 0;
            } else if (evt.type === "content_block_start") {
              const cb = evt.content_block;
              if (cb?.type === "tool_use") {
                toolUses[evt.index] = {
                  id: cb.id,
                  name: cb.name,
                  argsBuf: "",
                };
              }
            } else if (evt.type === "content_block_delta") {
              const d = evt.delta;
              if (d?.type === "text_delta") textAcc += d.text ?? "";
              if (d?.type === "input_json_delta") {
                const tu = toolUses[evt.index];
                if (tu) tu.argsBuf += d.partial_json ?? "";
              }
            } else if (evt.type === "message_delta") {
              if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
              if (evt.usage?.output_tokens)
                outputTokens = evt.usage.output_tokens;
            }
          }
        }
      } finally {
        controller.close();
        const tool_calls = Object.values(toolUses).map((t) => ({
          id: t.id,
          name: t.name,
          input: safeParse(t.argsBuf),
        }));
        const finish_reason =
          stopReason === "end_turn"
            ? "stop"
            : stopReason === "tool_use"
              ? "tool_calls"
              : stopReason === "max_tokens"
                ? "length"
                : "stop";
        onFinal({
          text: textAcc,
          tool_calls,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          finish_reason,
          response: {
            id: messageId,
            content: [
              ...(textAcc ? [{ type: "text", text: textAcc }] : []),
              ...tool_calls.map((t) => ({
                type: "tool_use",
                id: t.id,
                name: t.name,
                input: t.input,
              })),
            ],
            stop_reason: stopReason,
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          },
        });
      }
    },
  });
}

export function captureFromAnthropicJSON(json: any): AnthropicCapture {
  const text: string[] = [];
  const tool_calls: AnthropicCapture["tool_calls"] = [];
  for (const b of json.content ?? []) {
    if (b.type === "text") text.push(b.text ?? "");
    if (b.type === "tool_use")
      tool_calls.push({ id: b.id, name: b.name, input: b.input });
  }
  const stop = json.stop_reason ?? "end_turn";
  return {
    text: text.join(""),
    tool_calls,
    input_tokens: json.usage?.input_tokens ?? 0,
    output_tokens: json.usage?.output_tokens ?? 0,
    finish_reason:
      stop === "end_turn"
        ? "stop"
        : stop === "tool_use"
          ? "tool_calls"
          : stop === "max_tokens"
            ? "length"
            : "stop",
    response: json,
  };
}

function safeParse(s: string): unknown {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}
