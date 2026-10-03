# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Use Node 22 for `better-sqlite3` compatibility (Docker and CI also use Node 22).

```bash
# Build shared before running consumers (imports resolve to shared/dist)
npm run build --workspace=packages/shared

# Prepare duel-engine resources before starting duel (separate from the TS build)
npm run duel:prepare
npx tsx packages/duel-server/scripts/build-domain-core.ts

# Development (run each in separate terminals)
npm run dev:bot      # Discord bot with hot reload
npm run dev:ws       # WebSocket server with hot reload
npm run dev:duel     # Private EDOPro engine host with hot reload
npm run dev:web      # Next.js dev server

# Quality checks
npm test             # All packages via Turborepo (duel tests need engine resources)
npm run typecheck    # All packages
npm run build        # All packages (shared must build first — Turbo handles ordering)

# Run tests in a single package
npm test --workspace=packages/bot
npm test --workspace=packages/shared
npm test --workspace=packages/web
npm test --workspace=packages/ws
npm test --workspace=packages/duel-server

# Run a single test file (bot/shared — no config needed)
npx vitest run packages/bot/tests/services/drafts.test.ts

# Run a single web test file (must specify the web vitest config)
npx vitest run packages/web/tests/cards-resolve-route.test.ts -c packages/web/vitest.config.ts

# Docker (local dev with hot reload)
docker compose up -d --build

# Docker (production — no override file)
docker compose -f docker-compose.yml up -d --build

# Seed test data and restart services
npm run reset:test-data

# Deploy Discord slash commands
npm run commands:deploy --workspace=packages/bot  # dev (tsx)
```

## Architecture

This is an npm workspaces + Turborepo monorepo with five packages:

- **`packages/shared`** (`@yugidraft/shared`) — The foundation. Contains the SQLite schema (`src/db/schema.ts`), shared business-logic services (drafts, cubes, matches, tournaments, players, guild settings, card catalog, duels), and WebSocket event types (`src/ws/`). All other packages depend on its built `dist`; rebuild after shared source changes before checking consumers.
- **`packages/bot`** — Discord bot (discord.js). Handles slash commands, buttons, modals, select menus, and autocomplete. Also runs an internal announce HTTP server on port 4001 so the web can trigger bot announcements.
- **`packages/ws`** — Socket.IO server for draft/tournament updates and duel invalidations/presence. Public browser port 3001 (`WS_PORT`); internal HTTP port 4002 (`WS_INTERNAL_PORT`) receives signed broadcasts from `bot`, `web`, and `duel-server`.
- **`packages/web`** — Next.js 16 App Router dashboard. Discord OAuth via NextAuth v5. Real-time draft UI uses Zustand (`src/lib/stores/draft-store.ts`) fed by the WebSocket connection.
- **`packages/duel-server`** (`@yugidraft/duel-server`) — EDOPro engine host using `ocgcore-wasm` and engine workers. `build` compiles TypeScript; `dev` runs `tsx watch src/server.ts`; `start` runs `dist/server.js`. Only exposes private HTTP on `127.0.0.1:4003` by default (`DUEL_INTERNAL_HOST` / `DUEL_INTERNAL_PORT`). Web routes call it through `src/lib/duel-host.ts`.

### Duel resources and Docker

- `duel:prepare` downloads pinned card data, strings, and Lua scripts into `DUEL_DATA_DIR` (default root `data/duel-engine`). `scripts/build-domain-core.ts` in `packages/duel-server` separately builds the patched Domain Format WASM bundle with the pinned Emscripten Docker image; `DOMAIN_CORE_BUILD=local` uses a local `em++` toolchain. Neither step is part of the package's TypeScript build.
- `Dockerfile` has `bot`, `ws`, `duel`, `web`, and `web-dev` runtime targets. Compose mounts `./data` into bot/web/duel; duel startup runs `packages/duel-server/scripts/install-engine-bundle.sh` to validate the prepared bundle. The deploy workflow prepares/caches that bundle separately (`.github/workflows/deploy.yml`).
- Compose binds duel to `0.0.0.0:4003` inside the Docker network and sets web's `DUEL_INTERNAL_URL=http://duel:4003`. Caddy routes `/socket.io/*` to `ws:3001` and other HTTP to `web:3000`; internal ports 4001/4002/4003 are not published. The dev override adds a shared TypeScript watcher and exposes web/ws on 3000/3001.

