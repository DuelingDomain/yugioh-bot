# Bug report flow implementation plan

## Review corrections, 19 October 2026

The review supersedes the capture and privacy rules below. Apply the seven requested corrections in this worktree.

- [x] Add route and database integration tests. Confirm that the current code fails them.
- [x] Remove public duel references, reporter seats, and replay links. Mask the duel segment in the public page path. Apply account names only to player text and titles. Keep numbers and card names in trusted logs.
- [x] Add random `public_id` values. Backfill old rows in `migrate()`, add a unique index, and show the public reference on the owner page.
- [x] Set log failure reasons only for duel reports. Use a neutral reason if the duel check fails. Exclude `new` and `dev-presets` from duel slugs.
- [x] Retry capture only for 5xx, timeouts, and invalid data. Set a five-second capture request limit and a 35-second submit limit. Reuse identical submissions from the same player for ten minutes. Use a database transaction to prevent two saved submissions from opening two issues.
- [x] Keep the last 400 diagnostic log entries. Cap saved board data at 128 KiB and diagnostic JSON at 256 KiB. Record truncation or board omission in the saved data.
- [x] Run the report integration tests and typecheck all workspaces with Node 22 and `prlimit --core=0`. Remove generated build output. Review, commit with the required trailers, and push the branch without a PR.

**Goal:** Save the submitter, board, and duel log with each report. Keep public issues free of private data.

**Design:** Use the current Clerk session and `OWNER_USER_IDS` guard. Keep report identity and capture data in SQLite. Public issues keep an opaque report reference and public context only. Infer a missing duel slug from the duel page path. Never infer a previous duel from a general page. Capture the spectator board and public log on the server. Keep a bounded log tail and board in storage. Retry 5xx responses, timeouts, and invalid data once. Preserve the original host failure for this decision. File the issue even if capture fails, with a fixed reason that cannot expose internal error text. Keep existing GitHub label and duplicate handling.

**Stack:** Next.js, React, TypeScript, SQLite, Vitest integration tests.

## Tasks

- [x] Record the two open issues and the no-log cause in the requested local brief. Do not change gameplay.
- [x] Add route integration tests for capture retry, capture failure, missing slug, private storage, and owner access. Run them before implementation.
- [x] Extend the host `bug-context` response with the spectator board and full available public log. Use the stored public board after a duel. Give a fixed failure reason when a board is unavailable.
- [x] Extend report storage with a submitter snapshot and capture data. Read old report identities through `players.user_id -> users.id`. Add a guild-scoped owner report list with pagination.
- [x] Add guarded report list and saved-data routes. Add `/settings/bug-reports` to the existing Admin navigation. Show submitter, time, duel, and issue links. Do not send personal data to ordinary members.
- [x] Use the exact requested dialog copy. Add an explicit missing-log reason to public issues. Include the random reference `Report #<public_id>`.
- [x] Run typechecks and targeted integration tests. Review the change. Delete build output. Commit with both requested trailers. Push only `fix/bug-report-flow`. Do not open a PR.

## Verification

Use Node 22 and `prlimit --core=0` for Node commands. Build shared before consumer checks. Run report-route tests with the web Vitest config. Run host bug-context integration tests with the prepared local engine data. Use synthetic sessions and stub external HTTP in tests. Do not read `.env` files or call live GitHub write APIs.

## Capture and privacy rules

Success means the host supplies a spectator board with a log array. An empty log is valid before the first event. A 5xx host response, timeout, invalid response, or missing board causes one retry (two attempts total). A 4xx host response or other network error stops capture. General pages cause no capture call and record no log failure reason. A denied duel keeps no slug. Replay forks are rejected. Private diagnostics keep at most the last 400 log entries. The board is capped at 128 KiB and total diagnostic JSON at 256 KiB. Larger boards are omitted with a saved reason. Large log entries keep their text tail. The public issue remains capped at 15 lines. The saved identity has `userId`, `username`, and nullable `email`, read from the database inside the save transaction. Player text and the title remove stored account names, emails, and Discord IDs. The name list excludes numeric application user IDs. Trusted spectator log lines and page paths do not use the name list. Public page paths mask the duel slug. Public issues and comments have no reporter seat or replay link. Owner page and API checks run before any report read.

The exact form copy is: "Describe the problem. We save the board and the duel log with your report. A screenshot is optional."

Test paths: `packages/web/tests/bug-reports-route.test.ts`, `packages/duel-server/tests/host-bug-context.test.ts`. Run the former with `npx vitest run packages/web/tests/bug-reports-route.test.ts -c packages/web/vitest.config.ts`. Run the latter from the duel-server workspace with `npx vitest run tests/host-bug-context.test.ts --testTimeout=20000`. Use `TMPDIR=/dev/shm` for isolated SQLite test files to avoid slow disk commits.

## Verified result

All seven review points are corrected. The review also found a host status conversion that could cause an incorrect retry. Transport integration tests reproduced the failure before the correction and passed after it.

All 136 targeted integration tests passed: 106 web tests and 30 database service tests. The web tests cover the real dialog, routes, database, transport failure handling, submit deadline, and simultaneous submissions in separate route instances. Database tests cover old report ID migration, uniqueness, report storage, and account deletion. No new unit tests were added. A forced typecheck passed in all seven workspaces with Node 22 and `prlimit --core=0`. Generated shared build output and the web TypeScript build cache were removed.

Test files:
- `packages/web/tests/bug-reports-route.test.ts`
- `packages/web/tests/bug-reports-precheck-route.test.ts`
- `packages/web/tests/bug-report-flow.integration.test.tsx`
- `packages/web/tests/bug-report-host.integration.test.ts`
- `packages/shared/tests/services/bug-reports.test.ts`
- `packages/shared/tests/services/account-deletion.test.ts`

The required local brief is `data/briefs/open-bugs-2026-10-19.md` in the original repository workspace. This work does not change GitHub labels or send live issue comments.
