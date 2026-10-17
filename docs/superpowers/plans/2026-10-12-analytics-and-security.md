# Error reporting, internal signing, hardening and analytics: implementation plan

> **For agentic workers:** each stream below is one PR from its own worktree. Work task by task, test first. Steps use checkbox (`- [ ]`) syntax for tracking. Do not run `git` writes; the orchestrator stages and commits.

**Goal:** implement `docs/superpowers/specs/2026-10-11-analytics-and-security-design.md`.

**Architecture:** two new shared modules (`S/observability`, `S/internal-auth`) replace scattered code; a third (`S/analytics`) adds an outbox drained by the worker. Hardening items are local fixes with their own tests.

**Tech stack:** TypeScript, Node 22, npm workspaces + Turborepo, Vitest, better-sqlite3, Next.js 16.4, Socket.IO, `@sentry/node`, `@sentry/nextjs`, `posthog-js`.

**Spec:** `docs/superpowers/specs/2026-10-11-analytics-and-security-design.md`. Read it before starting; it is the authority when this plan is silent.

Path abbreviations: **S** = `packages/shared/src`, **W** = `packages/web`, **X** = `packages/ws/src`, **D** = `packages/duel-server/src`, **K** = `packages/worker/src`, **B** = `packages/bot/src`.

## Global constraints

- Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`). Build shared before consumers: `npm run build --workspace=packages/shared`.
- In the Codex sandbox use `node --import tsx <script>`, not `npx tsx`. Run focused test files; the orchestrator runs the full suites outside the sandbox.
- Single web test file: `npx vitest run packages/web/tests/<file> -c packages/web/vitest.config.ts`. Shared/ws/worker/duel: `npx vitest run <path>`.
- The repo is public. Code comments, test names, commit text and docs use neutral wording: no "vulnerability", "exploit", "attack", "CVE" or descriptions of how a weakness could be abused.
- Identity sent to third parties is `users.id` only. Never send emails, usernames, Discord IDs, card names, slugs, titles or free text to Sentry or PostHog.
- Empty `SENTRY_DSN` / `POSTHOG_KEY` means local behaviour (console / no-op). Tests and e2e never set them.
- Keep existing behaviour of anything not named in a task. Match the surrounding code style and comment density.
- Update `CLAUDE.md`, `.env.example` and `docs/deployment/vm-runbook.md` only where a task changes what they describe.

## Review focus

1. A Sentry adapter failure (network down, bad DSN) must never break a request or crash a process: `report` swallows its own errors. Owner: Stream A, Task A2 test "adapter throws".
2. A request signed for one path must be refused on another, and a body over the limit must be refused before it is fully buffered. Owner: Stream B, Task B1/B3 tests.
3. After deploy, an open duel tab holding an old duel token must recover by fetching a new token, not hang. Owner: Stream B, Task B4 test.
4. A player at the Table cap gets a clear 429 message, and a Table that ends frees its slot (including crash and abandon paths). Owner: Stream C1, Task C1-1 tests.
5. Running containers as non-root must still write `data/` (SQLite, WAL, card images, heartbeat) on an existing VM whose files are owned by root. Owner: Stream C3, Task C3-1 (ownership step in the deploy script).

---

## Stream A: Observability module (spec part 1)

Worktree branch `feat/observability`. Dependencies are pre-installed by the orchestrator (`@sentry/node` in ws, duel-server, worker, bot; `@sentry/nextjs` in web).

### Task A1: module interface and console adapter

**Files:** create `S/observability/index.ts`, `S/observability/console-adapter.ts`, `S/observability/redact.ts`, `S/observability/expected-error.ts`; export from `S/index.ts`; test `packages/shared/tests/observability/*.test.ts`.

**Produces:**
```ts
export type ReportContext = { userId?: number; tags?: Record<string, string>; extra?: Record<string, unknown> };
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export interface ObservabilityAdapter {
  report(error: unknown, context: ReportContext): void;
  log(level: "info" | "warn" | "error", message: string, fields: LogFields): void;
  flush(timeoutMs: number): Promise<void>;
}
export function setObservabilityAdapter(adapter: ObservabilityAdapter): void;
export function report(error: unknown, context?: ReportContext): void;
export function log(level: "info" | "warn" | "error", message: string, fields?: LogFields): void;
export function flushObservability(timeoutMs?: number): Promise<void>;
export class ExpectedError extends Error { readonly status: number; constructor(safeMessage: string, status: number) }
export function isExpectedError(e: unknown): e is ExpectedError;
export function errorResponseBody(e: unknown): { status: number; body: { error: string } }; // expected → its message; else report + 500 "Something went wrong"
export function redactText(s: string): string;            // emails, bearer/sk_/pk_ tokens, sha256=…, hex ≥32, SQL statements
export function redactEvent<T>(event: T): T;               // drops request.data, cookies, authorization/cookie/x-*-signature headers; runs redactText on message, exception values, breadcrumbs
```
- [ ] Write tests: default adapter is console; `report` of an `ExpectedError` is not forwarded; `errorResponseBody` for both kinds; `redactText` cases (email, `Bearer abc`, `sk_live_…`, `sha256=<hex>`, `SELECT * FROM users WHERE …`, plain text unchanged); `redactEvent` drops body/cookies/headers; adapter that throws inside `report`/`log` does not throw out.
- [ ] Run, see fail. Implement. Run, see pass.

### Task A2: Node bootstrap and Sentry adapter

**Files:** create `S/observability/node-bootstrap.ts` (no Sentry import; takes an adapter factory); create `packages/{ws,duel-server,worker,bot}/src/instrument.ts` that builds the Sentry adapter with `@sentry/node` and calls the bootstrap; update each package's `start` script and Dockerfile `CMD` to `node --import ./dist/instrument.js dist/<entry>.js`; `docker-compose.yml` adds `init: true` and `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` to ws, duel, worker, web.

- Sentry init: `dsn`, `environment`, `release`, `sendDefaultPii: false`, `tracesSampleRate: 0.05`, `beforeSend: redactEvent`, `beforeBreadcrumb` runs `redactText`.
- Bootstrap: when DSN empty, keep console adapter; install `uncaughtException` / `unhandledRejection` → `report` then `flushObservability(2000)` then `process.exit(1)`; on SIGTERM call `flushObservability(2000)` before the existing shutdown continues (do not replace existing SIGTERM drains in worker/duel; chain them).
- [ ] Tests: bootstrap with a fake adapter factory: crash handler reports and exits; empty DSN keeps console; SIGTERM flush is awaited before the existing handler's work completes.

### Task A3: Engine worker errors keep their stack

**Files:** `D/worker-client.ts` and the worker entry it loads.
- Errors posted from the worker thread carry `name`, `message`, `stack`; the main thread rebuilds an `Error` with that stack and calls `report(err, { tags: { table: slug } })` for unexpected ones.
- [ ] Test: a worker that throws produces a main-thread error whose stack includes the worker frame.

### Task A4: web wiring

**Files:** `W/instrumentation.ts` (register server/edge init + `export const onRequestError = Sentry.captureRequestError`), `W/instrumentation-client.ts`, `W/app/global-error.tsx`, `W/next.config.ts` (`withSentryConfig`, `tunnelRoute: "/monitoring"`, source maps upload only when `SENTRY_AUTH_TOKEN` set, `sourcemaps.deleteSourcemapsAfterUpload: true`), `W/proxy.ts` (`/monitoring` public, exact), Dockerfile web build args `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (secret mount, not ARG baked into a layer), `.github/workflows/deploy.yml` passes `secrets.SENTRY_AUTH_TOKEN` and `vars.NEXT_PUBLIC_SENTRY_DSN`.
- Client: no replay integration; `sendDefaultPii: false`; `tracesSampleRate: 0.05`; `beforeSend: redactEvent`.
- [ ] Tests: proxy test asserts `/monitoring` is public and `/monitoringx` is not; `global-error.tsx` renders a generic message.

### Task A5: migrate error-path console calls

- Replace `console.error` / `console.warn` on error paths in `packages/*/src` and `W/app` with `report` (caught unexpected errors) or `log` (expected warnings). Leave startup/info logs alone. Do not change route response bodies here (Stream E does).
- [ ] Run each touched package's focused tests and `npm run typecheck`.

---

## Stream B: Internal request signing (spec part 2a)

Worktree branch `feat/internal-auth`.

### Task B1: module and contract tests

**Files:** create `S/internal-auth/index.ts`, `S/internal-auth/keys.ts`, `S/internal-auth/request.ts`, `S/internal-auth/token.ts`; export from `S/index.ts`; test `packages/shared/tests/internal-auth/contract.test.ts`.

**Produces:** exactly the interface in the spec (`signedTransport`, `readSignedRequest`, `signToken`, `verifyToken`, `recordingTransport`, `Purpose`, `TokenPurpose`, `SignedPostTransport`, `SignedPostResult`).
- Key: `deriveKey(secret, label) = HMAC-SHA256(secret, label)`; labels `yugidraft:ws-broadcast:v2`, `yugidraft:duel-host:v2`, `yugidraft:bot-announce:v2`, `yugidraft:duel-room:v2`, and the existing `yugidraft:draft-room:v2`, `yugidraft:tournament-room:v2`.
- Header `x-internal-signature: t=<unix s>,v2=<hex>`; signed string `v2\n<METHOD>\n<pathname+search>\n<t>\n<body>`; window ±60 s; constant-time compare; `maxBytes` default 65536 checked on `content-length` and while streaming the body; JSON parsed only after the signature passes.
- `readSignedRequest` accepts an injectable `now()` for tests.
- [ ] Tests (all through the interface): round trip; tampered body 401; other path 401; other method 401; t-61 s and t+61 s 401; malformed header 401; body 65537 bytes 413; content-length lie 413; bad JSON 400; key of `ws-broadcast` refused under `duel-host`; `duel-room` token refused as `draft-room`; fixtures created with the current `S/ws/draft-token.ts` and `tournament-token.ts` still verify.

### Task B2: move token files onto the module

**Files:** `S/ws/duel-token.ts`, `S/ws/draft-token.ts`, `S/ws/tournament-token.ts` keep their exported names and signatures and delegate to `signToken`/`verifyToken`. Delete their private HMAC helpers.
- [ ] Existing token tests pass unchanged except the duel token signature fixture.

### Task B3: switch senders and receivers

- Senders: replace `httpTransport` with `signedTransport` and the right purpose in `W/src/lib/notify.ts`, `W/src/lib/notify-duel.ts`, `W/src/lib/duel-host.ts` (`duel-host`), `D/server.ts`, `K/effects.ts`, `B/index.ts`, `B/lib/notify-duel.ts`. Delete `S/notify/signed-post.ts` and `httpTransport`.
- Receivers: `X/internal-http.ts` uses `readSignedRequest(…, { purpose: "ws-broadcast" })`; `listenInternalHttp` enforces `maxBytes` while reading, wraps the handler in try/catch (log + 500), and never throws out of the request callback. `D/host.ts` handler uses `readSignedRequest(…, { purpose: "duel-host" })` (drop the inline check and its 64 KB check). `B/announce/server.ts` + `B/announce/auth.ts` use `bot-announce`. Delete `X/auth.ts`.
- Rejections: `log("warn", "internal request rejected", { purpose, path, reason })` (use `console.warn` if Stream A is not merged yet; the orchestrator swaps it at merge).
- [ ] Tests: ws internal route tests and duel host route tests build requests with `signedTransport` + `recordingTransport` or a direct signed `Request`; a ws listener test sends an oversize body and a handler that throws, and the server keeps serving the next request.

### Task B4: duel token refresh after rejection

- Check `W/src/lib/hooks/use-duel-websocket.ts` and `use-duel-presence.ts`: when ws rejects a join for an invalid or expired token, the client fetches a new token from `/api/duels/[slug]/connection` and rejoins (bounded retries). Add it if missing.
- [ ] Test: hook test where the first join ack is a token rejection and the second succeeds; the hook ends connected.

---

## Stream C1: Engine host limits (spec 2b items 1, 2, 11)

Worktree branch `fix/engine-limits`.

### Task C1-1: worker caps

**Files:** `D/worker-client.ts`, `D/host.ts`, config in `D/config.ts` (or where host options are read), `docker-compose.yml`, `.env.example`.
- `DUEL_MAX_WORKERS` (default 24) global cap on live engine workers, including replay rebuilds; `DUEL_MAX_TABLES_PER_PLAYER` (default 3) on Tables a player is seated at that hold a live worker. Over the cap: `RequestError` 429 "The duel server is busy. Try again in a minute." / "You already have 3 live duels. Finish one first."
- Replay rebuilds wait in a FIFO queue for a slot (bounded queue length 32; over that → 429).
- Each `new Worker` gets `resourceLimits: { maxOldGenerationSizeMb: DUEL_WORKER_HEAP_MB (default 192) }`.
- Slots are released on normal end, abandon, crash, timeout and host shutdown.
- [ ] Tests: cap reached → 429; slot freed after end/crash/abandon; replay queue order and overflow; resourceLimits passed (spy on the Worker factory).

### Task C1-2: answer validation

- Before an answer reaches the worker, validate its shape against the pending prompt type (`selected` is an array of integers within range, etc.). Malformed → 400 "Invalid answer", duel state unchanged, worker untouched.
- [ ] Tests: non-array `selected`, out-of-range index, wrong type per prompt kind; each 400 and a later valid answer still works.

### Task C1-3: engine call time limit and body cap

- Every operation that awaits a worker has a time limit (`DUEL_OP_TIMEOUT_MS`, default 15000) returning 503 "The duel engine did not answer in time." without leaving the queue blocked.
- `Caddyfile` app block: `request_body { max_size 1MB }` except the routes that accept uploads, if any (check `W/app/api` for uploads and size them).
- [ ] Tests: stuck worker op times out and the next op for that Table runs; `caddy validate` (orchestrator runs it).

---

## Stream C2: web route fixes (spec 2b items 4, 5, 6, 7, 10)

Worktree branch `fix/web-route-hardening`.

### Task C2-1: deck check responses

- Find where a tournament or series duel start returns deck check results (search `deck` + `check` in `W/app/api/tournaments`, `W/app/api/duels`, `S/services`). The response includes only the requesting player's own result; an opponent's result is reduced to `{ ok: boolean }`.
- [ ] Test: two players, invalid opponent deck; requester's response has no opponent card names.

### Task C2-2: waitlist response

- `W/app/api/waitlist/route.ts`: new and existing emails both return 201 with the same body. Internal behaviour (no duplicate rows, Clerk call once) unchanged.
- [ ] Test: same status and body for new and existing.

### Task C2-3: rate limit maps

- Find the shared limiter used by the routes in the rate-limit list (`git grep -ln -iE "rateLimit|createRateLimiter"`). Change to: per-key fixed window; total key cap (10 000) with eviction of the oldest window first, never a global block; IPv6 keys truncated to /64; IPv4-mapped IPv6 normalised to IPv4.
- [ ] Tests: cap reached evicts oldest and new clients still pass; two addresses in one /64 share a bucket; `::ffff:1.2.3.4` equals `1.2.3.4`.

### Task C2-4: existing-player recovery

- `W/app/api/auth/existing-player/complete/route.ts`, `W/src/lib/existing-player.ts`, `W/src/lib/clerk-sync.ts`: recovery proceeds only if the proven Discord ID equals the Discord ID currently linked to the claimed `users` row (`users`/`players` link), and that link has not been removed. If the row has no linked Discord ID, refuse with the existing "contact support" response.
- [ ] Tests: linked match → success; row unlinked → refused; different Discord ID → refused.

### Task C2-5: card fetch queue

- `S/services/card-fetch.ts` (+ the web routes that enqueue, and `POST /api/sets`): per-member limit on pending fetches (default 20) and a per-member rate limit on manual set sync (1 per 10 minutes). Over limit → `RequestError`/429 with a clear message.
- [ ] Tests: 21st pending fetch for one member refused while another member is accepted; second set sync inside 10 minutes refused.

---

## Stream C3: containers (spec 2b item 8)

Worktree branch `chore/container-user`.

### Task C3-1: non-root runtime

- `Dockerfile`: runtime targets `ws`, `duel`, `web`, `worker`, `bot` run as `USER node` (uid 1000); files they only read stay root-owned.
- `docker-compose.yml`: each service gets `security_opt: ["no-new-privileges:true"]`, `cap_drop: [ALL]`; Caddy keeps `NET_BIND_SERVICE`. Mounts unchanged.
- Deploy script (`scripts/remote-deploy.sh` or the script the deploy workflow runs on the VM): before starting containers, `chown -R 1000:1000` the data paths the services write (`data/bot.sqlite*`, `data/card-images`, worker heartbeat path, duel engine runtime dirs that are written). Idempotent.
- Duel startup script `packages/duel-server/scripts/install-engine-bundle.sh`: confirm it does not need root; if it writes, write to a path owned by `node`.
- [ ] Orchestrator verification (outside sandbox): build images, run the stack locally with a root-owned copy of `data/`, run the deploy ownership step, confirm web/ws/duel/worker healthy and a write succeeds.

---

## Stream D: product analytics (spec part 3), starts after A merges

Worktree branch `feat/product-analytics`. Dependencies pre-installed (`posthog-js` in web).

- **D1 outbox:** `S/analytics/{events.ts,record.ts,index.ts}`; `product_events` table in `S/db/schema.ts` `migrate`; `ProductEventName` union with per-event props types (disallowed keys fail to compile; add a `// @ts-expect-error` type test); `recordProductEvent(db, name, userId, props)`.
- **D2 call sites:** the 14 events in the spec, each recorded inside the service transaction that makes the change (`S/services/*`, waitlist route, account creation in `session-identity`/clerk sync, bug report route). `first_sign_in` once per user.
- **D3 worker drain:** `K/analytics-drain.ts`, every 10 s, batch ≤100 to `${POSTHOG_HOST}/batch/`, backoff by attempts (max 10, then leave for cleanup), cleanup rows 7 days after `sent_at` and abandoned rows after 30 days; `$delete_person` job rows call the persons API with `POSTHOG_PERSONAL_API_KEY`; no-op when key empty (delete rows). Uses `report`/`log` from A.
- **D4 browser:** `W/src/lib/analytics/page-views.tsx` client component loaded only on the key pages in the spec; `cookieless_mode: "always"`, `api_host: "/ingest"`, `capture_pageview: "history_change"`, `autocapture: false`, `disable_session_recording: true`, no `identify`. Caddy app and marketing blocks import one `(posthog_ingest)` snippet before their fallbacks: strip `/ingest`, proxy `/ingest/static/*` to `https://eu-assets.i.posthog.com` and `/ingest` or `/ingest/*` to `https://eu.i.posthog.com`, dropping Cookie, Authorization and Referer upstream. CSP report-only unchanged (same origin).
- **D5 marketing:** Caddy marketing block imports the shared ingestion snippet; `site/public/index.html` adds the snippet with the same options; key page only.
- Tests per spec part 3.

## Stream E: error responses and account deletion (2b items 3, 9), starts after A and D merge

- Routes returning raw error text use `errorResponseBody`/`ExpectedError`.
- Account deletion also removes the person's Clerk waitlist entry (by email, before the email is erased) and records the `$delete_person` job.

## Stream F: privacy policy

- `site/public/privacy.html`: replace "We use no analytics." and add a section naming PostHog (EU) and Sentry (EU), what each receives, no analytics cookies, retention, deletion with the account; update "Last updated". Owner reviews wording in the PR.
