# Architecture

A short map of the system. The code is the source of truth; this page tells you where to look.

More detail:

- [Data flow](data-flow.md): how data passes between the browser, the services and SQLite.
- [Infrastructure](infrastructure.md): what the system runs on, and how a release reaches the VM.
- [Draft engine](draft-engine.md). Card data: [pre-release cards](card-data/prerelease-cards.md), [Genesys points](card-data/genesys-points.md). Effect search: [artifact](effect-search/artifact.md), [CI tagging](effect-search/tagging.md), [format staples](effect-search/format-staples.md).

## 1. The platform

```mermaid
flowchart LR
  user([Browser]) -->|HTTPS| caddy[Caddy :443]
  caddy -->|app pages + /api| web[web<br/>Next.js :3000]
  caddy -->|app /socket.io| ws[ws<br/>Socket.IO :3001]
  caddy -->|marketing host| site[site/public<br/>static files]
  caddy -->|marketing POST /api/waitlist only| web
  web -->|session + Backend API| clerk[Clerk<br/>auth + waitlist]
  web -->|signed /internal/duel| duel[duel<br/>engine host :4003]
  web & duel -->|signed /internal/* :4002| ws
  web & duel --> db[(SQLite<br/>data/bot.sqlite)]
  worker[worker<br/>timers + cron] --> db
  worker -->|signed updates| ws
  worker -->|set metadata| ygo
  bot[bot<br/>admin Discord bot] --> db
  bot -->|Gateway + REST| discord([Discord])
  duel --> bundle[[Engine bundle<br/>data/duel-engine]]
  web -->|card data + images| ygo([ygoprodeck.com])
```

| Box | Job | Code |
|---|---|---|
| web | Pages, API routes, custom Clerk sign-in | `packages/web` |
| ws | Live pushes only. Never carries hidden game data | `packages/ws` |
| bot | Admin Discord bot: moderation, server, waitlist, community. Off unless `DISCORD_BOT_ENABLED=1`. No inbound port | `packages/bot` |
| duel | Runs the rules engine. Private, internal port only | `packages/duel-server` |
| worker | Draft expiry, report approval, tournament deadlines, set sync, image eviction | `packages/worker` |
| e2e | Isolated web/WS/duel/worker with offline signed-cookie login | `packages/e2e` |
| shared | DB schema and all business services | `packages/shared` |

There are seven packages. Run `npm run dev:worker` alongside web/WS/duel and `npm test --workspace=packages/worker` after building shared. Exactly one worker uses each SQLite file. Startup sweeps catch durable deadlines; SIGTERM drains in-flight work. The bot runs in Compose as an admin Discord bot ([ADR 0006](../adr/0006-admin-discord-bot.md)). Only literal `DISCORD_BOT_ENABLED=1` starts it. It owns no gameplay scheduler. The duel host retains its engine clocks and archive/series sweeps.

`users.id` is application identity, `players.user_id` links to it, and gameplay player IDs stay unchanged. Owners/creators are integer user IDs; `session.user.id` is their decimal string and `session.user.discordUserId` is nullable. Clerk sessions resolve through one server resolver, syncing missing/stale/forced profiles and linking verified Discord identities transactionally. Email-only users work without Discord checks. Draft tokens use application IDs; duel tokens still use player IDs. Creators manage their resources. Owners (`OWNER_USER_IDS`) also get the `/admin` console. Seasons/imports/merges use `node packages/worker/dist/ops/cli.js` on the VM.

All DB consumers use the same absolute `DATABASE_PATH`. `openDatabase` enables WAL, a 5000-ms busy timeout and foreign keys. Worker/web share an absolute image-cache path; worker publishes committed WS state with Discord effects disabled. The worker has no public port and uses a local heartbeat healthcheck. E2E supervises four processes per isolated DB/cache/heartbeat, authenticating offline with an expiring HMAC-signed `dd_e2e_session` cookie (literal `E2E_AUTH=1` and ≥32-character secret only).

All internal calls use v2 HMAC-signed POSTs (`shared/src/internal-auth/request.ts`) with the `x-internal-signature` header and the receiver's purpose (`ws-broadcast`, `duel-host` or `bot-announce`). Ports 4002 and 4003 are never public. The bot has no inbound port; the old port 4001 announce server is removed.

