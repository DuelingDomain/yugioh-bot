# Owner Discord alerts and online status

These features use two Discord channel webhooks. They do not start a bot.
Keep `DISCORD_BOT_ENABLED=0` (ADR 0004).

## Owner setup

1. In Discord, make two private channels: one for waitlist/sign-up alerts and one
   for status. Limit access to the owner and trusted admins. For **each** channel,
   open **Server Settings → Integrations → Webhooks → New Webhook**, choose the
   channel, and select **Copy Webhook URL**. Use separate webhooks. Keep the URLs
   in the protected VM `.env` beside `docker-compose.yml`; they are credentials.
2. In the **production Clerk instance**, enable Waitlist mode and email delivery.
   Open **Webhooks → Add Endpoint**. Set
   `https://app.duelingdomain.com/api/webhooks/clerk` (or the exact app host for
   your instance). Select **waitlistEntry.created**. Also select **user.created**
   if you enable sign-up alerts. Copy the endpoint **Signing Secret**. Use the
   app host: the marketing host only proxies the waitlist form POST.
3. Sign in to the app with the owner's Clerk account. Open
   `/api/auth/session` on that same app host and read `user.id`. This is the
   decimal application `users.id`, **not** a Clerk ID or Discord ID. Set
   `OWNER_USER_IDS` to that ID. Multiple owner IDs use commas. An empty value
   grants no owner access. No Discord role or permission grants this access.
4. Generate a separate random signing key with `openssl rand -hex 32`. Save its
   output directly in the protected environment file. Do not reuse the Clerk
   signing secret, webhook URLs, or an internal service key. Set these values:

   ```dotenv
   WEB_URL=https://app.duelingdomain.com
   OWNER_USER_IDS=<APPLICATION_USER_ID>
   CLERK_SECRET_KEY=<PRODUCTION_CLERK_SECRET_KEY>
   CLERK_WEBHOOK_SIGNING_SECRET=<CLERK_ENDPOINT_SIGNING_SECRET>
   DISCORD_ADMIN_WEBHOOK_URL=<PRIVATE_ALERT_CHANNEL_WEBHOOK_URL>
   DISCORD_ADMIN_ACTION_SIGNING_SECRET=<SEPARATE_RANDOM_KEY_AT_LEAST_32_CHARACTERS>
   DISCORD_ADMIN_STATUS_WEBHOOK_URL=<PRIVATE_STATUS_CHANNEL_WEBHOOK_URL>
   DISCORD_JOIN_REQUEST_ALERTS_ENABLED=1
   DISCORD_SIGNUP_ALERTS_ENABLED=0
   DISCORD_ONLINE_STATUS_ENABLED=1
   DISCORD_ADMIN_SHOW_FULL_EMAIL=0
   DISCORD_ADMIN_DASHBOARD_URL=
   DISCORD_BOT_ENABLED=0
   ```

   Keep the existing `DISCORD_GUILD_ID`, absolute shared `DATABASE_PATH`,
   `CARD_IMAGE_CACHE_DIR`, `WS_INTERNAL_URL` and `WS_INTERNAL_SECRET` settings.
   Compose already supplies these. `DISCORD_GUILD_ID` scopes game statistics.
   Keep the existing build-time `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` for the same
   instance. Never put any secret above in Git, an image build argument, or a
   `NEXT_PUBLIC_` variable.

   Only literal `1` enables each switch. Join alerts default on; sign-up alerts
   and online status default off. To enable sign-up alerts, select `user.created`
   in Clerk **and** set `DISCORD_SIGNUP_ALERTS_ENABLED=1`. Emails stay masked with
   `DISCORD_ADMIN_SHOW_FULL_EMAIL=0`; use `1` only if channel members may see full
   addresses. The optional `DISCORD_ADMIN_DASHBOARD_URL` must be HTTPS and defaults
   to `https://dashboard.clerk.com/`. It is the manual fallback for expired links.
5. Deploy the PR through the normal [VM process](vm-runbook.md). On the VM,
   recreate **web and worker** to load the new runtime values:

   ```sh
   docker compose -f docker-compose.yml up -d --no-build --no-deps --force-recreate web worker
   ```

   A plain restart does not reload Compose environment changes. Startup adds the
   SQLite columns and tables. Run exactly one worker per database. The web and
   worker must share the same database file. Do not start the bot. No Caddy or
   public-path change is needed.
6. Submit a new waitlist request with an email you control. Check for **one**
   masked alert with **Approve / Reject** links. Clerk endpoint delivery must be
   HTTP 200. Open Approve as the signed-in owner: it must show a confirmation
   button before sending an invite. Press the button, check Clerk's invited
   status and email, and check **Approved by Name** on the original Discord
   message. Refresh/re-submit: there must be no second invite. Use another test
   identity to check Reject and **Rejected by Name**. An ordinary signed-in user
   must get 403; a signed-out browser must sign in first.