### Database

Single SQLite file (root `data/bot.sqlite`) shared between `bot`, `web`, and `duel-server`. They open it directly via `@yugidraft/shared/db`; `DATABASE_PATH` overrides the path. Compose sets `DATABASE_PATH=/app/data/bot.sqlite` for web and duel; the bot takes `.env` and otherwise its cwd default, which is `/app/data/bot.sqlite` in the container, so don't set a different `DATABASE_PATH` in `.env`. Natively, set an absolute `DATABASE_PATH` for every process: web and duel-server default to the root `data/bot.sqlite`, but the bot uses the cwd-relative `./data/bot.sqlite`, so `npm run dev:bot` would otherwise open `packages/bot/data/bot.sqlite` and its drafts would not appear on the dashboard. `openDatabase` enables WAL and a 5-second busy timeout, then calls `migrate(db)` in `packages/shared/src/db/schema.ts`. Migrations include column additions, table rebuilds, and removal of obsolete tables.

### Service pattern

Shared business logic lives in factory functions: `createDraftService(db)`, `createMatchService(db)`, etc. These are defined in `packages/shared/src/services/` and consumed by bot/web/duel-server. Bot services under `packages/bot/src/services/` include draft/tournament timers, draft cleanup, and notification cleanup; draft images re-export the shared implementation. Bot template commands use the shared `createCubeService`.

### Discord interaction wrappers

The bot wraps all discord.js interactions into framework-agnostic `*Like` types (e.g., `CommandInteractionLike`, `ButtonInteractionLike`) before passing them to handlers in `src/interactions/` and `src/commands/handlers.ts`. This keeps handler logic testable without Discord mocks.

### Inter-service communication

- Internal HTTP uses `httpTransport` in `packages/shared/src/notify/signed-post.ts`: HMAC-SHA256 over the exact serialized JSON body, sent as `x-announce-signature: sha256=<hex>`. Receivers verify the raw body with the matching secret before parsing JSON.
- **Bot/web/duel-server → ws**: `createBroadcaster` posts draft/tournament events to `/internal/draft/*` and `/internal/tournament/*`; duel invalidations use `/internal/duel/changed`. Uses `WS_INTERNAL_URL` / `WS_INTERNAL_SECRET` on port 4002 (`packages/ws/src/internal-http.ts`).
- **Web → bot**: `packages/web/src/lib/notify.ts` creates the announcer; `/internal/announce/*` triggers Discord messages and duel invites. Uses `BOT_ANNOUNCE_URL` / `BOT_ANNOUNCE_SECRET` on port 4001 (`BOT_ANNOUNCE_PORT`, `packages/bot/src/announce/server.ts`).
- **Web → duel-server**: `packages/web/src/lib/duel-host.ts` posts operations to `/internal/duel` with `DUEL_INTERNAL_URL` / `DUEL_INTERNAL_SECRET` on port 4003. URL defaults to `http://127.0.0.1:4003`; Compose uses `http://duel:4003`. Browsers use authenticated web API routes.
- **Browser → ws**: Socket.IO connects to `NEXT_PUBLIC_WS_URL` (falls back to the page origin). Draft/tournament joins use slugs. Duel joins require a 5-minute token from `/api/duels/[slug]/connection`, signed with `WS_INTERNAL_SECRET` over JSON claims (`slug`, `guildId`, `playerId`, `seat`, `expiresAt`); ws verifies it in `src/duel-events.ts`. See `packages/shared/src/ws/duel-token.ts`.

### Web access model

