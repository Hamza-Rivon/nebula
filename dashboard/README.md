# Nebula Dashboard

## Install

```bash
bun install
```

## Analyze sessions

```bash
bun run analyze \
  --api-base-url https://api.example.com/v1 \
  --api-key sk-... \
  --model claude-opus-4-7
```

Use `--api-key-env MY_KEY_VAR` instead of `--api-key` to read the key from an env var.

## Run the dashboard

```bash
bun run dev
```
