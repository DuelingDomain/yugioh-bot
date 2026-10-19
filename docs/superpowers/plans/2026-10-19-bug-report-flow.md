# Bug report flow implementation plan

**Goal:** Save the submitter, board, and duel log with each report. Keep public issues free of private data.

**Design:** Use the current Clerk session and `OWNER_USER_IDS` guard. Keep report identity and capture data in SQLite. Public issues keep an opaque report reference and public context only. Infer a missing duel slug from the duel page path. Never infer a previous duel from a general page. Capture the spectator board and full available public log on the server. Retry a failed or incomplete capture once. File the issue even if capture fails, with a fixed reason that cannot expose internal error text. Keep existing GitHub label and duplicate handling.

**Stack:** Next.js, React, TypeScript, SQLite, Vitest integration tests.

## Tasks

- [x] Record the two open issues and the no-log cause in the requested local brief. Do not change gameplay.
- [x] Add route integration tests for capture retry, capture failure, missing slug, private storage, and owner access. Run them before implementation.
- [x] Extend the host `bug-context` response with the spectator board and full available public log. Use the stored public board after a duel. Give a fixed failure reason when a board is unavailable.
- [x] Extend report storage with a submitter snapshot and capture data. Read old report identities through `players.user_id -> users.id`. Add a guild-scoped owner report list with pagination.
- [x] Add guarded report list and saved-data routes. Add `/settings/bug-reports` to the existing Admin navigation. Show submitter, time, duel, and issue links. Do not send personal data to ordinary members.
- [x] Use the exact requested dialog copy. Add an explicit missing-log reason to public issues. Include the opaque reference `Report #<id>`.
- [x] Run typechecks and targeted integration tests. Review the change. Delete build output. Commit with both requested trailers. Push only `fix/bug-report-flow`. Do not open a PR.

## Verification

Use Node 22 and `prlimit --core=0` for Node commands. Build shared before consumer checks. Run report-route tests with the web Vitest config. Run host bug-context integration tests with the prepared local engine data. Use synthetic sessions and stub external HTTP in tests. Do not read `.env` files or call live GitHub write APIs.

## Capture and privacy rules

Success means the host supplies a spectator board with a log array. An empty log is valid before the first event. A host error, throw, invalid response, or missing board causes one retry (two attempts total). General pages cause no capture call and record an outside-duel reason. A denied duel keeps no slug. Replay forks are rejected. The private board keeps every available public log entry; the public issue remains capped at 15 lines. The saved identity has `userId`, `username`, and nullable `email`, read from the database inside the save transaction. Public text removes stored account names, emails, and Discord IDs, including public log text. Owner page and API checks run before any report read.

The exact form copy is: "Describe the problem. We save the board and the duel log with your report. A screenshot is optional."

Test paths: `packages/web/tests/bug-reports-route.test.ts`, `packages/duel-server/tests/host-bug-context.test.ts`. Run the former with `npx vitest run packages/web/tests/bug-reports-route.test.ts -c packages/web/vitest.config.ts`. Run the latter from the duel-server workspace with `npx vitest run tests/host-bug-context.test.ts --testTimeout=20000`. Use `TMPDIR=/dev/shm` for isolated SQLite test files to avoid slow disk commits.

## Verified result

The review found and verified two privacy corrections. Account deletion clears the submitter snapshot. Submission and duplicate suggestions use the same account-data removal rules. All 109 targeted integration tests passed (75 web, 5 host, 29 database). Typecheck passed in all seven workspaces. The required local brief is `data/briefs/open-bugs-2026-10-19.md` in the original repository workspace.
