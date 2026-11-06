# Discord sign-up alerts implementation plan

**Goal:** Explain where each waitlist request happened and how each account gained access, while removing duplicate Discord decision logs.

**Architecture:** Keep the existing notification claims, hashes, receipts and outbox delivery. Resolve stored origins and creator context in shared presentation, and use the existing decision audit to describe approved accounts. Keep moderation audit rows; mirror a successful decision only when no durable alert can carry it.

**Tech stack:** TypeScript, SQLite, Clerk webhooks, Discord outbox, Vitest; Node 22 with core dumps disabled.

- [x] Update existing string assertions and extend existing integration coverage for origin variants, survey redaction, approval attribution and conditional decision logs. Run targeted tests to confirm the old output fails.
- [x] In `packages/shared/src/notify/join-request.ts` and `services/waitlist.ts`, retain typed form origins, render Where and Heard from for both transports, and use a common email-hiding text cleaner. Add a read-only creator-link resolver in `services/creator-access.ts`.
- [x] In `packages/bot/src/features/waitlist/outbox.ts`, label Clerk counts clearly and show Place in line only when known and different from Still waiting. Reuse shared decision presentation.
- [x] In `packages/shared/src/services/waitlist-decisions.ts`, preserve audit writes, suppress successful mirrors when an alert exists, and enqueue one short masked decision line otherwise. Preserve failure diagnostics and delivery policies.
- [x] Update the feature README with exact findings and the optional follow-through decision. The Account created edit is deferred: the action has no durable account-created state, and safe handling must cover pre-post decisions, concurrent edits, restart and privacy deletion.
- [x] Build shared before consumers, run targeted shared/bot/web tests, and typecheck all three. Review changes and prepare small commits without attribution lines.

Delivery: delete generated output, push this branch without a PR, and report all text variants and verification results.

## Verification

Node 22.23.3; builds, checks and tests run with `prlimit --core=0`. Network edges were mocked or local HTTP servers; no real Discord posts.

- The updated shared integration suite failed against the original implementation (12 failures), reproducing lost origins and duplicate moderation posts.
- Shared build passed before consumer checks. Shared, bot and web typechecks passed.
- Shared: 86 passing tests across `tests/discord-admin.integration.test.ts`, `tests/services/waitlist.test.ts`, and `tests/notify/join-request.test.ts` (the integration file was rerun after adding the valid-but-unknown creator-code case).
- Bot: 25 passing tests in `src/features/waitlist/integration.test.ts`, including the 502-entry queue and no-card command audits.
- Web: 154 passing tests across `tests/discord-bot-webhook.integration.test.ts`, `tests/clerk-webhook-route.test.ts`, `tests/waitlist-route.test.ts`, and `tests/admin-console-waitlist.integration.test.ts`. The admin integration file was rerun after extending coverage for the masked no-card audit line and retained database audits.
- Read-only code review found no correctness or privacy issues. `git diff --check` passed.

No new unit tests or test files were added; existing unit assertions were updated and integration coverage was extended.

The user's detailed specification and instruction to finish authorize inline execution without an additional design approval step.
