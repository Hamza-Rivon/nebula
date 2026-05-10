# Single image: build UI -> static assets -> served by Nebula proxy.
# One container, one port. Bun runs the proxy directly from TypeScript and
# uses bun:sqlite, so there is no compile step and no native build deps.

# ---- UI build ----
FROM oven/bun:1-alpine AS ui-builder
WORKDIR /app
COPY ui/package.json ui/bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY ui ./
RUN bun run build

# ---- Proxy deps ----
FROM oven/bun:1-alpine AS proxy-deps
WORKDIR /app
COPY proxy/package.json proxy/bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install --production

# ---- Runtime ----
FROM oven/bun:1-alpine
WORKDIR /app
RUN apk add --no-cache tini

COPY --from=proxy-deps /app/package.json ./
COPY --from=proxy-deps /app/node_modules ./node_modules
COPY proxy/src ./src
COPY proxy/tsconfig.json ./
COPY --from=ui-builder /app/dist ./ui-dist

ENV NEBULA_PROXY_PORT=8080
ENV NEBULA_DB_PATH=/data/nebula.db
EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "src/index.ts"]
