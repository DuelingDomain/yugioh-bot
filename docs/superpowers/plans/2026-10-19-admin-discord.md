# Owner Discord Webhooks Implementation Plan

> Execute inline with the executing-plans skill; use independent reviewers for design and final code.

**Goal:** Owner waitlist decisions and private online status through webhooks, with the production bot disabled.

**Architecture:** Shared SQLite records and HTTP adapters, authenticated web routes and a visible-tab heartbeat, one worker publishing loop. Preserve existing join alert deduplication and owner access policy.

**Tech Stack:** Node 22, TypeScript, Next.js 16, Clerk, better-sqlite3, Vitest integration tests, Playwright.

- [x] Add failing integration coverage in `packages/web/tests/admin-discord.integration.test.ts` for signed webhook -> alert -> owner POST -> Clerk -> Discord PATCH, real signed sessions, replay and negative access cases.
- [x] Cover timeout after Clerk success, concurrent competing decisions, expired processing leases and expiry during retries. Verify exact 409 recovery codes against the Clerk error reference.
- [x] Extend `packages/shared/src/db/schema.ts` with latest presence, durable waitlist action records and singleton status state. Make migrations repeatable.
- [x] Add `packages/shared/src/notify/discord-webhook.ts` (bounded, sanitized HTTP), `waitlist-actions.ts` (HMAC, binding, lease, decision and edits); connect `join-request.ts`, Clerk webhook and local waitlist response. Extend shared Clerk REST methods.
- [x] Add owner confirmation page and POST route in `packages/web/app/admin/waitlist`, with shared guard under `src/lib`. GET has no effects; POST requires same origin. Show safe errors and a button only for actionable records.
- [x] Add shared route-template mapping and presence storage; authenticated heartbeat route and layout component. Add integration cases for rates, route privacy, retention and disabled state.
- [x] Add `packages/worker/src/discord-admin.ts` and 60-second loop; real-SQLite integration cases cover counts, 25-name cap, create/PATCH/recreate, rate limits, Clerk cache and failure containment.
- [x] Update privacy, ADR 0004 addendum, environment example and owner guide. Add correct Compose environment passthrough on web and worker.
- [x] Extend isolated E2E fetch boundary stubs and runtime env with disposable credentials. Add `packages/e2e/tests/admin-discord.spec.ts` to cover confirmation, owner denial, approve/reject, repeat clicks, navigation heartbeat and hidden tab. Keep fixture-only changes outside application code.
- [x] Build shared; run targeted integration suites and existing Clerk/join/waitlist regressions. Run `npm run typecheck --workspace=packages/{shared,worker,web,e2e}` separately.
- [x] Build services and the dedicated E2E slot. Run `E2E_SLOT=8 E2E_OWNER_USER_IDS=101 E2E_DISCORD_ADMIN=1 E2E_WORKERS=1 npx playwright test 'admin-discord\.spec\.ts$' -c packages/e2e/playwright.config.ts`. Use read-only engine data from an existing prepared bundle.
- [x] Independent code review; fix findings and repeat affected checks. Stop only owned stack processes and remove generated build/test output.
- [ ] Commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, push `feat/admin-discord-webhooks`, create PR to main with required footer, wait for green CI. Do not merge.

## Verified before PR creation

- Node 22.23.3: shared, web, worker and E2E TypeScript checks passed.
- Targeted Vitest suites: web 126, worker 8, shared 103 (237 total), all passed.
- Playwright: 2 feature flows plus 5 signed-cookie setup checks passed in slot 8 (3381/3383/4384/4385), with real SQLite and Clerk/Discord fetch-boundary stubs. All four ports closed at completion.
- Production standalone build and Compose YAML/environment validation passed.
- Independent design and code review approved; webhook-rotation backlog regression passed.
- Existing copied-schema migration integration now verifies the two nullable presence fields and still checks every original user value.
