# Updates board and release emails

Every update has one server-side release record. The board and release email render its plain-text sections. The additive migration seeds the published, minor v0.2.2 record once; it never sends that release automatically. Drafts can be edited until publication. Published content is immutable. Board reads return at most twenty published releases, newest publication first. Seen state belongs to the application user and advances by numeric version, including across browser sessions.

A major release defaults to automatic email on publication when email is configured. `autoEmail: false` disables that reservation. Minor releases never reserve an automatic send, even if `autoEmail: true` is supplied. The owner can preview and confirm a manual send for either kind. Publication and an automatic reservation commit together. Repeating publish/confirm requests preserves the same reservation; `UNIQUE(release_id)` permanently prevents a second campaign. There is no reset or resend operation. Release notes support `**bold**`: HTML escapes content before rendering bold, and text emails remove the markers.

## Runtime settings

Web prepares previews and handles unsubscribe; the worker prepares automatic campaigns and sends individual messages. Both use the same SQLite file and explicit Compose environment lists. No bot flag controls email. Any missing `MAIL_HOST`, `MAIL_USER` or `MAIL_PASSWORD` makes sending `not_configured`, while publication continues without reserving an automatic campaign. Both the publish route and shared service enforce this guard, even for explicit `autoEmail: true`. Restoring configuration does not retroactively reserve published releases; use manual preview/confirmation for those. Already reserved campaigns wait if configuration is later removed. `MAIL_POSTAL_ADDRESS` is optional and does not affect configuration status or block sending. The owner chose on **2026-11-05** to send without a postal address for now.

- `MAIL_HOST`: Namecheap Private Email SMTP hostname, runtime only. Implicit TLS on port **465** is fixed.
- `MAIL_USER`: existing mailbox login (`support@duelingdomain.com` in production).
- `MAIL_PASSWORD`: that mailbox password, runtime only.
- `MAIL_POSTAL_ADDRESS`: optional physical mailing address. When set, it appears in HTML and text messages; when unset or blank, its line is omitted without an empty gap.
- `MAIL_FROM`: defaults to `Dueling Domain <support@duelingdomain.com>`.
- `MAIL_REPLY_TO`: defaults to `support@duelingdomain.com`.
- `MAIL_ENCRYPTION_KEY`: optional dedicated secret for AES-256-GCM payload encryption. Without it, payload encryption derives from `CLERK_SECRET_KEY`. Set the same value on web and worker. Keep the encryption secret stable while previews or deliveries remain pending; do not change from the fallback to a dedicated key with pending work.
- `MAIL_DAILY_LIMIT`: persisted UTC daily SMTP **attempt** budget, default **2000**. Safe retries count against this conservative daily budget; auth/setup rejections do not spend a per-delivery attempt. Suppressed recipients and audience discovery do not spend the SMTP budget. The budget resets at UTC midnight, while queue pauses survive midnight and restarts.
- `CLERK_SECRET_KEY`: also required on the worker for read-only discovery/revalidation. Never supplied to a build.
- `WEB_URL`: canonical application origin for sign-in, signup and public unsubscribe links.

The owner decided on **2026-11-05** to send through the existing Namecheap Private Email mailbox using Nodemailer. The worker reuses one TLS connection where possible and sends one recipient per message. The renderer adds no tracking pixels, remote assets or analytics links. SMTP does not append a copy to the Sent folder; this implementation never connects over IMAP. Nodemailer's internal requeue is disabled so only the durable outbox decides whether a retry is safe.

Namecheap's [Private Email limits](https://www.namecheap.com/support/knowledgebase/article.aspx/10719/2179/email-sending-and-usage-limits-for-private-email/) and [terms](https://www.namecheap.com/legal/hosting/netos/) list **500 emails/hour/mailbox** for paid plans and say Private Email is not intended for mass mail. The application spaces SMTP attempts at least **12 seconds** apart (at most **300/hour**) to leave headroom for support mail. The daily cap and spacing are shared by every campaign on this database and persist across restarts. Other clients using the mailbox are outside this application's budget. The preview adds `estimatedMinutes` (recipient count at 300/hour, rounded up); provider pauses, existing queue work and daily caps can extend it. Existing preview fields are unchanged.

