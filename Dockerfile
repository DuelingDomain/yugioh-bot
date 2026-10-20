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
RUN npm ci && find /app -type f -name '*.map' -delete

# ── build ────────────────────────────────────────────────────────────────────
# Build non-web packages via turbo (respects dependency order).
# Prune without lifecycle scripts so native addons and patch-package edits are not
# re-extracted from the registry. Re-apply patches afterward (postinstall would
# not run under --ignore-scripts).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx turbo run build --filter='!@yugioh-discord-bot/web' \
    && find /app -type f -name '*.map' -delete

# Local Compose builds start with an empty Next cache. Actions overrides this
# stage with a named docker-image context from the rolling GHCR nextcache tag.
FROM node:22-bookworm-slim AS nextcache
RUN mkdir /cache

FROM build AS web-build
# Turbo's strict env filter would drop an undeclared Clerk key.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG SENTRY_ENVIRONMENT=
ARG SENTRY_RELEASE=
ARG SENTRY_ORG=
ARG SENTRY_PROJECT=
ARG SENTRY_UPLOAD_SOURCEMAPS=0
# Import the rolling cache, build, upload and remove maps in one committed layer.
# This also removes any map files inherited from an older cache image.
# The token is a temporary mount; fail without printing it if a tool persists it.
RUN --mount=type=bind,from=nextcache,source=/cache,target=/tmp/nextcache \
    --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    mkdir -p packages/web/.next/cache \
    && cp -a /tmp/nextcache/. packages/web/.next/cache/ \
    && SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null || true)" \
    SENTRY_UPLOAD_SOURCEMAPS="$SENTRY_UPLOAD_SOURCEMAPS" \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" \
    NEXT_PUBLIC_SENTRY_DSN="$NEXT_PUBLIC_SENTRY_DSN" \
    NEXT_PUBLIC_POSTHOG_KEY="$NEXT_PUBLIC_POSTHOG_KEY" \
    SENTRY_ENVIRONMENT="$SENTRY_ENVIRONMENT" SENTRY_RELEASE="$SENTRY_RELEASE" \
    SENTRY_ORG="$SENTRY_ORG" SENTRY_PROJECT="$SENTRY_PROJECT" npm run build --workspace=packages/web \
    && find /app -type f -name '*.map' -delete \
    && if [ -s /run/secrets/SENTRY_AUTH_TOKEN ]; then \
         if grep -F -r -q -f /run/secrets/SENTRY_AUTH_TOKEN /app; then \
           echo "Sentry upload token found in build output" >&2; exit 1; \
         else [ "$?" = 1 ] || { echo "Sentry upload token scan failed" >&2; exit 1; }; fi; \
       fi
# Export only the incremental build cache, never runtime configuration.
FROM scratch AS web-cache
COPY --from=web-build /app/packages/web/.next/cache/ /cache/

FROM build AS runtime-deps
RUN npm prune --omit=dev --ignore-scripts && npx patch-package --error-on-fail \
    && find /app -type f -name '*.map' -delete

# ── bot ──────────────────────────────────────────────────────────────────────
# Compile only the bot and shared package; no duel engine build is required.
FROM deps AS bot-build
COPY tsconfig.json ./
COPY packages/shared packages/shared
COPY packages/bot packages/bot
RUN npm run build --workspace=packages/bot && find /app -type f -name '*.map' -delete

# Install only this service's production dependencies. Native SQLite is rebuilt
# with the compiler toolchain from deps; build tools stay outside the final image.
FROM deps AS bot-runtime-deps
RUN npm ci --omit=dev --ignore-scripts --workspace=packages/bot --workspace=packages/shared --include-workspace-root=false \
    && npm rebuild better-sqlite3 \
    && find /app -type f -name '*.map' -delete