7. Open Dashboard or Deck builder in a visible, signed-in tab. Within a minute,
   the status channel must contain **Online now: N** and **Name — page**. Navigate
   between sections; after the heartbeat/update interval, the label must change.
   Hide/close the tab: the user leaves the list after two minutes plus up to one
   worker interval. Delete the status message: the next worker tick must create
   one replacement. Submitting the same waitlist email or replaying a Clerk
   delivery must not create another alert. If enabled, check one `user.created`
   sign-up alert too. Use new identities for later checks; deduplication survives
   restarts.

## Runtime environment by service

| Variable | Web | Worker | Purpose/default |
| --- | --- | --- | --- |
| `WEB_URL` | yes | no | Canonical app origin, required; use HTTPS in production |
| `OWNER_USER_IDS` | yes | existing | Application owner IDs; empty denies access |
| `CLERK_SECRET_KEY` | yes | yes | Clerk Backend API credential |
| `CLERK_WEBHOOK_SIGNING_SECRET` | yes | no | Verify the existing signed endpoint |
| `DISCORD_ADMIN_WEBHOOK_URL` | yes | yes | Send alerts; worker retries completed decision edits |
| `DISCORD_ADMIN_ACTION_SIGNING_SECRET` | yes | no | HMAC key, at least 32 characters; unset disables action links |
| `DISCORD_ADMIN_STATUS_WEBHOOK_URL` | no | yes | Separate status channel webhook |
| `DISCORD_JOIN_REQUEST_ALERTS_ENABLED` | yes | no | `1` by default |
| `DISCORD_SIGNUP_ALERTS_ENABLED` | yes | no | `0` by default |
| `DISCORD_ONLINE_STATUS_ENABLED` | yes | yes | `0` by default; `1` mounts heartbeat and publishes status |
| `DISCORD_ADMIN_SHOW_FULL_EMAIL` | yes | no | `0` by default |
| `DISCORD_ADMIN_DASHBOARD_URL` | yes | no | Optional HTTPS Clerk dashboard link |
| `DISCORD_BOT_ENABLED` | fixed `0` | fixed `0` | Bot stays off |

`docker-compose.yml` passes these values to the services shown. The worker needs
no webhook signing key or owner action key. It retries **only Discord edits** of
already completed decisions; it never starts or retries a Clerk decision itself.
For staging, use a separate Clerk instance, keys, channels and protected env file.
Staging is currently removed and returns later on a separate server.

## Waitlist actions and Clerk API

Verified in the installed **`@clerk/backend` 3.23.0** (from `@clerk/nextjs` 7.9.11):
`dist/api/endpoints/WaitlistEntryApi.d.ts` declares `invite(id, params?)` and
`reject(id)`. Its distributed implementation uses the following endpoints. The
shared REST adapter uses the same endpoints, not invitation creation or deletion:

