# Alpha Access PR 2: Clerk Custom Auth and Domain Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace NextAuth with custom Clerk sign-in/sign-up flows on the merged concept A shell, resolve every Clerk session to `users.id` with safe Discord linking, remove the admin role and all Discord I/O from the web app, take the bot out of Compose, and ship the waitlist bridge, owner scripts, signed-cookie E2E login and cutover docs.

**Architecture:** `clerkMiddleware` in `proxy.ts` verifies Clerk sessions; one server resolver (`session-identity.ts`) maps a Clerk user ID to a `users` row, syncing from Clerk's Backend API only when the row is missing, older than five minutes or forced, and running the spec's linking algorithm in a single `BEGIN IMMEDIATE` transaction. `auth()` and `requireWebAccess()` keep their current return shapes, so the 41 guarded routes do not churn. Custom auth UI is a pure step machine plus error mapper (Codex), wrapped in Clerk v7 signal hooks and rendered by step cards ported from `docs/design/sign-in/` (Sonnet). Clerk Backend calls (sync, waitlist, owner scripts) share one fetch-based REST client in `@yugidraft/shared/clerk`, so the worker image can run the owner scripts on the VM without new dependencies.

**Tech Stack:** Node 22.23.2, TypeScript, Next.js 16.2.4 App Router (`proxy.ts`), React 19.2.5, `@clerk/nextjs` 7.9.11 (signal hooks `useSignIn`/`useSignUp`, `clerkMiddleware`, `<UserProfile/>`), Clerk Backend REST API, better-sqlite3, Vitest, Playwright, npm workspaces/Turborepo, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-05-alpha-access-clerk-design.md`, authority `docs/adr/0004-alpha-access-clerk.md`. PR 2 scope is the spec's decisions 1–5, 8–12, 14, 16, 17; "PR 2: Clerk to users"; "Linking and owner merge"; "Access and ownership after admin removal"; "Bot shelving" (PR 2 lines); "Custom sign-in/sign-up (PR 2)"; "Waitlist → approval → invitation → first run"; "Existing member at cutover"; "Email account links Discord / conflict"; "PR 2 — domain cutover" file table; the PR 2 rows of the test plan; "Pre-cutover checklist"; "Cutover order (PR 2)". Executors read both documents completely, then this plan's Global Constraints and their own task.

## Global Constraints

- Base: branch `alpha-access-pr2` (integration worktree `/home/imran/orca/workspaces/yugioh-discord-bot/alpha-access-pr2`), cut from `alpha-access` at `32143f0bf` (PR #235, open, **not merged**). Whenever `alpha-access` gains review fixes, the orchestrator merges it into `alpha-access-pr2` before the next task branch is cut. The PR 2 pull request targets `alpha-access` until #235 merges, then is retargeted to `main`.
- Executors: backend/logic tasks go to Codex `gpt-6.1-sol` at reasoning **high**; ALL UI tasks go to the Sonnet 5.5 `ui-designer` agent at high effort; reviews go to Opus 5.5 high. Every task runs in its own worktree `/home/imran/orca/workspaces/yugioh-discord-bot/alpha-access-pr2-tN` on branch `alpha-access-pr2-tN`, cut by the orchestrator. Never two agents in one checkout.
- Every shell starts with `export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH`. The shell is zsh: never loop over commands stored in a variable.
- Codex sandbox: no network, no `npm install`, no sockets/subprocess servers, git read-only. Only the orchestrator edits `package.json` dependency lists or `package-lock.json`, runs Docker/Playwright/compose, and commits. Executors stage nothing; they report exact created/modified/deleted files and the commands they ran.
- Build shared before consumers: `npm run build --workspace=packages/shared`.
- Identity invariants from PR 1 hold: `users.id` is a positive safe integer; `session.user.id = String(users.id)`; parse once at the server boundary with `parseUserId`; owner comparisons are integer equality. `players.id` and every gameplay FK never change during automatic linking. Draft tokens carry `users.id`; duel tokens keep `players.id`.
- `requireWebAccess()` keeps returning `{ ok: true; userId: number; discordUserId: string | null; userName: string }` (Discord ID becomes nullable) or `{ ok: false; response }`. `auth()` keeps returning `{ user: { id: string; name: string; email: string | null; image: string | null; discordUserId: string | null }; expires: string } | null`.
- No admin role anywhere in the web app or shared logic. Creators manage their drafts, tournaments and cubes. Season start/end only through the VM owner script.
- `DISCORD_BOT_ENABLED` is true only for literal `1`. PR 2 deploys with `0`. With it off: no web→bot HTTP, no Discord REST, `/api/discord/channels` and `/api/tournaments/[slug]/announce` return **404** `{ "error": "discord_disabled" }`, never 502. The capability reaches UI through server-rendered props, never a `NEXT_PUBLIC_*` flag.
- Clerk keys: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is a web **build** arg; `CLERK_SECRET_KEY` is web **runtime** only (and passed explicitly with `-e` to one-off owner-script runs). Never bake the secret into an image; never commit keys; dev keys never reach staging/production.
- CI and E2E builds use the format-valid dummy publishable key `pk_test_Y2xlcmsuZXhhbXBsZS5jb20k` (base64 of `clerk.example.com$`). It never authenticates anything.
- Legal links are constants: `https://duelingdomain.com/privacy` and `https://duelingdomain.com/terms`. The app hosts no `/privacy` or `/terms` page and adds no public path for them.
- No prebuilt `<SignIn/>`/`<SignUp/>`, no `@clerk/elements`, no `/legacy` hooks. `<UserProfile/>` only on `/settings/account`.
- Never name Sila Inc. Contact address in copy is `support@duelingdomain.com`.
- Never touch the live database `/opt/yugioh-bot/data/bot.sqlite`. Realistic rehearsals use a COPY from `/home/imran/dueling-db-copies/` copied into `/tmp/alpha-access-pr2-evidence/`.
- Evidence lives in `/tmp/alpha-access-pr2-evidence/` (mode 0700). No credentials, session cookies or whole identity records in evidence or review output.
- Push, PR, merge and deploy need the owner's explicit go. Creating or changing the Clerk dev app needs the owner's explicit go (T12). Marketing files (`site/public/*`) and privacy wording are coordinated with the marketing peer session and approved by the owner; the peer cannot grant permissions.
- One review → one fix pass → one re-review for the PR. Every returned task gets code review in chat, and every UI task gets a rendered desktop (1440×900) and phone (390×844) review in chat against `docs/design/sign-in/shots/` or the current page, before the orchestrator commits.
- Package test commands: `npm test --workspace=packages/{shared,web,worker,bot,ws,duel-server}`. Focused web files: `npx vitest run <file> -c packages/web/vitest.config.ts`. Focused shared/worker files: `npx vitest run <file>`.
- Re-anchor every line reference below by reading the current file first; numbers come from the 2026-10-06 inventory of `32143f0bf`.

## Review Focus

