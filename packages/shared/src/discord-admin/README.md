# Shared Discord admin API

Import access, moderation, and delivery functions from `@yugidraft/shared/discord-admin`.
Import decisions from `@yugidraft/shared/services/waitlist-decisions`.
These modules use `better-sqlite3` and have no Discord client dependency.

## Access and audit

- `lookupSiteAccount(db, actor)` returns `{ siteUserId, discordUserId, displayName }` or `null`.
- `isAdminActor(db, actor)` checks the stored `users` row against the current `OWNER_USER_IDS`.
- `isModerator(db, actor)` permits an admin or a Discord actor with `DISCORD_MODERATOR_ROLE_ID`.
- `adminAccess(db, discordUserId | actor)` returns `{ siteUserId, discordUserId, isAdmin, isModerator }`.
- `recordModAction(db, { guildId, actorSiteUserId?, actorDiscordId?, action, targetSiteUserId?, targetDiscordId?, reason?, params?, result })` returns the audit row ID. `result` is `success`, `failure`, or `denied`. When enabled and configured, it also queues a mod-log embed.
- `addWarning(db, { guildId, actorSiteUserId?, actorDiscordId?, targetDiscordId, reason })` returns a warning ID and records its audit action atomically.
- `listWarnings(db, guildId, targetDiscordId, limit?)` returns at most 100 warnings.

An actor is `{ siteUserId: number | string, roles? }` or `{ discordUserId: string, roles? }`.
Use a verified session or guild interaction. Supply role IDs from the interaction, never request text.
Discord identity resolves only through `users.discord_user_id`; there is no second link table.
Web owners can use their site account without linking Discord. Discord owner access requires the link; the Moderator role does not require a linked site account.
The bot must check guild, interaction context, and target hierarchy before calling moderation services.

## Outbox poller

```ts
const rows = claimOutbox(db, 10);
for (const row of rows) {
  // Send JSON.parse(row.payload_json) as the Discord REST body.
  // operation='post': POST /channels/{channel_id}/messages
  // operation='edit': PATCH /channels/{channel_id}/messages/{message_id}
  try {
    const message = await deliver(row);
    markPosted(db, row, { messageId: message.id, channelId: message.channel_id });
  } catch {
    markFailed(db, row, { code: "transport" });
  }
}
```

- `enqueueOutbox(db, { idempotencyKey, kind, channelId, payload, operation?, messageId?, waitlistActionId?, modActionId?, subjectHash?, subjectClerkId?, availableAt? })` returns the existing or new row ID. Call it in the transaction that writes domain state.
- `claimOutbox(db, limit = 10, { now?, leaseMs? }?)` atomically returns due rows with fresh lease tokens. The default lease is 60 seconds. A shared SQLite budget permits 30 claims per minute, including retries and edits. Keep batches small enough to deliver within the lease.
- `markPosted(db, claimedRow, { messageId, channelId? }, now?)` saves delivery IDs and clears the transient body. It returns `false` for a stale or deleted claim. Original waitlist posts bind the message ID to the action and its queued edit. Completed edits set `discord_updated_at`.
- `markFailed(db, claimedRow, { code?, retryAfterMs?, permanent? }?, now?)` returns whether the claim still belongs to the caller. Codes are `transport`, `rate_limited`, `rejected`, and `invalid_payload`. Pass Discord's retry delay in milliseconds. Backoff starts at one second. Eight failed attempts or `permanent: true` makes the row `dead` and clears its body.

Rows use snake_case: `id`, `idempotency_key`, `kind`, `operation`, `channel_id`, `message_id`, `payload_json`, `status`, `attempts`, `available_at`, `lease_token`, `lease_expires_at`, `last_error`, `waitlist_action_id`, `mod_action_id`, `subject_hash`, `subject_clerk_id`, `created_at`, `posted_at`.
Statuses are `pending`, `processing`, `posted`, `failed`, and `dead`.
Every message disables mentions. Posts include a stable `nonce` and `enforce_nonce`; preserve both fields in the REST body. Delivery is at least once; Discord's nonce check covers recent repeated posts. A deleted edit target (404) can be acknowledged with `markPosted` using its existing ID.

