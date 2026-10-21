# Admin console

The admin console is at `/admin` in the app. Only owners can open it. Everyone else gets a 404, on the page and on every `/api/admin/console/*` route.

Owners are the users in `OWNER_USER_IDS` (application `users.id` values, comma separated). The same variable is used by the web, ws and duel services.

All keys are read on the web server only. They are never sent to the browser and never logged. Every section works alone: when its keys are missing, that panel shows "not configured" and the rest of the page still works.

## Sections

| Section | Shows | Source | Needs |
| --- | --- | --- | --- |
| Online now | Signed-in people seen in the last 2 minutes, the page each one is on, a count per page group | `users.last_seen_at` / `users.last_route` (SQLite) | Nothing (on by default) |
| Waitlist | Pending sign-up requests, emails masked in the UI (see Waitlist emails), Approve and Reject with a confirm step | Clerk waitlist API | `CLERK_SECRET_KEY` |
| Live duels and drafts | Open and running tables and drafts, newest first, with links | SQLite | `DISCORD_GUILD_ID` |
| Duels today | Every duel that started today (from 00:00 in the browser time zone: `?start=` local midnight in epoch ms, and `?tz=` minutes east of UTC, clamped to ±14 h, for the label): format, ranked or casual, players with Won/Lost/Draw, result, turns, length, start time, and Replay (ended) or Watch (running). At most 200 rows; the filter counts cover the whole day. The Overview "Duels today" figure is this count and links to the list (`/admin#duels-today`) | SQLite | `DISCORD_GUILD_ID` |
| Stats | Sign-ups, active users, duels and drafts started and finished: today and the last 7 days. Days are UTC | SQLite | `DISCORD_GUILD_ID` |
| Errors | Error count for the last 24 hours and the latest issues | Sentry API | `SENTRY_API_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| Usage | Visitors today and for 7 days, page views, top pages, a link to the dashboard | PostHog query API | `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` |
| System | Deployed version, card-data update state, health of web, duel server, ws, worker, bot and database, disk space (total, used, free, what uses it, warnings), VPS health and capacity history | SQLite, duel host `/internal`, ws `GET /health`, `SENTRY_RELEASE`, worker disk snapshot | `DUEL_INTERNAL_URL`, `DUEL_INTERNAL_SECRET`, `WS_INTERNAL_URL`, `SENTRY_RELEASE` |

The summary strip at the top shows six figures: Online now, Live duels, Pending waitlist, Errors in the last 24 hours, Sign-ups today and System ("OK", or the number of problems: a service down or stale, or disk space at warn or fail). Each one links to its section. A figure turns gold when the waitlist has people waiting, and orange when there are errors or system problems. A figure shows a dash when its section is not configured or failed.

Panels refresh on their own (10 to 60 seconds, by section) and stop while the tab is hidden. Each panel has an "Updated Xs ago" line. Deep links work: `/admin#waitlist`, `/admin#errors` and so on.

## Environment

Compose passes all of these to the `web` service. Put them in the VM `.env` (see `.env.example`).

| Variable | Used for | Notes |
| --- | --- | --- |
| `OWNER_USER_IDS` | Who can open `/admin` | Already set in production |
| `PRESENCE_ENABLED` | Presence heartbeat and Online now | Default `1`. `0` stops the heartbeat and the endpoint stores nothing (204); Online now empties after 2 minutes |
| `CLERK_SECRET_KEY` | Waitlist list, approve and reject | Already set (required by web). Same key as for sign-in |
| `DISCORD_GUILD_ID` | Scope of Live and Stats | Already set |
| `DUEL_INTERNAL_URL`, `DUEL_INTERNAL_SECRET` | Duel server health in System | Already set |
| `WS_INTERNAL_URL` | ws health in System (`GET /health` on the internal port) | Already set on web |
| `SENTRY_RELEASE` | Version in System | Already set by the production deploy (the git SHA) |
| `SENTRY_API_TOKEN` | Errors section | New. Read-only token, see below |
| `SENTRY_ORG` | Errors section | Organization slug. Also used for source-map upload |
| `SENTRY_PROJECT` | Errors section | Project slug. A comma-separated list is allowed: use both web projects |
| `SENTRY_BASE_URL` | Errors section | Optional. `https://de.sentry.io` for the EU region. Default `https://sentry.io` |
| `POSTHOG_PERSONAL_API_KEY` | Usage section | Read-only query scope, see below |
| `POSTHOG_PROJECT_ID` | Usage section | Numeric project ID |
| `POSTHOG_HOST` | Usage section | Optional. The EU ingest host (`eu.i.posthog.com`) is mapped to the API host (`eu.posthog.com`) |
| `POSTHOG_DASHBOARD_URL` | Usage section | Optional. The "Open PostHog" link |

The worker must run the new build too. It writes a heartbeat row on each health tick and clears old presence every 10 minutes. The disk measurement runs once an hour, because it walks the whole data folder including the image cache. Until it runs, System shows "No heartbeat yet" for the worker. The worker also measures disk use (the database folder, `CARD_IMAGE_CACHE_DIR`, `DUEL_DATA_DIR` and the backups) and stores a snapshot in SQLite (`disk_usage_snapshot`, `disk_usage_history`); the web only reads it. The worker container needs read access to those folders. Until the first snapshot, the disk line is empty.

