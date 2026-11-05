# Updates board and release emails

Every update has one server-side release record. The board and release email render its plain-text sections. The additive migration seeds the published, minor v0.2.2 record once; it never sends that release automatically. Drafts can be edited until publication. Published content is immutable. Board reads return at most twenty published releases, newest publication first. Seen state belongs to the application user and advances by numeric version, including across browser sessions.

A major release defaults to automatic email on publication. `autoEmail: false` disables that reservation. Minor releases never reserve an automatic send, even if `autoEmail: true` is supplied. The owner can preview and confirm a manual send for either kind. Publication and an automatic reservation commit together. Repeating publish/confirm requests preserves the same reservation; `UNIQUE(release_id)` permanently prevents a second campaign. There is no reset or resend operation.

## Runtime settings

Web prepares previews and handles unsubscribe/webhooks; the worker prepares automatic campaigns and sends individual messages. Both use the same SQLite file and explicit Compose environment lists. No bot flag controls email. Missing `RESEND_API_KEY` or `MAIL_POSTAL_ADDRESS` makes sending `not_configured`, while publication continues. A reserved automatic campaign waits until configuration is available.

- `RESEND_API_KEY`: restricted sending key, runtime only.
- `MAIL_POSTAL_ADDRESS`: physical mailing address in every HTML/text message.
- `MAIL_FROM`: defaults to `Dueling Domain <news@updates.duelingdomain.com>`.
- `MAIL_REPLY_TO`: defaults to `support@duelingdomain.com`.
- `MAIL_ENCRYPTION_KEY`: optional dedicated secret for AES-256-GCM payload encryption. Without it, payload encryption derives from `CLERK_SECRET_KEY`. Set the same value on web and worker. Keep the encryption secret stable while previews or deliveries remain pending; do not change from the fallback to a dedicated key with pending work.
- `MAIL_DAILY_LIMIT`: persisted UTC daily **attempt** budget, default 100. Retries count. Increase only to the approved provider allowance.
- `RESEND_WEBHOOK_SECRET`: web-only Svix signing secret for `POST /api/webhooks/resend`.
- `CLERK_SECRET_KEY`: also required on the worker for read-only discovery/revalidation. Never supplied to a build.
- `WEB_URL`: canonical application origin for sign-in, signup and public unsubscribe links.

Verify the sending domain in Resend and disable its open and click tracking before enabling delivery. The renderer adds no tracking pixels, remote assets, or analytics links; the Resend send API has no per-message tracking switch. Keep support mail on its existing mailbox. Subscribe the signed webhook to sent, delivered, bounced, complained, failed and suppressed events. Deployment DNS, provider configuration and production audience verification are owner operations; implementing this backend performs none of them.

To trigger the drain by hand after configuration is intentionally enabled, restart the worker:

```sh
docker compose -f docker-compose.yml restart worker
```

The worker immediately resumes existing safe work and then ticks every second. Use the owner Updates controls to publish/preview/confirm; restarting never creates a second campaign. This command can send already queued mail, so it was not run during implementation.

## Audience and consent

Discovery exhausts Clerk users, pending invitations, and pending/invited waitlist entries at 100 records per page. It supports array and REST/SDK envelope responses and rejects incomplete/error pagination. It performs no Clerk writes. A verified primary email wins, otherwise another verified email is selected. Inboxes are normalized with the existing email dedupe rules; members win over invitations, which win over waitlist entries. Pending invitations with expired/missing ticket URLs receive news and a signup link, without an invite CTA. Valid existing invitation URLs are reused unchanged and never returned to the browser or logs.

The preview counts distinct, eligible inboxes and reports exclusions, including suppression, unknown consent, unverified email and duplicates. Existing accounts, invitations and historical waitlist rows do **not** imply consent. They need a provenance-backed `email_consents` entry for the `alpha-news` scope. The public waitlist form records the current alpha-news notice version for new submissions; this does not remove an existing suppression. Import historical consent only after validating its evidence, using the shared `recordEmailConsent(db, email, { provenance, textVersion })` helper in an owner-operated migration/script. Do not bulk fabricate consent for the discovered audience.

Snapshots are encrypted, expire after fifteen minutes, and bind the owner, published release hash and complete audience hash. Confirmation freezes the content and recipient payloads in one transaction with the permanent send guard. Before a recipient's first provider attempt, the worker revalidates eligibility, gives a newly created account priority, and removes obsolete invite CTAs. Suppression is checked again immediately before dispatch and on every retry. HMAC-only subject/inbox associations survive acceptance to cover previously emailed verified fallback addresses. Account deletion records a stable HMAC suppression tombstone and removes private queue/preview data before erasing identity. Tokens and suppression remain valid across signup/deletion and deployment credential changes.

## Delivery and recovery

The worker uses fenced sixty-second leases, renews them during paginated discovery, a persisted one-request-per-second budget and the daily attempt budget. Each tick claims at most ten due rows individually. It honors provider Retry-After/rate headers, backs off with jitter, bounds attempts, and drains its in-flight work on shutdown. Acceptance and confirmed delivery have separate statuses. The API's `sent` count includes accepted/delivered rows; `failed` includes permanent failure, suppression and review rows.

A delivery stores its exact serialized body and permanent Resend idempotency key before the first provider request. A timeout after provider acceptance retries those same bytes/key, including after process restart. Resend retains keys for 24 hours; this backend stops automatic retries at **23 hours** from the first attempt. Expired ambiguous attempts and exhausted ambiguous retries become `needs_review` and cannot be automatically replayed. Signed webhook tags can reconcile acceptance even when the original provider response was lost. Receipt deduplication and terminal failure precedence prevent webhook replays or late delivery events from undoing a complaint/bounce.

Review ambiguous work through the provider records and local delivery IDs/keys. Do not delete the send reservation, clear its attempts or generate a new key. No automatic redrive beyond the safety window exists. Accepted/failed/suppressed payloads are purged immediately; review payloads are purged after thirty days when the configured worker drains. Permanent minimal reservation, delivery and suppression tombstones remain. Preview snapshots are deleted on expiry during preview/drain and on confirmation or account deletion.

`GET /unsubscribe?t=...` displays a confirmation form and does not change preferences. Public `POST` immediately suppresses all alpha-news mail; RFC 8058 one-click requests require no login or Origin. Every message carries both unsubscribe headers, the visible link and the postal address. These links do not expire.

## Offline validation

Use Node 22 and build shared before consumers. The two integration test files cover the broadcast and the releases API/seen feature; all Clerk/Resend requests use fakes. Run only these files and touched-package typechecks:

```sh
prlimit --core=0 -- npm run build --workspace=@yugidraft/shared
prlimit --core=0 -- node node_modules/vitest/vitest.mjs run --config packages/shared/vitest.config.ts packages/shared/tests/release-email.integration.test.ts
prlimit --core=0 -- node node_modules/vitest/vitest.mjs run --config packages/web/vitest.config.ts packages/web/tests/releases-api.integration.test.ts
prlimit --core=0 -- npm run typecheck --workspace=@yugidraft/shared
prlimit --core=0 -- npm run typecheck --workspace=@yugidraft/worker
prlimit --core=0 -- npm run typecheck --workspace=@yugioh-discord-bot/web
```

Provider references: [idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys), [send API](https://resend.com/docs/api-reference/emails/send-email), [signed webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests), [bounce payload](https://resend.com/docs/webhooks/emails/bounced).
