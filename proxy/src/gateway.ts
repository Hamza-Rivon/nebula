import { Hono } from "hono";
import { nanoid } from "nanoid";
import { ensureSession, ensureUser, recordRequest } from "./db.js";
import {
  parseModel,
  getProviders,
  findByKind,
  findProvider,
  type Provider,
} from "./providers.js";
import { estimateCost } from "./catalog.js";
import { discoverModels } from "./discover.js";
import { oaiToAnthropic, anthropicToOAI, anthropicStreamToOAI } from "./translate/anthropic.js";
import { oaiToGoogle, googleToOAI, googleStreamToOAI } from "./translate/google.js";
import { teeOAIStream } from "./translate/oai_passthrough.js";
import {
  teeAnthropicStream,
  captureFromAnthropicJSON,
} from "./translate/anthropic_native.js";

export const gateway = new Hono();

gateway.get("/v1/models", async (c) => {
  // Discover models from each configured provider in parallel; merge and
  // expose with the `<providerId>/<modelId>` prefix that this gateway uses.
  const providers = getProviders();
  const lists = await Promise.all(providers.map((p) => discoverModels(p)));
  const seen = new Set<string>();
  const data: Array<{ id: string; object: string; owned_by: string }> = [];
  for (const list of lists) {
    for (const m of list) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      data.push({ id: m.id, object: "model", owned_by: m.provider });
    }
  }
  return c.json({ object: "list", data });
});

