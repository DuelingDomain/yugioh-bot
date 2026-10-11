# Active replay fork recovery implementation plan

> **For agentic workers:** Execute inline with the executing-plans and test-driven-development skills. The user has authorized implementation, commits and push on `replay/fix-engine` in this checkout.

**Goal:** Let a currently authorized owner find and cancel their abandoned active forks, and let the UI discover that recovery route when the four-fork limit is reached.

**Architecture:** Add the signed host operation `fork-list`, scoped by guild and the resolved creator user ID. Reuse the existing owner/creator access validation for every returned fork, without loading engines or requiring the source to exist. Expose it through an owner-gated `GET /api/admin/duels/forks`; return private, non-cacheable responses and recheck identity after the host wait. Fork-limit responses carry the quota and route URL instead of private fork metadata.

**Tech stack:** TypeScript, Next.js App Router, better-sqlite3, Vitest, Node 22.

**Contracts:**

- List success: HTTP 200 `{ forks: [{ slug, sourceSlug, format, createdAt, lastActivityAt }], limit: 4 }`, including `{ forks: [], limit: 4 }` when empty. Timestamps use the existing stored UTC format (`YYYY-MM-DD HH:MM:SS`); null activity falls back to creation. Order newest creation first, then descending ID.
- Only `kind = 'replay-fork'`, `status = 'active'`, caller guild and matching `setup.replayFork.ownerUserId` rows qualify. Each row must pass `assertReplayForkAccess`.
- The existing `POST /api/duels/{slug}/fork/cancel` cancels each result; cancellation removes it from the next list and frees a slot.
- The web route ignores no user-supplied filters: reject any query parameters with HTTP 400. Anonymous requests return 401; unauthorized owners return 404; access failures retain the existing 503 behavior. Every response has `Cache-Control: private, no-store`.
- Fork-limit response: HTTP 429 `{ error: string, code: 'FORK_LIMIT', limit: 4, forksUrl: '/api/admin/duels/forks' }` on launch and restart, including the transaction quota checks. The web transport preserves these fields only for `FORK_LIMIT`.
- No automatic cancellation: a long pause is valid during replay analysis. Explicit cancellation recovers capacity without losing paused branches or introducing a worker/command expiry race.

## Task 1: Host list operation

Files: `packages/duel-server/src/replay-fork.ts`, `packages/duel-server/src/host.ts`, `packages/duel-server/tests/host-replay-fork.test.ts`.

- [ ] Add host tests for exact metadata, activity updates/fallback, empty list, deterministic order, guild/creator isolation, cancelled/completed/interrupted exclusion, source deletion, no worker reads/spawns, cancellation freeing capacity, signature/mapping/allowlist failures and corrupt metadata denial.
- [ ] Run the touched host file and confirm the new list tests fail because the operation is absent.
- [ ] Add `listActiveReplayForks(db, actor)` with a resolved-owner SQL query and per-row access checks; return `{ forks, limit }` from `fork-list` before source/target lookup.
- [ ] Run the touched host file, review the diff, remove generated engine `.build` output, and commit with the requested trailers.

## Task 2: Owner-gated list route

Files: `packages/web/app/api/admin/duels/forks/route.ts`, `packages/web/src/lib/duel-host.ts`, `packages/web/tests/replay-fork-routes.test.ts`.

- [ ] Add route tests for the host payload, response contract, empty list, no-store on success/errors, rejected query filters, session/owner failures, host errors and access/identity changes during the wait. Exercise the existing cancel route using a returned slug.
- [ ] Run the touched web test file and confirm the new route tests fail because the route is absent.
- [ ] Add `fork-list` to host op typing/private replay error handling; implement the route with pre/post `requireReplayOwnerActor` checks and exact identity comparison.
- [ ] Run the touched web test file, review the diff, and commit with the requested trailers.

## Task 3: Fork-limit recovery data

Files: `packages/duel-server/src/replay-fork.ts`, `packages/duel-server/src/host.ts`, `packages/duel-server/tests/host-replay-fork.test.ts`, `packages/web/src/lib/duel-host.ts`, `packages/web/tests/duel-host-errors.test.ts`, `packages/web/tests/replay-fork-routes.test.ts`.

- [ ] Extend launch/restart quota tests for the exact 429 body; cover a quota reached during detached replay. Add transport/route tests proving the recovery URL/quota survive and unrelated fields remain excluded.
- [ ] Run touched tests and observe failures for missing recovery data.
- [ ] Centralize quota error metadata on `ReplayForkLaunchError`; serialize it in the host; preserve the allowed fields in the web error parser for `FORK_LIMIT` only.
- [ ] Run the final touched test files, review changes and commit with the requested trailers.

## Verification and delivery

- Engine command (from `packages/duel-server`): `PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH DUEL_REQUIRE_CORES=1 prlimit --core=0 -- node ../../node_modules/vitest/vitest.mjs run tests/host-replay-fork.test.ts --config vitest.config.ts --testTimeout=15000`.
- Web command (from checkout root): `PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH prlimit --core=0 -- node node_modules/vitest/vitest.mjs run packages/web/tests/replay-fork-routes.test.ts packages/web/tests/duel-host-errors.test.ts --config packages/web/vitest.config.ts`.
- [ ] Review the complete diff and obtain code review; address material issues and rerun only affected touched tests if needed.
- [ ] Confirm engine `.build` output is removed, no components changed, clean working tree and exact branch.
- [ ] Push `replay/fix-engine` to `origin` without a PR; verify the remote full SHA matches local HEAD.
- [ ] Report full SHA, exact contracts/cancel route, expiry choice, touched test results and files outside `packages/duel-server`.

All commits end with:

```text
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Jo347fwscScmug26ujsNN2
```

Do not start or alter port 3000. Wait for long jobs in the foreground and terminate processes only by PID if necessary.