## VPS health

System includes a separate VPS health panel next to the existing disk diagnostics. Its owner-only `GET /api/admin/console/vps-health` route uses `web-access.ts` and `isOwnerUser`, the same guards as the console. (`discord-web-access.ts` was replaced by the application identity guard.) Responses are private/no-store. Live duel and draft counts are scoped to `DISCORD_GUILD_ID`; CPU, memory, worker reservations, replay queue and sockets are VPS-wide totals and the UI labels their scope.

- Host: CPU usage from deltas of `/proc/stat` (100% = the whole host), logical vCPU count, 1/5/15-minute load averages, RAM used/available/total and percentage from `MemAvailable`, swap used/total (or “No swap”), and host uptime. The CAX11 baseline is 2 ARM vCPU, 4 GB RAM, no swap; the panel reads actual values instead of hard-coding that baseline.
- Services: ws, duel, web and worker report their own cgroup v2 `memory.current`, `memory.max`, `memory.events` `oom_kill` counter, and CPU deltas from `cpu.stat` `usage_usec`. Service CPU 100% means one vCPU, so a service can exceed 100%. Limits are read from the running cgroup, including the ws 384 MiB and duel 1 GiB Compose defaults; an unlimited/unreadable limit is “n/a”. The panel does not assume a worker memory limit: this revision of Compose leaves it unlimited (the 256 MiB limit belongs to bot). Systemd services with a dedicated `.service` cgroup work too; a shared native login scope, absent proc files, or unsupported cgroup versions show “n/a”. CPU needs two samples.
- Capacity: active play duels and active drafts in this guild; actual engine pool reservations in use versus `DUEL_MAX_WORKERS` (12 by default), queued replay rebuilds, and connected ws transport sockets. Reservations include live games, replay work and workers still closing; a duel database row alone does not prove an engine thread is running. These are resource counts, not distinct people.

Every service reports once a minute into `vps_service_health` in the already shared SQLite database. Web starts its reporter from Node instrumentation, independently of admin page visits. The worker reads host proc metrics, reports its own cgroup, imports Caddy’s report and saves one aggregate minute bucket in `vps_health_history`. Retention deletes buckets older than 24 hours and bounds history to 1,440 rows (a few MiB). History survives process/worker restarts. Browser polling is once a minute while visible; the route reads SQLite only. Disk sampling keeps its existing hourly directory walk.

Caddy has no SQLite dependency. Compose runs `scripts/deployment/caddy-vps-health.sh` alongside its normal Caddy command. The script reads only Caddy’s own cgroup and atomically writes a small JSON snapshot to the private `vps_health` named volume; the worker mounts that volume read-only. There is no public metrics endpoint, Docker socket, privileged container, or host cgroup mount. No new secrets or configuration keys are required. Deploy the updated worker, ws, duel, web **and Caddy** together so all reporters start.

The status is:

| Status | Trigger |
| --- | --- |
| OK | Fresh host measurements with no current or sustained pressure detected |
| High | Current host RAM >80%, host CPU >85%, 1-minute load >vCPU count, engine reservations at least two-thirds of capacity (8/12), or a nonempty replay rebuild queue |
| Upgrade soon | RAM >80% for 15 continuous minutes; 1-minute load >vCPU count for 15 continuous minutes; engine reservations at least two-thirds of capacity in 15 distinct sampled minutes of the last hour; or any service OOM kill reported in retained 24-hour history |
| n/a | No worker snapshot yet, snapshot over 3 minutes old, or required host RAM/load/vCPU metrics unavailable |

No gap longer than 90 seconds counts toward continuous host pressure. Multiple collections in the same minute replace that bucket; repeated old duel reports do not count as distinct pressure minutes. Reports older than 3 minutes show “n/a” and cannot trigger current pressure. OOM reasons remain visible when measurements go stale. An OOM counter is cumulative for the current cgroup: a nonzero count remains an upgrade signal until that cgroup resets and its last observation expires from history. An OOM can mean a service limit needs adjusting; inspect that before deciding to upgrade the VPS. Events that occur and reset entirely between samples cannot be observed. A new deployment needs at least 15 minutes of history to establish sustained host pressure. Sparklines show CPU, RAM, load and engine workers over 24 hours, with gaps for missing samples; dashed lines mark pressure thresholds. The coverage disclosure lists missing services.

The Discord bot writes `bot_heartbeat(id, at, pid)` when enabled. System reads `at` in epoch milliseconds. A missing table shows "Not deployed"; an empty table shows "No heartbeat yet"; a heartbeat older than 3 minutes shows "Late". With `DISCORD_BOT_ENABLED=0`, the bot container stays idle and writes no heartbeat.

## Create the keys

