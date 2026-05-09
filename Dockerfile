# Single image: build UI -> static assets -> served by Nebula proxy.
# One container, one port.

# ---- UI build ----
FROM node:22-alpine AS ui-builder
WORKDIR /app
COPY ui/package.json ui/package-lock.json* ./
RUN npm install --silent
COPY ui ./
RUN npx vite build

# ---- Proxy build (compiles TS + native better-sqlite3) ----
FROM node:22-alpine AS proxy-builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY proxy/package.json proxy/package-lock.json* ./
RUN npm install --silent
COPY proxy ./
RUN npx tsc \
 && npm prune --omit=dev

# ---- Runtime ----
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini

# Reuse already-compiled node_modules (incl. native better-sqlite3)
COPY --from=proxy-builder /app/package.json ./
COPY --from=proxy-builder /app/node_modules ./node_modules
COPY --from=proxy-builder /app/dist ./dist
COPY --from=ui-builder    /app/dist ./ui-dist

ENV NEBULA_PROXY_PORT=8080
ENV NEBULA_DB_PATH=/data/nebula.db
EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
