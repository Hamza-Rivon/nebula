import { Hono } from "hono";
import { nanoid } from "nanoid";
import { ensureSession, recordRequest } from "./db.js";
import { parseModel, PROVIDERS } from "./providers.js";
import { estimateCost } from "./pricing.js";
import { oaiToAnthropic, anthropicToOAI, anthropicStreamToOAI } from "./translate/anthropic.js";
import { oaiToGoogle, googleToOAI, googleStreamToOAI } from "./translate/google.js";
import { teeOAIStream } from "./translate/oai_passthrough.js";
import {
  teeAnthropicStream,
  captureFromAnthropicJSON,
} from "./translate/anthropic_native.js";

export const gateway = new Hono();

gateway.get("/v1/models", (c) => {
  // Static catalog of well-known models, prefixed by provider.
  const models = [
    "openai/gpt-4o", "openai/gpt-4o-mini", "openai/gpt-4.1",
    "openai/gpt-4.1-mini", "openai/gpt-4.1-nano", "openai/o1-mini", "openai/o3-mini",
    "anthropic/claude-opus-4-5", "anthropic/claude-sonnet-4-5", "anthropic/claude-haiku-4-5",
    "anthropic/claude-3-5-sonnet-latest", "anthropic/claude-3-5-haiku-latest",
    "google/gemini-2.5-pro", "google/gemini-2.5-flash",
    "groq/llama-3.3-70b-versatile", "groq/llama-3.1-8b-instant",
    "mistral/mistral-large-latest", "mistral/mistral-small-latest",
    "kimi/kimi-k2.6", "kimi/kimi-k2.5",
    "kimi/moonshot-v1-128k", "kimi/moonshot-v1-32k",
    "kimi/moonshot-v1-8k", "kimi/moonshot-v1-auto",
  ].map((id) => ({ id, object: "model", owned_by: id.split("/")[0] }));
  return c.json({ object: "list", data: models });
});

// Anthropic-native passthrough — accept the Messages API at /v1/messages so
// SDKs and tools that speak Anthropic directly (e.g. OpenCode) can route
// through Nebula by changing only their base URL.
gateway.post("/v1/messages", async (c) => {
  const startedAt = Date.now();
  const reqId = nanoid();
  const body = await c.req.json<any>();
  const sessionId =
    c.req.header("x-nebula-session") ??
    body.metadata?.session_id ??
    body.metadata?.user_id ??
    nanoid();
  const userId =
    c.req.header("x-nebula-user") ?? body.metadata?.user_id ?? null;
  const stream = body.stream === true;

  if (!body.model || typeof body.model !== "string") {
    return c.json({ type: "error", error: { message: "model is required" } }, 400);
  }
  const provider = PROVIDERS.anthropic;
  // Prefer Nebula's configured key over whatever the client sends. Some clients
  // (e.g. OpenCode) write the apiKey statically in JSON without env-var
  // expansion, so the literal placeholder reaches us — using our env here means
  // a single source of truth for credentials.
  const clientKey = c.req.header("x-api-key");
  const apiKey =
    provider.apiKey ||
    (clientKey && !clientKey.includes("${") ? clientKey : undefined);
  if (!apiKey) {
    return c.json(
      {
        type: "error",
        error: {
          message: "Anthropic key missing. Set ANTHROPIC_API_KEY or pass x-api-key.",
        },
      },
      401,
    );
  }

  ensureSession(sessionId, userId);
  const requestedModel = `anthropic/${body.model}`;

  const persistFinal = (cap: {
    text: string;
    tool_calls: any[];
    input_tokens: number;
    output_tokens: number;
    finish_reason: string;
    response: unknown;
  }) => {
    const cost = estimateCost(body.model, cap.input_tokens, cap.output_tokens);
    const finishedAt = Date.now();
    const oaiToolCalls = (cap.tool_calls ?? []).map((t: any) => ({
      id: t.id,
      type: "function" as const,
      function: {
        name: t.name,
        arguments:
          typeof t.input === "string" ? t.input : JSON.stringify(t.input ?? {}),
      },
    }));
    recordRequest({
      id: reqId,
      session_id: sessionId,
      user_id: userId,
      provider: "anthropic",
      model: requestedModel,
      status: "ok",
      error: null,
      streamed: stream ? 1 : 0,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: finishedAt - startedAt,
      input_tokens: cap.input_tokens,
      output_tokens: cap.output_tokens,
      cost,
      request_json: JSON.stringify(body),
      response_json: JSON.stringify(cap.response),
      tool_calls_json: oaiToolCalls.length ? JSON.stringify(oaiToolCalls) : null,
      finish_reason: cap.finish_reason,
    });
  };

  const persistError = (status: number, message: string, raw?: unknown) => {
    const finishedAt = Date.now();
    recordRequest({
      id: reqId,
      session_id: sessionId,
      user_id: userId,
      provider: "anthropic",
      model: requestedModel,
      status: "error",
      error: message,
      streamed: stream ? 1 : 0,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: finishedAt - startedAt,
      input_tokens: null,
      output_tokens: null,
      cost: null,
      request_json: JSON.stringify(body),
      response_json: raw ? JSON.stringify(raw) : null,
      tool_calls_json: null,
      finish_reason: null,
    });
    return c.json(
      { type: "error", error: { message } },
      status as any,
    );
  };

  try {
    const upstreamHeaders: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version":
        c.req.header("anthropic-version") ?? "2023-06-01",
    };
    const beta = c.req.header("anthropic-beta");
    if (beta) upstreamHeaders["anthropic-beta"] = beta;
    if (stream) upstreamHeaders["accept"] = "text/event-stream";

    const upstream = await fetch(`${provider.baseUrl}/messages`, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(body),
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      return persistError(upstream.status, text || `upstream ${upstream.status}`, parsed);
    }
    if (stream) {
      const out = teeAnthropicStream(upstream.body, persistFinal);
      return new Response(out, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "x-nebula-session": sessionId,
          "x-nebula-request": reqId,
        },
      });
    }
    const json = (await upstream.json()) as any;
    const cap = captureFromAnthropicJSON(json);
    persistFinal(cap);
    return c.json(json);
  } catch (e: any) {
    return persistError(502, e?.message ?? "proxy error");
  }
});

