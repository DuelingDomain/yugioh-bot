# Admin Discord bot returns

Status: accepted (owner, 2026-10-19).

This supersedes the decision in [ADR 0004](0004-alpha-access-clerk.md) to shelve the bot and remove it from Compose. Clerk and application `users.id` remain the identity source. Discord membership does not grant site access. The worker retains all gameplay timers, Genesys sync, set sync and image cleanup.

Run one small discord.js Gateway process in its own container. Request only `Guilds`, `GuildMembers`, `GuildModeration`, and `AutoModerationExecution`. Enable the privileged Server Members intent in the Developer Portal. Do not request Message Content or Presence. The bot has no inbound HTTP port. The old player commands, port 4001 announce server, reminders, notification cleanup and duplicate jobs are removed permanently.

Only literal `DISCORD_BOT_ENABLED=1` starts Discord or opens SQLite. Other values keep a healthy idle process. Roll back this service by setting `DISCORD_BOT_ENABLED=0` and recreating `bot`. This release provides the runtime and empty feature folders. It registers **zero commands**, which removes the old guild commands. It does not post alerts until Phase 1 installs a delivery hook. No deploy ping is included. PR #400 stays open and is not merged.

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

Each command has `data.toJSON()`, `access`, `execute(interaction, context)`, optional `autocomplete`, `acknowledgement`, and `destructive`. Components have the same handler fields and a unique `prefix`, such as `wl:`. Prefixes must not overlap; `confirm:` is reserved. Command names must be unique. Registry construction rejects conflicts before login or deployment.

The four owning folders are `src/features/moderation/`, `server/`, `waitlist/`, and `community/`. Each exports its module from `index.ts`. Put each command in its own file and collect it in that folder's index. `src/features/index.ts` collects the four modules. Both the dispatcher and the guild command deploy script consume that list. Phase 1 workers need to edit only their own feature folders.

The dispatcher wraps real discord.js interactions with `CommandInteractionLike`, `ButtonInteractionLike`, `ModalInteractionLike`, or `AutocompleteInteractionLike`. Replies have empty allowed mentions. The context supplies `db`, `config`, `client`, `rest`, `signal`, `shared`, `audit`, `confirmations`, and `cooldown`. The client is available for feature Gateway listeners; each listener must check the configured guild and remove itself in its stop callback.

Every command, button, modal and autocomplete passes a guild and access check. Admin means a verified `users.discord_user_id` link to a `users.id` in `OWNER_USER_IDS`. Discord Administrator permission alone grants no code access. Moderation also allows the configured Moderator role, fetched through REST on each interaction. Server management and waitlist stay admin only. Definitions are guild only; default visibility is Administrator for admin commands and Moderate Members for moderation commands. Public commands have no default permission restriction. The Integrations command overrides can make the Moderator role visible without changing code authorization.

Default acknowledgement is an ephemeral deferred reply before shared-service or member REST access. Button modules that edit their original message can use `deferUpdate`. A command that opens a modal uses `manual` and must acknowledge within three seconds. Autocomplete must respond within three seconds. Unknown actions and failures return fixed text. Feature handlers must audit success and failure with safe parameters; the dispatcher audits access refusals. No raw Discord error is shown to the member.

`confirmations.request(interaction, { summary, access, execute })` stores a 60-second nonce bound to the invoker and guild. Capture the exact confirmed payload in the closure; do not read options again. Confirmation rechecks access, consumes the nonce before execution, and applies a three-second actor cooldown with one operation at a time per guild. Use `destructive: true` for immediate actions that need that cooldown. Do not mark the request-for-confirmation command destructive; the confirmed operation takes the lock. Features must enforce actor/bot hierarchy, protected targets and command-specific limits before a mutation.

## Task B boundary

Task B owns `@yugidraft/shared/discord-admin`, its package export, all tables and migrations, Clerk access and waitlist decisions. Task A does not change shared source. `runtime/shared.ts` is the one adapter to that export. An absent export logs one warning and disables privileged access. A broken installed export fails startup instead of silently substituting a stub.

The adapter calls these shared functions (the structural declarations are in `runtime/shared.ts`):

```ts
adminAccess(db, discordUserId)
// { siteUserId: number | null, isAdmin: boolean, ... }
recordModAction(db, {
  guildId, actorDiscordId, action, targetDiscordId?, reason?, params?,
  result: "success" | "failure" | "denied"
})
claimOutbox(db, limit)
markPosted(db, claimedRow, { messageId })
markFailed(db, claimedRow)
```

`recordModAction` persists an action and queues its mod-log post in one transaction. `context.audit` calls this service once. It does not also post directly. `runtime/audit.ts` exports `postAuditMessage` for the Phase 1 outbox renderer.

The agreed table name is **`discord_outbox`**. The claimed row contract used by the bot is:

```ts
interface DiscordOutboxRow {
  id: number;
  kind: string;
  operation: "post" | "edit";
  channel_id: string;
  message_id: string | null;
  payload_json: string;
  idempotency_key: string;
  lease_token: string;
  lease_expires_at: number;
  attempts: number;
}
```

Task B may return additional columns. It owns atomic claiming, lease fencing, durable retry, deduplication, poison-row isolation and the shared 30-attempt-per-minute budget. The adapter marks each row posted or failed independently. It never implements SQL or schema changes itself.

`runtime/outbox.ts` exports `startOutboxPoller({ shared, guildId, signal, deliver?, intervalMs? }): Stop`. The default interval is three seconds. There is no claim without a delivery function. The runtime also caps delivery attempts to 30 per rolling minute, prevents overlapping sweeps and drains a sweep on shutdown. Delivery returns `{ messageId }`. It must check that the destination belongs to the configured guild, enforce empty allowed mentions, handle `post` and `edit`, and check `signal` before network effects.

The waitlist module can install this poller from its `start(context)` and return its stop callback. Its renderer owns embeds, waitlist buttons and message edits. It must also route the shared `mod_log` kind to the audit poster. `startBot` accepts an optional `deliverOutbox` hook for a composed renderer; choose one installation path so there is one consumer. Phase 0 supplies neither renderer and claims no rows.

Web and worker keep their old gameplay Discord switch fixed to `0` in Compose. Phase 1 must separate those old web capabilities from the shared notifier switch before enabling the web outbox producer. Do not enable the removed 4001 path. Task B's notifier uses webhooks when its process has `DISCORD_BOT_ENABLED!=1`.

## Deployment and verification

The bot gets a separate ARM64 image in the production build, pull, promotion and retention lists. Rollback to older releases with no bot image remains supported. The image compiles only bot/shared and installs their production dependencies. It runs as `node`, with no capabilities, no new privileges, no published ports, a 256 MB memory limit and a 160 MB heap cap. The shared package still requires sharp for its own services; the bot has no direct sharp or cron dependency.

Start after web. The bot heartbeat is container-local and checks Gateway readiness; disabled mode is healthy. Shutdown stops new dispatch, aborts work, stops feature hooks and polling, drains active interactions, destroys the client, closes SQLite and flushes observability. Gameplay deployment health checks do not wait for the bot.

Runtime integration tests use real SQLite and discord.js against local HTTP and WebSocket servers. They verify guild command replacement, exact intents, adapters, dispatch, mention suppression, guild refusal, health and shutdown. No new unit tests are added. A private test guild remains the owner acceptance check; see [setup](../deployment/discord-bot.md).
