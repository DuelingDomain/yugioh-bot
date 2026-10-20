# Server management

All commands and confirmation buttons require a linked site account allowed by
`adminAccess`. Discord registration also defaults to Administrator and guild use.
Moderator access alone does not permit these commands. Responses are ephemeral;
posts disable mentions. The existing feature registry already imports this module.

| Command | Function | Bot permissions |
| --- | --- | --- |
| `/channel create` | Create text, voice, announcement, forum, or stage channels; optional category, topic, slowmode, and private role visibility | Manage Channels; private channels also need Manage Roles and View Channel |
| `/channel edit` | Set name, topic, slowmode, category, position, or NSFW; `uncategorized` removes the parent | Manage Channels |
| `/channel delete` | Delete after confirmation; configured bot channels are protected | Manage Channels |
| `/category create`, `/category rename` | Create or rename a category | Manage Channels |
| `/category delete` | Delete after confirmation; nonempty categories require `move-to` or `move-to-root` | Manage Channels on the source, children, and destination |
| `/permissions set` | Set one role/member overwrite to allow, deny, or neutral after confirmation | Manage Roles and the selected permission, subject to Discord overwrite rules |
| `/permissions view` | Show all overwrites, including bits outside the editable list; attach large results as a text file | View Channel |
| `/role create`, `/role edit`, `/role delete`, `/role give`, `/role take` | Manage role appearance and membership; confirm deletion | Manage Roles |
| `/setup channels` | Confirm creation or repair of the recommended layout and print IDs and env values | Manage Channels, Manage Roles, View Channel, Send Messages, Send Messages in Threads, Embed Links, Attach Files, Read Message History |

Private channel `roles` accepts up to 20 space/comma-separated role IDs or role
mentions. Linked site admins and the bot also receive visibility.

The editable permissions are View, Send, Read History, Attach, Embed, React,
Connect, Speak, and Manage Messages. Changes preserve unrelated
overwrite bits. Neutral removes the chosen bit from both allow and deny.

Role and member targets must be below the bot and actor. The server owner bypasses
the actor hierarchy check, but cannot bypass the bot hierarchy. Managed roles,
@everyone role changes, and member actions on the bot, server owner, or site owners
are refused. Only the server owner may manage privileged roles with Administrator,
Manage Server, or Manage Roles. In addition, `/role give` refuses roles with Ban Members, Kick Members, Moderate Members, Manage Channels, Manage Webhooks or Mention Everyone, and the configured Moderator role, unless the actor is the server owner. Role creation grants no server permissions.

Confirm and Cancel buttons expire after 60 seconds. They are bound to the same
admin and guild, can be consumed once, and check current access and target state.
Confirm and Cancel edit the original prompt, remove its buttons and show the result.
Destructive actions use the runtime's per-guild lock and three-second actor cooldown.
Category deletion refuses a changed child list; child moves preserve their current
overwrites. Discord operations are not transactional, so a failed multi-step setup
or category move can leave completed steps in place. The audit records that failure;
run the command again after the cause is corrected.

Setup reuses unique names and refuses ambiguous names or incompatible channel types.
It replaces overwrites on reused channels to repair access:

- `Admin`, `signups`, and `online-now`: linked site admins and bot visibility.
- `mod-log`: the same visibility, plus the configured Moderator role. If no role ID
  is configured, setup uses the role named `Moderator` when present.
- `announcements`: public, outside the private category; members cannot send channel
  or thread messages. Admins and the bot can post. Thread creation is also denied
  when the bot holds those permissions; the approved invite does not require them.
  If an ordinary role grants thread creation that the bot cannot deny, setup stops
  before any write and lists the roles whose grants must be removed first.

Setup prints `DISCORD_WAITLIST_CHANNEL_ID`, `DISCORD_MOD_LOG_CHANNEL_ID`,
`DISCORD_STATUS_CHANNEL_ID`, `DISCORD_ANNOUNCE_CHANNEL_ID`, and the Moderator role
ID when found. Apply these values and restart the bot. It does not edit the environment.

All completed, failed, refused, and cancelled actions record `mod_actions` and queue
the shared mod-log outbox post. Setup can queue its own audit to the new mod-log
before the environment value is set. Raw Discord errors are not stored or shown.

Integration checks use real SQLite and a local HTTP Discord REST stub, including
the original baseline permissions without Administrator. Use the combined
permission integer in the [deployment guide](../../../../../docs/deployment/discord-bot.md)
for the integrated release, including all editable permission bits.

Build shared first (`npm run build --workspace=@yugidraft/shared` from the repository
root). Then, from `packages/bot` with Node 22:

```sh
npx vitest run src/features/server/server.integration.test.ts tests/integration/runtime.test.ts tests/bot-enabled.test.ts
```

From the repository root:

```sh
npm run typecheck --workspace=@yugioh-discord-bot/bot
npm run build --workspace=@yugioh-discord-bot/bot
```
