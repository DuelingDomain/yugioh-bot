# Explicit Duel Lobby Seats Implementation Plan

**Goal:** Enter tables as a spectator and choose a human seat explicitly, with reversible lobby-only participation.

**Architecture:** Keep room/invite reads spectator-safe. Split spectator entry (`join`) from atomic seat claims (`takeSeat`), retain the existing `leave` operation, and reuse websocket invalidation for room updates. Public access remains limited to Discord guild members; private access still requires a seat, organizer ownership, or an invite grant. There is no spectating-disable setting in the current settings model.

**Tech stack:** TypeScript, better-sqlite3, Next.js, React, SWR, Socket.IO, Vitest.

The user's task is the approved behavior specification. Execute in the current branch; do not create worktrees, push, deploy, or restart services.

1. Shared service and regression coverage
   - [x] Add failing tests for default spectator entry, explicit seats, deck/ready reset on leaving, private/guild access, real concurrent claims, RPS locks, started games, and later series lobbies.
   - [x] Add `takeSeat` to `packages/shared/src/services/duels.ts`, using an immediate SQLite transaction and the existing seat constraints. Enforce lobby, no-opening, and no-series guards.
   - [x] Keep `join` read-only and make accessible lobbies visible in the table list.
   - [x] Update shared and duel-server test fixtures to take seats explicitly.
2. Routes and UI
   - [x] Add failing route tests and lobby component tests for open/full tables, seat changes, errors, permissions, and locked tables.
   - [x] Add `POST /api/duels/[slug]/seat`, accepting a seat index and broadcasting `notifyDuelChange` after a successful claim.
   - [x] Add `takeDuelSeat` in `packages/web/src/components/duel/api.ts`; wire it into `room.tsx`. Leaving refreshes the same room.
   - [x] Put “Take seat N” on open seat cards and “Watch instead” on non-host lobby controls in `room-lobby.tsx`. Hide seat controls for openings, fixed series, full tables, and bot seats. Preserve the saved-deck/Ready flow.
   - [x] Verify invite acceptance opens the room as a spectator and retains private grants after leaving. Verify the room realtime callback updates a spectator after claims and releases.
   - [x] Show Join and Watch on accessible open lobbies in `lobby.tsx`, and Full — watch on full lobbies. Both entry actions open the room as a spectator.
3. Verification and commits
   - [x] Run focused red/green tests before the full suites.
   - [x] Run `npm test --workspace=packages/shared`.
   - [x] Run `npx vitest run packages/web/tests -c packages/web/vitest.config.ts`; rerun known flaky DB route tests alone if necessary.
   - [x] Run duel-server tests with the supplied `DUEL_DATA_DIR` (read-only engine data).
   - [x] Run `npm run typecheck`, review the diff, and commit logical changes with the requested co-author trailer. Exclude `.agents/` and `skills-lock.json`, restore changed `next-env.d.ts`, and remove temporary output.

Validation: shared 372 passed / 0 failed (41 files); web 2,333 passed / 0 failed (208 files); duel-server 324 passed / 0 failed (23 files, supplied engine data directory); typecheck 5 successful / 0 failed workspaces. No flaky reruns were needed. The web suite emitted jsdom canvas/navigation warnings. Read-only code review found no material defects.
