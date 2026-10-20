# Waitlist feature

`features/index.ts` already registers `waitlist`. No registry or shared-file change is needed.

## Commands and buttons

- `/waitlist` lists pending Clerk entries, oldest first, ten entries per page.
- `/waitlist page:2` selects a page.
- `/waitlist action:approve entry:<exact email or Clerk ID>` invites an entry.
- `/waitlist action:reject entry:<exact email or Clerk ID>` rejects an entry.
- Each list entry and channel alert has Approve and Reject buttons. Previous, Refresh and Next open a new private page.

All commands and buttons require a linked site owner in the current `OWNER_USER_IDS`. The dispatcher checks `adminAccess`, and the feature checks it again. The shared decision service checks owner access before claiming the decision. A Moderator role alone does not grant access. Registration restricts the command to guilds and sets the Administrator default member permission as a second gate. Server integration command overrides can grant command visibility to the linked owners.

Actor replies are ephemeral. Channel posts disable mentions. The bot needs View Channel, Send Messages and Embed Links in `DISCORD_WAITLIST_CHANNEL_ID` and `DISCORD_MOD_LOG_CHANNEL_ID`. It must retain access to edit its own alert messages. `CLERK_SECRET_KEY` is required for listing and decisions.

Ten pairs of buttons exceed the legacy five-action-row limit. The private list uses Components V2 (35 components for a full page). Channel alerts remain normal embeds.

## Delivery

Phase 0 already writes the alert and decision outbox rows. This feature's `start` hook adapts the synchronous claim interface to prepare one leased alert at a time with bounded Clerk requests. The next runtime sweep delivers the complete JSON. The shared outbox still owns leases, rate limits, retries, nonces, message binding, audit delivery and edit acknowledgement. Shutdown releases an alert which has not been sent.

The renderer adds When and the current Clerk pending count. Position is shown when the entry is in the first 500 pending entries; the pending count covers the whole queue. During a Clerk outage, the masked alert still posts and the count is explicitly labelled `Pending (known)` to indicate local knowledge.

Emails stay masked unless `DISCORD_ADMIN_SHOW_FULL_EMAIL=1`. In that mode, the renderer reads the trusted Clerk entry or signup's primary address and verifies its hash against the alert subject. A lookup failure or changed address keeps the stored masked value. Full emails exist only in the delivery body in memory; the persisted alert stays masked and is cleared after delivery. Neither decisions nor audit records contain an email.

Successful decisions use `decideWaitlistEntry`; this service also writes the mod action and mod-log outbox row. Repeated or conflicting presses do not call Clerk again. The first decision and actor stay pinned across a failed Clerk call. Errors produce a private reply and do not change the alert buttons. Decision edits are durable outbox work, delivered on the next sweep, and show the original actor, source and completion time with no email or buttons. Deleted Discord messages follow Phase 0's acknowledgement policy; rejected edits and rate limits follow its dead-letter/retry policy.

Before returning a prepared claim, the feature checks its persisted lease, payload and action again. This prevents a web decision or privacy deletion during enrichment from sending an old actionable alert. A web decision before posting is rendered as a final decision on the first post.

## Web route integration still required

Web `/admin` still calls Clerk invite/reject directly until the admin console in **PR #405** merges. After both PR #405 and PR #407 merge, replace those calls with the shared decision service so web decisions update the Discord message and audit. This follow-up retains the existing web access checks.

When the admin-console route is integrated, retain its session, owner, origin and input checks. Resolve the exact Clerk entry to obtain its email, then replace the direct invite/reject call with:

```ts
const result = await decideWaitlistEntry(getDb(), {
  clerkEntryId: entry.id,
  email: entry.email_address,
  decision: action,
  actor: { siteUserId: actor.userId },
  source: "web",
}, backend);
```

Import the service from `@yugidraft/shared/services/waitlist-decisions`. Treat `completed` and `already_decided` as success; handle `in_progress` and `conflict` explicitly and keep cache invalidation. The email is necessary for web-first decisions which have no existing alert identity. The integration test calls this same service with `source: "web"` and verifies the real Phase 0 poller issues a Discord PATCH and sets `discord_updated_at`. An HTTP test of the actual `/admin` route remains blocked until that route is present and connected.

## Verification

Use Node 22. From the worktree root:

```sh
npm run typecheck --workspace=packages/bot
npm test --workspace=packages/bot
```

The feature integration file uses a migrated SQLite file, actual runtime dispatcher/adapters/outbox, and local HTTP servers at the Discord and Clerk network edges. It covers access revocation, unlinked owners, foreign guilds and DMs, email masking and opt-in disclosure, pagination, exact identity lookup, double presses, decision races, Clerk 409/5xx, web-source edits, pre-post decisions, privacy deletion during preparation, restart, mod-log delivery, and Discord 403/404/429.
