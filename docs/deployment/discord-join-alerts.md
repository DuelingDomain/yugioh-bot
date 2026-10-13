# Discord join request alerts

The web service can send alerts to a private channel in Dueling Domain. It uses a
channel webhook. It does not need a Discord bot. `DISCORD_BOT_ENABLED=0` can stay set.

## Owner setup

1. In Discord, open Dueling Domain. Select **Server Settings → Integrations →
   Webhooks → New Webhook**. Choose the private owner channel. Select **Copy Webhook
   URL**. Keep this URL in the protected VM environment file.
2. In the Clerk Dashboard, select the production app and instance. Open **Webhooks
   → Add Endpoint**. Set the URL to `https://<APP_HOST>/api/webhooks/clerk` on the
   app host. Select `waitlistEntry.created`. Also select `user.created` if you want
   sign-up alerts. Save the endpoint. Copy its **Signing Secret** to the VM.
   The marketing host serves only the waitlist POST; use the app host for this endpoint.
3. On the VM, edit the protected `.env` beside `docker-compose.yml`. Add these
   runtime values. Replace the placeholders with the values from steps 1 and 2.
   Do not put these values in Git or in a `NEXT_PUBLIC_` variable.

   ```dotenv
   DISCORD_ADMIN_WEBHOOK_URL=<DISCORD_CHANNEL_WEBHOOK_URL>
   CLERK_WEBHOOK_SIGNING_SECRET=<CLERK_ENDPOINT_SIGNING_SECRET>
   DISCORD_JOIN_REQUEST_ALERTS_ENABLED=1
   DISCORD_SIGNUP_ALERTS_ENABLED=0
   DISCORD_ADMIN_SHOW_FULL_EMAIL=0
   DISCORD_ADMIN_DASHBOARD_URL=
   ```

   Use `DISCORD_SIGNUP_ALERTS_ENABLED=1` to turn on sign-up alerts. Use
   `DISCORD_JOIN_REQUEST_ALERTS_ENABLED=0` to turn off join request alerts.
   These switches are independent. Only the literal value `1` enables a type.
   Keep `DISCORD_ADMIN_SHOW_FULL_EMAIL=0` for masked emails. Set it to `1` only
   if the private channel may show full emails. The dashboard link defaults to
   `https://dashboard.clerk.com/`. You can set `DISCORD_ADMIN_DASHBOARD_URL` to
   an HTTPS page for your Clerk app. There is no app page for waitlist administration.
4. Deploy this code with the normal [VM deployment process](vm-runbook.md).
   From the VM checkout, recreate web so it reads the new environment values:

   ```sh
   docker compose -f docker-compose.yml up -d --no-deps --force-recreate web
   ```

   Web is the only service that needs these new variables. Its normal database
   startup adds the alert and receipt tables. You do not need to restart worker,
   WS, duel or Caddy for these settings. A plain `restart` does not load changed
   Compose environment values. For staging, use a separate Clerk instance,
   signing secret, channel webhook and protected staging environment file.
   Recreate staging web with `scripts/staging/compose.sh up -d --no-deps --force-recreate web`.
5. Submit a new test join request with an email that you control. Check for one
   masked alert in the private channel. Submit the same email again; there must
   be no second alert. In Clerk, inspect the endpoint delivery status. It must
   show HTTP 200. If sign-up alerts are on, create a test user in the correct
   instance and check for one **New user sign-up** alert. The Clerk test tool can
   replay an event; a replay must not send another alert. Use new test identities
   for later checks because duplicate prevention survives web restarts.

## Flow and delivery limits

The marketing form and the app's not-invited button use `POST /api/waitlist`.
The shared waitlist service starts an alert after it saves a new local row.
The `/access` page links to the marketing form. It does not create a request.
The route then creates a Clerk entry. If Clerk needs a retry, the saved request
still has one alert attempt.

The signed endpoint receives Clerk-only waitlist entries and entries created by
the owner reconcile command. That command checks only local emails and is not a
scheduled scan of Clerk. A webhook covers all these entry creation paths without
another polling job. Optional `user.created` alerts also cover owner user creation
and existing-player recovery. Clerk verifies signatures with its existing
`verifyWebhook` helper. Only the exact webhook POST bypasses session middleware.
The endpoint rejects a declared body size above 64 KiB before verification.
Signed events that cannot make an alert still save a receipt and return HTTP 200.
See [Clerk signature verification](https://clerk.com/docs/reference/backend/verify-webhook)
and [Clerk delivery rules](https://clerk.com/docs/guides/development/webhooks/overview).

One shared notifier makes all Discord messages. A SQLite primary key permits one
attempt per normalized email and alert type. The key contains an email hash,
not another copy of the email. Users without an email use a hash of their Clerk
user ID. A separate receipt table stores each `svix-id` once. Each new receipt
removes up to 100 receipts older than seven days, using an expiry index. A join
alert and a sign-up alert for the same email are separate types, so both can be sent.

The message has a title, email, source, event time and dashboard link. The source
is **marketing waitlist**, **app waitlist**, **Clerk waitlist** or **sign-up**.
Emails are masked by default. User text is escaped, and emails appear in inline
code to prevent automatic links. `allowed_mentions: { parse: [] }`
prevents mentions. An unset or empty Discord URL makes the notifier do nothing.

The user request does not wait for Discord. Each HTTP attempt has a two-second
timeout, including the 429 response body. A 429 with a valid delay of at most
30 seconds gets one retry after its `retry_after` seconds, or its numeric
`Retry-After` header. A second 429
gets no further retry. See [Discord rate limits](https://github.com/discord/discord-api-docs/blob/main/developers/topics/rate-limits.mdx).
Longer delays get no retry. Rejection logs include the HTTP status code.
Other failures are logged with generic text and do not change the user response.
Receipt storage errors return 503 so Clerk can retry.

Each process permits 30 alert attempts in a fixed one-hour window. Join and
sign-up alerts share this limit. Duplicate and disabled alerts do not use it.
Once the limit is reached, further alerts are dropped. One generic warning is
logged per window when this occurs. The next window starts after one hour.
A process restart resets this limit. Dropped alerts keep their claims and are
not sent later.

Rows saved before this change have no alert claim. With alerts on,
`clerk-reconcile-waitlist --apply` makes one alert attempt for each such row
that needs a new Clerk entry. Expect a burst of alerts. The process limit or
Discord rate limits can drop some alerts, with no later delivery. Check the
dry-run report before `--apply` to see the size of the backlog.

These are best-effort alerts. The claim records an attempt before the HTTP call.
A crash, restart or Discord outage can lose an alert. There is no durable send
queue or later repair of failed alerts. This prevents duplicate messages when a
network error leaves the delivery result unknown. Existing requests are not
sent as a batch when you turn alerts on. Events received while alerts are off
are acknowledged and are not sent again when replayed.
