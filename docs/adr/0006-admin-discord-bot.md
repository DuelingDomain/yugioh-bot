# Admin Discord bot returns

Status: accepted (owner, 2026-10-19).

This supersedes the decision in [ADR 0004](0004-alpha-access-clerk.md) to shelve the bot and remove it from Compose. Clerk and application `users.id` remain the identity source. Discord membership does not grant site access. The worker retains all gameplay timers, Genesys sync, set sync and image cleanup.

Run one small discord.js Gateway process in its own container. Request only `Guilds`, `GuildMembers`, `GuildModeration`, and `AutoModerationExecution`. Enable the privileged Server Members intent in the Developer Portal. Do not request Message Content or Presence. The bot has no inbound HTTP port. The old player commands, port 4001 announce server, reminders, notification cleanup and duplicate jobs are removed permanently.

Only literal `DISCORD_BOT_ENABLED=1` starts Discord or opens SQLite. Other values keep a healthy idle process. Roll back this service by setting `DISCORD_BOT_ENABLED=0` and recreating `bot`. The integrated moderation, server, waitlist and community modules register **22 guild commands** (21 slash commands and User info), replacing the old guild commands. The runtime delivers complete shared outbox payloads and waitlist decision edits; the modules handle waitlist buttons. No deploy ping is included. PR #400 stays open and is not merged. The final invite permission integer is `1391841111254`; see the complete [setup and permission list](../deployment/discord-bot.md).

## Module contract

The source of truth is `packages/bot/src/runtime/types.ts`:

```ts
type FeatureModule = {
  commands: readonly CommandModule[];
  buttons: readonly ComponentModule<ButtonInteractionLike>[];
  modals: readonly ComponentModule<ModalInteractionLike>[];
  start?(context: FeatureContext): Stop | void | Promise<Stop | void>;
};
type Access = "public" | "moderator" | "admin";
type Stop = () => void | Promise<void>;
```

Each command has `data.toJSON()`, `access`, `execute(interaction, context)`, optional `autocomplete` and `acknowledgement`. Components have the same handler fields and a unique `prefix`, such as `wl:`. Prefixes must not overlap. Command names must be unique. Registry construction rejects conflicts before login or deployment.

The four owning folders are `src/features/moderation/`, `server/`, `waitlist/`, and `community/`. Each exports its module from `index.ts`. Put each command in its own file and collect it in that folder's index. `src/features/index.ts` collects the four modules. Both the dispatcher and the guild command deploy script consume that list. Phase 1 workers need to edit only their own feature folders.

The dispatcher wraps real discord.js interactions with `CommandInteractionLike`, `ButtonInteractionLike`, `ModalInteractionLike`, or `AutocompleteInteractionLike`. Replies have empty allowed mentions. The context supplies `db`, `config`, `client`, `rest`, `signal`, `shared`, `audit`, and `cooldown`. The client is available for feature Gateway listeners; each listener must check the configured guild and remove itself in its stop callback.

Every command, button, modal and autocomplete passes a guild and access check. Admin means a verified `users.discord_user_id` link to a `users.id` in `OWNER_USER_IDS`. Discord Administrator permission alone grants no code access. Moderation also allows the configured Moderator role, fetched through REST on each interaction. Server management and waitlist stay admin only. Definitions are guild only; default visibility is Administrator for admin commands and Moderate Members for moderation commands. Public commands have no default permission restriction. The Integrations command overrides can make the Moderator role visible without changing code authorization.

Default acknowledgement is an ephemeral deferred reply before shared-service or member REST access. Button modules that edit their original message can use `deferUpdate`. A command that opens a modal uses `manual` and must acknowledge within three seconds. Autocomplete must respond within three seconds. Unknown actions and failures return fixed text. Feature handlers must audit success and failure with safe parameters; the dispatcher audits access refusals. No raw Discord error is shown to the member.

Each feature owns its active confirmation flow. The unused runtime `ConfirmationStore`, reserved `confirm:` branch and `destructive` flag are removed. Confirmation stores a 60-second nonce bound to the invoker and guild, freezes the intended action, rechecks access and target state, and consumes the nonce before execution. Features acquire `context.cooldown` for mutations: a three-second actor cooldown with one operation at a time per guild. Confirm and Cancel update the original prompt, remove its buttons and show the outcome. Features enforce actor/bot hierarchy, protected targets and command-specific limits before a mutation.

