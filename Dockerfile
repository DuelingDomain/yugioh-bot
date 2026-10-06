# ── deps ────────────────────────────────────────────────────────────────────
# Install all npm dependencies once. Copy only manifests so this layer is
# cached as long as package-lock.json doesn't change.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ libvips-dev && \
    rm -rf /var/lib/apt/lists/*
# Root workspace manifest + all workspace manifests (needed by npm workspaces ci)
COPY package*.json ./
COPY packages/bot/package*.json packages/bot/
COPY packages/ws/package*.json packages/ws/
COPY packages/web/package*.json packages/web/
COPY packages/shared/package*.json packages/shared/
COPY packages/duel-server/package*.json packages/duel-server/
COPY packages/e2e/package*.json packages/e2e/
COPY packages/worker/package*.json packages/worker/
COPY patches/ patches/
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
# Build all packages via turbo (respects dependency order: shared → bot/ws/web/duel-server/worker).
# Prune without lifecycle scripts so native addons and patch-package edits are not
# re-extracted from the registry. Re-apply patches afterward (postinstall would
# not run under --ignore-scripts).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx turbo run build
RUN npm prune --omit=dev --ignore-scripts && npx patch-package --error-on-fail

# ── bot ──────────────────────────────────────────────────────────────────────
# Production stage for the Discord bot.
FROM node:22-bookworm-slim AS bot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
# Shared package (symlink target for @yugidraft/shared)
COPY --from=build /app/packages/shared/package*.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
# Bot compiled output
COPY --from=build /app/packages/bot/package*.json packages/bot/
COPY --from=build /app/packages/bot/dist packages/bot/dist
RUN mkdir -p /app/data
VOLUME ["/app/data"]
CMD ["sh", "-c", "node packages/bot/dist/deploy-commands.js && node packages/bot/dist/index.js"]

# ── ws ───────────────────────────────────────────────────────────────────────
# Production stage for the Socket.IO WebSocket server.
FROM node:22-bookworm-slim AS ws
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
# Shared package (symlink target for @yugidraft/shared; ws duel auth imports it)
COPY --from=build /app/packages/shared/package*.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/ws/package*.json packages/ws/
COPY --from=build /app/packages/ws/dist packages/ws/dist
RUN mkdir -p /app/data
VOLUME ["/app/data"]
CMD ["node", "packages/ws/dist/server.js"]

# ── duel ─────────────────────────────────────────────────────────────────────
# Private automated duel engine. Browsers use authenticated Next routes.
FROM node:22-bookworm-slim AS duel
WORKDIR /app
ENV NODE_ENV=production
# The bundle installer reads the sibling SQLite database to protect active duels.
RUN apt-get update && apt-get install -y --no-install-recommends python3 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package*.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/duel-server/package*.json packages/duel-server/
COPY --from=build /app/packages/duel-server/dist packages/duel-server/dist
COPY --from=build /app/packages/duel-server/scripts/install-engine-bundle.sh packages/duel-server/scripts/install-engine-bundle.sh
COPY --from=build /app/packages/duel-server/scripts/verify-deploy-multi-cores.mjs packages/duel-server/scripts/verify-deploy-multi-cores.mjs
RUN mkdir -p /app/data
CMD ["sh", "-c", "sh packages/duel-server/scripts/install-engine-bundle.sh && exec node packages/duel-server/dist/server.js"]

# CI compiles the pinned engine bundle before it reaches the VM. The deploy
# scripts pass the verified tarball contents as the named engine build context.
# Keep a source outside /app/data: the Compose bind mount hides image data there.
FROM duel AS duel-bundled
ENV DUEL_BUNDLE_SRC=/opt/duel-engine
ENV DUEL_DATA_DIR=/app/data/duel-engine
COPY --from=engine --chmod=0755 . /opt/duel-engine/
RUN DUEL_DATA_DIR=/opt/duel-engine node packages/duel-server/scripts/verify-deploy-multi-cores.mjs

# ── web ──────────────────────────────────────────────────────────────────────
# Production stage for the Next.js web dashboard.
# Standalone output is traced from the worktree root (next.config outputFileTracingRoot).
FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/shared/package*.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "packages/web/server.js"]

# ── worker ───────────────────────────────────────────────────────────────────
# One scheduling process per SQLite file; no public port.
FROM node:22-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package*.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/worker/package*.json packages/worker/
COPY --from=build /app/packages/worker/dist packages/worker/dist
RUN mkdir -p /app/data
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "packages/worker/dist/healthcheck.js"]
CMD ["node", "packages/worker/dist/index.js"]

# ── web-dev ──────────────────────────────────────────────────────────────────
# Development stage: runs `next dev` with HMR.
# Source directories are bind-mounted by docker-compose.override.yml at runtime.
FROM node:22-bookworm-slim AS web-dev
WORKDIR /app
ENV NODE_ENV=development
# Install build tools for any native addons rebuilt in dev
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ libvips-dev && \
    rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY packages/bot/package*.json packages/bot/
COPY packages/ws/package*.json packages/ws/
COPY packages/web/package*.json packages/web/
COPY packages/shared/package*.json packages/shared/
COPY packages/duel-server/package*.json packages/duel-server/
COPY packages/e2e/package*.json packages/e2e/
COPY packages/worker/package*.json packages/worker/
# Copy full source — bind mounts in docker-compose.override.yml overlay these at runtime
COPY . .
# Next dev regenerates next-env.d.ts and writes .next/.turbo at runtime, but
# the container runs as UID 1000 while `COPY . .` baked these as root. Make
# the whole web package writable by the runtime user (skip the large,
# read-only node_modules tree). Covers the .next anonymous-volume mount too.
RUN mkdir -p /app/packages/web/.next \
 && find /app/packages/web -maxdepth 1 -mindepth 1 ! -name node_modules \
      -exec chown -R 1000:1000 {} +
EXPOSE 3000
WORKDIR /app/packages/web
CMD ["/app/node_modules/.bin/next", "dev"]