// Anthropic-native passthrough — accept the Messages API at /v1/messages so
// SDKs and tools that speak Anthropic directly (e.g. OpenCode) can route
// through Nebula by changing only their base URL. The `x-nebula-provider`
// header picks a specific anthropic-kind provider when more than one is
// configured; otherwise we use the first one.
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
  // Register the user the moment we see the header — before any validation
  // gate. A request that errors here (missing model, bad provider, no API
  // key) would otherwise never reach `ensureSession` / `recordRequest`,
  // and the user would silently never appear in the Users tab.
  if (userId) ensureUser(userId);
  const stream = body.stream === true;

  if (!body.model || typeof body.model !== "string") {
    return c.json({ type: "error", error: { message: "model is required" } }, 400);
  }

  const providerHint = c.req.header("x-nebula-provider");
  const provider = providerHint ? findProvider(providerHint) : findByKind("anthropic");
  if (!provider || provider.kind !== "anthropic") {
    return c.json(
      {
        type: "error",
        error: {
          message: providerHint
            ? `Provider ${providerHint} is not configured or is not anthropic-kind`
            : "No anthropic-kind provider is configured",
        },
      },
      400,
    );
  }

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
          message: `Anthropic key missing for provider ${provider.id}. Configure it or pass x-api-key.`,
        },
      },
      401,
    );
  }

  ensureSession(sessionId, userId);
  const requestedModel = `${provider.id}/${body.model}`;
  const catalogKey = provider.catalogKey ?? provider.id;

  const persistFinal = (cap: {
    text: string;
    tool_calls: any[];
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    finish_reason: string;
    response: unknown;
  }) => {
    const cost = estimateCost(
      body.model,
      {
        input: cap.input_tokens,
        output: cap.output_tokens,
        cacheRead: cap.cache_read_tokens,
        cacheWrite: cap.cache_creation_tokens,
      },
      catalogKey,
    );
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
      provider: provider.id,
      model: requestedModel,
      status: "ok",
      error: null,
      streamed: stream ? 1 : 0,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: finishedAt - startedAt,
      input_tokens: cap.input_tokens,
      output_tokens: cap.output_tokens,
      cache_read_tokens: cap.cache_read_tokens,
      cache_creation_tokens: cap.cache_creation_tokens,
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
      provider: provider.id,
      model: requestedModel,
      status: "error",
      error: message,
      streamed: stream ? 1 : 0,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: finishedAt - startedAt,
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
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
  if (userId) ensureUser(userId);

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

  let provider: Provider;
  let modelId: string;
  try {
    const parsed = parseModel(modelInput);
    provider = parsed.provider;
    modelId = parsed.modelId;
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 400);
  }

  if (!provider.baseUrl) {
    return c.json(
      {
        error: {
          message: `Provider ${provider.id} has no baseUrl configured.`,
        },
      },
      400,
    );
  }

  ensureSession(sessionId, userId);
  const requestedModel = providerHint
    ? `${provider.id}/${modelId}`
    : body.model;
  const stream = body.stream === true;
  const catalogKey = provider.catalogKey ?? provider.id;

  // Strip our metadata fields before forwarding upstream.
  const upstreamBody: any = { ...body, model: modelId };
  delete upstreamBody.session_id;
  delete upstreamBody.metadata;

  const persistFinal = (final: {
    text: string;
    tool_calls: any[];
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    finish_reason: string;
    response?: unknown;
  }) => {
    const cost = estimateCost(
      modelId,
      {
        input: final.input_tokens,
        output: final.output_tokens,
        cacheRead: final.cache_read_tokens,
        cacheWrite: final.cache_creation_tokens,
      },
      catalogKey,
    );
    const finishedAt = Date.now();
    recordRequest({
      id: reqId,
      session_id: sessionId,
      user_id: userId,
      provider: provider.id,
      model: requestedModel,
      status: "ok",
      error: null,
      streamed: stream ? 1 : 0,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: finishedAt - startedAt,
      input_tokens: final.input_tokens,
      output_tokens: final.output_tokens,
      cache_read_tokens: final.cache_read_tokens,
      cache_creation_tokens: final.cache_creation_tokens,
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
      provider: provider.id,
      model: requestedModel,
      status: "error",
      error: message,
      streamed: stream ? 1 : 0,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: finishedAt - startedAt,
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      cost: null,
      request_json: JSON.stringify(body),
      response_json: raw ? JSON.stringify(raw) : null,
      tool_calls_json: null,
      finish_reason: null,
    });
    return c.json({ error: { message } }, status as any);
  };

  try {
    if (provider.kind === "anthropic") {
      const aReq = oaiToAnthropic(upstreamBody, modelId);
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
      const json = (await upstream.json()) as any;
      const oai = anthropicToOAI(json, requestedModel);
      // Anthropic's native usage carries the cache breakdown; the OAI shape
      // does not, so pull it from the upstream JSON directly.
      const aUsage = json?.usage ?? {};
      persistFinal({
        text:
          typeof oai.choices[0].message.content === "string"
            ? oai.choices[0].message.content
            : "",
        tool_calls: (oai.choices[0].message as any).tool_calls ?? [],
        input_tokens: oai.usage.prompt_tokens,
        output_tokens: oai.usage.completion_tokens,
        cache_read_tokens: aUsage.cache_read_input_tokens ?? 0,
        cache_creation_tokens: aUsage.cache_creation_input_tokens ?? 0,
        finish_reason: oai.choices[0].finish_reason,
        response: oai,
      });
      return c.json(oai);
    }

    if (provider.kind === "google") {
      const gReq = oaiToGoogle(upstreamBody);
      const action = stream ? "streamGenerateContent?alt=sse&" : "generateContent?";
      const url = `${provider.baseUrl}/models/${modelId}:${action}key=${provider.apiKey}`;
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
      const json = (await upstream.json()) as any;
      const oai = googleToOAI(json, requestedModel);
      const gMeta = json?.usageMetadata ?? {};
      const gCached = gMeta.cachedContentTokenCount ?? 0;
      persistFinal({
        text:
          typeof oai.choices[0].message.content === "string"
            ? oai.choices[0].message.content
            : "",
        tool_calls: (oai.choices[0].message as any).tool_calls ?? [],
        input_tokens: Math.max(0, (oai.usage.prompt_tokens ?? 0) - gCached),
        output_tokens: oai.usage.completion_tokens,
        cache_read_tokens: gCached,
        cache_creation_tokens: 0,
        finish_reason: oai.choices[0].finish_reason,
        response: oai,
      });
      return c.json(oai);
    }

    // openai-kind: native passthrough
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
    const oCached = json.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const oPrompt = json.usage?.prompt_tokens ?? 0;
    persistFinal({
      text:
        typeof choice?.message?.content === "string"
          ? choice.message.content
          : "",
      tool_calls: choice?.message?.tool_calls ?? [],
      input_tokens: Math.max(0, oPrompt - oCached),
      output_tokens: json.usage?.completion_tokens ?? 0,
      cache_read_tokens: oCached,
      cache_creation_tokens: 0,
      finish_reason: choice?.finish_reason ?? "stop",
      response: json,
    });
    // Pass through with our requested model id (so client sees what they asked for).
    return c.json({ ...json, model: requestedModel });
  } catch (e: any) {
    return persistError(502, e?.message ?? "proxy error");
  }
});