Channel moderation also checks the actor's resolved target-channel permissions and fresh permissions at execution. Non-admins need View Channel plus the action's management permission and cannot change configured bot destinations. Role grants refuse the configured Moderator role and roles with moderation/server powers unless the actor is the server owner. `/announce` permits only already mentionable roles; the invite excludes Manage Server and Mention Everyone.

## Shared admin boundary

`@yugidraft/shared/discord-admin` owns access, audit and durable outbox state. `@yugidraft/shared/services/waitlist-decisions` owns Clerk decisions. The shared API is required at startup. `runtime/shared.ts` imports its real types and binds access, audit, `claimOutbox`, `markPosted` and `markFailed` to the bot database. Identity resolves through `users.discord_user_id`.

`recordModAction` persists an action and queues its mod-log post in one transaction. `context.audit` calls this service once. The default poller delivers that stored body; handlers must not also post it directly.

Shared producers supply complete REST payloads in `discord_outbox.payload_json`, including waitlist embeds, buttons, decision edits and moderation logs. `DiscordOutboxRow` aliases the shared `ClaimedOutbox` type. Shared SQLite owns atomic claims, 60-second leases, fencing, durable retry, deduplication, poison-row isolation and a 30-claim-per-minute budget across processes.

`startBot` installs one poller automatically. It runs every three seconds and claims one row just before delivery. Each claimed row uses a fresh REST manager with a 10-second request timeout, immediate rate-limit rejection and no automatic retries. This avoids lingering timers from cached rate-limit handlers. A rate limit pauses further claims for the returned delay. The complete write, including its response body, has a 30-second deadline so shutdown fits within the container's 45-second grace period. The sender checks the channel's guild, suppresses all mentions, preserves nonces, and handles both `post` and `edit`. Missing edit targets are acknowledged with their existing ID. The poller stores fixed failure codes; it passes Discord retry delays to shared backoff and marks invalid payloads and rejected destinations permanent. It also caps local attempts to 30 per rolling minute.

The optional `startBot.deliverOutbox(row, context)` hook can replace the default sender. It returns `{ messageId, channelId? }`. Custom senders must preserve guild checks, mention suppression, post nonces and bounded I/O. Feature modules must not install a second consumer. Shutdown stops claims, cancels channel lookups and drains a started write before closing SQLite.

Web and worker keep their old gameplay `DISCORD_BOT_ENABLED=0` in Compose. Web uses the separate `DISCORD_ADMIN_OUTBOX_ENABLED=1` and `DISCORD_WAITLIST_CHANNEL_ID` settings to produce durable alerts without the removed port 4001 path. An enabled producer with a missing channel logs once and falls back to the webhook; configuration does not fail Clerk receipts. Decision edits are queued only when a matching post or message ID exists. Web `/admin` still calls Clerk directly until PR #405 merges; after both PRs merge, wire its decisions to `decideWaitlistEntry` as documented in the waitlist contract.

## Deployment and verification

The bot gets a separate ARM64 image in the production build, pull, promotion and retention lists. Rollback to older releases with no bot image remains supported. The image compiles only bot/shared and installs their production dependencies. It runs as `node`, with no capabilities, no new privileges, no published ports, a 256 MB memory limit and a 160 MB heap cap. The shared package still requires sharp for its own services; the bot has no direct sharp or cron dependency.

Start after web. The container-local file heartbeat checks Gateway readiness; disabled mode is healthy. The shared migration also creates `bot_heartbeat(id, at, pid)` with singleton `id=1`. The enabled bot writes a Unix millisecond timestamp and its container PID at startup and every 30 seconds while ready. It removes its row on a disconnected heartbeat or shutdown. The admin console reads recency from this table; a missing row or a timestamp older than 120 seconds means unavailable. A process crash leaves a stale timestamp. Disabled mode never opens SQLite. Shutdown stops new dispatch, aborts work, stops feature hooks and polling, drains active interactions, destroys the client, closes SQLite and flushes observability. Gameplay deployment health checks do not wait for the bot.

Runtime integration tests use real SQLite and discord.js against local HTTP and WebSocket servers. They verify guild command replacement, exact intents, adapters, dispatch, mention suppression, guild refusal, health and shutdown. No new unit tests are added. A private test guild remains the owner acceptance check; see [setup](../deployment/discord-bot.md).
