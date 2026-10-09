# Draft host termination implementation plan

**Goal:** Let hosts and verified Discord guild admins end or cancel a web draft in any live phase.

**Architecture:** Reuse `completeDraft` and `cancel` inside immediate SQLite transactions. Add small terminal functions without changing pick/pass rotation. Web routes share guild-scoped authorization and post-commit notification through existing broadcasters and announcers.

**Stack:** TypeScript, better-sqlite3, Next.js App Router, Vitest; Node 22.

- [x] Inspect schema, shared lifecycle, `/draft cancel`, cleanup, timers, web routes and linked tournaments on fetched `origin/main`.
- [x] Add failing lifecycle tests in `packages/shared/tests/services/draft-terminal.test.ts` for lobby, uneven picks, theme/Extra, rollback, idempotence, bot/manual picks and tournament behavior.
- [x] Implement `endNow` and guarded, idempotent cancellation in `packages/shared/src/services/drafts.ts`, reusing completion/deck saving and lobby disarming.
- [x] Add failing route tests in `packages/web/tests/drafts-terminal-routes.test.ts` for host/non-host/admin, guild isolation, response and broadcast contracts.
- [x] Restore existing Discord access helpers removed by the app identity migration; authorize linked Discord admins through `src/lib/discord-web-access.ts`.
- [x] Add dedicated `POST /api/drafts/[slug]/end` and `/cancel` with a shared handler and existing WS `status`/Discord notifications.
- [x] Add concurrent SQLite connection tests against manual picks, bot picks and expiry; test stale snapshots and terminal behavior in both deployed worker and shelved bot timers.
- [x] Run only affected test files and TypeScript checks for shared/web/bot/worker; review the final changes. Final validation: 242 targeted tests passed; four TypeScript checks passed; production/staging Compose validation passed.
- [x] Document the UI API contract in `docs/api/draft-host-end.md`, including the current auth/timer architecture and optional runtime admin-verification token.

Delivery steps: commit each logical change with the requested trailers, push without PR/merge, then remove generated/dependency directories from the worktree.