`SITE_DOMAIN` is the app host (production `app.duelingdomain.com`, marketing `duelingdomain.com`, legacy `duelistskingdom.com`); `WEB_URL` is its required canonical origin and WS CORS origin. Optional `MARKETING_DOMAIN` serves static files, redirects `/login` to the app, and permits only the exact waitlist POST upstream; its `www` redirects to the marketing apex. `LEGACY_DOMAIN` and its `www` preserve paths/queries in a 308 to the app. Unset extra domains use reserved `.localhost` defaults, leaving existing public routing unchanged. Exact `POST /api/waitlist` stores normalized emails locally then creates Clerk waitlist entries with notification; retryable Clerk failure returns 503 `retry_later` (native form redirects to the retry outcome) and retains the local row. Owner reconciliation handles existing signups. Exact `GET /api/auth/session` returns 200 `null` anonymously. Custom `/sign-in`, `/sign-up`, `/sso-callback`, `/access`, legacy `/login`, assets/icons and enabled FX-lab paths are public; test-auth routes require the isolated E2E gate. Legal links point to marketing `/privacy` and `/terms`. See [domains](../deployment/domains.md).

Compose runs web/WS/duel/worker/bot/Caddy, fixes `DISCORD_BOT_ENABLED=0` on web and worker, and injects only explicit web env variables. Disabled channel/announce routes return 404 `discord_disabled`; gameplay commits and WS updates continue. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` goes only to the web build/dev process, `CLERK_SECRET_KEY` only to web runtime or explicitly authorized one-off owner CLI runs. Production never uses dev keys.

Optional owner alerts use a private Discord channel webhook, independent of the bot. The shared waitlist service starts an alert after a new local signup. Exact `POST /api/webhooks/clerk` bypasses session middleware and verifies the Svix signature with `CLERK_WEBHOOK_SIGNING_SECRET`. It handles `waitlistEntry.created` and optional `user.created` events, including entries from owner reconciliation. SQLite alert claims deduplicate normalized emails by alert type; Svix receipts deduplicate deliveries. Discord runs in the background with a two-second timeout per attempt and one 429 retry. See [owner setup and delivery limits](../deployment/discord-join-alerts.md).

## 2. The duel engine

```mermaid
flowchart TB
  host[host.ts<br/>op switch + per-duel queue] --> worker[Engine worker<br/>one thread per duel]
  worker --> pick{Seats and engine choice?}
  pick -->|2: Domain, DUEL_1V1_ENGINE=legacy| legacy[Legacy core<br/>Domain Compose default]
  pick -->|2: Standard, DUEL_STANDARD_1V1_ENGINE=pinned| pinned[Pinned core<br/>Standard Compose default]
  pick -->|3 or 4: Tag, FFA3, FFA4| multi[Multi core<br/>+ Lua overlay]
  legacy & pinned & multi --> lua[Card scripts<br/>Lua + cards.cdb]
  worker --> views[views.ts<br/>one redacted view per seat]
  host --> journal[(duel_commands<br/>journal)]
  host --> clock[Clock, bots, RPS opening]
