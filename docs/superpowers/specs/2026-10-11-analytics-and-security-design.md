# Error reporting, internal request signing, hardening and product analytics

Owner decisions: **2026-10-09 to 2026-10-11.** Part 1 approved 2026-10-09; parts 2a, 2b and 3 approved 2026-10-11; consent mode A (cookieless).
Platform upgrades, security headers and deploy key isolation already shipped (PR #316, deployed 2026-10-11) and are out of scope here.
Path abbreviations: **S** = `packages/shared/src`, **W** = `packages/web`, **X** = `packages/ws/src`, **D** = `packages/duel-server/src`, **K** = `packages/worker/src`.

## Goals

- Every unexpected error in any process reaches Sentry (EU) with enough context to fix it and no personal data beyond `users.id`.
- Internal HTTP between services uses one signing module with one contract test suite.
- Close the remaining hardening items from the 2026-10-09 review (part 2b).
- Product analytics in PostHog (EU): trustworthy server events for the core flows and anonymous page views on key pages, with no cookies and no consent banner.

## Non-goals

- Zero-downtime deploys (separate work).
- Staging data and transport changes (deferred until staging is used again).
- Session replay, autocapture, feature flags, experiments, Sentry performance dashboards beyond default sampling.
- Enforcing the content security policy (stays report-only; switch after reviewing reports).

## Part 1: Observability module

**Location:** `S/observability`. One module, two functions, two adapters.

```ts
report(error: unknown, context?: ReportContext): void   // bugs: goes to Sentry when configured
log(level: "info" | "warn" | "error", message: string, fields?: LogFields): void
class ExpectedError extends Error { constructor(safeMessage: string, status: number) }
setObservabilityAdapter(adapter: ObservabilityAdapter): void   // called once per process at startup
```

- **Adapters.** Console adapter when `SENTRY_DSN` is empty (local, tests, e2e). Sentry adapter is created in each process's bootstrap (`@sentry/node` for ws, duel-server, worker, bot; `@sentry/nextjs` for web) and injected; `S` does not depend on a Sentry package.
- **Expected vs. unexpected.** `ExpectedError` carries a safe message and an HTTP status; it is returned to the caller and never sent to Sentry. Anything else is reported and the caller gets a generic 500 body (`{ "error": "Something went wrong" }`).
- **Redaction (in the adapter, before send).** Drop request bodies, cookies and `authorization`/`cookie`/`x-*-signature` headers. Strip email addresses, bearer/token-like strings, HMAC signatures and SQL text from messages and breadcrumbs. The only identity attached is `users.id`.
- **Engine workers.** Errors thrown inside duel-server worker threads are re-thrown on the main thread with the original stack and the Table slug as a tag.
- **Process bootstrap.** Node services load an instrument file through `node --import`, install `uncaughtException`/`unhandledRejection` handlers that report then exit, and flush (2 s cap) on SIGTERM. Compose sets `init: true` on these services.
- **Web wiring.** `instrumentation.ts` (server and edge configs), `instrumentation-client.ts`, `onRequestError = Sentry.captureRequestError`, `app/global-error.tsx`. Browser events go through the tunnel route `/monitoring`, which `proxy.ts` marks public.
- **Sentry settings.** EU data region, `sendDefaultPii: false`, `tracesSampleRate: 0.05`, no replay. `environment` from `SENTRY_ENVIRONMENT`; `release` is the deployed git SHA.
- **Source maps.** The production deploy uploads web source maps with `SENTRY_AUTH_TOKEN` (production environment secret) and deletes them from the image.
- **Migration scope.** Only error-path `console.error`/`console.warn` calls move to `report`/`log`. Routes that currently return raw error text switch to `ExpectedError` (part 2b item 3).
- **Env.** `SENTRY_DSN` (all server processes), `NEXT_PUBLIC_SENTRY_DSN` (web build arg), `SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN` (CI only). All empty means console only.

**Tests.** Through the interface: redaction cases, expected vs. unexpected routing, generic 500 body, console adapter output, worker-thread stack preserved. A web test asserts `/monitoring` is public and nothing else new is.

## Part 2a: Internal request signing module

**Location:** `S/internal-auth`. Replaces `S/notify/signed-post.ts`, `X/auth.ts`, the inline check in `D/host.ts` and the per-token HMAC code in `S/ws/*-token.ts`.

```ts
type Purpose = "ws-broadcast" | "duel-host" | "bot-announce";
type TokenPurpose = "duel-room" | "draft-room" | "tournament-room";

signedTransport(cfg: { url: string; secret: string; purpose: Purpose; timeoutMs?: number }): SignedPostTransport
readSignedRequest(req: Request, cfg: { secret: string; purpose: Purpose; maxBytes?: number }):
  Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 401 | 413 }>
signToken<C>(purpose: TokenPurpose, claims: C, secret: string): string
verifyToken<C>(purpose: TokenPurpose, token: string, secret: string, parse: (v: unknown) => C | null): C | null
```

- **Keys.** Each purpose derives its own key from the existing secret: `HMAC(secret, "yugidraft:<purpose>:v2")`. No `.env` changes. `draft-room` and `tournament-room` keep their current labels (`yugidraft:draft-room:v2`, `yugidraft:tournament-room:v2`) so issued tokens stay valid; `duel-room` gets a new label.
- **Request signature.** Header `x-internal-signature: t=<unix seconds>,v2=<hex>` over `v2\n<METHOD>\n<path>\n<t>\n<body>`. Verification rejects a timestamp more than 60 s from now, uses a constant-time compare and parses JSON only after the signature passes. `maxBytes` defaults to 64 KB and is checked while reading.
- **Cutover.** All services restart together in a deploy, so there is no dual-format period. Duel connection tokens issued before the deploy stop verifying; the client must fetch a new token when ws rejects one (verify this path exists; add it if not).
- **ws listener.** `listenInternalHttp` stops reading at `maxBytes`, wraps the handler in try/catch (report, then 500) and never lets one request crash the process.
- **Logging.** Rejected requests call `log("warn", …)` with purpose, path and reason; not `report`.
- **Recording transport.** `recordingTransport()` stays for tests, with the same shape.

**Tests.** One contract suite in `S` through the interface: valid round trip, tampered body, different path, different method, stale and future timestamp, oversize body, wrong purpose key, token of one purpose rejected for another, existing draft/tournament token fixtures still verify. The ad-hoc verifier tests in ws and duel-server are deleted; their route tests use `signedTransport` to build requests.

## Part 2b: Hardening

Each item is an independent change with its own tests.

1. **Engine resources.** Global cap on live engine workers and a per-player cap on Tables they host; `resourceLimits` on each worker; replay rebuilds share the same cap and queue behind it. Over the cap returns an `ExpectedError` (429) with a clear message.
2. **Duel answer validation.** Answers are shape-checked before reaching the worker; malformed input returns 400 and leaves the duel untouched.
3. **Error responses.** Routes that return raw error text return `ExpectedError` messages or the generic 500 body.
4. **Deck-check responses.** A duel start response includes only the requesting player's own deck check result.
5. **Waitlist response.** Joining returns the same status and body whether or not the email is already listed.
6. **Rate limits.** Rate-limit maps evict per key with a total cap that never blocks unrelated clients; IPv6 clients are keyed by /64.
7. **Existing-player recovery.** Recovery requires a Discord account that is currently linked to the claimed `users` row.
8. **Containers.** Runtime images run as a non-root user; Compose adds `no-new-privileges` and drops capabilities; writable mounts stay limited to what each service needs.
9. **Account deletion.** Also removes the person's Clerk waitlist entry and queues the PostHog person deletion (part 3).
10. **Card fetch queue.** Per-member limit on queued card fetches; manual set sync requests are rate limited per member.
11. **Engine call timeout and request size.** Engine host operations have a time limit; Caddy caps request bodies for the app domain.

## Part 3: Product analytics (PostHog EU, cookieless)

### Server events through an outbox

- **Table** `product_events(id INTEGER PRIMARY KEY, name TEXT, user_id INTEGER NULL, props_json TEXT, occurred_at INTEGER, sent_at INTEGER NULL, attempts INTEGER DEFAULT 0)`, created by the idempotent `migrate`.
- **Interface** `recordProductEvent(db, name: ProductEventName, userId: number | null, props?: ProductEventProps[name])`. Called inside the same transaction as the change it describes. `ProductEventName` and its props are a typed union in `S/analytics`.
- **Shipping.** The worker drains unsent rows every 10 s in batches of up to 100 to the PostHog batch endpoint; failures back off by `attempts`; rows are deleted 7 days after `sent_at`. With `POSTHOG_KEY` empty the worker deletes rows without sending (no-op adapter).
- **distinct_id** is `String(users.id)`; events without a user (waitlist) use a random per-event id and no person profile.
- **Events.** `waitlist_joined`, `account_created`, `first_sign_in`, `draft_created`, `draft_started`, `draft_completed`, `duel_started`, `duel_finished`, `tournament_created`, `tournament_joined`, `tournament_finished`, `cube_created`, `deck_saved`, `bug_reported`.
- **Allowed props.** Mode/format, Seat or Participant counts, Engine, theme vs. booster, how a duel ended, turn count, durations. Never card names, slugs, titles, usernames, emails or free text.
- **Deletion.** Account deletion writes a `$delete_person` job row; the worker calls the PostHog persons API with `POSTHOG_PERSONAL_API_KEY` (worker only).

### Browser page views

- `posthog-js` with `cookieless_mode: "always"`, `api_host: "/ingest"`, `capture_pageview: "history_change"`, `autocapture: false`, `disable_session_recording: true`. No `identify`; browser events stay anonymous.
- **Key pages.** Marketing landing, `/access`, sign-up, dashboard, Draft lobby and room, duel Table, tournaments, cubes. Other pages do not load the script.
- **Proxy.** App: Next rewrite `/ingest/*` to the EU ingest and assets hosts, public in `proxy.ts`. Marketing: Caddy proxies `/ingest/*` the same way; the static page uses the standard snippet with `api_host: "/ingest"`.
- **Env.** `NEXT_PUBLIC_POSTHOG_KEY` (web build arg), `POSTHOG_KEY` and `POSTHOG_PERSONAL_API_KEY` (worker), `POSTHOG_HOST` (default `https://eu.i.posthog.com`). Empty key means no script and no sending. E2E and tests never set them.
- **Project setting.** Cookieless server hash mode enabled in the PostHog project.

### Privacy

- Replace "We use no analytics" in `site/public/privacy.html` with a section naming PostHog and Sentry (EU), what each receives, no analytics cookies, retention, and deletion with the account. Draft for owner approval before analytics go live.
- No waitlist email (owner 2026-10-11: about five users; the policy update is enough).
- Analytics stay off in production (empty keys) until the updated policy is live.

**Tests.** Outbox: event written in the same transaction (rolled back with it), drain sends and marks, backoff, cleanup, no-op adapter, deletion job. Type test: disallowed prop keys fail to compile. Web: `/ingest` public, script absent when key empty, absent on non-key pages.

## Build order and parallel streams

Each stream is one PR from its own worktree; Codex implements, the orchestrator reviews and merges in this order.

| Stream | Scope | Depends on |
|---|---|---|
| A | Part 1 Observability | none |
| B | Part 2a Internal auth | none (uses `console` until A merges, then `log`) |
| C1 | Part 2b items 1, 2, 11 (Engine host) | none |
| C2 | Part 2b items 4–7, 10 (web routes) | none |
| C3 | Part 2b item 8 (containers) | none |
| D | Part 3 outbox, events, worker drain, browser page views, proxies | A merged |
| E | Part 2b items 3 and 9 | A and D merged |
| F | Privacy policy update (approved in principle; owner sees wording in the PR) | none |

A, B, C1, C2 and C3 run in parallel. Shared touch points (`S/index.ts` exports, `docker-compose.yml`, `.env.example`, `CLAUDE.md`) are resolved at merge by rebasing the later PR.

## Owner setup

- Sentry: organization in the EU region, projects for web and server, DSNs, `SENTRY_AUTH_TOKEN` as a production environment secret.
- PostHog: EU project, cookieless mode on, project key and a personal API key with person write scope.
- Merge the privacy policy PR (stream F) before setting PostHog keys in production.