- A Clerk user whose verified Discord account already belongs to an imported user with history, signing in for the first time from two tabs (or web plus another process) at once, must end with exactly one `users` row holding that Clerk ID and the imported history; never two rows, never a `UNIQUE constraint failed` 500 (T1 two-connection race test; T4 resolver concurrency test).
- Removing `NEXTAUTH_URL` from the environment must not silently reset the WS CORS origin to `http://localhost`: Compose must read `WEB_URL` and fail config when it is missing (T10 compose assertions run by the orchestrator with `docker compose config`).
- An invitation link opened in a new browser, continued with Discord, must come back to `/sso-callback` still bound to the invited email and still requiring username and consent, never landing in the app early and never showing an editable email (T2 machine tests; T3 callback wiring; T13 manual dev check).
- With the bot service gone, finishing a draft, approving a match, creating a duel challenge or completing a tournament must commit state, broadcast WS updates and return success without any HTTP attempt to `bot:4001` (T6 route tests asserting the announcer is never called; worker already gates on `DISCORD_BOT_ENABLED`, asserted in T10's compose env).
- A production-like build with `E2E_AUTH` unset must reject a forged or replayed `dd_e2e_session` cookie and must 404 `/api/test-auth/session`, while an E2E build reads the gate per request, not from a statically prerendered layout (T4 cookie/gate tests; T5 build stamp includes the gate).

---

## Execution order and scope decisions

```
T0 (orchestrator) ─┬─ T1 shared (Codex) ─┬─ T4 web auth core (Codex) ─┬─ T6 Discord off (Codex) ─┐
                   │                     ├─ T5 E2E stack (Codex)       ├─ T7 account/shell/de-Discord UI (Sonnet)
                   │                     ├─ T8 waitlist bridge (Codex) │
                   │                     └─ T9 owner scripts (Codex)   │
                   ├─ T2 auth flow logic (Codex) ── T3b wire auth pages (Sonnet) ──────────────┤
                   ├─ T3a step cards, presentational (Sonnet)                                   │
                   ├─ T10 deploy/env/docs (Codex)                                               │
                   ├─ T11 privacy/legal coordination (orchestrator + marketing peer)            │
                   └─ T12 Clerk dev instance (orchestrator, owner go) ──────────────────────────┴─ T13 integrate + verify
```

- **Wave 1** (after T0): T1, T2, T3a, T10 in parallel; T11 and T12 run alongside (T12 only after the owner's go).
- **Wave 2** (after T1 merges): T4, T5, T8, T9 in parallel. T3b starts when T2 and T3a are merged.
- **Wave 3** (after T4 merges): T6 and T7 in parallel. T6 owns route/lib files and their tests; T7 owns components/pages and their tests. T7 consumes T6's `discordEnabled` prop contract, fixed below.
- **T13** after everything: merge order, full suites, E2E, compose/docker checks, render review with the owner, Clerk dev manual checklist, bounded review.

Scope decisions and spec deviations (surface these to the owner with the plan):

1. **Clerk CLI configuration (decision 17).** The Codex sandbox has no network, so the orchestrator runs `clerk apps create` / `config patch` / `env pull` (T12) after the owner's go. Coding does not wait for it: every unit test mocks Clerk.
2. **Owner scripts location.** The spec names `scripts/{clerk-precreate-users,clerk-reconcile-waitlist,merge-users,season}.ts`. Production images ship neither `scripts/` nor `tsx`, and the precreate run must write Clerk IDs into the VM database. The scripts therefore live in `packages/worker/src/ops/` (compiled into the worker image, which already has node, shared dist and better-sqlite3) behind one CLI, `node packages/worker/dist/ops/cli.js <command>`, with a root `npm run ops -- <command>` (tsx) for local runs. Clerk calls use the shared fetch-based REST client, so the worker gains no Clerk dependency.
3. **Clerk Backend access.** Server-side sync, the waitlist bridge and owner scripts use `@yugidraft/shared/clerk` (fetch to `https://api.clerk.com/v1`), not `clerkClient()`, so one tested client serves web and worker. `@clerk/nextjs` is used for middleware, provider, hooks and `<UserProfile/>` only.
4. **Old `/login` URL.** `app/(auth)/login/page.tsx` becomes a server redirect to `/sign-in`, preserving a safe `callbackUrl` as `redirect_url`. NextAuth actions, login button and error mapping are deleted.
5. **`/settings`.** The guild-settings page is deleted; `/settings` redirects to `/settings/account`, which hosts `<UserProfile/>`, the moved `DuelViewToggle`, and the legal links.
6. **Marketing files.** `site/public/app.js` (503 retry handling) and `site/public/privacy.html` (Clerk waitlist, users table, verified-email capture, imports) are edited in this PR only with wording agreed with the marketing peer and approved by the owner (T8 code, T11 wording).
7. **E2E without Clerk.** With `E2E_AUTH=1`, `proxy.ts` never invokes `clerkMiddleware`, the root layout renders no `ClerkProvider`, and `/settings/account` renders offline account controls (display name, sign out). This is the spec's "Test mode bypasses Clerk middleware/provider network initialization".

---

### Task 0: Branch, Clerk install and recorded API surface (orchestrator)

**Files:**
- Modify: `packages/web/package.json` (add `"@clerk/nextjs": "7.9.11"`, exact; keep `next-auth` until T4 removes it), `package-lock.json`.
- Create: `/tmp/alpha-access-pr2-evidence/clerk-api.md` (not tracked).

**Interfaces:**
- Produces: installed `@clerk/nextjs` 7.9.11 and its resolved `@clerk/react`, `@clerk/shared`, `@clerk/backend` versions; `clerk-api.md` recording the exact signal-hook members every later task relies on (below), the `clerkMiddleware` + `createRouteMatcher` + `proxy.ts` export shape for Next 16 (from `mcp__clerk__clerk_sdk_snippet`), and the Backend REST endpoints used by `@yugidraft/shared/clerk`.

- [ ] **Step 1: Cut the branch and evidence directory.**

```bash
export PATH=$HOME/.nvm/versions/node/v22.23.2/bin:$PATH
cd /home/imran/orca/workspaces/yugioh-discord-bot/alpha-access
git status --short            # expect clean
git worktree add -b alpha-access-pr2 ../alpha-access-pr2 alpha-access   # alpha-access stays free for PR 1 fixes
cd ../alpha-access-pr2
install -d -m 0700 /tmp/alpha-access-pr2-evidence
```

- [ ] **Step 2: Install Clerk with an exact pin.**

```bash
npm install @clerk/nextjs@7.9.11 --save-exact --workspace=packages/web
npm ls @clerk/nextjs @clerk/react @clerk/shared @clerk/backend
```

Expected: `@clerk/nextjs@7.9.11`, `@clerk/shared@4.x`, `@clerk/react@6.x`; no peer warnings for next 16.2.4 / react 19.2.5.

- [ ] **Step 3: Record the installed API surface.** Confirm from `node_modules/@clerk/shared/dist/types/{signInFuture,signUpFuture,state,signInCommon,signUpCommon}.d.ts` and write to `clerk-api.md`:
  - `SignInSignalValue = { signIn, errors: { fields, raw, global }, fetchStatus: 'idle' | 'fetching' }`; same for sign-up.
  - `SignInStatus = 'needs_identifier' | 'needs_first_factor' | 'needs_second_factor' | 'needs_client_trust' | 'needs_new_password' | 'needs_protect_check' | 'complete'`; `SignUpStatus = 'missing_requirements' | 'complete' | 'abandoned'`.
  - `signIn.create({ identifier })`, `signIn.password({ password })`, `signIn.sso({ strategy, redirectUrl, redirectCallbackUrl })`, `signIn.resetPasswordEmailCode.{sendCode, verifyCode({ code }), submitPassword({ password })}`, `signIn.mfa.{sendEmailCode, verifyEmailCode({ code })}`, `signIn.ticket({ ticket })`, `signIn.finalize({ navigate? })`, `signIn.reset()`; every method resolves `{ error: ClerkError | null }`.
  - `signUp.create`, `signUp.update({ username, legalAccepted })`, `signUp.password({ password, ... })`, `signUp.sso(...)`, `signUp.ticket({ ticket })`, `signUp.verifications.{sendEmailCode, verifyEmailCode({ code })}`, `signUp.finalize`, `signUp.reset`; fields `status`, `missingFields`, `unverifiedFields`, `emailAddress`, `username`, `legalAcceptedAt`.
  - Any difference from these names is recorded and copied into the T2 and T3b briefs; the briefs cite `clerk-api.md`, not the spec.

- [ ] **Step 4: Baseline.** Run `npm run build --workspace=packages/shared`, `npm run typecheck`, and each package test command; record pass/fail counts in `/tmp/alpha-access-pr2-evidence/baseline.txt`. Known environmental failures from PR 1 (`publish-engine-data` on git 2.25.1, stale `multi-scripts-manifest`, load-only web timeouts) are listed by name.

- [ ] **Step 5: Commit** `package.json`/lockfile only: `chore(web): add @clerk/nextjs 7.9.11 for PR 2`.

---

### Task 1: Shared Clerk linking, history and Backend REST client (Codex)

**Files:**
- Modify: `packages/shared/src/services/users.ts`, `packages/shared/src/services/draft-tournament.ts:13,57-58`, `packages/shared/src/services/index.ts`, `packages/shared/package.json` (exports `./clerk`).
- Create: `packages/shared/src/clerk/backend.ts`, `packages/shared/src/clerk/profile.ts`, `packages/shared/src/clerk/index.ts`, `packages/shared/src/services/user-history.ts`.
- Test: `packages/shared/tests/services/users.test.ts` (extend), `packages/shared/tests/services/users-linking.test.ts`, `packages/shared/tests/services/users-linking-race.test.ts`, `packages/shared/tests/services/user-history.test.ts`, `packages/shared/tests/clerk/backend.test.ts`, `packages/shared/tests/clerk/profile.test.ts`, `packages/shared/tests/services/draft-tournament.test.ts` (adjust).

**Interfaces:**
- Consumes: PR 1 `User`, `createUserService(db)`, schema columns `users.clerk_user_id unique`, `synced_at`, `email_verified`; player reference tables listed in the spec's history table.
- Produces (exact):

```ts
// packages/shared/src/clerk/profile.ts
export interface ClerkProfile {
  clerkUserId: string;          // "user_..."
  username: string | null;
  displayName: string;          // "first last" trimmed, else username, else email local part, else "Duelist"
  email: string | null;         // primary email, trimmed + lowercased
  emailVerified: boolean;       // primary email verification.status === "verified"
  discordUserId: string | null; // oauth_discord external account provider_user_id, only when verified and /^[0-9]{1,25}$/
  imageUrl: string | null;
}
export function profileFromClerkUser(user: ClerkUserJson): ClerkProfile;

// packages/shared/src/clerk/backend.ts
export interface ClerkUserJson { id: string; username: string | null; first_name: string | null; last_name: string | null;
  image_url: string | null; external_id: string | null; primary_email_address_id: string | null;
  email_addresses: { id: string; email_address: string; verification: { status: string } | null }[];
  external_accounts: { provider: string; provider_user_id: string; verification: { status: string } | null }[]; }
export interface ClerkWaitlistEntryJson { id: string; email_address: string; status: string }
export class ClerkBackendError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null, readonly retryAfterMs: number | null);
  get retryable(): boolean;     // status 0 (network/timeout), 429, >= 500
}
export interface ClerkBackend {
  getUser(clerkUserId: string): Promise<ClerkUserJson>;
  listUsers(query: { externalId?: string; emailAddress?: string; username?: string }): Promise<ClerkUserJson[]>;
  createUser(input: { emailAddress: string; username: string; externalId: string; skipPasswordRequirement: true; skipLegalChecks?: boolean }): Promise<ClerkUserJson>;
  updateUserExternalId(clerkUserId: string, externalId: string): Promise<ClerkUserJson>;
  createWaitlistEntry(input: { emailAddress: string; notify: boolean }): Promise<ClerkWaitlistEntryJson>;
  listWaitlistEntries(query: { query?: string; status?: string; offset?: number; limit?: number }): Promise<{ data: ClerkWaitlistEntryJson[]; totalCount: number }>;
}
export function createClerkBackend(opts: { secretKey: string; apiUrl?: string; fetch?: typeof fetch; timeoutMs?: number }): ClerkBackend;
// apiUrl default "https://api.clerk.com/v1"; timeoutMs default 5000; Authorization: Bearer <secretKey>.
// Endpoints: GET /users/{id}; GET /users?external_id=&email_address=&username= (array query params);
// POST /users {email_address:[...], username, external_id, skip_password_requirement, skip_legal_checks};
// PATCH /users/{id} {external_id}; POST /waitlist_entries {email_address, notify}; GET /waitlist_entries?query=&status=&offset=&limit=
// Non-2xx: parse {errors:[{code,message}]} into ClerkBackendError; 429 reads Retry-After seconds. Never log the secret.

// packages/shared/src/services/user-history.ts
export type HistoryCounts = Record<string, number>; // key = "table.column", only non-zero entries
export function userHistory(db: Database.Database, userId: number): HistoryCounts;
export function hasHistory(db: Database.Database, userId: number): boolean; // Object.keys(userHistory(...)).length > 0

// packages/shared/src/services/users.ts additions
export type LinkConflict = "discord_claimed" | "both_have_history";
export interface LinkOutcome { user: User; conflict: LinkConflict | null; foldedUserId: number | null }
export interface UserService {
  /* existing members */
  findByClerkId(clerkUserId: string): User | undefined;
  needsSync(user: User | undefined, now?: Date): boolean; // true when missing, synced_at null/unparseable, or older than 5 minutes
  resolveClerkProfile(profile: ClerkProfile, now?: Date): LinkOutcome;
}
export const USER_SYNC_MAX_AGE_MS = 5 * 60_000;
```

- `CreateTournamentFromDraftInput` loses `actorIsAdmin`; `createFromDraft` throws `new Error("Only the draft creator can create a tournament")` unless `createdByUserId === draft.createdByUserId`.

`userHistory` counts, for the user: `tournaments.created_by_user_id`, `cubes.created_by_user_id`, `drafts.created_by_user_id`, `seasons.created_by_user_id`, `saved_decks.owner_user_id`; and for every `players.id` with `user_id = ?`: `tournament_participants.player_id`, `draft_player_cube.player_id`, `draft_players.player_id`, `matches.{player_one_id,player_two_id,winner_id,reporter_id,approver_id}`, `tournament_matches.{player_one_id,player_two_id}`, `player_ratings.player_id`, `point_awards.player_id`, `season_standings.player_id`, `player_achievements.player_id`, `duels.{organizer/winner columns}`, `duel_seats.player_id`, `duel_invite_grants.player_id`, `duel_series.{player0_id,player1_id,winner_player_id,created_by_player_id}`, `bug_reports.player_id`. Read the exact duel column names from `schema.ts` (spec lines `:523,:533,:544,:610,:649,:654,:667`). Use only columns that exist (`pragma table_info`) so the function survives later migrations; a missing listed table is a test failure, not a silent skip.

`resolveClerkProfile` implements the spec algorithm exactly, inside `db.transaction(...).immediate()`, re-reading every row inside the transaction:

```text
A = findByClerkId(p.clerkUserId) ?? insert user (clerk_user_id = p.clerkUserId, no Discord)
apply profile to A: username (if non-null), display_name, email, email_verified, synced_at = now, updated_at
D = p.discordUserId
if D is null: set A.discord_user_id = null and players.discord_user_id = null for A's players; return {A}
B = user by discord_user_id D
if B is absent or B.id == A.id: attach D to A (users + players.discord_user_id); return {A}
if B.clerk_user_id is not null: return {A, conflict: "discord_claimed"}         // B untouched
if !hasHistory(A): delete A's players (all empty), clear A.clerk_user_id, delete A;
                   set B.clerk_user_id + profile; return {B, foldedUserId: A.id}
if !hasHistory(B): delete B's players, clear B.discord_user_id, delete B;
                   attach D to A and A's players; return {A, foldedUserId: B.id}
return {A, conflict: "both_have_history"}                                         // neither modified beyond A's profile
```

Clearing a Discord ID never deletes A's players or history. "Both empty" takes the `!hasHistory(A)` branch (imported B survives). An insert racing another process is impossible inside `BEGIN IMMEDIATE`, but the insert still uses `insert ... on conflict(clerk_user_id) do nothing` followed by a re-read, so a stale read can never raise a 500.

- [ ] **Step 1: Write failing profile/backend tests.** `profile.test.ts`: primary verified email lowercased; unverified primary → `emailVerified:false`; Discord account with `verification.status !== "verified"` → `discordUserId:null`; non-numeric provider ID → null; display-name fallbacks in order. `backend.test.ts` with an injected `fetch` mock: correct URL/method/body/headers for each method (`email_address` array on create, `external_id[]`-style repeated query params), 404 → `ClerkBackendError(status 404, retryable false)`, 429 with `Retry-After: 3` → `retryAfterMs 3000, retryable true`, abort after `timeoutMs` → `status 0, retryable true`, error text never contains the secret.
- [ ] **Step 2: Write failing history/linking tests** (`user-history.test.ts`, `users-linking.test.ts`) with an in-memory DB built by `migrate()`:
  - `userHistory` is empty for a fresh user; each listed reference (one fixture per table/column) makes it non-empty and names `table.column`; a creator who never played has history through ownership.
  - `needsSync`: undefined user, null `syncedAt`, `"garbage"`, 4m59s old → false only for the last one; 5m01s → true.
  - Branches: new Clerk user without Discord; D absent clears A's accepted Discord fields but keeps A's players and history; B absent attaches D to A and its players; B == A is idempotent; B with another Clerk ID → `discord_claimed`, B unchanged; A empty/B history → returns B with Clerk ID, A deleted, `foldedUserId = A.id`, B's `players.id` unchanged; A history/B empty → B deleted, A gains D; both empty → B survives; both history → `both_have_history`, B unchanged, no player rows moved; email is normalized and `emailVerified` false never keeps an old verified flag; `synced_at` set.
- [ ] **Step 3: Write the failing race test** (`users-linking-race.test.ts`): a temp-file DB opened twice with `openDatabase` (WAL, busy timeout); both connections call `resolveClerkProfile` for the same new Clerk ID and an imported Discord user; result: one row with that Clerk ID, both calls return the same `user.id`, no thrown error. Run each call through `Promise.all` of two `setImmediate`-scheduled synchronous calls on separate connections, and also call sequentially second-after-first to cover the "already folded" re-read.
- [ ] **Step 4: Run** `npx vitest run packages/shared/tests/clerk packages/shared/tests/services/users-linking.test.ts packages/shared/tests/services/users-linking-race.test.ts packages/shared/tests/services/user-history.test.ts` — expect FAIL (missing modules).
- [ ] **Step 5: Implement** `profile.ts`, `backend.ts`, `index.ts` (re-export both), `user-history.ts`, the `UserService` additions, the `./clerk` export entry mirroring the existing `./notify` entry, and the `draft-tournament.ts` creator-only change (update its tests: a non-creator now fails even when previously `actorIsAdmin: true`).
- [ ] **Step 6: Run** the focused files, then `npm run build --workspace=packages/shared && npm test --workspace=packages/shared` — expect PASS except documented baseline flakes.
- [ ] **Checkpoint:** report files and results; orchestrator reviews and commits `feat(shared): Clerk profile sync, linking and history`.

---

### Task 2: Auth flow state machine, error mapper and Clerk hook adapters (Codex)

**Files:**
- Create: `packages/web/src/lib/auth-flow.ts` (pure), `packages/web/src/lib/auth-errors.ts` (pure), `packages/web/src/lib/auth-return.ts` (pure), `packages/web/src/hooks/use-sign-in-flow.ts`, `packages/web/src/hooks/use-sign-up-flow.ts`, `packages/web/src/hooks/use-sso-callback.ts`.
- Test: `packages/web/tests/auth-flow.test.ts`, `packages/web/tests/auth-errors.test.ts`, `packages/web/tests/auth-return.test.ts`, `packages/web/tests/hooks/use-sign-in-flow.test.tsx`, `packages/web/tests/hooks/use-sign-up-flow.test.tsx`, `packages/web/tests/hooks/use-sso-callback.test.tsx`.

**Interfaces:**
- Consumes: `/tmp/alpha-access-pr2-evidence/clerk-api.md` (T0) for exact hook members; `useSignIn`, `useSignUp` from `@clerk/nextjs`; `useRouter` from `next/navigation`.
- Produces (exact; T3b renders these and nothing else):

```ts
// auth-return.ts
export const DEFAULT_RETURN = "/dashboard";
export function safeReturnPath(value: unknown): string; // "/x?y#z" only; rejects "//", "/\\", schemes, control chars, "/sign-in*", "/sign-up*", "/sso-callback*"; else DEFAULT_RETURN

// auth-flow.ts
export type AuthStep = "signin" | "password" | "code" | "newpw" | "invite" | "signing" | "success"
  | "err-invite" | "err-signup" | "err-banned";
export type CodePurpose = "signup" | "reset" | "client-trust";
export type FieldName = "identifier" | "password" | "code" | "newPassword" | "confirm" | "username" | "legal";
export interface AuthBanner { tone: "bad" | "info"; body: string; code?: string }
export interface AuthFlowState {
  step: AuthStep;
  identifier: string | null;      // email shown on password/code/err-invite steps
  lockedEmail: string | null;     // invitation email from Clerk, never from the query string
  codePurpose: CodePurpose | null;
  fieldErrors: Partial<Record<FieldName, string>>;
  banner: AuthBanner | null;      // err-service and info notices on the current step
  pending: boolean;
  resendAvailableAt: number | null; // epoch ms; resend disabled until then (30 s)
  returnTo: string;
}
export type AuthEvent =
  | { type: "submit" } | { type: "settled" }
  | { type: "identified"; identifier: string } | { type: "needs-password" }
  | { type: "code-sent"; purpose: CodePurpose; now: number } | { type: "needs-new-password" }
  | { type: "invite-ready"; lockedEmail: string } | { type: "complete" } | { type: "finalized" }
  | { type: "error"; view: AuthErrorView } | { type: "back" };
export function initialAuthState(input: { returnTo: string; step?: AuthStep }): AuthFlowState;
export function reduceAuth(state: AuthFlowState, event: AuthEvent): AuthFlowState;
export function signInStatusEvent(status: string): AuthEvent; // maps SignInStatus to the next event (needs_first_factor → needs-password, needs_client_trust/needs_second_factor with email → code-sent client-trust, needs_new_password → needs-new-password, complete → complete); unknown → error service
export function signUpRequirementsEvent(input: { status: string; missingFields: string[]; unverifiedFields: string[]; emailAddress: string | null }): AuthEvent;

// auth-errors.ts
export type AuthErrorView =
  | { kind: "step"; step: "err-invite" | "err-signup" | "err-banned" }
  | { kind: "field"; field: FieldName; message: string }
  | { kind: "banner"; banner: AuthBanner };
export function mapClerkError(error: unknown, context: "identifier" | "password" | "code" | "newpw" | "signup" | "sso"): AuthErrorView;

// hooks (client components only, "use client")
export function useSignInFlow(opts: { returnTo: string; marketingUrl: string | null }): {
  state: AuthFlowState;
  actions: { submitIdentifier(identifier: string): Promise<void>; continueWithDiscord(): Promise<void>;
    submitPassword(password: string): Promise<void>; forgotPassword(): Promise<void>;
    submitCode(code: string): Promise<void>; resendCode(): Promise<void>;
    submitNewPassword(password: string, confirm: string): Promise<void>; back(): void };
};
export function useSignUpFlow(opts: { ticket: string | null; returnTo: string }): {
  state: AuthFlowState;
  actions: { submitAccount(input: { username: string; password: string; legalAccepted: boolean }): Promise<void>;
    continueWithDiscord(input: { username: string; legalAccepted: boolean }): Promise<void>;
    submitCode(code: string): Promise<void>; resendCode(): Promise<void> };
};
export function useSsoCallback(): { state: AuthFlowState; resumeKind: "sign-in" | "sign-up" | null;
  actions: ReturnType<typeof useSignUpFlow>["actions"] };
```

Error mapping table (Clerk API codes; T13 confirms them on the dev instance and records any difference):

| Clerk code(s) | Context | View |
|---|---|---|
| `form_identifier_not_found` | identifier | step `err-invite` (identifier kept for the note box) |
| `sign_up_restricted_waitlist`, `not_allowed_access`, `sign_up_mode_restricted` | signup, sso | step `err-signup` |
| `form_password_incorrect` | password | field `password`: "That password doesn't match. Try again or reset it." |
| `form_identifier_exists` (username), `form_username_exists`, `form_username_invalid*` | signup | field `username`: "That username is taken." / Clerk's long message for invalid |
| `form_password_pwned`, `form_password_length_too_short`, `form_password_validation_failed` | newpw, signup | field `password`/`newPassword` with Clerk's long message |
| `form_code_incorrect` | code | field `code`: "That code isn't right." |
| `verification_expired`, `verification_failed` | code | field `code`: "That code expired. Send a new one." |
| `user_locked`, `user_banned`, `user_deactivated` | any | step `err-banned` |
| `form_param_format_invalid` on `email_address`/`identifier` | identifier | field `identifier`: "Enter a valid email." |
| `legal_accepted` missing / `form_param_missing` on `legal_accepted` | signup | field `legal`: "Accept the terms and privacy policy to continue." |
| anything else, network errors, `fetchStatus` stuck | any | banner `{tone:"bad", body:"Sign-in is having trouble. Try again in a moment.", code}` |

Flow rules the hooks enforce (each covered by a hook test with mocked `useSignIn`/`useSignUp` signal values):

1. Identifier → `signIn.create({ identifier })`; `{error}` maps; success with `needs_first_factor` → password step. "Continue with Discord" → `signIn.sso({ strategy: "oauth_discord", redirectUrl: returnTo, redirectCallbackUrl: "/sso-callback" })`.
2. Password → `signIn.password({ password })`; wrong password stays on `password` with field error; `complete` → `signing`, then `signIn.finalize({ navigate })`, then `success`; navigation to `returnTo` happens only after `finalize` resolves without error, ~900 ms after entering `success` (so the pack-tear frame plays). `needs_client_trust` → `signIn.mfa.sendEmailCode()` → code (`client-trust`).
3. Forgot password → `signIn.resetPasswordEmailCode.sendCode()` → code (`reset`) → `verifyCode({ code })` → `needs_new_password` → newpw → `submitPassword({ password })` (client-side `confirm` mismatch is a field error with no request) → remaining status handled → finalize.
4. Code step resend: purpose-specific send method; disabled until `resendAvailableAt`.
5. Sign-up: with `__clerk_ticket` → `signUp.ticket({ ticket })` on mount; `lockedEmail = signUp.emailAddress`; ticket missing or rejected → `err-signup`. `submitAccount` → `signUp.update({ username, legalAccepted })` then `signUp.password({ password })`; unverified email → `signUp.verifications.sendEmailCode()` → code (`signup`); `complete` → finalize. `continueWithDiscord` stores `{username, legalAccepted}` via `signUp.update` first, then `signUp.sso({ strategy: "oauth_discord", redirectUrl: returnTo, redirectCallbackUrl: "/sso-callback" })`, never dropping the ticket attempt.
6. No path reaches `success` or navigates unless the attempt `status === "complete"` and `finalize()` returned no error. `pending` is true while any request or `fetchStatus === "fetching"`; actions are no-ops while pending (no duplicate submits).
7. SSO callback: if the sign-up attempt has `missing_requirements` → `invite` step (username/consent only, email locked) or code step for unverified email; if the sign-in is `complete` or the sign-up is `complete` → signing → finalize → success; an OAuth sign-in that Clerk transfers to sign-up under waitlist mode → `err-signup`.

- [ ] **Step 1: Write failing pure tests** for `safeReturnPath` (each rejected form above, query/hash kept), `reduceAuth` (every event from every step it applies to; `back` from password/code returns to `signin` and clears field errors; `submit` sets pending; `error` field keeps step), `signInStatusEvent`, `signUpRequirementsEvent`, and every mapping table row plus unknown/network fallback.
- [ ] **Step 2: Write failing hook tests** with `vi.mock("@clerk/nextjs", ...)` returning controllable signal values and spies; cover rules 1–7, including "Discord with ticket keeps ticket attempt", "no navigation before finalize", "finalize error shows banner and stays", "duplicate submit while pending makes one call", "resend disabled for 30 s".
- [ ] **Step 3: Run** `npx vitest run packages/web/tests/auth-flow.test.ts packages/web/tests/auth-errors.test.ts packages/web/tests/auth-return.test.ts packages/web/tests/hooks/use-sign-in-flow.test.tsx packages/web/tests/hooks/use-sign-up-flow.test.tsx packages/web/tests/hooks/use-sso-callback.test.tsx -c packages/web/vitest.config.ts` — expect FAIL.
- [ ] **Step 4: Implement** the three pure modules, then the hooks. Hooks hold `AuthFlowState` in `useReducer(reduceAuth, ...)`, call Clerk methods, translate `{ error }` with `mapClerkError`, and derive next events from the signal's `status`/fields after each call.
- [ ] **Step 5: Run** the focused tests and `npx tsc --noEmit -p packages/web` — expect PASS (pre-existing NextAuth code still compiles; T4 removes it).
- [ ] **Checkpoint:** report; orchestrator reviews and commits `feat(web): custom Clerk auth flow state machine and hooks`.

---

### Task 3a: Step cards, presentational (Sonnet `ui-designer`)

**Files:**
- Create: `packages/web/src/components/auth/steps/{identifier-step,password-step,code-step,new-password-step,create-account-step,signing-step,success-step,not-invited-step,signup-closed-step,account-unavailable-step}.tsx`, `packages/web/src/components/auth/fields.tsx` (field, password-with-reveal, OTP cells, consent checkbox, locked input, note box, signing row, CAPTCHA slot), `packages/web/src/components/auth/steps.module.css`.
- Modify: `packages/web/src/components/auth/sign-in-shell.tsx`, `sign-in-shell.module.css` (success frame: port `.done-*` and confirm `packState="open"` plays tear/burst/rays), `sign-in-step.tsx` (`SignInFootLinks` gains the terms link; links use the constants `https://duelingdomain.com/privacy` and `https://duelingdomain.com/terms`).
- Create: `packages/web/app/dev/sign-in-preview/page.tsx` (renders every step and error state with static props; public only under the existing FX-lab gate, add its path to `src/lib/fx-lab.ts`'s public list), `packages/web/tests/components/auth/steps.test.tsx`.

**Interfaces:**
- Consumes: `AuthFlowState`, `AuthStep`, `FieldName`, `AuthBanner` types from T2 (import types only; if T2 is not merged yet, copy the type block from this plan into a local `types.ts` and replace the import when T2 lands).
- Produces: each step is a pure component `({ state, onSubmit..., disabled }) => JSX` with no Clerk import. Exact props:

```ts
IdentifierStep:   { identifier?: string; error?: string; banner?: AuthBanner | null; pending: boolean; onSubmit(identifier: string): void; onDiscord(): void }
PasswordStep:     { identifier: string; error?: string; pending: boolean; onSubmit(password: string): void; onForgot(): void; onBack(): void }
CodeStep:         { purpose: CodePurpose; identifier: string | null; error?: string; pending: boolean; resendAvailableAt: number | null; onSubmit(code: string): void; onResend(): void; onBack(): void }
NewPasswordStep:  { errors: { newPassword?: string; confirm?: string }; pending: boolean; onSubmit(password: string, confirm: string): void }
CreateAccountStep:{ lockedEmail: string; errors: { username?: string; password?: string; legal?: string }; banner?: AuthBanner | null; pending: boolean;
                    onSubmit(v: { username: string; password: string; legalAccepted: boolean }): void; onDiscord(v: { username: string; legalAccepted: boolean }): void;
                    passwordOptional?: boolean /* true on the SSO-callback missing-requirements card */ }
SigningStep:      {}
SuccessStep:      {}
NotInvitedStep:   { identifier: string; waitlistUrl: string; onRetry(): void }
SignupClosedStep: { waitlistUrl: string; onRetry(): void }
AccountUnavailableStep: { onBack(): void }
```

Every step renders inside `SignInStep` with the committed eyebrow/title/lede copy from `docs/design/sign-in/reference/all-steps.dom.html` for its `data-screen`; `CreateAccountStep` always renders `<div id="clerk-captcha" />`. Field errors use `aria-invalid` and `role="alert"` exactly as the reference markup. Waitlist URL is `${marketingUrl}/#join`.

- [ ] **Step 1:** Read `docs/design/sign-in/README.md`, `a/`, `shared/base.css`, `reference/all-steps.dom.html`, and the shots for every step. List each control the README marks as not yet ported and port it into `fields.tsx` / `steps.module.css` using existing tokens from `sign-in-shell.module.css`.
- [ ] **Step 2:** Write `steps.test.tsx`: each step renders its title text and controls; buttons are disabled while `pending`; `CreateAccountStep` email input is `readOnly` and shows `lockedEmail`; `#clerk-captcha` exists; consent links point at the two constant URLs; errors carry `aria-invalid`/`role="alert"`; `SuccessStep` is only a status region. Run → FAIL.
- [ ] **Step 3:** Build the components and the preview page; run the test → PASS; `npx tsc --noEmit -p packages/web`.
- [ ] **Step 4: Render review.** With `DUEL_FX_LAB=1 npm run dev:web` (orchestrator runs servers outside any sandbox), screenshot `/dev/sign-in-preview?step=<each>` at 1440×900 and 390×844 and compare side by side with `docs/design/sign-in/shots/a-<step>-{1440,390}.webp`, including `success` against `a-success-*`. Post the comparison in chat; fix differences.
- [ ] **Checkpoint:** report files, test output and screenshot paths; orchestrator reviews code and renders, then commits `feat(web): sign-in step cards from concept A markup`.

---

### Task 3b: Wire custom auth pages (Sonnet `ui-designer`)

**Files:**
- Create: `packages/web/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `packages/web/app/(auth)/sign-in/[[...sign-in]]/sign-in-card.tsx` (client), `packages/web/app/(auth)/sign-up/[[...sign-up]]/page.tsx`, `.../sign-up-card.tsx` (client), `packages/web/app/(auth)/sso-callback/page.tsx`, `.../sso-callback-card.tsx` (client), `packages/web/app/(auth)/access/page.tsx`.
- Modify: `packages/web/app/(auth)/login/page.tsx` → server redirect only.
- Delete: `packages/web/app/(auth)/login/{actions.ts,login-button.tsx,login-errors.ts}` and their tests (`tests/components/home/login.test.tsx` is rewritten as `tests/components/auth/sign-in-pages.test.tsx`).

**Interfaces:**
- Consumes: T2 hooks and `safeReturnPath`; T3a step components; `SignInShell` (`packState` `"open"` only while `state.step === "success"`, `tone="bad"` on `err-*` steps).
- Produces: `/sign-in?redirect_url=<path>`, `/sign-up?__clerk_ticket=<t>&redirect_url=<path>`, `/sso-callback`, `/access` (static explanation: the alpha is invite-only; join the waitlist at `${MARKETING_URL}/#join`; already invited → sign in; links to privacy/terms; it is not an approval gate). `/login?callbackUrl=/x` → 307 to `/sign-in?redirect_url=/x` (safe path only).

- [ ] **Step 1:** Write `sign-in-pages.test.tsx` mocking the T2 hooks: each `state.step` renders the matching step component; `success` sets `data-pack-state="open"`; login redirect preserves only safe paths; `/access` has the waitlist link and no Clerk import. Run → FAIL.
- [ ] **Step 2:** Implement pages (server components read `MARKETING_URL` and `searchParams`, pass `returnTo = safeReturnPath(redirect_url)` to client cards).
- [ ] **Step 3:** Run tests and typecheck → PASS.
- [ ] **Step 4: Render review** of `/sign-in`, `/sign-up?__clerk_ticket=x` (against a mocked hook state via the preview page, since dev Clerk may not be configured yet) and `/access` at both sizes; post in chat.
- [ ] **Checkpoint:** orchestrator reviews and commits `feat(web): Clerk sign-in, sign-up, SSO callback and access pages`.

---

### Task 4: Web auth core on Clerk, NextAuth and admin removal (Codex)

**Files:**
- Create: `packages/web/src/lib/session-identity.ts`, `packages/web/src/lib/clerk-sync.ts`, `packages/web/src/lib/e2e-auth.ts`, `packages/web/app/api/auth/session/route.ts`, `packages/web/app/api/account/refresh/route.ts`, `packages/web/app/api/test-auth/session/route.ts`, `packages/web/app/api/test-auth/sign-out/route.ts`.
- Modify: `packages/web/proxy.ts`, `packages/web/src/lib/auth.ts` (compatibility wrapper only), `packages/web/src/lib/web-access.ts`, `packages/web/src/lib/auth-identity.ts` (delete or reduce to nothing used), `packages/web/src/next-auth.d.ts` → delete, `packages/web/app/layout.tsx` (ClerkProvider), `packages/web/app/(app)/layout.tsx` (server resolution), `packages/web/src/lib/actions.ts` (`handleSignOut` removed or Clerk-based), `packages/web/src/lib/cube-access.ts`, `packages/web/app/api/cubes/route.ts:71-92`, `packages/web/app/api/drafts/[slug]/helpers.ts:334-346`, `packages/web/app/api/drafts/[slug]/tournament/route.ts:37-76`, `packages/web/src/lib/duel-host.ts`, `packages/web/src/lib/saved-decks.ts`, `packages/web/app/api/bug-reports/route.ts:112` (null-safe Discord redaction), `packages/web/app/api/drafts/[slug]/helpers.ts:86` (`buildDraftResponse` actor `discordUserId: string | null`), `packages/web/app/api/cubes/[id]/route.ts:14,25`, the 13 `auth()` callers (only if the shape change requires it), `packages/web/package.json` (remove `next-auth` — orchestrator applies the lockfile), `packages/web/vitest.config.ts:18` (drop `next-auth` inline).
- Delete: `packages/web/app/api/auth/[...nextauth]/route.ts`, `packages/web/src/lib/{discord-web-access,discord-guild-membership,discord-guild-admin}.ts`, `packages/web/app/api/admin/season/route.ts`, `packages/web/app/api/settings/route.ts`, and their tests; every test's `vi.mock` of the deleted modules.
- Test: `packages/web/tests/session-identity.test.ts`, `packages/web/tests/clerk-sync.test.ts`, `packages/web/tests/e2e-auth.test.ts`, `packages/web/tests/proxy.test.ts` (replaces `auth-public-routes.test.ts`), `packages/web/tests/auth-session-route.test.ts`, `packages/web/tests/account-refresh-route.test.ts`, `packages/web/tests/admin-removal.test.ts`, plus every existing test that mocked the deleted modules.

**Interfaces:**
- Consumes: T1 `createUserService(db).{findByClerkId, needsSync, resolveClerkProfile}`, `createClerkBackend`, `profileFromClerkUser`, `ClerkBackendError`; `auth as clerkAuth`, `clerkMiddleware`, `createRouteMatcher` from `@clerk/nextjs/server`; `ClerkProvider` from `@clerk/nextjs`.
- Produces (exact; T5, T6, T7 rely on these):

```ts
// e2e-auth.ts  (server only)
export const E2E_SESSION_COOKIE = "dd_e2e_session";
export const E2E_SESSION_TTL_SECONDS = 3600;
export const E2E_AUTH_SECRET_MIN_LENGTH = 32;
export function isE2EAuthEnabled(env?: NodeJS.ProcessEnv): boolean;   // env.E2E_AUTH === "1" && (env.E2E_AUTH_SECRET?.length ?? 0) >= 32
export function signE2ESession(userId: number, secret: string, nowSeconds?: number): string;
// value = "v1." + b64url(JSON.stringify({ uid: userId, exp })) + "." + b64url(HMAC_SHA256(secret, "dd-e2e-session:v1." + payloadB64))
export function verifyE2ESession(value: string | undefined, secret: string, nowSeconds?: number): number | null; // constant-time; uid must be a positive safe integer; exp > now

// POST /api/test-auth/session  body {userId:number, secret:string}
//   404 {"error":"not_found"} unless isE2EAuthEnabled(); 401 on secret mismatch (constant-time digest compare);
//   404 when users.findById(userId) is missing; 200 {user:{id:String(userId), name}} + Set-Cookie
//   dd_e2e_session=<value>; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure only when request is https.
// POST /api/test-auth/sign-out → 404 unless enabled; 204 + cookie cleared.

// session-identity.ts  (server only)
export interface SessionIdentity { userId: number; clerkUserId: string | null; name: string; email: string | null;
  image: string | null; discordUserId: string | null; conflict: "discord_claimed" | "both_have_history" | null }
export type SessionResult = { ok: true; identity: SessionIdentity } | { ok: false; status: 401 | 503 };
export async function resolveSessionIdentity(opts?: { forceSync?: boolean }): Promise<SessionResult>;
// E2E enabled: read cookie via next/headers cookies(), verify, users.findById → identity; else 401. Clerk is never called.
// Otherwise: const { userId } = await clerkAuth(); null → 401. user = findByClerkId; if !forceSync && !needsSync(user) → identity.
//   else syncClerkUser(clerkUserId) → LinkOutcome; ClerkBackendError retryable or missing user → 503; non-retryable 404 (deleted) → 401.

// clerk-sync.ts
export async function syncClerkUser(clerkUserId: string): Promise<LinkOutcome>;
// one in-flight promise per clerkUserId (Map, deleted in finally); fetch getUser OUTSIDE SQLite, then users.resolveClerkProfile(profileFromClerkUser(json)).
// After a fold (foldedUserId !== null) or when json.external_id !== String(user.id): best-effort updateUserExternalId with 2 retries, errors logged only.
// Backend comes from createClerkBackend({ secretKey: process.env.CLERK_SECRET_KEY }); missing key → throw ClerkBackendError(…, 0, "missing_secret", null) → 503.

// auth.ts
export async function auth(): Promise<Session | null>; // 401 → null; 503 → throw new SessionUnavailableError()
export class SessionUnavailableError extends Error {}
export type Session = { user: { id: string; name: string; email: string | null; image: string | null; discordUserId: string | null }; expires: string };
export { isE2EAuthEnabled } from "./e2e-auth";

// web-access.ts
export async function requireWebAccess(): Promise<
  | { ok: true; userId: number; discordUserId: string | null; userName: string }
  | { ok: false; response: Response }>; // 401 {"error":"unauthorized"}, 503 {"error":"session_unavailable"}

// GET /api/auth/session → 200 Session JSON, or 200 `null` when signed out (keeps existing browser consumers), 503 when sync fails.
// POST /api/account/refresh → resolveSessionIdentity({forceSync:true}); 200 {user:{id}, conflict} | 401 | 503.
//   conflict "both_have_history" message for UI: "Both accounts have activity. Your history has not been merged. Contact the owner."
```

Proxy rules (`proxy.ts`):

```ts
const PUBLIC = ["/sign-in(.*)", "/sign-up(.*)", "/sso-callback(.*)", "/access", "/login",
  "/favicon.ico", "/icon.svg", "/apple-icon.png", "/icons/(.*)"]; // + fx-lab public paths when enabled
// exact-match POST /api/waitlist and GET /api/auth/session are public (not "/api/waitlist(.*)": /api/waitlistx stays protected)
// /api/test-auth/* public only when isE2EAuthEnabled()
// FX lab paths 404 unless enabled (unchanged rule from current auth.ts:138-172)
// Non-public: E2E → verifyE2ESession(cookie) ; else clerkMiddleware's auth().userId.
//   Missing: /api/* → 401 JSON {"error":"unauthorized"}; pages → redirect `/sign-in?redirect_url=<path+search>`.
// Export shape: exactly what T0's clerk-api.md records for Next 16 proxy.ts (default export or named `proxy`), matcher unchanged.
```

Root layout: a server component that calls `await connection()` (from `next/server`) and renders `<ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" waitlistUrl={…/#join} appearance={tokens}>` unless `isE2EAuthEnabled()`. `(app)/layout.tsx` calls `resolveSessionIdentity()`: 401 → `redirect("/sign-in")`; 503 → render a retry panel ("We couldn't load your account. Try again in a moment.") inside `AppShell`; otherwise render as today.

Admin removal: `cubeWriteAccess` and `canEdit` become `cube.createdByUserId === actor.userId`; draft `canCreateTournament` and the tournament route accept only the draft creator; the shared T1 change enforces it again. `requireDuelActor`/`requireSavedDeckActor` use `requireWebAccess()`.

- [ ] **Step 1: Write failing tests.**
  - `e2e-auth.test.ts`: round trip; tampered payload, tampered signature, `v2.` prefix, expired, `uid` `0`/`-1`/`1.5`/`"1"`/`9007199254740993`, short secret → null; `isE2EAuthEnabled` false for `E2E_AUTH="true"`, missing or 31-char secret.
  - `session-identity.test.ts` (mock `@clerk/nextjs/server` and `next/headers`): fresh row → no backend call; stale/missing/forced → one `getUser` and `resolveClerkProfile`; two concurrent calls for one Clerk ID → one `getUser`; retryable backend error → 503 and `synced_at` unchanged; 404 → 401; E2E enabled → never calls `clerkAuth`; E2E disabled with a valid-looking cookie → ignored.
  - `proxy.test.ts`: every public path; `/api/waitlist` POST public, `/api/waitlistx` 401; `/api/auth/session` public; `/settings` page unauthenticated → redirect with `redirect_url`; `/api/drafts` → 401 JSON; `/api/test-auth/session` 404-shaped protected when disabled; FX-lab rule preserved.
  - `auth-session-route.test.ts`, `account-refresh-route.test.ts`: shapes above, including the conflict message.
  - `admin-removal.test.ts`: a non-creator (previously admin) gets 403 on cube PUT, cube cards write, draft tournament creation; `canEdit` false for non-creators in `GET /api/cubes`; `/api/settings` and `/api/admin/season` no longer exist (import fails / route file absent).
  - Email-only actor (`discordUserId: null`) can create and read a draft, write a cube, save a deck and create a duel: extend the existing route tests' fixtures with one email-only case each.
- [ ] **Step 2: Run** the new files → FAIL.
- [ ] **Step 3: Implement** the modules and route changes; delete the listed files; rewrite every `vi.mock("@/lib/discord-web-access")` / guild-membership / guild-admin mock (73 files) to mock `@/lib/web-access` or `@/lib/session-identity` instead, keeping each test's intent; drop NextAuth-specific test helpers.
- [ ] **Step 4: Run** `npm test --workspace=packages/web` and `npx tsc --noEmit -p packages/web` → PASS except documented load-only timeouts. `rg -n "next-auth|NEXTAUTH|discord-web-access|checkDiscordWebAccess|verifyDiscordGuild|\"admin\"" packages/web/src packages/web/app packages/web/proxy.ts` returns only intentional hits, listed in the report.
- [ ] **Checkpoint:** report; the orchestrator removes `next-auth` from the lockfile (`npm uninstall next-auth --workspace=packages/web`), reruns the web suite, reviews and commits `feat(web): Clerk sessions resolve to users; remove NextAuth and admin role`.

---

### Task 5: Signed-cookie E2E login (Codex)

**Files:**
- Modify: `packages/e2e/stack/{env,start,prepare,login-auth,login,fetch-stub,seed}.mjs`, `packages/e2e/tests/auth.setup.ts`, `packages/e2e/tests-unit/login.test.ts`, `packages/e2e/README.md`, any Playwright readiness/helper that polls `/api/auth/*`.

**Interfaces:**
- Consumes (T4, exact): `POST /api/test-auth/session {userId, secret}` → cookie `dd_e2e_session`; `GET /api/auth/session` → `{user:{id, discordUserId}}`; gate `E2E_AUTH=1` + `E2E_AUTH_SECRET` ≥ 32 chars; dummy publishable key `pk_test_Y2xlcmsuZXhhbXBsZS5jb20k`.
- Produces: `authenticatePlayer(api, player, secret, webUrl)` posts `{userId: player.userId, secret}`, expects 200, then checks `/api/auth/session` returns `id === String(player.userId)`; seeded players include one email-only user (`discord_user_id NULL`) used by at least one existing duel spec via a new `p6` key or by switching `p5`.

- [ ] **Step 1:** Update `tests-unit/login.test.ts` first: posts JSON to `/api/test-auth/session` (no CSRF), rejects identity mismatch, rejects short secrets in `login.mjs` manual mode, never sends `discordId`. Run `npx vitest run packages/e2e/tests-unit` → FAIL.
- [ ] **Step 2:** Implement: remove `/api/auth/csrf` and the Credentials callback; `start.mjs` web env drops `DISCORD_CLIENT_ID/SECRET/TOKEN`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `AUTH_URL`, `AUTH_TRUST_HOST`, `E2E_STUB_GUILD_ID`, `E2E_STUB_MEMBER_IDS`; adds `WEB_URL`, `E2E_AUTH=1`, `E2E_AUTH_SECRET`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (dummy), `DISCORD_BOT_ENABLED=0`; `env.mjs` drops `E2E_NEXTAUTH_SECRET`; `fetch-stub.mjs` deletes the Discord guild-member stub (`:105-112`) and keeps card/image stubs; `prepare.mjs` builds web with `E2E_AUTH=1` and the dummy key in the build env and records `{ wsUrl, e2eAuth: true, clerkPublishableKey }` in the build stamp so a non-E2E build is never reused.
- [ ] **Step 3:** Run the unit tests → PASS. Report the orchestrator commands: `npm run e2e` (full), `npx playwright test tests/auth.setup.ts` (fast gate), expected results against the PR 1 baseline (40 environment-only failures are listed in `/tmp/alpha-access-pr1-evidence/review.md`).
- [ ] **Checkpoint:** orchestrator runs the E2E commands after T4 merges, reviews and commits `test(e2e): signed-cookie login replaces NextAuth credentials`.

---

### Task 6: Discord I/O off in web routes and libs (Codex)

**Files:**
- Modify: `packages/web/src/lib/env.ts` (add `discordBotEnabled: process.env.DISCORD_BOT_ENABLED === "1"`; `webUrl` from `WEB_URL`), `src/lib/notify.ts` (announcer is a no-op `{ announce: async () => ({ ok: false, error: "discord_disabled" }) }` when disabled and never constructs the bot transport), `src/lib/announce-bot.ts` (`webBaseUrl` order: `WEB_URL`, then request origin; delete `NEXTAUTH_URL`/`AUTH_URL`; `sendDuelInvite`/`announceDuelInvite` return `false` immediately when disabled), `src/lib/bug-report-github.ts:36` (`WEB_URL`), `app/api/discord/channels/route.ts` (404 `discord_disabled` when disabled, before any token read), `app/api/tournaments/[slug]/announce/route.ts` (404 when disabled; never 502 for a disabled bot), `app/api/drafts/route.ts:118-124` (channel optional: `resolvedChannelId = channelId || env.discordDefaultChannelId || null`, no 500), every `announcer.announce` caller listed in the inventory (`drafts/route.ts:157,222`, `drafts/[slug]/route.ts:340`, `tournaments/[slug]/route.ts:426`, `report/route.ts:178`, `complete/route.ts:43`, `matches/[tmId]/result/route.ts:60`, `matches/[id]/approve/route.ts:46,50`, `matches/[id]/deny/route.ts:46`) to skip when disabled, `app/api/duels/route.ts:108-132` and `tournaments/[slug]/matches/[tmId]/duel/route.ts:79-98` (response `{ session, series, shareUrl }`; drop `notified`; no invite calls when disabled), and the server pages/APIs that pass capability to UI: `app/(app)/drafts/new/**`, tournament lobby page, duel creator data → `discordEnabled: boolean` prop/field.
- Test: extend each listed route's tests; `packages/web/tests/discord-disabled.test.ts` (new, cross-route).

**Interfaces:**
- Consumes: T4 `requireWebAccess` shape.
- Produces (T7 relies on these): `env.discordBotEnabled`; draft create/theme pages pass `discordEnabled` to `CreateDraftForm`/`CreateThemeDraftForm`; tournament lobby page passes `discordEnabled` to `TournamentLobby`; `POST /api/duels` and tournament-duel responses include `shareUrl: string` (absolute, from `duelUrl(slug)`), no `notified`; `src/components/duel/api.ts` type drops `notified?`, adds `shareUrl`.

- [ ] **Step 1: Write failing tests:** with `DISCORD_BOT_ENABLED` unset/`0`/`true`: the announcer transport/fetch is never called by any listed route (spy on `httpTransport`/global `fetch`), each route still returns its existing success status and WS broadcasts still fire; channels and announce routes return 404 `discord_disabled`; draft POST without channel and without default channel → 201 with `channel_id` NULL; duel create returns `shareUrl` built from `WEB_URL`; with `DISCORD_BOT_ENABLED=1` the old behaviour is unchanged (one test per route family).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test --workspace=packages/web`, `npx tsc --noEmit -p packages/web` → PASS; `rg -n "NEXTAUTH|AUTH_URL" packages/web/src packages/web/app` → no hits.
- [ ] **Checkpoint:** orchestrator reviews and commits `feat(web): skip Discord I/O when the bot is off; channels optional; share links for duels`.

---

### Task 7: Account page, shell and de-Discord UI (Sonnet `ui-designer`)

**Files:**
- Create: `packages/web/app/(app)/settings/account/[[...account]]/page.tsx`, `.../account-panel.tsx` (client: themed `<UserProfile path="/settings/account" routing="path" appearance={...}/>`; on mount, on window focus and after `?refresh=1` calls `POST /api/account/refresh` and shows the conflict message when returned; E2E mode renders offline controls instead), `packages/web/src/components/layout/legal-links.tsx`.
- Modify: `packages/web/app/(app)/settings/page.tsx` → `redirect("/settings/account")`; move `DuelViewToggle` into the account page; delete `src/components/settings/{season-control,announcement-toggles,announcement-posts}.tsx` and tests; `src/lib/nav-items.ts:18`, `src/components/layout/{shell-model,nav-list,sidebar,mobile-drawer,account-menu}.tsx` (Settings → "Account" at `/settings/account`; account menu subtitle shows email or "Signed in" instead of "Signed in with Discord"; sign out uses Clerk `useClerk().signOut({ redirectUrl: "/sign-in" })`, or `POST /api/test-auth/sign-out` in E2E mode via a server-provided flag; legal links in the account menu and a small shell footer); `src/hooks/use-shell-account.ts` (unchanged contract); `create-draft-form.tsx` and `create-theme-draft-form.tsx` (channel picker and fetch rendered only when `discordEnabled`; copy at `:96/98/118`, `:129/158` adjusted); `tournament-lobby.tsx:117,191-192` (Announce button and command hint only when `discordEnabled`); `dashboard/welcome-panel.tsx`, `app/(app)/dashboard/page.tsx:160,184`, `tournaments/page.tsx:68`, `drafts/page.tsx:91`, `draft/lobby/invite-panel.tsx`, `create-tournament-form.tsx:98`, `duel/room-settings.tsx:16` (remove `/draft`, `/event`, `/duel` command hints; keep in-app instructions); `duel/creator.tsx:85,118,182,195,375-377` (after creating a challenge show the share URL with a "Copy the link" button; remove DM sent/failed copy); admin copy at `app/(app)/draft/[slug]/page.tsx:75`, `draft-summary-view.tsx:73,314,377`, `room/finale.tsx:17,69`, `pool-api.ts:207`, `pool-model.ts:374`, `cubes-library-list.tsx:207` → creator-only wording.
- Test: update the matching component tests; `packages/web/tests/components/settings/account-page.test.tsx`, `packages/web/tests/components/shell/legal-links.test.tsx`.

**Interfaces:**
- Consumes: T4 `/api/account/refresh` contract and `isE2EAuthEnabled` (server-side, passed as a prop); T6 `discordEnabled` props and `shareUrl`.
- Produces: no new contracts.

- [ ] **Step 1:** Update/add component tests: no channel select or `/draft` hint when `discordEnabled` is false; Announce hidden; duel creator shows "Copy the link" and copies `shareUrl`; nav has no `/settings` guild item and has Account; legal links are the two constant URLs; account page calls refresh on focus and shows the exact conflict message. Run → FAIL.
- [ ] **Step 2:** Implement. `<UserProfile/>` appearance uses existing CSS tokens (dark, purple/gold accents sparingly) via Clerk `appearance.variables` and `elements` class hooks; no copied Clerk CSS.
- [ ] **Step 3:** Run web tests and typecheck → PASS.
- [ ] **Step 4: Render review** at 1440×900 and 390×844: dashboard, drafts/new (both forms), tournament lobby, duel creator after challenge, account page (E2E offline mode and, once T12 is done, the real `<UserProfile/>`), sidebar and mobile drawer. Post before/after in chat.
- [ ] **Checkpoint:** orchestrator reviews code and renders, commits `feat(web): account page, shell without guild settings, Discord controls hidden`.

---

### Task 8: Waitlist bridge to Clerk (Codex)

**Files:**
- Modify: `packages/web/app/api/waitlist/route.ts`, `packages/web/tests/waitlist-route.test.ts`, `site/public/app.js:88-105,327-338` (wording from T11 only).

**Interfaces:**
- Consumes: T1 `createClerkBackend`, `ClerkBackendError`; `createWaitlistService(db).join`.
- Produces: unchanged success contract (201 joined / 200 exists / 400 / 415 / 429); new failure contract: Clerk failure or missing `CLERK_SECRET_KEY` → JSON **503** `{ "error": "retry_later" }`, native form → 303 `/?waitlist=retry#join`; local row is kept. Storage failure keeps returning 500 JSON but native forms now get 303 `/?waitlist=error#join`.

- [ ] **Step 1: Failing tests:** joined and exists both call `createWaitlistEntry({ emailAddress: normalized, notify: true })` exactly once after `join`; honeypot calls neither; rate-limited and invalid requests call neither; Clerk 5xx/timeout/429 → 503 JSON and 303 retry for forms, with the local row present; missing secret → 503; Cache-Control `no-store` on every response; Clerk is never called inside a DB transaction (assert call order: `join` resolved before backend call).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; `app.js` maps status 503 / `retry_later` to the retry message and the no-JS map gains `retry` and `error` outcomes (copy supplied by T11). **Step 4:** Run the route tests and any `site/` tests → PASS.
- [ ] **Checkpoint:** orchestrator reviews and commits `feat(waitlist): create Clerk waitlist entries; retryable failure`.

---

### Task 9: Owner scripts in the worker image (Codex)

**Files:**
- Create: `packages/worker/src/ops/cli.ts`, `packages/worker/src/ops/{season,merge-users,clerk-precreate-users,clerk-reconcile-waitlist,report}.ts`, `packages/worker/tests/ops/{season,merge-users,clerk-precreate-users,clerk-reconcile-waitlist,cli}.test.ts`.
- Modify: root `package.json` (`"ops": "tsx packages/worker/src/ops/cli.ts"`), `packages/worker/tsconfig.build.json` if `src/ops` is excluded.

**Interfaces:**
- Consumes: T1 `createClerkBackend`, `userHistory`, `createUserService`; shared `createSeasonService(db).{getActive,start,end}`; `openDatabase(DATABASE_PATH)`; env `DISCORD_GUILD_ID`, `CLERK_SECRET_KEY`.
- Produces: CLI `node packages/worker/dist/ops/cli.js <command> [flags]`, dry-run by default, `--apply` to write, `--report <path>` (default `/app/data/ops-reports/<command>-<utc>.json`, created mode 0600). Commands:
  - `season status | start [--name <text>] [--actor <usersId>] | end` — uses `DISCORD_GUILD_ID`; `--actor` must be an existing `users.id`.
  - `merge-users --source <usersId> --target <usersId>` — dry-run prints both identities (IDs, Clerk/Discord presence, not emails) and `userHistory` counts plus affected rows. Apply, in one `BEGIN IMMEDIATE`: refuse if both have a Clerk ID or both have a Discord ID (owner resolves in Clerk first); move ownership columns to target; for each guild, if only source has a player, set `players.user_id = target`; if both have a player in the same guild, repoint every player-reference column from the history table (including `draft_cards.picked_by_player_id`, `draft_picks.player_id`, `draft_passes.player_id`) from source player to target player and delete the source player, aborting the whole transaction and writing the report on any constraint failure; move the Clerk/Discord ID if only source has it; delete source user; `PRAGMA foreign_key_check` must be empty before commit. The report lists `config_json.themeAssignments` and `tournament_matches.metadata_json.winnerId` values that reference the source player for manual review; they are not rewritten. Prints the reminder to stop writers and revoke the source's Clerk sessions first.
  - `clerk-precreate-users` — selects users with `clerk_user_id IS NULL`, `email_verified = 1`, `discord_user_id IS NOT NULL`; duplicate local emails are all reported and skipped; username = local `username` sanitized to `[a-z0-9_]`, 4–64 chars, deduped against local users and `listUsers({ username })`; per user: `listUsers({ externalId: String(id) })` first (resume) → bind if found and its email matches, else conflict; `listUsers({ emailAddress })` non-empty → conflict, never bind by email; else `createUser({ emailAddress, username, externalId: String(id), skipPasswordRequirement: true })` (pass `skipLegalChecks: true` only with `--skip-legal-checks`, and only here); persist `clerk_user_id` and chosen username immediately after each success; 429 waits `retryAfterMs` (default 2 s), at most 3 tries per call; report counts and per-user outcome without emails.
  - `clerk-reconcile-waitlist [--notify|--no-notify]` (default notify) — for each `waitlist_signups` row: skip if `listUsers({ emailAddress })` non-empty; `listWaitlistEntries({ query: email })` with status `rejected` or `revoked` → skip (never re-invite); existing pending/invited → skip; else `createWaitlistEntry`. Dry-run makes **no** remote writes but may perform the read calls only with `--check-remote`; plain dry-run is offline.

- [ ] **Step 1: Failing tests** with temp-file DBs and a fake `ClerkBackend`: dry-run writes nothing (DB checksum and fake call log unchanged); season start twice fails cleanly; season end with none active is a no-op message; merge with only-source player, same-guild collision success, collision with unique conflict rolls back fully, both-Clerk refusal, FK check; precreate resume by externalId, email conflict never binds, duplicate local emails skipped, 429 retry then success, persistence after each user (crash after 2 of 3 → rerun creates only the third); reconcile skips existing users and revoked/rejected entries; CLI parses flags and exits non-zero on unknown commands; report files are 0600 and contain no email addresses or secrets.
- [ ] **Step 2:** Run `npx vitest run packages/worker/tests/ops` → FAIL. **Step 3:** Implement. **Step 4:** `npm test --workspace=packages/worker`, `npm run build --workspace=packages/worker` → PASS; `node packages/worker/dist/ops/cli.js --help` lists the four commands.
- [ ] **Checkpoint:** orchestrator reviews and commits `feat(worker): owner ops CLI for seasons, merges, Clerk import and waitlist reconcile`.

---

### Task 10: Deploy, env and docs (Codex)

**Files:**
- Modify: `docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.staging.yml`, `Dockerfile`, `.github/workflows/{deploy,deploy-staging,test}.yml`, `scripts/staging/{make-staging-env.sh,health-check.sh,remote-deploy.sh}`, `scripts/smoke-test-site.sh`, `.env.example`, `.gitignore` (`.env.local`, `**/.env.local`), `CLAUDE.md`, `README.md`, `docs/architecture.md`, `docs/deployment/vm-runbook.md`, `docs/deployment/domains.md` (replaces `domain-cutover.md`, which the marketing peer deletes on `docs/domains-cleanup`; merge that into the PR 2 base first, and fill its Clerk DNS/env placeholder), staging docs.

**Interfaces:**
- Consumes: env names fixed in Global Constraints and T4/T6/T9.
- Produces:
  - Compose (prod/dev/staging): no `bot` service. `ws` sets `WEB_URL=${WEB_URL:?WEB_URL is required}`. `web` gets an explicit `environment:` list (no broad `env_file: .env`): `DATABASE_PATH`, `CARD_IMAGE_CACHE_DIR`, `WEB_URL`, `MARKETING_URL`, `DISCORD_GUILD_ID`, `DISCORD_BOT_ENABLED=0`, `CLERK_SECRET_KEY`, `WS_INTERNAL_*`, `DUEL_INTERNAL_*`, `NEXT_PUBLIC_WS_URL`, `MULTIPLAYER_TABLES`, `DUEL_FX_LAB`, `DRAFT_TEST_BOTS`, `GITHUB_*` bug-report vars (read the current file for the complete set web actually reads; list them in the report). `worker` sets `DISCORD_BOT_ENABLED=0` and drops `BOT_ANNOUNCE_URL`.
  - Dockerfile `build` stage: `ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` exported only to the web build; the `bot` target stays buildable.
  - `deploy.yml`: pass the publishable key as a build arg from a repository variable; never pass `CLERK_SECRET_KEY` to builds; remove `bot` from the service list/stop/up; health checks stop probing `/api/auth/providers` and instead require `/sign-in` 200 and `GET /api/auth/session` 200 with body `null`.
  - `test.yml`: web build uses the dummy key; bot typecheck/tests remain.
  - Staging: `make-staging-env.sh` copies `CLERK_SECRET_KEY`/publishable key from a staging-specific source, drops `NEXTAUTH_*`, `AUTH_URL`, `DISCORD_CLIENT_*`, `DISCORD_TOKEN`; `remote-deploy.sh` keeps worker-owned eviction.
  - Docs: `CLAUDE.md` access model (Clerk, no admin, public paths, E2E cookie, owner CLI), bot section (out of Compose), env; runbook (owner CLI usage including `docker compose run --rm --no-deps -e CLERK_SECRET_KEY worker node packages/worker/dist/ops/cli.js …`, stop writers before merge apply); `domains.md`: Clerk DNS/email and env section (its placeholder), real auth checks, rollback to the PR 1-compatible release, waitlist-email wording. If `docs/domains-cleanup` has not merged when T10 runs, edit nothing under `docs/deployment/domain*` and report it for T13.

- [ ] **Step 1:** Edit files. **Step 2:** Codex runs `npx vitest run` for any script tests and `bash -n` on every changed shell script. **Step 3:** Report the orchestrator commands with expected results: `docker compose --env-file <dummy> config` for each variant (expect no `bot` service, `ws.environment.WEB_URL` equal to the dummy `WEB_URL`, config failure when `WEB_URL` is missing, no `CLERK_SECRET_KEY` under any service except `web`), `docker build --target web --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k .`, `docker build --target worker .`, `docker build --target bot .`, `docker history` of the web image shows no secret.
- [ ] **Checkpoint:** orchestrator runs those commands, reviews and commits `chore(deploy): bot out of Compose, Clerk keys scoped, WS origin from WEB_URL`.

---

### Task 11: Privacy and legal coordination (orchestrator with the marketing peer)

**Files:**
- Modify (after agreement): `site/public/privacy.html`; read-only check of `site/public/terms.html`.

- [ ] **Step 1:** Draft the privacy additions: Clerk receives waitlist emails before approval (replace "Once you are invited"); the app keeps a `users` table (username, display name, email and its verification, linked Discord ID); verified Discord email captured at sign-in since PR 1; existing members' accounts pre-created in Clerk from verified emails; contact `support@duelingdomain.com`. Draft the `app.js` retry message ("We couldn't add you just now. Try again in a minute.").
- [ ] **Step 2:** Send the draft to the marketing peer for wording and conflicts with their in-flight work; present the final text to the owner for approval. The peer cannot approve.
- [ ] **Step 3:** Apply the approved text; verify `terms.html` exists at `https://duelingdomain.com/terms` after deploy; commit `docs(site): privacy policy covers Clerk waitlist, users and imports`.

---

### Task 12: Clerk dev instance (orchestrator, needs the owner's go)

- [ ] **Step 1:** With the owner's explicit go, `clerk whoami` (expect the owner's account), then `clerk apps create "Dueling Domain"` and record the app/instance IDs (not keys) in evidence.
- [ ] **Step 2:** Inspect config, then `clerk config patch` for: waitlist sign-up mode; email address required + verified by email code; password on; username required; Discord OAuth on (dev shared credentials first; custom credentials require the owner to add Clerk's redirect URI to the Discord application); passwordless (email code/link sign-in), passkeys and phone off; legal consent required with the two marketing URLs; maximum session lifetime 30 days, no inactivity timeout; bot protection on. Save a sanitized readback/diff.
- [ ] **Step 3:** `clerk env pull` into `packages/web/.env.local` (gitignored by T10; verify with `git check-ignore`). Never copy dev keys elsewhere.
- [ ] **Step 4:** Owner sets the waitlist/invitation email templates in the dashboard (Pro); orchestrator records what was set.

---

### Task 13: Integrate and verify

- [ ] **Step 1: Merge order** into `alpha-access-pr2`: T0, T1, T2, T3a, T10, T4, T5, T8, T9, T3b, T6, T7, T11. After each merge: `npm run build --workspace=packages/shared` and the touched package's tests.
- [ ] **Step 2: Full checks** (outside the sandbox): `npm run typecheck`; all six package test suites plus worker; `npm run build`; `npm run e2e` compared with the PR 1 baseline; `npm run test:engine` only if duel-server changed; compose configs, docker builds and secret checks from T10.
- [ ] **Step 3: Dev Clerk manual checklist** (needs T12 and the owner for real emails): every step and error from the spec's "2 manual Clerk dev" row, including invitation ticket + password, invitation ticket + Discord through `/sso-callback` with missing username/consent, taken username, wrong password, forgot password → code → new password, signup code resend/expired, client trust (record whether enabled), not invited, banned user, service trouble (block `api.clerk.com` in the browser), pack-tear success only after finalize, legal links, 30-day session, no passwordless/passkeys. Record the actual Clerk error codes and update `auth-errors.ts` if they differ.
- [ ] **Step 4: Import and linking rehearsal** on a COPY of the production DB against the dev instance: `ops clerk-precreate-users` dry-run then apply; sign in with Discord as a pre-created member and prove the same Clerk ID, `users.id` and `players.id`; exercise each linking branch with dev accounts; merge-users dry-run and apply on the copy; FK and integrity checks. Never reuse these dev Clerk IDs in production; delete the copy afterwards.
- [ ] **Step 5: Render review with the owner** of every auth step/error at both sizes against the committed shots, the pack-tear frame, account page, shell and de-Discord screens.
- [ ] **Step 6: Bounded review:** one Opus review of the whole branch diff against `alpha-access`, one fix pass, one re-review. Remaining P2s become follow-up issues.
- [ ] **Step 7:** Report to the owner with evidence; push and open the PR only on the owner's go.

---

## Plan self-review

1. **Spec coverage.** Clerk proxy/resolver/sync/dedup/503/401 → T4. Linking algorithm, history, concurrent first access → T1/T4. Admin removal (web + shared) → T4/T1; season script → T9. Custom flows, every step/error, CAPTCHA, ticket lock, SSO callback, pack-tear, safe returns → T2/T3a/T3b. `/access`, `/settings/account` with `<UserProfile/>`, forced sync on return/focus, conflict message → T3b/T7/T4. Discord I/O off, 404 not 502, channels optional, hints/pickers/Announce hidden, Copy the link → T6/T7. Waitlist bridge, 503 retry, native-form retry → T8. Reconcile, precreate, merge scripts → T9. Signed-cookie E2E, no Clerk network in test mode, build stamp → T4/T5. Bot out of Compose, key scoping, WS origin, health checks, scoped web env, docs, cutover doc (now `domains.md`) → T10. Privacy extension and legal links → T11/T3a/T7. Clerk configuration → T12. Manual dev proof, realistic rehearsal, render review, bounded review → T13.
2. **Placeholders.** None; T7's exhaustive file list depends on the inventory and each item names its line. T10's web env list must be read from the current Compose file, and the task requires listing it.
3. **Type consistency.** `ClerkProfile`, `LinkOutcome`, `LinkConflict`, `userHistory/hasHistory`, `ClerkBackend` (T1) are consumed with the same names by T4/T8/T9. `AuthFlowState`/`AuthStep`/`FieldName`/`AuthBanner`/`CodePurpose` (T2) match T3a's props. Cookie name/format/route (T4) match T5. `discordEnabled` and `shareUrl` (T6) match T7. `requireWebAccess`/`auth()` shapes match Global Constraints.
4. **Review Focus.** Each line has an owning test: race (T1 Step 3, T4 Step 1), WS origin (T10 Step 3 compose assertions), ticket + Discord (T2 rule 5/7 tests, T13 Step 3), no bot HTTP (T6 Step 1), forged cookie/gate per request (T4 Step 1, T5 build stamp).