Configure mailbox credentials only in the deployment secret store. Never put them in builds or source control. Deployment DNS, provider configuration and production audience verification are owner operations; implementing this backend performs none of them.

To trigger the drain by hand after configuration is intentionally enabled, restart the worker:

```sh
docker compose -f docker-compose.yml restart worker
```

The worker immediately resumes existing safe work and then ticks every second. Use the owner Updates controls to publish/preview/confirm; restarting never creates a second campaign. This command can send already queued mail, so it was not run during implementation.

## Audience and consent

Discovery exhausts Clerk users, pending invitations, and pending/invited waitlist entries at 100 records per page. It supports array and REST/SDK envelope responses and rejects incomplete/error pagination. It performs no Clerk writes. A verified primary email wins, otherwise another verified email is selected. Inboxes are normalized with the existing email dedupe rules; members win over invitations, which win over waitlist entries. Pending invitations with expired/missing ticket URLs receive news and a signup link, without an invite CTA. Valid existing invitation URLs are reused unchanged and never returned to the browser or logs.

The owner decided on **2026-11-04** to send alpha news to all signed-up users with a verified email, pending invitees, and the waitlist, with unsubscribe in every message. After all Clerk calls finish successfully, discovery idempotently backfills missing `email_consents` rows for this audience, including local historical `waitlist_signups` that predate Clerk. Each owner-basis row records scope `alpha-news`, source `owner_basis_2026-11-04`, provenance `owner instruction; alpha news; unsubscribe in every email`, and text version `alpha-news-2026-11-04`. Later members and invitees receive the same recorded basis at discovery; they do not need a separate opt-in to receive this news.

The public waitlist form keeps its own `public-waitlist-form` provenance and current notice version. Existing evidence and consent timestamps are preserved. Suppression from unsubscribe, bounce, complaint or account deletion always wins: backfill never restores consent or removes suppression. The preview counts distinct eligible inboxes and reports suppression, unverified email, invalid email and duplicates. All subject/inbox association writes and consent backfill share one transaction after the complete discovery, without holding a database lock during Clerk requests.

Snapshots are encrypted, expire after fifteen minutes, and bind the owner, published release hash and complete audience hash. Confirmation freezes the content and recipient payloads in one transaction with the permanent send guard. Before a recipient's first provider attempt, the worker revalidates eligibility, gives a newly created account priority, and removes obsolete invite CTAs. Suppression is checked again immediately before dispatch and on every retry. HMAC-only subject/inbox associations survive acceptance to cover previously emailed verified fallback addresses. Account deletion records a stable HMAC suppression tombstone and removes private queue/preview data before erasing identity. Tokens and suppression remain valid across signup/deletion and deployment credential changes.

## Delivery and recovery

The worker uses fenced sixty-second leases and renews them during paginated discovery. Each tick processes at most ten due rows, checks the shared rate/daily budget immediately before SMTP, and drains its in-flight work on shutdown. The email writer sets SQLite `synchronous=FULL`, so the delivery's attempt timestamp, encrypted rendered message and budget commit durably **before** calling SMTP. SMTP supplies no idempotency key: the legacy `idempotency_key` database column remains a local audit identifier only. There is no 23-hour retry window.

- Connection refusal, DNS, TLS or greeting failures that prove setup failed before DATA: retry safely after a persisted queue pause.
- Explicit SMTP **4xx** rejection: retry safely with queue backoff, capped at one hour. Replies to **RCPT TO**, **MAIL FROM** or **DATA**, except **421**, are eligible for the five-rejection delivery limit below; setup/authentication replies and all 421 replies do not spend that limit. No per-delivery attempt is spent.
- Authentication failure (**535**): `provider_auth`, retry without a per-delivery attempt, pause the entire queue at least **one hour**.
- **5xx recipient address rejection** at **RCPT TO**: permanently fail that delivery only when the reply starts with enhanced code **5.1.1**, **5.1.2**, **5.1.3**, **5.1.6** or **5.1.10**, or says **user unknown**, **no such user** or **does not exist**. Replies naming the **sender** or carrying a **5.7.x** policy code remain provider-policy failures. Other recipients continue under the normal spacing.
- **5xx rate, limit, spam, quota or policy rejection** (including 550/554): `provider_policy`, return the delivery to retry without a per-delivery attempt and pause the **whole queue for one hour**. No remaining recipients are tried during that pause. Other non-recipient 5xx failures also pause conservatively.
- Connection loss or timeout with an unknown outcome after handoff, unclassified transport failures, or a crash leaving a durable attempted row: `needs_review`, **never retried automatically**. Expired attempted leases are quarantined before checking the queue budget; a late worker response cannot override that decision.