```

**One action, start to end**

1. The host checks the `promptId` and `revision`. A stale answer gets 409.
2. The worker feeds the answer to the WASM core.
3. The host appends the command to the journal in SQLite.
4. The host builds a view for each seat. Hidden cards are removed.

**Cores.** Each core has a Standard and a Domain (Deck Master) build.

| Core | Used for | File |
|---|---|---|
| Legacy | Domain 1v1 Compose default (`DUEL_1V1_ENGINE=legacy`); Standard with `DUEL_STANDARD_1V1_ENGINE=legacy` | npm `ocgcore-wasm`, `ocgcore.domain.legacy.wasm` |
| Pinned | Standard 1v1 Compose default (`DUEL_STANDARD_1V1_ENGINE=pinned`); Domain with `DUEL_1V1_ENGINE=pinned` | `ocgcore.standard.wasm`, `ocgcore.domain.wasm` |
| Multi | Tag, 3-way, 4-way | `ocgcore.multi.wasm`, `ocgcore.multi-domain.wasm` |

Native runs with a missing, empty or invalid Standard override use `DUEL_1V1_ENGINE` (default `legacy`).
Compose uses `pinned` for a missing or empty Standard value. Each game of a series reads the switch at its start;
recover and replay keep that game's saved engine. See [the engine switch](../deployment/duel-engine-switch.md).

**Engine data.** `scripts/prepare-data.ts` pins the card DB (BabelCDB), strings and Lua scripts (ProjectIgnis CardScripts). `manifest.json` holds the hashes and the `bundleVersion`. The server checks the bundle at start.

**Restart safety.** Live state is in worker memory. SQLite keeps the seed and the command journal. `recover()` replays the journal on a fresh worker. A replay needs the same `bundleVersion`.

## 3. Engine to screen

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as web /api/duels
  participant D as duel host
  participant S as ws
  B->>W: POST /actions {promptId, revision, answer}
  W->>W: session + community + room access
  W->>D: signed op "respond"
  D->>D: core runs, journal saved
  D->>S: /internal/duel/changed {slug}
  S-->>B: duel:changed (no game data)
  B->>W: GET /api/duels/{slug}
  W->>D: op "view" (seat from DB)
  D-->>W: view for my seat + events
  W-->>B: view for my seat + events
  B->>B: FX queue: move, summon, destroy
```

- The socket only says "something changed". The browser then asks for its own view.
- The seat always comes from the DB. A client cannot act for another seat.
- If the socket is down, the page polls (1 s offline, 10 s live).
- A 5-minute signed token (`/connection`) lets a tab join the duel room.
- FX: `event-queue.ts` → `effect-sequence.ts` → `MoveFx`, `SummonFx`, `DestroyFx`.

## 4. What we added for Tag, 3-way and 4-way

| Layer | Added | Where |
|---|---|---|
| Core | ~91 patches: seat arrays, teams, elimination, team LP, opponent binding, FFA attack rules, clockwise chain order, leaving | `duel-server/domain-core/patches/` |
| Core | Domain multi core: Deck Master for 3 and 4 seats | `build-multi-core.sh`, `apply-domain-multi.mjs` |
| Core | FFA4: facing seats (0+1, 2+3) share Extra Monster Zones and columns | patches 0077, 0105 |
| Scripts | Lua overlay: ~580 card fixes + `mp-utility.lua`. 1v1 never loads it | `domain-core/multi-scripts/` |
| Host | Formats, seat counts, teams, opponents | `shared/src/duels/settings.ts` |
| Host | Seat lobby, practice bots, ready, start | `shared/src/services/duels.ts` |
| Host | Attack-target pick, surrender, timeouts, autopilot for out seats | `attack-target-pick.ts`, `host.ts` |
| Host | Flag `MULTIPLAYER_TABLES` (Compose: on) | `shared/src/duels/multiplayer-tables.ts` |
| Rules | Rule list and tests | `docs/adr/0002`, `docs/specs/multiplayer-rule-coverage.md` |
| UI | 3-way and 4-way: Plaza table, aim arrow, seat crumble | `web/src/components/duel/table/` |
| UI | 4-way 2x2 grid and the FFA3 facing pair (seats 0+1 share one Extra Monster Zone row; seat 2 has its own). A seat that is out crumbles and its place stays empty; fields never move or join and the camera never zooms by itself. The column pick has no UI; the ordinary "choose an opponent" prompt keeps its pick buttons | `web/src/components/duel/table/grid-stage.tsx`, `grid-layout.ts` |
| UI | Tag 2v2: Rooftop, shared team LP | `web/src/components/duel/tag/` |

## 5. How a player uses the site

```mermaid
flowchart LR
  login[Sign in<br/>Clerk] --> dash[Dashboard]
  dash --> cubes[Cubes<br/>build a pool]
  dash --> draft[New draft<br/>web]
  cubes --> draft
  draft --> room[Draft room<br/>live picks]
  room --> deck[Deck builder]
  deck --> tour[Tournament<br/>web]
  deck --> duel[Duel lobby<br/>1v1, Tag, 3-way, 4-way]
  tour --> duel
  duel --> table[Table<br/>live duel]
  table --> result[Results, Elo,<br/>leaderboard, replay]
```