gateway.post("/v1/chat/completions", async (c) => {
  const startedAt = Date.now();
  const reqId = nanoid();
  const body = await c.req.json<any>();
  const sessionId =
    c.req.header("x-nebula-session") ??
    body.session_id ??
    body.metadata?.session_id ??
    nanoid();
  const userId =
    c.req.header("x-nebula-user") ?? body.user ?? body.metadata?.user_id ?? null;

  if (!body.model || typeof body.model !== "string") {
    return c.json({ error: { message: "model is required" } }, 400);
  }

  // Clients that strip provider prefixes from model IDs (e.g. OpenCode, which
  // namespaces provider names in its own registry) can send the provider via
  // the x-nebula-provider header instead.
  const providerHint = c.req.header("x-nebula-provider");
  const modelInput =
    providerHint && !body.model.includes("/")
      ? `${providerHint}/${body.model}`
      : body.model;

  let parsed;
  try {
    parsed = parseModel(modelInput);
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 400);
  }

  const provider = PROVIDERS[parsed.provider];
  if (!provider.apiKey && parsed.provider !== "ollama") {
    return c.json(
      {
        error: {
          message: `Provider ${parsed.provider} is not configured. Set ${parsed.provider.toUpperCase()}_API_KEY.`,
        },
      },
      400,
    );
  }

  ensureSession(sessionId, userId);
  const requestedModel = providerHint
    ? `${parsed.provider}/${parsed.modelId}`
    : body.model;
  const stream = body.stream === true;

  // Strip our metadata fields before forwarding upstream.
  const upstreamBody: any = { ...body, model: parsed.modelId };
  delete upstreamBody.session_id;
  delete upstreamBody.metadata;

  const persistFinal = (final: {
    text: string;
    tool_calls: any[];
    input_tokens: number;
    output_tokens: number;
    finish_reason: string;
    response?: unknown;
  }) => {
    const cost = estimateCost(parsed.modelId, final.input_tokens, final.output_tokens);
    const finishedAt = Date.now();
    recordRequest({
      id: reqId,
      session_id: sessionId,
      user_id: userId,
      provider: parsed.provider,
      model: requestedModel,
      status: "ok",
      error: null,
      streamed: stream ? 1 : 0,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: finishedAt - startedAt,
      input_tokens: final.input_tokens,
      output_tokens: final.output_tokens,
      cost,
      request_json: JSON.stringify(body),
      response_json: JSON.stringify(
        final.response ?? {
          content: final.text,
          tool_calls: final.tool_calls,
        },
      ),
      tool_calls_json: final.tool_calls.length
        ? JSON.stringify(final.tool_calls)
        : null,
      finish_reason: final.finish_reason,
    });
  };

  const persistError = (status: number, message: string, raw?: unknown) => {
    const finishedAt = Date.now();
    recordRequest({
      id: reqId,
      session_id: sessionId,
      user_id: userId,
      provider: parsed.provider,
      model: requestedModel,
      status: "error",
      error: message,
      streamed: stream ? 1 : 0,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: finishedAt - startedAt,
      input_tokens: null,
      output_tokens: null,
      cost: null,
      request_json: JSON.stringify(body),
      response_json: raw ? JSON.stringify(raw) : null,
      tool_calls_json: null,
      finish_reason: null,
    });
    return c.json({ error: { message } }, status as any);
  };

  try {
    if (parsed.provider === "anthropic") {
      const aReq = oaiToAnthropic(upstreamBody, parsed.modelId);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-api-key": provider.apiKey!,
        "anthropic-version": "2023-06-01",
      };
      if (stream) headers["accept"] = "text/event-stream";
      const upstream = await fetch(`${provider.baseUrl}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(aReq),
      });
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text();
        return persistError(upstream.status, text || `upstream ${upstream.status}`, text);
      }
      if (stream) {
        const out = anthropicStreamToOAI(upstream.body, requestedModel, persistFinal);
        return new Response(out, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "x-nebula-session": sessionId,
            "x-nebula-request": reqId,
          },
        });
      }
      const json = await upstream.json();
      const oai = anthropicToOAI(json, requestedModel);
      persistFinal({
        text:
          typeof oai.choices[0].message.content === "string"
            ? oai.choices[0].message.content
            : "",
        tool_calls: (oai.choices[0].message as any).tool_calls ?? [],
        input_tokens: oai.usage.prompt_tokens,
        output_tokens: oai.usage.completion_tokens,
        finish_reason: oai.choices[0].finish_reason,
        response: oai,
      });
      return c.json(oai);
    }

    if (parsed.provider === "google") {
      const gReq = oaiToGoogle(upstreamBody);
      const action = stream ? "streamGenerateContent?alt=sse&" : "generateContent?";
      const url = `${provider.baseUrl}/models/${parsed.modelId}:${action}key=${provider.apiKey}`;
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(gReq),
      });
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text();
        return persistError(upstream.status, text || `upstream ${upstream.status}`, text);
      }
      if (stream) {
        const out = googleStreamToOAI(upstream.body, requestedModel, persistFinal);
        return new Response(out, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "x-nebula-session": sessionId,
            "x-nebula-request": reqId,
          },
        });
      }
      const json = await upstream.json();
      const oai = googleToOAI(json, requestedModel);
      persistFinal({
        text:
          typeof oai.choices[0].message.content === "string"
            ? oai.choices[0].message.content
            : "",
        tool_calls: (oai.choices[0].message as any).tool_calls ?? [],
        input_tokens: oai.usage.prompt_tokens,
        output_tokens: oai.usage.completion_tokens,
        finish_reason: oai.choices[0].finish_reason,
        response: oai,
      });
      return c.json(oai);
    }

    // Native OpenAI-compatible providers: openai / groq / mistral / ollama
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (provider.apiKey) headers["authorization"] = `Bearer ${provider.apiKey}`;

    const forwardBody = stream
      ? { ...upstreamBody, stream_options: { include_usage: true } }
      : upstreamBody;

    const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(forwardBody),
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      return persistError(upstream.status, text || `upstream ${upstream.status}`, text);
    }
    if (stream) {
      const out = teeOAIStream(upstream.body, persistFinal);
      return new Response(out, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "x-nebula-session": sessionId,
          "x-nebula-request": reqId,
        },
      });
    }
    const json = (await upstream.json()) as any;
    const choice = json.choices?.[0];
    persistFinal({
      text:
        typeof choice?.message?.content === "string"
          ? choice.message.content
          : "",
      tool_calls: choice?.message?.tool_calls ?? [],
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
      finish_reason: choice?.finish_reason ?? "stop",
      response: json,
    });
    // Pass through with our requested model id (so client sees what they asked for).
    return c.json({ ...json, model: requestedModel });
  } catch (e: any) {
    return persistError(502, e?.message ?? "proxy error");
  }
});