Safe rejections clear the attempt marker atomically with recording the pause, except when the delivery is placed in review. An eligible rejection adds a delivery rejection count only while the queue's consecutive failure count is below five, so a continuous queue outage spends at most five counts across all recipients. Each counted rejection sets that row's availability at least **1, 2, 4, 8 or 16 hours** ahead for counts one through five, while keeping the existing queue pause. A lone row can reach its fifth rejection after **15 hours** (1 + 2 + 4 + 8). If the queue's consecutive failure count is greater than zero at that rejection, the delivery becomes `needs_review`, keeps its payload and records the review timestamp for the thirty-day purge; it is never retried automatically. Only when that count is zero, meaning a message was accepted immediately before the rejection, does the fifth rejection permanently fail the delivery and purge its payload. Authentication, setup and other uncounted failures continue retrying without an attempt cutoff or retry-window expiry. Queue pauses persist and resume automatically when due. A crash before the safe rejection can be recorded leaves the row for review, preserving at-most-once delivery at the cost of possibly skipping a message. A fenced successful acceptance resets queue backoff and its consecutive failure count.

`GET /api/admin/console/releases` exposes an optional `email.lastError` fixed code, including `provider_auth`, `provider_policy`, `provider_unavailable`, `unknown_outcome` or `audience_unavailable`. Raw SMTP messages and private values are never stored there. Automatic audience preparation retries indefinitely with backoff capped at one hour. The API's `sent` count means SMTP accepted (plus legacy delivered rows); `failed` includes permanent failure, suppression and review rows. SMTP acceptance does not establish inbox delivery.

There are **no bounce or complaint webhooks**. Hard bounces arrive in the **support@duelingdomain.com inbox** and are **not automatically suppressed**; the owner must monitor that inbox and handle them. Existing suppression records remain effective, and **one-click unsubscribe still immediately suppresses** further alpha-news mail.

Review ambiguous work against mailbox/provider records and local delivery IDs. Do not delete the send reservation, clear an ambiguous attempt or create a replacement campaign. No automatic redrive exists for review rows. Accepted/failed/suppressed payloads are purged immediately; review payloads are purged after thirty days when the configured worker drains. Permanent minimal reservation, delivery and suppression tombstones remain. Preview snapshots are deleted on expiry during preview/drain and on confirmation or account deletion.

`GET /unsubscribe?t=...` displays a confirmation form and does not change preferences. Public `POST` immediately suppresses all alpha-news mail; RFC 8058 one-click requests require no login or Origin. Every message must carry the visible unsubscribe link and both headers (`List-Unsubscribe` and `List-Unsubscribe-Post`), whether or not a postal address is set. These links do not expire.

## Offline validation

Use Node 22 and build shared before consumers. The two integration test files cover the broadcast and the releases API/seen feature; all Clerk requests and SMTP transports use fakes; no test contacts a mail server. Run only these files and touched-package typechecks:

```sh
prlimit --core=0 -- npm run build --workspace=@yugidraft/shared
prlimit --core=0 -- node node_modules/vitest/vitest.mjs run --config packages/shared/vitest.config.ts packages/shared/tests/release-email.integration.test.ts
prlimit --core=0 -- node node_modules/vitest/vitest.mjs run --config packages/web/vitest.config.ts packages/web/tests/releases-api.integration.test.ts
prlimit --core=0 -- npm run typecheck --workspace=@yugidraft/shared
prlimit --core=0 -- npm run typecheck --workspace=@yugidraft/worker
prlimit --core=0 -- npm run typecheck --workspace=@yugioh-discord-bot/web
```

Provider references: [SMTP transport](https://nodemailer.com/smtp), [pooled SMTP and retry controls](https://nodemailer.com/smtp/pooled), [SMTP error fields](https://nodemailer.com/errors).