## More

- Rules for multiplayer: [ADR 0002](../adr/0002-multiplayer-duel-rules.md). Test layers: [ADR 0003](../adr/0003-duel-test-layers.md).
- Data flow: [data-flow.md](data-flow.md). Infrastructure: [infrastructure.md](infrastructure.md).
- Draft dealing: [draft-engine.md](draft-engine.md). Core ABI: [engine/ocgcore-wasm-abi.md](../engine/ocgcore-wasm-abi.md).
- Deploy and ops: [deployment/vm-runbook.md](../deployment/vm-runbook.md), [deployment/duel-engine-switch.md](../deployment/duel-engine-switch.md).
- Weekly card data updates: [deployment/engine-data-updates.md](../deployment/engine-data-updates.md).
- Every scheduled or recurring job, with manual run steps: [runbooks/README.md](../runbooks/README.md).

## Card artwork selection

The duel server owns selectable artwork identity: only passcodes in its `cards.cdb` artwork alias family may enter a deck picker. The authenticated web artwork route merges that family with `card_artworks` API metadata and the existing image cache, returning only local cached-image route URLs (nullable when availability is unknown). Search stays one result per card and includes `altArtCount`. Deck storage preserves selected engine passcodes; draft-pool checks canonicalize both sides without rewriting the art choice. Explicit cube rows can swap same-family artwork while retaining copy counts.

See [the picker backend contract](../api/alt-art-picker.md) for exact routes, types, alias edge cases, and the resumable `npm run backfill:artworks --workspace=packages/shared -- --database … --dump … --state …` maintenance command. The backfill downloads one full metadata dump, syncs existing catalog families, and does not fetch images. It must be run explicitly; no production backfill is part of this implementation.

## Stored duel boards

Terminal duels keep the public final board and each seat's own final board. All server readers use `services/stored-duel-snapshots.ts`. Each snapshot column can hold old JSON TEXT or gzip BLOB bytes. SQLite permits BLOB values in the existing TEXT-affinity columns. The codec accepts both forms. No board, event, or log data is removed. Finished-room history and last-damage displays still read `events`; bug context uses only the public board's last log lines.

New writes use JSON. A complete `snapshot_seats_json` list supersedes the two legacy seat columns for FFA3, FFA4, and Tag. Those new rows leave `snapshot_seat0_json` and `snapshot_seat1_json` null. Incomplete lists retain legacy seat columns. Two-seat final writes retain their existing three columns. The nullable `turn_count` column records the final turn. Active casual cancellation saves the live turn, falling back to the saved clock before clearing it. History reads this column with a bounded metadata-prefix fallback for old JSON rows until the age-independent turn backfill reaches them. The backfill runs even while compression is disabled.

The duel host runs snapshot retention separately from its frequent archive sweep. Its first pass starts after one minute. Later passes use these settings, also passed to the duel container by Compose:

| Variable | Default | Effect |
| --- | --- | --- |
| `DUEL_SNAPSHOT_RETENTION_ENABLED` | `0` | `1` or `true` enables compression and cancelled-fork deletion. Turn-only backfill still runs while disabled. Checked between rows and before writes. |
| `DUEL_TURN_BACKFILL_ENABLED` | `1` | `1` or `true` enables turn-only backfill, independently of retention. Checked between rows and before writes. Set both switches to `0` to stop storage maintenance writes. Recreate the duel container after changing Compose settings. |
| `DUEL_SNAPSHOT_RETENTION_DAYS` | `30` | Compress terminal boards after this many days from `ended_at`. Nonnegative integer. |
| `DUEL_SNAPSHOT_RETENTION_INTERVAL_MS` | `21600000` | Time between passes (6 hours). Minimum 60000; maximum 2147483647. |