- `packages/web/proxy.ts` runs NextAuth on every route except Next static/image assets and the favicon. `src/lib/auth.ts` allows login/auth endpoints, icons, and the enabled FX lab; protected pages and APIs require Discord sign-in and membership in `DISCORD_GUILD_ID`, checked with `DISCORD_TOKEN`.
- `src/lib/discord-web-access.ts` is the shared entry point for member/admin checks, used by sign-in, proxy, and route guards. E2E/test login providers must go through it too. Exception: duel guards in `src/lib/duel-host.ts` call `verifyDiscordGuildMembership` directly, so tests that stub only the entry point still hit Discord verification there. Membership/admin decisions cache for 60 seconds with in-flight deduplication and a 5-second request timeout; failures back off for at least 10 seconds and honor Discord's 429 retry deadline. APIs return 401 for no session, 403 for denied access, 503 when verification is unavailable.
- Admin = guild owner or a member with Manage Server / Administrator. Season start/end and settings writes require admin; cubes are editable by their owner or admin. Every server-data read is scoped to the configured guild, including slug/id lookups and linked resources.
- `/dev/fx-lab` and its card-image routes are public with `DUEL_FX_LAB=1` or in `next dev`; the lab returns 404 otherwise (`src/lib/fx-lab.ts`).
- Draft lobby test bots (Add bot button, `POST /api/drafts/[slug]/join-bot`, host only) are off in production unless the web server has `DRAFT_TEST_BOTS=1`; any non-production build allows them. The draft API returns `botsEnabled` so the page never reads the env (`src/lib/draft-test-bots.ts`). Bots pick through the pick route (they auto-pick after each human pick) and through pick-deadline expiry.

### Draft flow

Drafts are started from either Discord or the web dashboard. The bot's draft timer (`packages/bot/src/services/draft-timer.ts`) polls active drafts every second and expires pick steps past their deadline, then notifies the ws server. The ws server broadcasts to all browser clients in the draft's Socket.IO room.

### Cubes and theme draft mode

- Reusable pools/configs live in `cubes` / `cube_cards` (`main`/`extra` pools, per-card `max_copies`, draft config in `config_json`). `createCubeService` supports archetype seeding, passcode imports, and saved configs; `applyCubeToConfig` supplies shared booster-style drafts. The library/editor uses `/cubes`, `/cubes/[id]`, and `/api/cubes`; `/themes` and `/themes/[id]` redirect to the corresponding cube pages. Legacy theme and draft-template tables are dropped by migration.
- `DraftConfig.mode === "theme"` deals each player privately from an assigned cube. `allowedCubeIds` controls available cubes; `draft_player_cube` stores assignments. `themeSelection` still supports `host_assigned`, `random`, and `player_pick`; `uniqueThemes` controls distinct assignments.
- In `packages/shared/src/services/drafts.ts`, `startThemeDraft` assigns seats/cubes and checks main-pool sufficiency; `openThemeRound` deals up to `themePackSize` choices; `pickThemeCard` advances `current_wave_number` once everyone dealt a pack has picked. Main-deck rounds precede optional extra-deck rounds; `burnUnpicked` controls whether unpicked choices return to the pool.
- Web flow: `/drafts/new` → `/drafts/new/theme` → lobby cube creation/attachment, claim/preview, and start preflight. Draft cube management uses `/api/drafts/[slug]/cubes`; player claims use `/api/drafts/[slug]/claim-cube` with `cubeId`; analysis uses `/api/drafts/[slug]/preflight`. Card catalog supports `syncByArchetype`, `listArchetypes`, and `card_catalog.archetype`.

### Card catalog

Card data is fetched from ygoprodeck.com and cached in `card_catalog`. The bot syncs sets at `SETS_SYNC_CRON` (default `0 6 * * *`, `SETS_SYNC_TIMEZONE=UTC`). Bot images and the web card-image route use `CARD_IMAGE_CACHE_DIR` (default `./data/card-images`, relative to process cwd). Bot cleanup evicts oldest files over `CARD_IMAGE_CACHE_MAX_BYTES` (default `16106127360`, 15 GiB) on `IMAGE_CLEANUP_CRON` (default `0 4 * * *`, `IMAGE_CLEANUP_TIMEZONE=UTC`). Next's optimized images have a separate cache with a 1-year minimum TTL (`packages/web/next.config.ts`).

## Design context (`.impeccable.md`)

Dark-mode-first competitive UI. High-contrast card displays, crisp typography, minimal chrome. Accent colors from Yu-Gi-Oh brand (purple/gold) used sparingly for active states. Design principles: speed over ceremony, live state is truth, draft-room immersion, Discord is the lobby.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `imran443/yugioh-bot`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
