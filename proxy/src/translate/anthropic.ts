// Translate OpenAI chat-completions <-> Anthropic Messages API.
// MVP: text + tool calls. No images/audio/vision yet.

type OAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string; [k: string]: unknown }> | null;
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
  tool_choice?: unknown;
};

export function oaiToAnthropic(req: OAIRequest, modelId: string) {
  const system: string[] = [];
  const messages: any[] = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") system.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id ?? "",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const blocks: any[] = [];
      if (typeof m.content === "string" && m.content) {
        blocks.push({ type: "text", text: m.content });
      }
      for (const tc of m.tool_calls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments || "{}");
        } catch {
          input = { _raw: tc.function.arguments };
        }
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
      messages.push({ role: "assistant", content: blocks });
      continue;
    }
    messages.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: typeof m.content === "string" ? m.content : (m.content ?? ""),
    });
  }

  const body: any = {
    model: modelId,
    messages,
    max_tokens: req.max_tokens ?? 4096,
  };
  if (system.length) body.system = system.join("\n\n");
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.stream) body.stream = true;
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
  }
  return body;
}

export function anthropicToOAI(resp: any, requestedModel: string) {
  const toolCalls: any[] = [];
  const textParts: string[] = [];
  for (const block of resp.content ?? []) {
    if (block.type === "text") textParts.push(block.text ?? "");
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }
  const finish_reason =
    resp.stop_reason === "end_turn"
      ? "stop"
      : resp.stop_reason === "tool_use"
        ? "tool_calls"
        : resp.stop_reason === "max_tokens"
          ? "length"
          : (resp.stop_reason ?? "stop");
  return {
    id: resp.id ?? `chatcmpl-${Date.now()}`,
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
      prompt_tokens: resp.usage?.input_tokens ?? 0,
      completion_tokens: resp.usage?.output_tokens ?? 0,
      total_tokens:
        (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    },
  };
}

// Translate an Anthropic SSE stream to OpenAI chat.completion.chunk SSE.
// Returns a ReadableStream<Uint8Array> emitting `data: {...}\n\n` lines.
export function anthropicStreamToOAI(
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
  let textAcc = "";
  const toolUses: Record<number, { id: string; name: string; argsBuf: string }> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let stopReason = "stop";

  function chunk(delta: any, finish?: string): Uint8Array {
    const payload = {
      id,
      object: "chat.completion.chunk",
      created,
      model: requestedModel,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finish ?? null,
        },
      ],
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
              const u = evt.message?.usage ?? {};
              inputTokens = u.input_tokens ?? 0;
              cacheReadTokens = u.cache_read_input_tokens ?? 0;
              cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
            } else if (evt.type === "content_block_start") {
              const cb = evt.content_block;
              if (cb?.type === "tool_use") {
                toolUses[evt.index] = {
                  id: cb.id,
                  name: cb.name,
                  argsBuf: "",
                };
                controller.enqueue(
                  chunk({
                    tool_calls: [
                      {
                        index: evt.index,
                        id: cb.id,
                        type: "function",
                        function: { name: cb.name, arguments: "" },
                      },
                    ],
                  }),
                );
              }
            } else if (evt.type === "content_block_delta") {
              const d = evt.delta;
              if (d?.type === "text_delta") {
                textAcc += d.text ?? "";
                controller.enqueue(chunk({ content: d.text ?? "" }));
              } else if (d?.type === "input_json_delta") {
                const tu = toolUses[evt.index];
                if (tu) tu.argsBuf += d.partial_json ?? "";
                controller.enqueue(
                  chunk({
                    tool_calls: [
                      {
                        index: evt.index,
                        function: { arguments: d.partial_json ?? "" },
                      },
                    ],
                  }),
                );
              }
            } else if (evt.type === "message_delta") {
              if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
              if (evt.usage) {
                if (evt.usage.output_tokens != null)
                  outputTokens = evt.usage.output_tokens;
                if (evt.usage.cache_read_input_tokens != null)
                  cacheReadTokens = evt.usage.cache_read_input_tokens;
                if (evt.usage.cache_creation_input_tokens != null)
                  cacheCreationTokens = evt.usage.cache_creation_input_tokens;
              }
            } else if (evt.type === "message_stop") {
              // handled in finally
            }
          }
        }
      } finally {
        const finish_reason =
          stopReason === "end_turn"
            ? "stop"
            : stopReason === "tool_use"
              ? "tool_calls"
              : stopReason === "max_tokens"
                ? "length"
                : "stop";
        controller.enqueue(chunk({}, finish_reason));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
        const tool_calls = Object.values(toolUses).map((t) => ({
          id: t.id,
          type: "function" as const,
          function: { name: t.name, arguments: t.argsBuf || "{}" },
        }));
        onFinal({
          text: textAcc,
          tool_calls,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_tokens: cacheReadTokens,
          cache_creation_tokens: cacheCreationTokens,
          finish_reason,
        });
      }
    },
  });
}