A pass first backfills terminal turn counts without an age limit when its switch is on, even when retention is off. It writes only the count and skips rows with no snapshot or clock. The host retains the ID cursor across passes, advances past unreadable turns, and resets it only after a select finds no rows. After a scan wraps, the host waits at least one hour before a new full turn scan. Compaction and fork cleanup continue during this delay. A busy read or write leaves its row for the next pass. History scans a bounded JSON prefix until the backfill reaches a row; SQLite `substr()` still reads the full TEXT value, including overflow pages. Once `turn_count` is set, `coalesce` skips this read. Compaction selects IDs and fetches one full row at a time within its byte budget. A pass prepares gzip data outside its write transactions. It yields between rows, caps an update batch at 50 rows and 4 MiB of input bytes (one larger row can proceed alone), and waits 100 ms between batches. A pass processes at most 20 update batches. Maintenance writes use zero busy timeout; a held lock defers work to the next pass. The connection's normal timeout is restored in `finally`. Conditional updates check the original board bytes and terminal metadata to protect concurrent changes.

`snapshot_compacted_at` marks processed rows, including rows with unreadable values. The job preserves unreadable bytes and can derive turns from other saved views or the old clock. This stamp makes each pass resumable and avoids repeated work. After an operator repairs a stored value, clear its stamp to process it again. Migration adds columns and indexes; it does not backfill counts, compress boards, or remove duplicate values during service startup.

For old multiplayer rows, a complete valid seat list supersedes the legacy seat copies, even if those copies differ. All readers already select the list first. Only then does the job null the copies. Gzip preserves the original JSON bytes. Replay cache keys hash stored bytes with encoding tags: compression, deduplication, or a board change invalidates the cache. Room, admin reveal, replay result, saved-board fallback (413 or unavailable source engine), and bug-context reads all use the same codec.

Each pass can delete at most 50 replay forks that are cancelled and ended more than 7 days ago. Deletion skips forks with queued host work, including asynchronous restart preparation and creator launch-retry queues. Each phase logs and isolates row failures. Error logs include only the phase, error name and code. Pass statistics expose progress and busy deferrals. `turnBackfillDone` means the cursor reached the end of its scan, or the backfill is disabled. Unreadable turns remain null and can be retried on the next scan. `backlogDone` includes this flag and the enabled compaction and fork phases; the host logs backfill progress and completion even while retention is off. It requires enabled foreign keys and no series link; the final DELETE rechecks these row guards. Each fork gets a separate transaction and a yield. Commands, seats, invite grants, and retry records cascade through indexed foreign keys. Fork source references are copied metadata or strings; the source is preserved. Active, completed, and interrupted forks are kept. Restart clears the count and compaction stamp. The host permits one pass at a time and waits for it at shutdown.

Compression frees SQLite pages for reuse. It does not shrink the database file. See the [manual VACUUM procedure](../deployment/vm-runbook.md#manual-duel-storage-vacuum) to return space to the file system. Retention defaults off for this release. Keep it off until all snapshot-reading services use the codec and a stable codec release is available for rollback, then enable it and recreate the duel container. After retention has run, roll back only to a release that has the codec. Older saved-board readers show no final board and no history turn count for compressed rows, and the old eliminated-spectator reader can return HTTP 500 on gzip BLOBs.

To repeat the synthetic measurement with Node 22 and dependencies installed:

```bash
prlimit --core=0 node --import tsx scripts/measure-duel-storage.ts
```

The fixture uses 40 synthetic card definitions, final public and own-seat projections, and bounded event/log histories. It contains no production data. Its repeating text compresses well; these figures are test measurements, not production estimates. Before means all old snapshot columns; after means deduplication plus gzip. Bytes exclude SQLite page and journal overhead.

| Format | Before bytes | After dedup bytes | After gzip bytes | Saved | Public-board events | Public-board log |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1v1 | 305609 | 305609 | 14222 | 95.35% | 65.81% | 16.85% |
| FFA3 | 1093385 | 727715 | 30086 | 97.25% | 73.10% | 12.50% |
| FFA4 | 1947937 | 1390353 | 50884 | 97.39% | 79.37% | 8.14% |
| Tag | 1030265 | 734873 | 31839 | 96.91% | 60.60% | 15.55% |

Gzip bytes are 4.65%, 4.13%, 3.66%, and 4.33% of deduped JSON bytes, respectively. Keep events: the final-board UI uses them. The measurement script is separate from retention and never opens the database.