## Waitlist decisions

`prepareWaitlistAction(db, { email?, clerkEntryId? })` binds form and Clerk events before dedupe.
`getWaitlistAction(db, actionId)` resolves `wl:approve:<actionId>` and `wl:reject:<actionId>` buttons.
A local alert waits for a Clerk entry ID before delivery.

```ts
const result = await decideWaitlistEntry(db, {
  clerkEntryId,
  email, // From the trusted Clerk entry, required if there is no existing subject hash.
  decision: "approve", // or "reject"
  actor: { siteUserId }, // bot: { discordUserId, roles }
  source: "web", // or "discord"
});
```

The optional third argument is a `ClerkBackend`; production defaults to `createClerkBackend` with `CLERK_SECRET_KEY`.
The service checks owner access and claims a 30-second lease before HTTP.
The first decision, actor, and source remain pinned across retries. Matching Clerk 409 already-invited/already-rejected responses succeed.
Results contain `{ status, action }`, where status is `completed`, `already_decided`, `in_progress`, or `conflict`.
Use the returned action's decision and actor to explain repeated presses. `WaitlistDecisionError` has safe `status` and `code` fields; Clerk failures return 503 `clerk_unavailable`.
A web-first decision must supply the entry's email so deletion can find its hash. Missing identity returns 409 `waitlist_identity_not_ready` before HTTP.

Completion records an audit row and, when a post or message ID exists, queues `waitlist_decision` as an edit with no buttons and text such as `Approved by Owner (web)`. A web-first decision without a Discord alert queues no edit.
The edit waits for the original post's message ID. If a decision precedes the post, its queued alert body is replaced with the result, removing email and buttons.

## Schema and retention

`src/db/schema.ts` creates `discord_outbox`, `discord_waitlist_actions`, `mod_actions`, and `mod_warnings` after identity migration. `discord_outbox_budget` holds one rate-budget row. `discord_join_subjects` stores email hashes and Clerk user IDs so privacy deletion works with reordered webhooks and disabled signup alerts.
The Clerk backend file is copied exactly from commit `a5ca9e969` so the admin-console branch can merge the same change.

With web `DISCORD_ADMIN_OUTBOX_ENABLED=1` and `DISCORD_WAITLIST_CHANNEL_ID` configured, signed Clerk receipts and outbox alerts commit together. Both join and signup alerts default on for this path; their existing alert flags can disable them. An enabled producer with a missing channel logs once and uses the existing webhook path and defaults without failing the Clerk receipt. The web gameplay flag remains `DISCORD_BOT_ENABLED=0`.
Bot messages always mask email, even when the legacy full-email flag is set. Decisions store a subject hash and IDs, never email text. Posted/dead bodies are discarded; deciding also clears pending email text.
`createWaitlistService(db).remove(email)` and `deleteUserAccount` clear related decisions, outbox rows, and dedupe claims. Linked signup IDs and Clerk subject IDs retain deletion links after an email change. Foreign keys cascade direct local waitlist deletion. Account deletion also removes related moderation rows and warnings.

The runtime consumes the outbox through the real exported functions. It checks the destination guild and sends the stored body with all mentions disabled. Bot feature handlers use this common service. Web `/admin` still calls Clerk directly until PR #405 merges; after both PRs merge, connect its decisions to `decideWaitlistEntry`.

## Bot heartbeat

The shared migration creates `bot_heartbeat(id, at, pid)`. The enabled bot maintains singleton `id=1`: `at` is Unix time in milliseconds and `pid` is the PID inside the bot container. It upserts the row at startup and every 30 seconds while the Gateway is ready, and removes its own row on a disconnected heartbeat or shutdown. Disabled mode does not open SQLite. A crash leaves the last timestamp for stale-health detection.

The admin console System section can read `select at, pid from bot_heartbeat where id=1`. Treat an absent row or an age above 120 seconds as unavailable. Use timestamp recency across containers; the PID is diagnostic data and is local to the bot container. Repeated migrations preserve the current row.