- Approve: [`waitlistEntries.invite(id)`](https://clerk.com/docs/reference/backend/waitlist-entries/invite),
  **POST `/v1/waitlist_entries/{waitlist_entry_id}/invite`**. Sends Clerk's invite.
- Reject: [`waitlistEntries.reject(id)`](https://clerk.com/docs/reference/backend/waitlist-entries/reject),
  **POST `/v1/waitlist_entries/{waitlist_entry_id}/reject`**.
- Pending count: [`waitlistEntries.list({ status: 'pending', limit: 1 })`](https://clerk.com/docs/reference/backend/waitlist-entries/list),
  **GET `/v1/waitlist_entries?status=pending&limit=1`**. Read `total_count`, not a
  full paginated scan; cache success or failure attempts for five minutes.

Links use HMAC-SHA256, an opaque random record ID, one decision and an absolute
24-hour expiry. They contain no email or Clerk entry ID. Both links share a
single-use SQLite decision record. **The link alone never grants access.** Every
GET and POST requires a valid Clerk session and current `OWNER_USER_IDS` check.
GET only shows confirmation. POST also requires the canonical same-origin
`Origin` header. Responses are private/no-store, disallow framing and send only
the origin as referrer, never the signed path. Key rotation invalidates old links.
Expired links require the Clerk
dashboard; new links are not issued by replaying old webhook events.

The first valid POST atomically fixes the decision and actor, then takes a
30-second processing lease before HTTP. Concurrent or opposite decisions return
409. A failed/ambiguous Clerk call releases the lease but keeps the chosen
decision and actor, so the same button can resume. A crashed process's lease can
be resumed after 30 seconds. Retrying after link expiry is not allowed. Only the
matching, documented [Clerk HTTP 409 error code](https://clerk.com/docs/guides/development/errors/backend-api)
`waitlist_entry_already_invited` or `waitlist_entry_already_rejected` reconciles a
previous ambiguous success. Other errors do not mark the request complete.
The signed-in owner must retry; there is no automatic Clerk decision job.

Discord creation uses `?wait=true` and stores the returned message ID and webhook
hash. After success, a [webhook message PATCH](https://docs.discord.com/developers/resources/webhook#edit-webhook-message)
removes both action links and shows **Approved by Name** or **Rejected by Name**.
Discord failure cannot undo Clerk's result. The worker retries failed edits each
minute with rate-limit backoff; it does not send another invite. A deleted alert
is not recreated. Changing the alert webhook leaves old messages in the old
channel; clean them up manually. If Discord accepted a POST but its response was
lost, no ID is available to repair that alert. Check Clerk for its actual state.

## Online status and privacy

Only visible signed-in app tabs send a tiny route-template heartbeat on entry,
navigation and every 60 seconds. The server accepts a closed vocabulary such as
`/decks/[id]`, `/duels/[slug]` and `/draft/[slug]`, never raw IDs, URLs, queries or
fragments. A durable per-user 30-second rate limit bounds writes across tabs and
web processes. Fast navigation may take the next heartbeat to change the label.
Only `users.last_seen_at` (Unix milliseconds) and `users.last_route` are kept;
each update replaces the prior values. No history table exists. The worker clears
values after 24 hours without an update, even when publishing is disabled.
Account deletion clears both values immediately. The [privacy notice](../../site/public/privacy.html)
describes this admin visibility and the normal backup retention.

The worker starts with one status POST, stores its message ID/webhook hash, then
PATCHes that ID every 60 seconds. It recreates on Discord **Unknown Message
(10008)**, not on other webhook or permission errors. This survives worker
restarts. A changed status webhook creates one message in the new channel;
remove the old channel's message manually. A lost create response can leave an
extra message: delete the extra message if that rare transport ambiguity occurs.
Discord retry-after delays are respected. HTTP calls time out after two seconds,
including response-body reads. All messages disable mentions and escape text.

**Online** means seen less than 120 seconds ago. The list shows names and friendly
section labels, up to 25 users and 2,000 message characters, then `+N more`.
Duel sections use the general label **Duel**, without table names or identifiers.
Stats use UTC days: local app accounts created today (`users.created_at`), pending
Clerk waitlist entries, active play duels by 1v1/Tag/3-way/4-way format, completed
play duels today and active drafts. Game counts use `DISCORD_GUILD_ID` and exclude
replay forks. Pending count is **unavailable** without a successful fetch and
marked **stale** when the last success is over five minutes old. It is not a
real-time queue count. The singleton message has no presence history.

To disable status, set `DISCORD_ONLINE_STATUS_ENABLED=0` on both services and
recreate them. Delete the old status message in Discord; disabling publishing
leaves its last content in place. To disable all alerts too, set both alert
switches to `0`. Keep the worker running for retention cleanup.

## Existing alert delivery limits

The marketing and app forms use `POST /api/waitlist`. Saving a new local row makes
one alert attempt even if Clerk is temporarily unavailable. Clerk's create
response or signed `waitlistEntry.created` delivery binds the real entry ID to
that alert. Until it arrives, the owner page reports that the entry is not ready.
Clerk-only and owner-reconciled entries use the same signed endpoint. The
reconcile command checks only local emails, not a scheduled Clerk scan.

Clerk verifies the raw webhook through its [existing signature helper](https://clerk.com/docs/reference/backend/verify-webhook).
Only the exact existing webhook POST bypasses session middleware; no new
unauthenticated route is added. Requests need Content-Length and are capped at
64 KiB. Event receipts deduplicate `svix-id`; each new receipt prunes up to 100
receipts older than seven days. A separate normalized email hash deduplicates
local and Clerk alerts. Optional sign-up alerts have their own kind, so an email
can receive one join alert and one sign-up alert. Email-less users use a Clerk-ID
hash. Disabled events are acknowledged and not replayed when enabled later.

Alert delivery remains best effort: claim before HTTP, 30 attempts per process
per hour across both types. Dropped claims are retained. Each HTTP call has a
two-second timeout. A valid Discord 429 delay of at most 30 seconds gets one
retry; longer delays and second failures do not. Logs contain generic reasons
and HTTP status, never credential URLs or provider error payloads. Crashes and
transport failures can lose an alert; there is no alert send queue. Existing
rows are not sent as a batch on enablement. Reconciliation of a large old backlog
can reach this limit; inspect its dry run first.
