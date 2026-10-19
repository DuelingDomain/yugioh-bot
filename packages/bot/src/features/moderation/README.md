# Moderation

All commands and confirmation buttons require either a linked site owner in
`OWNER_USER_IDS` or the current `DISCORD_MODERATOR_ROLE_ID` role. Membership is
fetched again at execution. Only linked site owners can clear warnings.

Discord command defaults require Moderate Members. As described in the deployment
guide, enable these commands for the Moderator role in Server Settings →
Integrations if that role does not have Moderate Members. The bot does not need
Administrator. The bot and actor must both rank above member targets. The guild
owner, linked site owners, the bot and the actor are protected targets.

| Command | Function | Bot permission |
| --- | --- | --- |
| `/timeout user duration [reason]` | Set a timeout up to 28 days; `remove` or `0` removes it | Moderate Members |
| `/untimeout user [reason]` | Remove a timeout | Moderate Members |
| `/kick user [reason]` | Kick after confirmation | Kick Members |
| `/ban user [reason] [delete-message-days]` | Ban after confirmation; delete 0–7 days of messages | Ban Members |
| `/unban user-id [reason]` | Unban by Discord ID | Ban Members |
| `/purge count [user] [reason]` | Scan the latest 1–100 messages in this channel; delete matches younger than 14 days | View Channel, Read Message History, Manage Messages |
| `/warn user reason` | Save a warning, try to send a DM, report the total count | No extra permission; DM can be refused |
| `/warnings user [page] [clear] [reason]` | List 10 warnings per page; site owners can clear a warning ID after confirmation | No extra permission |
| `/slowmode channel seconds [reason]` | Set 0–21600 seconds; 0 disables it | View Channel, Manage Channels |
| `/lock [channel] [reason]` | Confirm, save the current overwrite, then deny @everyone Send Messages | View Channel, Manage Roles, Send Messages |
| `/unlock [channel] [reason]` | Confirm, then restore the complete saved @everyone overwrite or its absence | View Channel, Manage Roles |
| **User info** user context menu | Show join date, roles, warning count, and five recent moderation actions | No extra permission |

Purge confirms above 10, freezes the selected message IDs, and checks their age
again at execution. It reports old messages and nonmatching users. A five-second
margin avoids sending messages that age past Discord's 14-day limit in its queue.
Timeout durations use integer `s`, `m`, `h`, `d`, `w` units, such as `30m` or `1d12h`.
Slowmode supports text, voice, stage, forum and media channels. Lock/unlock support
text, announcement, forum and media channels. Threads are excluded.

Confirm/Cancel buttons expire after 60 seconds, are single use, and belong to the
actor who requested them. Both buttons recheck current access. Confirm rechecks
target hierarchy and bot permissions. Mutations use the runtime's guild lock and
three-second actor cooldown. Actor replies are ephemeral and disable mentions.

Audit records use shared `recordModAction` and one mod-log outbox message with
actor, target, reason and duration. Warning writes and removal commit with their
audit/outbox records. Read actions stay in the audit but do not displace the five
moderation actions shown in User info. Error replies and stored failure codes do
not include raw Discord errors.

Lock snapshots are separate `lock_snapshot` audit records written before REST.
Successful unlock refers to the snapshot ID, marking it restored. An uncertain
lock failure leaves the snapshot available: use `/unlock` to restore it before
trying `/lock` again. This also works after a bot restart. Preserve these audit
records while a channel remains locked. Account deletion removes personal audit
data and queued posts, but keeps anonymized lock snapshots and successful unlock
markers so recovery remains correct.

The existing feature registry already imports `moderation`. The context-menu
definition uses a local type bridge because Phase 0 typed only slash command JSON.
Its local startup listener handles and drains context-menu interactions. No runtime,
shared code, schema, or registry change is required.

Verification (Node 22, from the worktree root):

```sh
npm run typecheck --workspace=packages/bot
npx vitest run packages/bot/src/features/moderation/moderation.integration.test.ts packages/bot/tests/integration/runtime.test.ts
```

The integration suite uses real SQLite, discord.js interactions, the real runtime
dispatcher and adapters, shared audit/outbox services, and a local HTTP Discord
REST server. It includes REST delivery of a queued mod log and a lock write applied
by the server before it returns an error, followed by reopening SQLite and recovery.