FROM node:22-bookworm-slim AS bot
WORKDIR /app
ENV NODE_ENV=production NODE_OPTIONS=--max-old-space-size=160
COPY --from=bot-build /app/package*.json ./
COPY --from=bot-runtime-deps /app/node_modules ./node_modules
COPY --from=bot-build /app/packages/shared/package*.json packages/shared/
COPY --from=bot-build /app/packages/shared/dist packages/shared/dist
COPY --from=bot-build /app/packages/shared/data/effects packages/shared/data/effects
COPY --from=bot-build /app/packages/shared/data/staples/usage.json packages/shared/data/staples/usage.json
COPY --from=bot-build /app/packages/bot/package*.json packages/bot/
COPY --from=bot-build /app/packages/bot/dist packages/bot/dist
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD ["node", "packages/bot/dist/healthcheck.js"]
CMD ["sh", "-c", "node packages/bot/dist/deploy-commands.js && exec node --import ./packages/bot/dist/instrument.js packages/bot/dist/index.js"]

# ── ws ───────────────────────────────────────────────────────────────────────
# Production stage for the Socket.IO WebSocket server.
FROM node:22-bookworm-slim AS ws
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=runtime-deps /app/node_modules ./node_modules
# Shared package (symlink target for @yugidraft/shared; ws duel auth imports it)
COPY --from=build /app/packages/shared/package*.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/data/effects packages/shared/data/effects
COPY --from=build /app/packages/shared/data/staples/usage.json packages/shared/data/staples/usage.json
COPY --from=build /app/packages/ws/package*.json packages/ws/
COPY --from=build /app/packages/ws/dist packages/ws/dist
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
USER node
CMD ["node", "--import", "./packages/ws/dist/instrument.js", "packages/ws/dist/server.js"]

# ── duel ─────────────────────────────────────────────────────────────────────
# Private automated duel engine. Browsers use authenticated Next routes.
FROM node:22-bookworm-slim AS duel
WORKDIR /app
ENV NODE_ENV=production
# The bundle installer reads the sibling SQLite database to protect active duels.
RUN apt-get update && apt-get install -y --no-install-recommends python3 && \
    rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package*.json ./
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package*.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/data/effects packages/shared/data/effects
COPY --from=build /app/packages/shared/data/staples/usage.json packages/shared/data/staples/usage.json
COPY --from=build /app/packages/duel-server/package*.json packages/duel-server/
COPY --from=build /app/packages/duel-server/card-block-list.json packages/duel-server/card-block-list.json
COPY --from=build /app/packages/duel-server/dist packages/duel-server/dist
COPY --from=build /app/packages/duel-server/scripts/install-engine-bundle.sh packages/duel-server/scripts/install-engine-bundle.sh
COPY --from=build /app/packages/duel-server/scripts/verify-effect-artifact.py packages/duel-server/scripts/verify-effect-artifact.py
COPY --from=build /app/packages/duel-server/scripts/verify-deploy-multi-cores.mjs packages/duel-server/scripts/verify-deploy-multi-cores.mjs
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["sh", "-c", "sh packages/duel-server/scripts/install-engine-bundle.sh && exec node --import ./packages/duel-server/dist/instrument.js packages/duel-server/dist/server.js"]

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
COPY --from=web-build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/shared/package*.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/data/effects packages/shared/data/effects
COPY --from=build /app/packages/shared/data/staples/usage.json packages/shared/data/staples/usage.json
RUN mkdir -p /app/data /app/packages/web/.next/cache && \
    chown node:node /app/data && chown -R node:node /app/packages/web/.next/cache
VOLUME ["/app/data"]
USER node
EXPOSE 3000
CMD ["node", "packages/web/server.js"]

# ── worker ───────────────────────────────────────────────────────────────────
# One scheduling process per SQLite file; no public port.
FROM node:22-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package*.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/data/effects packages/shared/data/effects
COPY --from=build /app/packages/shared/data/staples/usage.json packages/shared/data/staples/usage.json
COPY --from=build /app/packages/worker/package*.json packages/worker/
COPY --from=build /app/packages/worker/dist packages/worker/dist
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "packages/worker/dist/healthcheck.js"]
CMD ["node", "--import", "./packages/worker/dist/instrument.js", "packages/worker/dist/index.js"]

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
