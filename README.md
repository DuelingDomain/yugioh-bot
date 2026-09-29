# YuGiOh Draft Bot

A Discord bot + web dashboard for tracking YuGiOh matches, running drafts, managing tournaments, and viewing stats.

## Features

### Discord Bot
- `/duel` reports a casual 1v1 match
- `/approve` / `/deny` approves or rejects pending match reports
- `/stats` shows lifetime wins, losses, and win rate (optionally scoped to a tournament)
- `/rankings` shows the server leaderboard
- `/help` shows available bot commands
- `/event dashboard` opens a private tournament dashboard with buttons for open events, signup, match reporting, approvals, stats, creator tools, and help
- `/event` creates, joins, starts, shows, reports, and cancels tournaments with direct creator-seeded participants
- Tournament name autocomplete helps pick existing events in supported options
- Daily reminders ping a configured channel for unplayed tournament matches

### Web Dashboard
- Discord OAuth login (NextAuth.js v5)
- View active, pending, completed, and cancelled drafts
- Create new drafts with set picker and config options
- Create new tournaments with format selection
- Draft detail pages: manage pending drafts (start, cancel, edit), participate in active drafts, view completed draft summaries and export YDK
- Tournament detail pages: view participants, matches, standings; start/cancel tournaments (creator only); report match results
- Guild announcement settings toggles
- Real-time draft updates via Socket.IO
- Automated Normal/Domain 1v1 tables with the approved Obsidian duel room

## Local Setup

```bash
npm install
cp .env.example .env
npm run commands:deploy
npm run dev
```

SQLite data is stored in `./data/bot.sqlite` by default.

### Automated duel service

Authenticated **Standard 1v1** tables use selectable EDOPro Master Rule presets **1–5**, defaulting to **Master Rule 5**. **Domain 1v1** is a separate mode using modern rules plus Domain mechanics. The selection is fixed when a table is created and retained for reconnect, replay, and history. These are native gameplay presets with the current card catalog, not historical card pools or banlists. Players choose; the private compiled engine enforces legality and resolves effects. An organizer can fill an empty opponent seat with **Add practice bot** for solo testing. The bot brings a format-valid generic EARTH Normal Monster deck, makes basic legal choices, summons, and attacks automatically; it is not a competitive AI. There is no 3-/4-player mode. Casual `/duel` match reports and ranking are unchanged.

The canonical resource bundle is worktree-local `data/duel-engine` (`cards.cdb`, `card-scripts/`, `strings.conf`, `ocgcore.domain.wasm`, `manifest.json`). Domain mode loads only `DUEL_DATA_DIR/ocgcore.domain.wasm` (default `./data/duel-engine`); it does not fall back to `out/` or `packages/duel-server/domain-core/dist`. Opening decks are shuffled by the core from the pinned seed, so the accepted-input journal can replay the same game. A `manifest.json` `bundleVersion` change interrupts in-flight tables.

