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

Cards are titled `Waitlist request: needs your decision` and `New account created`. Both show `Email`, `Where`, optional `Heard from` (including detail), and `When`. Waitlist cards have Approve/Reject buttons; account cards have none. Context text hides email addresses and escapes Markdown formatting while preserving ordinary punctuation such as hyphens.

The renderer adds the current Clerk pending count as `Still waiting`. `Place in line` is the entry's one-based position in the oldest-first pending queue, shown only when the entry is in the first 500 entries and its position differs from the total. The count uses Clerk's `totalCount`, including entries beyond that page. During a Clerk outage, the masked alert still posts with `Still waiting (known locally)`, the count of unfinished local actions; position is omitted.

`Where` describes the actual form or access path:

| Stored origin / account context | Where |
| --- | --- |
| `hero` | Website: join form at the top of the home page |
| `footer` | Website: join form at the bottom of the home page |
| `form` / unknown | Website: join form |
| `app-not-invited` | App: tried to sign in without an invite, then joined the waitlist |
| Resolved `creator:<code>` | Creator link (closed or full): name · link label |
| Bare `creator` / unresolved code | Creator link (closed or full) |
| Clerk entry without a stored form origin | Clerk: added directly to the waitlist in Clerk |
| Account with a creator link grant | Creator link: name · link label |
| Account with a creator email grant | Creator email invite: name |
| Account with a completed waitlist approval | Waitlist: approved by owner name · Originally: original Where |
| Account without either attribution | Direct invite or Clerk |

Missing labels, approver names and original origins are omitted. Creator context comes from read-only creator-access lookups, including closed links. Approval context comes from `discord_waitlist_actions`, only when completed by the account's creation time. An email-less account can still use its Clerk identity. The shared renderer serves the durable outbox and legacy webhook fallback. Existing notification hashes, one-alert-per-person/type claims and signed-webhook receipts remain unchanged.

Emails stay masked unless `DISCORD_ADMIN_SHOW_FULL_EMAIL=1`. In that mode, the renderer reads the trusted Clerk entry or signup's primary address and verifies its hash against the alert subject. A lookup failure or changed address keeps the stored masked value. Full emails exist only in the delivery body in memory; the persisted alert stays masked and is cleared after delivery. Neither decisions nor audit records contain an email.

Successful decisions use `decideWaitlistEntry`; this service always writes the mod action. Repeated or conflicting presses do not call Clerk again. The first decision and actor stay pinned across a failed Clerk call. Errors produce a private reply and do not change the alert buttons. Decision edits are durable outbox work, delivered on the next sweep, and show the original actor, source and completion time with no email or buttons. Web and Discord now use the same decision text, including the `admin` source label. Deleted Discord messages follow Phase 0's acknowledgement policy; rejected edits and rate limits follow its dead-letter/retry policy.

### Mod-log investigation and decision (2026-11-05)

Previously, each successful approve/reject both edited the original alert to `Approved/Rejected by Owner …` and called `recordModAction`, which automatically queued a separate `Moderation action` embed with Action, Result, Actor and Target. That second post repeated the durable decision card and often had `Target: none` before a local account existed. No automatic sign-up mod-log post exists: the Clerk `user.created` path only queues the account alert.

Successful decisions now suppress that automatic mirror. If a posted or queued live alert can carry the decision, only its durable decision post/edit is queued. If no such alert exists (for example, a command or web-first decision with alerts disabled), one short mod-log line remains: `Approved/Rejected by Owner · <time> (Discord/web/admin) · <masked email or Clerk waitlist entry ID>`. The line is linked to its mod action and subject hash; email stays masked even with full-email display enabled. The bot's commands retain only the entry ID when calling the decision service, so their fallback audit uses that ID. Failure diagnostics and unrelated moderation logs retain their existing behavior. Neither `discord_waitlist_actions` nor `mod_actions` audit rows are removed by this change.

The optional `Account created <time>` edit to the earlier card is deferred. Actions have no durable account-created timestamp today, and delivery clears transient alert bodies. Safely adding this state would need handling for signup-before-post, in-flight decision edits, restart and privacy deletion. The account card instead includes the approver and original Where when available.

Before returning a prepared claim, the feature checks its persisted lease, payload and action again. This prevents a web decision or privacy deletion during enrichment from sending an old actionable alert. A web decision before posting is rendered as a final decision on the first post.

## Web route integration

Web `/admin` calls the shared decision service with its authenticated site user and source `admin`, so a web decision updates the matching Discord message and audit. It retains owner and Origin checks, resolves email by ID from the server-side cached Clerk list, and clears the cache after a decision.

The admin-console route retains its session, owner, Origin and input checks, resolves the exact Clerk entry email on the server, then calls:

```ts
const result = await decideWaitlistEntry(getDb(), {
  clerkEntryId: entry.id,
  email: entry.email,
  decision: action,
  actor: { siteUserId: actor.userId },
  source: "admin",
});
```

Import the service from `@yugidraft/shared/services/waitlist-decisions`. Treat `completed` and `already_decided` as success; handle `in_progress` and `conflict` explicitly and keep cache invalidation. The email is necessary for web-first decisions which have no existing alert identity. The bot integration test calls this same service with `source: "web"` and verifies the real Phase 0 poller issues a Discord PATCH and sets `discord_updated_at`. Web route integration tests verify admin decisions enqueue an edit when an alert message exists, enqueue no edit without an alert, ignore client identity fields, and return all four decision outcomes.

## Verification

Use Node 22. From the worktree root:

```sh
prlimit --core=0 -- npm run build --workspace=packages/shared
prlimit --core=0 -- npm run typecheck --workspace=packages/bot
prlimit --core=0 -- npm exec --workspace=packages/bot -- vitest run src/features/waitlist/integration.test.ts
```

The feature integration file uses a migrated SQLite file, actual runtime dispatcher/adapters/outbox, and local HTTP servers at the Discord and Clerk network edges. It covers access revocation, unlinked owners, foreign guilds and DMs, email masking and opt-in disclosure, pagination, exact identity lookup, double presses, decision races, Clerk 409/5xx, web-source edits, pre-post decisions, privacy deletion during preparation, restart, mod-log delivery, and Discord 403/404/429.
