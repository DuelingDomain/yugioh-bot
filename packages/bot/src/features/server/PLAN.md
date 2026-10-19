# Server management implementation plan

Goal: Add the approved admin server commands without shared or runtime changes.

- [x] Add integration coverage with real SQLite and a local Discord REST server.
- [x] Add command definitions and common access, hierarchy, error, audit, and confirmation handling.
- [x] Add channel and category operations, including protected channel and child move checks.
- [x] Add curated permission overwrites and role operations with live hierarchy checks.
- [x] Add idempotent setup with private admin channels and public read-only announcements.
- [x] Run the feature and runtime integration tests, bot typecheck, and build. Review security and scope.

Verification: 58 server integration checks and 31 existing bot checks passed.
Bot typecheck and build passed. All code review findings are addressed.
Delivery: remove generated output, commit with the required trailer, and push the feature branch. No PR.

Files: `definitions.ts`, `common.ts`, `confirmations.ts`, `channels.ts`, `permissions.ts`,
`roles.ts`, `setup.ts`, `index.ts`, and `server.integration.test.ts`, all in this folder.
The feature registry already imports this folder, so it needs no change.

Use integration tests only, as required by the owner. Confirmations hold the displayed payload
for 60 seconds, recheck admin access and live target state, and serialize destructive actions.
All outcomes use the shared audit transaction and its mod-log outbox.
