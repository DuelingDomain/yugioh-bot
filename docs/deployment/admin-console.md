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
| Stats | Sign-ups, active users, duels and drafts started and finished: today and the last 7 days. Days are UTC | SQLite | `DISCORD_GUILD_ID` |
| Errors | Error count for the last 24 hours and the latest issues | Sentry API | `SENTRY_API_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
| Usage | Visitors today and for 7 days, page views, top pages, a link to the dashboard | PostHog query API | `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` |
| System | Deployed version, card-data update state, health of web, duel server, ws, worker, bot and database, disk space (total, used, free, what uses it, warnings) | SQLite, duel host `/internal`, ws `GET /health`, `SENTRY_RELEASE`, worker disk snapshot | `DUEL_INTERNAL_URL`, `DUEL_INTERNAL_SECRET`, `WS_INTERNAL_URL`, `SENTRY_RELEASE` |

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

## Create the keys

1. Clerk. Nothing new. The web already has `CLERK_SECRET_KEY`. The console uses it to list waitlist entries and to call invite and reject.
2. Sentry. Open Settings, Developer Settings, Custom Integrations (or User Auth Tokens). Create an internal integration or token with read-only scopes: `project:read`, `event:read`, `org:read`. Do not use the source-map upload token (`SENTRY_AUTH_TOKEN`); that one is a CI secret and has write scopes. Put the token in `SENTRY_API_TOKEN`.
3. PostHog. Open Account settings, Personal API keys. Create a key for the one production project, with read-only scope `query:read`. The worker already uses `POSTHOG_PERSONAL_API_KEY` to write persons: if you keep one key for both, give it both scopes. Put the project ID in `POSTHOG_PROJECT_ID`.

Restart the web service after a change: the variables are read at run time.

## Presence and privacy

Signed-in pages send a small heartbeat every 60 seconds while the tab is visible. It sends only a page template from a fixed list (for example `/duels/[slug]`), never a full URL, query or ID. The server accepts at most one heartbeat per user every 30 seconds, or every 10 seconds when the page template changed, so the Online now label follows navigation.

Only the latest value is stored per user (`users.last_seen_at`, `users.last_route`). The worker deletes values older than 24 hours. Deleting an account clears them at once. The table type shown for duels ("4-way duel") is looked up on the server from the user's open table; it is not sent by the browser. The privacy page says this.

To turn it off, set `PRESENCE_ENABLED=0` and restart web.

## Waitlist emails

The browser hides waitlist emails until the owner chooses Show emails, but masking is a UI feature only. The waitlist JSON that `/api/admin/console/waitlist` sends to an owner's browser holds the full email addresses, so they are visible in the network tab. The route is for owners only (`OWNER_USER_IDS`); do not add anyone you would not trust with the waitlist.

## Local checks

- Integration tests: `npx vitest run packages/web/tests/admin-console -c packages/web/vitest.config.ts`. They use a real SQLite file and stub Clerk, Sentry and PostHog at the network edge.
- Browser test: `E2E_ADMIN_CONSOLE=1 E2E_OWNER_USER_IDS=101 E2E_SLOT=N E2E_WORKERS=1 npx playwright test tests/admin-console.spec -c packages/e2e/playwright.config.ts`. `E2E_ADMIN_CONSOLE=1` gives the stack fake keys and a fetch stub (`packages/e2e/stack/admin-stubs.mjs`) for Clerk, Sentry and PostHog. `E2E_OWNER_USER_IDS=101` makes the first test player the owner.
- The Sentry and PostHog calls were checked against fakes only. Check each panel once with the real keys after the first deploy.