1. Clerk. Nothing new. The web already has `CLERK_SECRET_KEY`. The console uses it to list waitlist entries and to call invite and reject.
2. Sentry. Open Settings, Developer Settings, Custom Integrations (or User Auth Tokens). Create an internal integration or token with read-only scopes: `project:read`, `event:read`, `org:read`. Do not use the source-map upload token (`SENTRY_AUTH_TOKEN`); that one is a CI secret and has write scopes. Put the token in `SENTRY_API_TOKEN`.
3. PostHog. Open Account settings, Personal API keys. Create a key for the one production project, with read-only scope `query:read`. The worker already uses `POSTHOG_PERSONAL_API_KEY` to write persons: if you keep one key for both, give it both scopes. Put the project ID in `POSTHOG_PROJECT_ID`.

Restart the web service after a change: the variables are read at run time.

## Presence and privacy

Signed-in pages send a small heartbeat every 60 seconds while the tab is visible. It sends only a page template from a fixed list (for example `/duels/[slug]`), never a full URL, query or ID. The server accepts at most one heartbeat per user every 30 seconds, or every 10 seconds when the page template changed, so the Online now label follows navigation.

Only the latest value is stored per user (`users.last_seen_at`, `users.last_route`). The worker deletes values older than 24 hours. Deleting an account clears them at once. The table type shown for duels ("4-way duel") is looked up on the server from the user's open table; it is not sent by the browser. The privacy page says this.

A person shows "in a duel" only on a duel page, while they hold a seat at an open table: not after the duel ends, and not after they surrendered or were eliminated while the others play on. On a duel page without such a seat the label is "Duel page". When a duel or draft tab closes (`pagehide`), the browser sends one `leave` beat with the same page template; the server then stores `/app` for that person, so the table label ends at once. The person still counts as online until 2 minutes after the last heartbeat. Lag: navigating to another page inside the app shows within about 10 seconds (route-change beat) plus the 10-second console poll; a closed tab shows within the console poll; a tab that is only hidden keeps the table label until the 2-minute window ends. Known case: with two tabs on the same kind of table page (for example two duel pages), closing one clears the label for the other too; the open tab sets it again with its next heartbeat (within about a minute). A page that comes back from the back-forward cache sends a heartbeat at once.

"Duels today" starts at the browser's local midnight: the console sends it as `start` (epoch ms), which is right on a daylight-saving day. The server accepts it only from 26 hours ago to now; otherwise it uses midnight of `tz`. `tz` also names the zone in the heading.

To turn it off, set `PRESENCE_ENABLED=0` and restart web.

## Waitlist decisions

The waitlist route resolves the entry email by ID from the cached Clerk list on the server and calls the shared `decideWaitlistEntry` service with the authenticated owner and source `admin`. Client email and actor fields are ignored. The same lease protects decisions from the console and Discord. The panel shows a short result for `ok`, `already_decided`, `conflict`, and `in_progress`, then refreshes the list. A decision queues a Discord edit when an alert exists; it creates no edit without an alert. The schema upgrade keeps existing decisions and outbox links while adding the `admin` source.

## Waitlist emails

The browser hides waitlist emails until the owner chooses Show emails, but masking is a UI feature only. The waitlist JSON that `/api/admin/console/waitlist` sends to an owner's browser holds the full email addresses, so they are visible in the network tab. The route is for owners only (`OWNER_USER_IDS`); do not add anyone you would not trust with the waitlist.

## Local checks

VPS health checks (no real credentials, Docker socket or engine data):

- `npx vitest run packages/shared/tests/health/vps-health.integration.test.ts` — temporary proc/cgroup files, real SQLite persistence/retention, CPU deltas, native fallback and status thresholds.
- `npx vitest run tests/vps-health.integration.test.ts -c vitest.config.ts` from `packages/worker` — real Caddy shell report, worker ingestion, CPU delta, staleness and sampler shutdown.
- `npx vitest run tests/vps-health.integration.test.ts -c vitest.config.ts` from `packages/duel-server` — real engine pool reservations, replay queue/release/cancellation and persisted capacity (no engine resources).
- `npx vitest run packages/web/tests/admin-vps-health.integration.test.ts packages/web/tests/admin-console-system.integration.test.ts -c packages/web/vitest.config.ts` — owner/session guard, privacy, guild scope, rendered diagnostics and existing disk/service regressions.

Existing console checks:

- Integration tests: `npx vitest run packages/web/tests/admin-console -c packages/web/vitest.config.ts`. They use a real SQLite file and stub Clerk, Sentry and PostHog at the network edge.
- Browser test: `E2E_ADMIN_CONSOLE=1 E2E_OWNER_USER_IDS=101 E2E_SLOT=N E2E_WORKERS=1 npx playwright test tests/admin-console.spec -c packages/e2e/playwright.config.ts`. `E2E_ADMIN_CONSOLE=1` gives the stack fake keys and a fetch stub (`packages/e2e/stack/admin-stubs.mjs`) for Clerk, Sentry and PostHog. `E2E_OWNER_USER_IDS=101` makes the first test player the owner.
- The Sentry and PostHog calls were checked against fakes only. Check each panel once with the real keys after the first deploy.