Domain deck submission requires a separate Deck Master, exactly 60 singleton Main Deck cards, at most 15 Extra Deck cards, and no Side Deck. Main Deck Pendulum Masters can be activated as scales or Pendulum Summoned from the Deck Master Zone; non-Pendulum Main Deck Masters can also be Pendulum Summoned when eligible. Extra Deck Pendulum Masters require their proper Extra Deck summon mechanic. Summon surcharges apply to subsequent departures, including effect-based summons, and recall eligibility resets on changes of location kind. Format rules: [Domain Format](https://www.domainformat.com/rules).

To choose your Deck Master, create a **Domain 1v1 · singleton** table and enter its card passcode in the deck editor. The Master determines the permitted Domain; there is no separate leader or Domain selection. Keep it outside the 60 Main and 0–15 Extra cards, or import a Domain Toolbox YDK with the Master as its sole Side card. Other Side Deck imports are rejected rather than silently discarded. Click **Ready with this deck**: **Deck needed** remains until the engine accepts the submission. Standard tables have no Deck Master and accept 40–60 Main cards instead.

Imported catalog/artwork IDs absent from the engine database are resolved through the existing card catalog to an unambiguous engine card name before validation. For example, Barrel Dragon `81480461` resolves to `81480460`. Unknown or ambiguous cards still fail; copy limits, Domain membership, and singleton rules apply to the canonical IDs.

The practice bot is a real bot seat, not a fabricated Discord player. Its Domain deck has 60 unique low-level EARTH Normal Monsters plus Axe Raider (`48305365`) as a separate Deck Master; its Normal deck has 40 cards. It sees only its own redacted engine view, and its accepted choices use the same durable journal as human choices. Bot wins are recorded by seat without awarding them to a human.

The **Obsidian duel room** uses an immersive two-sided field with five Monster and Spell/Trap zones per player and separate piles. MR1–2 have no Pendulum or Extra Monster Zones; MR3 has separate Pendulum Zones; MR4–5 and Domain use integrated Pendulum Zones and shared Extra Monster Zones. Left-click a card for its engine-offered actions; hover or focus it for stats. The inspector preserves exact card instances when choosing from a pile. Escape closes an action menu without submitting an answer. Required targets, zones, materials, and positions use the engine's prompt; optional chains offer Pass, mandatory chains do not. Only Domain tables show the Deck Master rail. Its recall prompt names the Master and displays the next summon surcharge before the choice.

The room skin follows the original `designs/duel-ui/nexus-classic/variation-2-obsidian-arena.webp`: sampled stone texture and card backs, closed gold/violet chamfered frames, a small sun centered between the Extra Monster Zones, and a compact bottom phase strip. Existing portrait/landscape Monster Zone guides remain authoritative rather than copying the concept's inaccurate zone proportions. Deck Master action buttons show only engine-offered actions; **Inspect** remains separate. On narrow screens the hand scrolls inside a reserved LP gutter, and the Master panels move below the field.

The reference-skin browser pass covered Normal and Domain rooms at 1568×896, 1659×948, and 390×844: Master summon through a clicked legal field slot, Normal card-menu Escape/focus restoration, phase submission, private hands from both seats, persisted sound/reduced-motion preferences, keyboard Options navigation, and both ends of a seven-card hand without LP overlap or document overflow.

Summons, sets, activations, attacks, and chain resolution produce non-blocking feedback in engine order. Face-down identities stay private to their owner, including logs and presentation events. **Options** provides persisted sound and motion preferences: sound starts off and requires a browser interaction to unlock; motion follows the device setting unless overridden. Muting stops current voices. Reduced motion keeps informational cues without animated movement.

**Room access and recovery:** signed-in Discord members of the configured guild may watch tables. Returning players recover their identity-bound seats, including during an active duel; spectators receive only the public board/events, never private hands, deck lists, or actionable prompts. Guild membership is checked through Discord using the web process's `DISCORD_TOKEN`; unavailable membership checks fail closed. Authenticated Socket.IO notifications trigger authoritative HTTP snapshots, including on reconnect. Tokens renew before expiry; HTTP polling remains available if realtime is unavailable. Presence reports occupied online seats and spectator count. A disconnect never invents a defeat.

**Room lifecycle:** organizers can cancel a lobby or immediately archive a terminal table from **Options**. Completed, cancelled, and interrupted tables otherwise leave **Live tables** after 10 minutes (`DUEL_ARCHIVE_AFTER_MS`) and remain in **Match history**. SQLite retains outcomes, decks, accepted inputs, and available final board snapshots; private and public projections remain separate. Completed workers are released after final-state persistence. Idle active workers are reclaimed after five minutes without room requests (`DUEL_IDLE_WORKER_MS`); a returning viewer reconstructs the game from its pinned seed and accepted-input journal. Rebuild the Domain bundle and restart the duel service to activate native rule changes; changing the bundle version interrupts existing active games rather than replaying them under different rules.

Compiled HTTP workers and the emitted standalone browser have completed ordinary Normal 1v1 games (including privacy, stale/wrong-seat/outsider rejection, and journal replay) and Domain 1v1 Deck Master leave → GY → offered recall → re-summon at +500 LP. The Obsidian room has also been exercised from both seats at desktop and 390px widths: card and multi-card-pile menus, keyboard dismissal, horizontal face-down cards, optional responses, two-link resolution, sound/mute, reduced motion, reversible Link-material selection through a completed Link Summon, and a live Master recall/resummon from 8000 to 7500 LP. Narrow-screen checks include reaching both ends of a seven-card hand. Native lifecycle smokes cover the second recall/resummon to 6500 LP. This does not imply complete card compatibility.

Current native regressions also cover Master Rule first-turn draws and field rules, Main Deck Pendulum scale activation/Pendulum Summoning, effect-based Deck Master surcharge payment, recall after location-kind changes, and right-scale/Link-arrow integrity across both cores. The existing `patch-package` patch for `ocgcore-wasm@0.1.2` includes the wasm32 card-data offset correction; keep the install-time patch applied when rebuilding or deploying.

**Prepare resources** (worktree root, after `npm install`):

```bash
npm run duel:prepare
# Domain wasm + domain.lua into data/duel-engine. Default: already-pulled
# docker.io/emscripten/emsdk:4.0.9. DOMAIN_CORE_BUILD=local uses host em++.
npx tsx packages/duel-server/scripts/build-domain-core.ts
```

**Compiled engine** (bind `127.0.0.1:4003` by default; never expose that port). `dist/worker.js` must sit next to `dist/worker-client.js`. Load `.env` into the process environment — do not pass `node --env-file` (Node 24 rejects it when Next forwards the flag into `NODE_OPTIONS`).

```bash
npm run build --workspace=@yugidraft/shared
npm run build --workspace=@yugidraft/duel-server
node packages/duel-server/dist/server.js
```

On memory-capped WSL, use this compiled host and the emitted standalone web below. Do not run unbounded `next dev` / Turbopack; it can spawn runaway PostCSS processes.

**Emitted Next standalone** (`output: "standalone"`, `outputFileTracingRoot` is the worktree). The web build runs `package:standalone` after Next finishes, copying `.next/static` and `public` beside the emitted server. Both the local start script and Docker use this complete tree; missing assets otherwise leave HTML visible while CSS and JavaScript return 404.

```bash
npm run build --workspace=@yugioh-discord-bot/web
# Repair assets in an existing completed build without running Next again:
npm run package:standalone --workspace=@yugioh-discord-bot/web
```

After loading `.env` into the process environment, launch from the worktree root:

```bash
HOSTNAME=127.0.0.1 PORT=3000 \
AUTH_URL=http://localhost:3000 NEXTAUTH_URL=http://localhost:3000 \
DATABASE_PATH="$PWD/data/bot.sqlite" \
DUEL_INTERNAL_URL=http://127.0.0.1:4003 \
WS_INTERNAL_URL=http://127.0.0.1:4002 \
BOT_ANNOUNCE_URL=http://127.0.0.1:4001 \
systemd-run --user --scope --unit=yugidraft-web-local \
  -p MemoryMax=1536M -p MemorySwapMax=256M -p TasksMax=128 \
  npm run start --workspace=@yugioh-discord-bot/web
```

`start` launches `packages/web/.next/standalone/packages/web/server.js`, not `next start`. The web process needs `DUEL_INTERNAL_SECRET` matching the engine or deck ready never reaches the host. Discord must register the exact callback `http://localhost:3000/api/auth/callback/discord`.

For host-run web with Docker bot/WebSocket services, Docker-only names such as `http://ws:4002` are not reachable from the web process. Publish the bot's `4001` and WebSocket internal `4002` ports on `127.0.0.1` only, retain matching signing secrets, and mount the same worktree `data` directory into the supporting containers. The current local override is `/tmp/yugioh-local-3000.override.yml`; it also publishes Socket.IO at `localhost:3002` and sets its browser origin to `http://localhost:3000`. Build the browser with `NEXT_PUBLIC_WS_URL=http://localhost:3002`. Leave the older Docker web container stopped to avoid a duplicate app.

Source attribution: [ocgcore-wasm](https://github.com/n1xx1/ocgcore-wasm), [EDOPro core](https://github.com/edo9300/ygopro-core), [ProjectIgnis CardScripts](https://github.com/ProjectIgnis/CardScripts), and the GPL-3.0 [Domain Toolbox](https://github.com/DarknessCatt/Yugioh-Domain-Toolbox) used as the Domain legality reference. Engine, scripts, and card artwork have separate licensing requirements; no Master Duel assets are bundled.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | Yes (bot + web) | Discord bot token; web uses it to verify guild membership for duel access |
| `DISCORD_CLIENT_ID` | Yes | Discord application client ID (shared between bot and web OAuth) |
| `DISCORD_CLIENT_SECRET` | Yes | Discord OAuth2 client secret (for web auth) |
| `DISCORD_GUILD_ID` | Yes | Discord server ID for guild-scoped commands |
| `DISCORD_REMINDER_CHANNEL_ID` | No | Channel for daily tournament reminders |
| `DISCORD_DEFAULT_CHANNEL_ID` | No | Default channel for web-created drafts/tournaments |
| `NEXTAUTH_SECRET` | Yes (web) | Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Yes (web) | `http://localhost:3000` for local, `http://<VM_IP>` or `https://yourdomain.com` for production |
| `WEB_URL` | Yes (bot) | Public web URL used in bot announcement links. Same value as `NEXTAUTH_URL` in production |
| `NEXT_PUBLIC_WS_URL` | Yes (web) | WebSocket URL: `http://localhost:3001` local, `http://<VM_IP>` or `https://yourdomain.com` for production. Baked into the browser bundle at build time — rebuild the web image when this changes |
| `WS_INTERNAL_SECRET` | Yes (web + bot + duel + ws) | Shared HMAC secret for internal broadcasts and short-lived duel subscription tokens. Generate with `openssl rand -hex 32` |
| `WS_INTERNAL_URL` | Yes (web + bot + duel) | Internal URL of the ws server. In Docker Compose this is `http://ws:4002` |
| `BOT_ANNOUNCE_SECRET` | Yes | Shared bearer secret for web → bot announce endpoint. Generate with `openssl rand -hex 32` |
| `BOT_ANNOUNCE_URL` | Yes (web) | Internal URL where web reaches the bot announce server. In Docker Compose this is `http://bot:4001` |
| `DUEL_INTERNAL_SECRET` | Yes (web + duel) | Shared HMAC secret for web → private duel host (`x-announce-signature`). Generate with `openssl rand -hex 32`. Never expose port 4003 |
| `DUEL_INTERNAL_URL` | Yes (web) | Internal URL of the duel host. Host: `http://127.0.0.1:4003`. Compose: `http://duel:4003` |
| `DUEL_DATA_DIR` | No | Canonical engine bundle. Defaults to `./data/duel-engine`. Use an absolute path when the process cwd is not the worktree |
| `DUEL_INTERNAL_HOST` | No | Duel host bind address. Defaults to `127.0.0.1` (`0.0.0.0` in Compose) |
| `DUEL_INTERNAL_PORT` | No | Duel host port. Defaults to `4003` |
| `DUEL_ARCHIVE_AFTER_MS` | No | Delay before terminal tables are archived from live listings; default `600000` (10 minutes). Records remain in SQLite |
| `DUEL_IDLE_WORKER_MS` | No | Idle worker reclamation delay; default `300000` (5 minutes). Re-entry replays the game without forfeiting a seat |
| `DATABASE_PATH` | No | SQLite file path. Defaults to `./data/bot.sqlite`. Web and duel must open the same file |
| `REMINDER_CRON` | No | Cron schedule for daily reminders. Defaults to `0 10 * * *` |
| `REMINDER_TIMEZONE` | No | Timezone for reminders. Defaults to `America/New_York` |

## Docker

### Development (with hot reload)

```bash
docker compose up -d --build
```

The tracked `docker-compose.override.yml` is auto-merged for local dev. It switches the web service to the `web-dev` target, enables polling-based file watching, and bind-mounts the source directories needed for HMR.

To reset local draft test data and reopen the SQLite-backed services against a fresh seed, run:

```bash
npm run reset:test-data
```

The seed uses the tracked offline catalog at `scripts/data/draft-catalog-legendary.json`, including in fresh checkouts and worktrees. Refresh that fixture deliberately with `npm run snapshot:draft-catalog`; ordinary seeding and tests do not fetch the catalog.

### Production

```bash
docker compose -f docker-compose.yml up -d --build
```

Production should always use the base file explicitly so local dev overrides are not loaded.

The stack runs 5 services:
- **bot** — Discord bot (deploys commands on startup)
- **ws** — Socket.IO WebSocket server for real-time draft updates
- **duel** — Private automated engine (`packages/duel-server/dist/server.js`, loopback 4003)
- **web** — Next.js 16 dashboard (standalone `packages/web/server.js`)
- **caddy** — Reverse proxy (HTTP on port 80, auto-HTTPS with a domain)

## Deployment

### VM Deployment (Hetzner / Any VPS)

The app runs on a VM via Docker Compose with Caddy as a reverse proxy. GitHub Actions deploys on every push to `main`.

**SSH access:**

```bash
ssh -i ~/.ssh/hetzner_deploy root@178.105.36.104
```

If you need to set or reset the root password after logging in:

```bash
passwd
```

**Quick setup:**
1. Create a VM (e.g., Hetzner CAX11, 4GB RAM, Ubuntu 24.04)
2. Install Docker and Git on the VM
3. Clone the repo to `/opt/yugioh-bot`
4. Create `.env` on the VM (see Environment Variables above)
5. Set Discord OAuth redirect URI: `http://<YOUR_IP>/api/auth/callback/discord`
6. Run `docker compose -f docker-compose.yml up -d --build`
7. Add GitHub Actions secrets (`VM_HOST`, `VM_USER`, `VM_SSH_PRIVATE_KEY`, `VM_PORT`)

See `docs/deployment/vm-runbook.md` for the full step-by-step guide.

**SSH into the production VM:**

```bash
ssh -i ~/.ssh/hetzner_deploy root@178.105.36.104
```

### Adding a Custom Domain (Optional)

For HTTPS with a custom domain:

1. Point your domain's A record to the VM IP
2. Edit `Caddyfile` — replace `:80` with `yourdomain.com`
3. Add `"443:443"` to the caddy ports in `docker-compose.yml`
4. Update `.env`: `NEXTAUTH_URL=https://yourdomain.com` and `NEXT_PUBLIC_WS_URL=https://yourdomain.com`
5. Update Discord redirect URI to `https://yourdomain.com/api/auth/callback/discord`
6. Open firewall port 443
7. `docker compose -f docker-compose.yml up -d` — Caddy auto-provisions HTTPS via Let's Encrypt

## Quality Checks

```bash
npm test
npm run typecheck
npm run build
```

## Backups

Run `./scripts/backup-sqlite.sh` to create a timestamped SQLite backup in `./backups`.

## Project Structure

```
packages/
  bot/          Discord bot (discord.js + better-sqlite3)
  web/          Next.js web dashboard (App Router, TailwindCSS v4)
  ws/           Socket.IO WebSocket server (draft real-time updates)
  shared/       Shared library (database schema, services, types)
  duel-server/  Private Normal/Domain 1v1 engine host (canonical data in `data/duel-engine`)
```
