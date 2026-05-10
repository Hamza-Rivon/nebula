# Nebula

LLM proxy gateway with a session-aware dashboard. OpenAI-compatible. Soft-pop neobrutalist UI.

One container, one port. Same origin serves the OpenAI-compatible proxy and the dashboard.

## Quick start

```bash
cp .env.example .env   # add at least one provider key
docker compose up --build
```

Open: <http://localhost:8080>

- Dashboard: <http://localhost:8080/>
- Proxy:     `POST http://localhost:8080/v1/chat/completions`
- Health:    <http://localhost:8080/healthz>

## Use it

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-nebula-session: demo-1" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello, Nebula!"}]
  }'
```

Every request is captured: model, tokens, cost, latency, tool calls, full content. Group by session via the `x-nebula-session` header (or `session_id` body field).

## Supported providers

`openai/*`, `anthropic/*`, `google/*`, `groq/*`, `mistral/*`, `ollama/*`. Use the prefix in the `model` field.

## Use with OpenCode

Nebula speaks **Anthropic Messages API natively** at `POST /v1/messages` and
OpenAI-compatible chat completions at `POST /v1/chat/completions`, so OpenCode
can route Anthropic and Kimi traffic through the same local Docker gateway.

1. Start Nebula:

```bash
cp .env.example .env
# add ANTHROPIC_API_KEY, KIMI_API_KEY, or OPENAI_COMPATIBLE_BASE_URL +
# OPENAI_COMPATIBLE_API_KEY to .env (for any internal/self-hosted upstream
# that speaks the OpenAI chat-completions API)
docker compose up --build
```

2. Put this in `~/.config/opencode/opencode.json`.
   Change `x-nebula-user` to your own handle so the dashboard can separate usage
   by teammate.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "nebula-anthropic/claude-haiku-4-5",
  "provider": {
    "nebula-anthropic": {
      "npm": "@ai-sdk/anthropic",
      "name": "Nebula (Anthropic via Nebula proxy)",
      "options": {
        "baseURL": "http://localhost:8080/v1",
        "apiKey": "set-in-nebula-env",
        "headers": {
          "x-nebula-session": "opencode-haiku",
          "x-nebula-user": "your-handle",
          "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14"
        }
      },
      "models": {
        "claude-haiku-4-5": {
          "name": "Claude Haiku 4.5 via Nebula",
          "limit": { "context": 200000, "output": 64000 }
        }
      }
    },
    "nebula-kimi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Nebula (Kimi via Nebula proxy)",
      "options": {
        "baseURL": "http://localhost:8080/v1",
        "apiKey": "set-in-nebula-env",
        "headers": {
          "x-nebula-provider": "kimi",
          "x-nebula-session": "opencode-kimi",
          "x-nebula-user": "your-handle"
        }
      },
      "models": {
        "kimi-k2.6": {
          "name": "Kimi K2.6 via Nebula",
          "limit": { "context": 256000, "output": 32000 }
        },
        "kimi-k2.5": {
          "name": "Kimi K2.5 via Nebula",
          "limit": { "context": 256000, "output": 32000 }
        },
        "moonshot-v1-128k": {
          "name": "Moonshot V1 128k via Nebula",
          "limit": { "context": 131072, "output": 8192 }
        },
        "moonshot-v1-auto": {
          "name": "Moonshot V1 Auto via Nebula",
          "limit": { "context": 131072, "output": 8192 }
        }
      }
    },
    "nebula-openai-compatible": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Nebula (OpenAI-compatible upstream)",
      "options": {
        "baseURL": "http://localhost:8080/v1",
        "apiKey": "set-in-nebula-env",
        "headers": {
          "x-nebula-provider": "openai-compatible",
          "x-nebula-session": "opencode-openai-compatible",
          "x-nebula-user": "your-handle"
        }
      },
      "models": {
        "gpt-oss-20b": {
          "name": "Internal GPT-OSS 20B via Nebula",
          "limit": { "context": 32768, "output": 8192 }
        }
      }
    }
  }
}
```

Now OpenCode chats hit Nebula first, then Nebula forwards them to Anthropic,
Kimi, or any OpenAI-compatible endpoint using the credentials from `.env`. Use
`openai-compatible/<model-id>` (with `OPENAI_COMPATIBLE_BASE_URL` and
`OPENAI_COMPATIBLE_API_KEY` set) for company-internal or self-hosted upstreams
— anything that speaks `/v1/chat/completions`. Every turn shows up in the
dashboard with full payload, tokens, tool calls, latency, and cost.

## Local dev (no Docker)

```bash
# in one terminal
cd proxy && npm install && npm run dev
# in another
cd ui && npm install && npm run dev   # http://localhost:3000, proxies to :8080
```

## Layout

- `proxy/` — Hono + TypeScript gateway. SQLite (better-sqlite3) for capture.
- `ui/` — Vite + React 19 + Tailwind v4. Soft-pop neobrutalist design.
- `Dockerfile` + `docker-compose.yml` — single command runtime.
