# Dueling Domain admin Discord bot

The bot runs in its own container and shares SQLite with web and worker. It registers 22 slash commands and the **User info** user context command in one configured guild. Old player commands, the announce HTTP server, reminder jobs, notification cleanup and duplicate Genesys sync have been removed. Worker still owns gameplay jobs. This release has no deploy ping.

## Developer Portal and invite

1. Open the [Discord Developer Portal](https://discord.com/developers/applications). Reuse the Dueling Domain application with its bot user, or create an application. Copy General Information → Application ID to `DISCORD_CLIENT_ID`.
2. Open **Bot**. Reset the token and save it in the private VM `.env`. Set **Public Bot** off and **Requires OAuth2 Code Grant** off.
3. Enable **Server Members Intent**. This is the only privileged intent requested. Keep **Presence Intent** and **Message Content Intent** off. The runtime requests `Guilds`, `GuildMembers`, `GuildModeration` and `AutoModerationExecution`; member lookups and `GuildMemberAdd` welcome delivery use `GuildMembers`. Site presence for `/online` comes from SQLite, not Discord presence. See [Gateway intents](https://docs.discord.com/developers/events/gateway#privileged-intents).
4. Under **Installation**, enable **Guild Install** only and disable **User Install**. For a private application, select a custom install link or no provided link if required by the Portal.
5. Enable Discord Developer Mode under User Settings → Advanced. Copy the bot server ID to `DISCORD_BOT_GUILD_ID`. Keep `DISCORD_GUILD_ID` at its existing site data value. Open the invite below as the server owner, with both IDs replaced.

```text
https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands&permissions=1391841111254&guild_id=<DISCORD_BOT_GUILD_ID>&disable_guild_select=true&integration_type=0
```

The scopes are **`bot applications.commands`**. The final permission integer is **`1391841111254`**. It includes Add Reactions, Connect and Speak for the server permission editor. It excludes Administrator, Manage Server (bit 5) and Mention Everyone (bit 17). The bits are `1,2,4,6,7,10,11,13,14,15,16,20,21,28,34,38,40`; see [Discord permission flags](https://docs.discord.com/developers/topics/permissions#bitwise-permission-flags).

| Permission | Bit | Reason |
| --- | ---: | --- |
| Kick Members | 1 | `/kick`. |
| Ban Members | 2 | `/ban` and `/unban`. |
| Manage Channels | 4 | Channel/category management, slowmode and setup. |
| Add Reactions | 6 | Allow the permission editor to set the `react` overwrite. |
| View Audit Log | 7 | Approved moderation baseline for audit inspection. |
| View Channels | 10 | Read destinations and inspect channel overwrites. |
| Send Messages | 11 | Announcements, sign-up alerts and mod-log posts. |
| Manage Messages | 13 | Purge and the `manage-messages` overwrite. |
| Embed Links | 14 | Cards, alerts, reports and announcement embeds. |
| Attach Files | 15 | Long online lists and permission reports. |
| Read Message History | 16 | Purge scans and saved-message access. |
| Connect | 20 | Allow the permission editor to set voice `connect`. The bot does not join voice. |
| Speak | 21 | Allow the permission editor to set voice `speak`. |
| Manage Roles | 28 | Role management, channel overwrites, private setup and lock/unlock. |
| Manage Threads | 34 | Approved baseline for thread management; `/lock` and `/unlock` operate on parent channels. |
| Send Messages in Threads | 38 | Setup repairs thread posting permissions and permits bot replies in threads. |
| Moderate Members | 40 | `/timeout` and `/untimeout`. |

In Server Settings → Roles, put the bot below the server owner's role and above roles it must manage. Both the actor and bot must rank above member/role targets. The guild owner can bypass only the actor hierarchy check. The bot can set only permissions it holds, and channel overwrites can remove permissions granted by the invite. Native AutoMod rules are managed in Discord's server settings in this release; there is no AutoMod event logger in the submitted modules. `/announce` accepts only a role that is already mentionable, and checks that setting again before posting. The permission editor does not offer `mention-everyone`.

## Link owners and run `/setup channels`

1. Each owner links Discord in the site's account settings. Put the linked account's application `users.id` in `OWNER_USER_IDS`, separated by commas. These are site IDs, not Discord IDs. Discord Administrator and server ownership alone do not grant bot owner access.
2. Create a **Moderator** role below the bot and copy its ID to `DISCORD_MODERATOR_ROLE_ID`. Moderators can use moderation commands and User info. Only linked owners can use server tools, waitlist, announcements and reports; warning deletion is also owner-only. `/card` is available to everyone in the configured guild.
3. Configure credentials, owner IDs and the shared database as below. Channel IDs can be empty during the first setup. Enable the test bot, deploy its commands and start it.
4. In Server Settings → Integrations → Dueling Domain, permit linked owners to use owner commands. Those commands default to Administrator visibility; moderation defaults to Moderate Members visibility. Add the Moderator role override where needed. The bot checks current access again on each command, button and modal.
5. As a linked owner, run **`/setup channels`**, review the preview, then Confirm within 60 seconds. It creates or repairs this layout:

   | Resource | Access |
   | --- | --- |
   | **Admin** category | Linked owners and bot. |
   | **#signups** | Linked owners and bot; waitlist alerts and decision buttons. |
   | **#mod-log** | Linked owners, bot and Moderator role. |
   | **#online-now** | Linked owners and bot; one live site-status embed, edited in place when activity changes. `/online` still replies privately. |
   | **#announcements**, outside Admin | Public reading; owner and bot posting. |
   | **#welcome**, outside Admin | Public reading; owner and bot posting; automatic member welcome cards. |

6. Copy the printed `DISCORD_WAITLIST_CHANNEL_ID`, `DISCORD_MOD_LOG_CHANNEL_ID`, `DISCORD_STATUS_CHANNEL_ID`, `DISCORD_ANNOUNCE_CHANNEL_ID`, `DISCORD_WELCOME_CHANNEL_ID` and Moderator role ID into the private environment. Setup prints values; it does not save them. Recreate the bot to load them. Set producer channel IDs before enabling automatic sign-up delivery.

Setup reuses unique names and replaces their parents and overwrites. Rename duplicate names or incompatible channel types first. It does not create the Moderator role. The invite omits thread creation permissions; if ordinary roles grant thread creation that the bot cannot deny, setup refuses before writing. Remove those grants and repeat setup. A Discord failure during a multi-step setup can leave completed steps; correct the cause and run setup again. Configured destination channels are protected from `/channel delete`.

## Environment

`DISCORD_GUILD_ID` is the site's data guild: players, duels, drafts, cubes, seasons and admin-console data stay under this value. Changing it hides the existing data from the site. To move the admin bot from an old server (for example, Computer Screen Ballers) to Dueling Domain, set only `DISCORD_BOT_GUILD_ID` to the new Discord server ID. No data migration is needed. Empty or unset `DISCORD_BOT_GUILD_ID` keeps the previous single-server behavior. For an invite with no override, replace the bot-guild placeholder with `DISCORD_GUILD_ID`.

All bot channel IDs (signups, mod-log, status, announcements and welcome) and the Moderator role must belong to the bot server. Discord moderation records, warnings and lock snapshots use the bot server. Waitlist decision audit records keep the site data guild for both web and Discord decisions; their outbox messages go to channels in the bot server. `/online` reads site presence and uses the data guild for duel labels. `/stats` reads site duels and drafts from the data guild. The #online-now publisher uses those same report sources plus data-guild tournaments and series. `/card` reads the existing shared card catalog and engine data. The web channel picker also lists the bot server's channels, so Compose passes the override to web. Current web login uses Clerk and site owner IDs, with no Discord guild membership check. The admin console System panel does not display a guild ID; its duel probes keep using the data guild.

Use a separate application, guild, Clerk instance and database for tests. Keep secrets in runtime environment only, outside Git and Docker build arguments. `DISCORD_CLIENT_ID` is the application ID; `DISCORD_APPLICATION_ID` is not read.

```dotenv
DISCORD_BOT_ENABLED=0
DISCORD_TOKEN=<bot-token>
DISCORD_CLIENT_ID=<application-id>
DISCORD_GUILD_ID=<existing-site-data-guild-id>
DISCORD_BOT_GUILD_ID=<bot-server-id>
OWNER_USER_IDS=<comma-separated-application-user-ids>
CLERK_SECRET_KEY=<clerk-instance-secret>
DISCORD_MODERATOR_ROLE_ID=<moderator-role-id>
DISCORD_WAITLIST_CHANNEL_ID=<signups-channel-id>
DISCORD_MOD_LOG_CHANNEL_ID=<mod-log-channel-id>
DISCORD_STATUS_CHANNEL_ID=<online-now-channel-id>
DISCORD_ANNOUNCE_CHANNEL_ID=<announcements-channel-id>
DISCORD_WELCOME_CHANNEL_ID=<welcome-channel-id>
DISCORD_ADMIN_SHOW_FULL_EMAIL=0
DATABASE_PATH=/app/data/bot.sqlite
BOT_HEALTH_PATH=/tmp/yugidraft-bot-health.json
NODE_OPTIONS=--max-old-space-size=160
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=<release-sha>
```

| Variable | Use |
| --- | --- |
| `DISCORD_BOT_ENABLED` | Only literal `1` starts the bot and deploys commands; `0` leaves a healthy idle process. |
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | Bot login and application identity. |
| `DISCORD_GUILD_ID` | Existing site data scope. Keep this value unchanged. |
| `DISCORD_BOT_GUILD_ID` | Discord server for registration, Gateway and interaction checks, permissions, member/role fetches, setup, moderation and channel delivery. Empty or unset uses `DISCORD_GUILD_ID`. |
| `OWNER_USER_IDS` | Current linked site owner allow-list; empty grants no owner access. |
| `CLERK_SECRET_KEY` | Runtime-only access to pending entries and invite/reject decisions. |
| `DISCORD_MODERATOR_ROLE_ID` | Moderation tier; empty disables role-based access. |
| `DISCORD_WAITLIST_CHANNEL_ID` | Private #signups destination. |
| `DISCORD_MOD_LOG_CHANNEL_ID` | Shared audit/outbox destination. |
| `DISCORD_STATUS_CHANNEL_ID` | Optional #online-now text or announcement channel in the bot guild. Maintains one live status embed; empty or unset disables the publisher. |
| `DISCORD_ANNOUNCE_CHANNEL_ID` | Same-guild text or announcement channel. Own posts are crossposted in announcement channels. |
| `DISCORD_WELCOME_CHANNEL_ID` | Optional same-guild text or announcement channel for member welcomes. Empty or unset disables automatic welcomes without an error. |
| `DISCORD_ADMIN_SHOW_FULL_EMAIL` | Keep `0` for masked addresses. Opt-in `1` can reveal trusted Clerk addresses in private lists and delivery; stored alert payloads and audit remain masked. |
| `DATABASE_PATH` | Same absolute SQLite file for every service. Bot defaults to `/app/data/bot.sqlite` in Compose; match web's fixed path. |
| `BOT_HEALTH_PATH` | Native override; Compose fixes a container-local heartbeat file. |
| `NODE_OPTIONS` | Compose fixes the 160 MB heap cap; container memory limit is 256 MB. |
| `SENTRY_DSN` | Optional error reporting; empty uses console reporting. |
| `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | Error reporting environment and code revision. |

Compose mounts `./data:/app/data`, drops all capabilities, sets `no-new-privileges`, publishes no bot port and allows 45 seconds to stop. `/card` reads `duel-engine/cards.cdb` beside SQLite. For native use, optional `DUEL_DATA_DIR` overrides that directory; Compose's default data mount supplies it without an override. Missing engine data falls back to `card_catalog`. No card lookup HTTP API is called. Normal catalog images use `https://images.ygoprodeck.com/images/cards/<passcode>.jpg`; pre-release and engine-only images use the existing Project Ignis base, `https://pics.projectignis.org:2096/pics/<passcode>.jpg`. The site image route stays protected. `SITE_DOMAIN` is not needed by the bot. The lean image omits the duel-server banlist module, so card footers say TCG status is unavailable.

Automatic join/sign-up alerts also depend on the **web producer's** environment:

```dotenv
CLERK_WEBHOOK_SIGNING_SECRET=<clerk-endpoint-signing-secret>
DISCORD_ADMIN_OUTBOX_ENABLED=1
DISCORD_WAITLIST_CHANNEL_ID=<signups-channel-id>
DISCORD_JOIN_REQUEST_ALERTS_ENABLED=1
DISCORD_SIGNUP_ALERTS_ENABLED=1
DISCORD_ADMIN_WEBHOOK_URL=<fallback-private-channel-webhook>
DISCORD_ADMIN_DASHBOARD_URL=
```

The signing secret verifies Clerk `waitlistEntry.created` and optional `user.created` deliveries to the app host's `/api/webhooks/clerk`. Set **`DISCORD_ADMIN_OUTBOX_ENABLED=1`** and **`DISCORD_WAITLIST_CHANNEL_ID`** on web to queue durable alerts for the bot. Compose passes both settings to web and keeps its legacy gameplay `DISCORD_BOT_ENABLED=0`, so the deleted port 4001 path stays off. Set both alert-type flags to `1` for join requests and sign-ups; the durable path defaults both on, while webhook fallback defaults sign-up alerts off. Only literal `1` enables a switch. Empty dashboard URL uses the Clerk Dashboard.

If the outbox flag is off, the notifier uses `DISCORD_ADMIN_WEBHOOK_URL`. If the flag is on but the channel ID is missing, it logs one warning per process and uses that same webhook fallback. Missing channel configuration does not fail the Clerk receipt or return 503. Actual receipt/outbox storage errors still permit Clerk retries. See [join alert setup](discord-join-alerts.md). Recreate web after changing producer settings and enable the bot container to drain its queue. `/waitlist` and its private decision buttons work independently.

## Live site status

With `DISCORD_STATUS_CHANNEL_ID` set, the bot polls SQLite at startup and about every 60 seconds. One **Dueling Domain • Online now** embed shows players seen on the site in the last two minutes, up to ten names with app/duel labels and a `+N more` line, live 1v1/Tag/FFA3/FFA4 duel counts, active drafts, active tournaments and live series. These are site users, not Discord presence. Duels exclude replay forks, deck-editor test duels, archived tables and tables idle past ten minutes. Drafts count only the first 24 hours after starting (creation if no start is recorded). Active tournaments count through their deadline, including multi-day events; those without a deadline use the same 24-hour rule. Series require a live latest game or a scheduled between-game deadline within ten minutes of now; interrupted games with no deadline do not count. Presence reads at most 500 users; live tables are capped at 100 per list, while tournament and series counts display `100+` above that bound. No boards, decks or historical stats are loaded.

Keep **#online-now private**, visible only to linked owners and the bot. Every poll fetches the channel and current roles before writing. Names require an explicit `@everyone` overwrite denying View Channel, no role overwrite allowing View Channel, and no Administrator permission on `@everyone`, matching the bot's private-channel setup. Member overwrites are allowed. Any other configuration shows counts only, with no names or page labels. Permission changes update the saved embed even when site activity is unchanged. Names are clipped at grapheme boundaries before Markdown escaping; Discord mention, channel and timestamp tokens are neutralized. Long escaped names can reduce the number shown to keep the field within Discord's size limit.

The publisher hashes displayed content without its relative timestamp. Unchanged activity and visibility make no message writes after startup verification; permission reads continue on every poll. Changed activity edits the saved message, with at least 30 seconds between edit attempts and additional backoff on rate limits. `Updated <t:unix:R>` records the last content update, so it stays unchanged during idle polls. Posts and edits suppress all mentions.

The additive shared migration creates `discord_status_messages`, keyed by bot guild and channel, to save the message ID, content hash and last successful write time. On restart, the bot checks the destination's guild and the saved message's channel and author before reuse. A deleted or invalid message is replaced on a later poll, using a fresh nonce. Missing channels or permissions produce one warning per outage, reset after a successful save, and are retried without stopping the bot; Discord failures also go through the existing error reporting path. An ambiguous create failure (server error or timeout) retries on the next poll using the same nonce and `enforce_nonce`; Discord checks nonce uniqueness for the past few minutes. Retries after that window, or a restart before a message ID is recovered, can still create a duplicate because pending nonces are not persisted. A recovered message ID is saved with an empty content hash before reconciliation, so a failed edit followed by restart reuses the same message. Its current content hash is saved only after the edit succeeds. Empty configuration disables both the poller and its Discord calls; an existing status message remains in the channel.

## Member welcomes

With `DISCORD_WELCOME_CHANNEL_ID` set, a non-bot member joining the configured bot guild receives `Hey <@userId>, welcome to **Dueling Domain**!` and the approved **B — First Pull** PNG. Only that member may be mentioned. The destination is checked against the bot guild before delivery. Other guilds and bot accounts are ignored. Enable **Server Members Intent** in the Developer Portal as above; no additional privileged intent is needed.

The shared SQLite migration creates `discord_welcome_members`. Numbers start at 1 for members welcomed after this feature is enabled, are allocated in an immediate transaction, and remain stable across departures, re-joins and bot restarts. Existing members are not backfilled; re-joining reposts their welcome. Keep the shared database backed up to preserve numbers.

The renderer loads bundled OFL-licensed Chakra Petch and Russo One TTF files with system fonts disabled. It measures names, shrinks to a minimum size, then ellipsizes. Emoji and glyphs outside the bundled Latin subsets are removed; accents retain their base letters, and an entirely unsupported name displays as “Duelist.” The 256px avatar download has a 2.5-second timeout, a 512 KiB cap and a decoded-dimension check; failure uses gradient initials. Joins and previews share one render queue. Each native render runs in a short-lived worker with a 32 MB JavaScript heap and exits before the next render, releasing bitmap allocations within the 256 MB container / 160 MB parent heap. Rendering errors still deliver the text greeting; delivery errors are reported without retrying the public post.

The bot image copies the artwork and fonts and explicitly installs optional npm platform packages. Its Debian Bookworm base uses the GNU/libc resvg binary for the target architecture (amd64 locally, ARM64 in production); the build checks that the native module loads. Font provenance and conversion instructions are in `packages/bot/assets/welcome/README.md`.

## Deploy commands and run

Use Node 22. From the repository root, build shared before consumers:

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
npm run build --workspace=packages/shared
npm run build --workspace=packages/bot
DISCORD_BOT_ENABLED=1 DOTENV_CONFIG_PATH="$PWD/.env" npm run commands:deploy --workspace=packages/bot
DISCORD_BOT_ENABLED=1 DOTENV_CONFIG_PATH="$PWD/.env" npm run dev:bot
```

For native use, set checkout-local absolute `DATABASE_PATH` and a unique `BOT_HEALTH_PATH`. The deploy script uses the same four-module registry as Gateway dispatch. It bulk-overwrites only `Routes.applicationGuildCommands(clientId, guildId)`: **23 guild commands** (22 slash commands plus User info), no global registration. Existing commands in the selected bot guild are replaced. Moving the bot does not remove commands from the previous guild; remove those separately if needed. Old global commands, if present, need separate removal after their origin is checked.

The normal deployment builds the bot image and starts it after web; gameplay health does not wait for Discord. The production CMD registers the guild commands on each enabled start. To repeat registration, inspect health and inspect logs:

```sh
docker compose -f docker-compose.yml exec -T bot node packages/bot/dist/deploy-commands.js
docker compose -f docker-compose.yml exec -T bot node packages/bot/dist/healthcheck.js
docker compose -f docker-compose.yml logs --tail=50 bot
```

## Command test checklist

Use disposable resources in the private test guild. Confirm owner access, Moderator limits, unlinked-user refusal, DM/foreign-guild refusal and #mod-log records. Moderation mutations and confirmed server changes use a per-guild lock and three-second actor cooldown. Confirmations belong to the invoker, expire after 60 seconds and recheck access/hierarchy. Check Confirm, Cancel, expiry, a second actor and role revocation before confirmation. All actor replies are private except `/card`.

| Command | Check |
| --- | --- |
| `/timeout user duration [reason]` | Set `30m`, verify timeout and audit; refuse higher roles, owners, bot and durations over 28 days. `remove` clears. |
| `/untimeout user [reason]` | Remove the timeout and verify it is absent. |
| `/kick user [reason]` | Cancel first; then confirm a disposable member and verify removal. |
| `/ban user [reason] [delete-message-days]` | Confirm a disposable member; verify ban and selected 0–7-day deletion. |
| `/unban user-id [reason]` | Use its Discord ID; verify ban removal. |
| `/purge count [user] [reason]` | Scan <=100 recent messages; confirm above 10; verify user filtering and that messages >=14 days old remain. |
| `/warn user reason` | Verify durable warning, attempted DM, total and audit even with DMs closed. |
| `/warnings user [page] [clear] [reason]` | Check ten-row pages; only an owner can clear an ID after confirmation. |
| `/slowmode channel seconds [reason]` | Set seconds, verify channel, then set `0`; maximum is 21600. |
| `/lock [channel] [reason]` | Confirm; verify @everyone cannot send and the full prior overwrite is saved. |
| `/unlock [channel] [reason]` | Confirm; verify exact prior overwrite or its absence returns, including after bot restart. |
| **User info** (user context menu) | Check join date, roles, warnings and five recent moderation actions; verify Moderator access. |
| `/channel create` | Create each needed channel type; check private `roles` and linked-owner visibility. |
| `/channel edit` | Change name/topic/slowmode/category/position/NSFW; verify `uncategorized` removes the parent. |
| `/channel delete` | Cancel and confirm a disposable channel; configured destinations must be refused. |
| `/category create`, `/category rename` | Verify category creation and changed name. |
| `/category delete` | Confirm empty deletion; nonempty categories need `move-to` or `move-to-root`; preserve child overwrites. |
| `/permissions view` | Check role/member allow and deny values; long output must attach a file. |
| `/permissions set` | Choose exactly one role/member; confirm allow, deny and neutral for each supported bit; preserve other bits. |
| `/role create`, `/role edit` | Check name, colour, hoist and mentionable; new roles have no server permissions. |
| `/role delete` | Confirm a disposable lower role; refuse managed/@everyone and hierarchy violations. |
| `/role give`, `/role take` | Verify membership changes; refuse protected member/role targets. |
| `/setup channels` | Confirm layout and printed IDs; repeat without duplicates; check private channels, read-only announcements/welcome and ambiguous-name refusal. |
| `/waitlist [page]` | Check pending Clerk entries, ten per page, masking, Previous/Refresh/Next and owner-only access. |
| `/waitlist action:approve entry:<exact email or Clerk ID>` | Verify one Clerk invitation, decision audit and a queued edit. Repeat without a second Clerk call. |
| `/waitlist action:reject entry:<exact email or Clerk ID>` | Reject a separate entry; verify conflict handling for an already approved entry. |
| Waitlist **Approve / Reject** buttons | Verify same shared service, double press/race, Clerk 409 success, 5xx retry and retained buttons on failure; restart with queued work. |
| `/announce [role]` | Fill modal title/body/optional HTTPS image; Cancel then Post preview; check role hierarchy, one-use expiry, selected-role-only mentions and announcement-channel crosspost. |
| `/welcome preview [member]` | Linked owners only. Privately attach a welcome PNG for the selected current member (default self), even with automatic welcomes disabled. Preview reuses an assigned number or displays the next number without reserving it. |
| `/card name` | As an ordinary member, select catalog, pre-release and engine-only cards. Check public image URLs and labels, autocomplete, alternate arts and five-lookups-per-30-seconds limit. |
| `/online` | Check private 120-second site presence list (up to 500 users), section labels and long-list attachment. Without the separate presence migration, expect `presence not available`. |
| `/stats` | Check seven UTC days, distinct weekly users, duel/draft counts and live tables; replay forks excluded. Without presence columns, verify the play-only note. |

For Moderator channel actions, require the actor's effective View Channel permission plus Manage Messages for `/purge`, Manage Channels for `/slowmode`, or Manage Roles for `/lock` and `/unlock`. A linked site admin can manage configured bot destinations; a Moderator cannot purge, slow, lock or unlock #mod-log, #signups, #online-now or #announcements. Confirmation rechecks current access. Confirm and Cancel edit the original private prompt, remove its buttons and show the result.

When producer outbox delivery is configured, submit a controlled new waitlist entry and replay its Clerk webhook: expect one masked #signups alert with two buttons. Approve in Discord and verify the saved message is edited with actor/source/time and no buttons. Retry durable posts/edits after restart, test Discord 403/404/429, and verify mention suppression. The shared budget allows 30 outbox claims per minute; delivery polls every three seconds.

The bot healthcheck runs every five seconds during its 45-second start period so deployment can record a healthy bot image during its first health scan. Check `[bot] ready` and a recent SQLite `bot_heartbeat` row (`id=1`, millisecond timestamp; updated every 30 seconds). A missing row or one older than 120 seconds means unavailable. SIGTERM must drain started work and remove this process's file/database heartbeats. With `DISCORD_BOT_ENABLED=0`, startup and healthcheck must succeed without credentials or database access.

## Admin console follow-up after both branches merge

The separate, unmerged **PR #405 (`feat/admin-console`)** route `/api/admin/console/waitlist/[id]` currently calls Clerk invite/reject directly. **After both branches merge, change that route to call `decideWaitlistEntry` from `@yugidraft/shared/services/waitlist-decisions`, with `source: "web"`, the site actor ID, exact Clerk entry ID and email.** Keep its session, owner, origin and input checks, result handling and cache invalidation. Otherwise the Discord message does not update after a web decision. See the [waitlist integration contract](../../packages/bot/src/features/waitlist/README.md#web-route-integration-still-required). This PR does not change the console route or public web access. Shared-service integration tests prove a web-source decision produces the Discord PATCH; the actual console HTTP route is not wired here. Leave PR #400 open for the owner.

## Automated verification and limits

Run all bot integration suites, touched shared/web tests, bot/shared/web TypeScript checks and the bot build. Tests use migrated SQLite and local Discord REST/Gateway and Clerk HTTP stubs; they do not contact the live services. No new unit tests are required. A live command acceptance check needs the owner's test application credentials. Docker is not available locally, so local container build and Compose acceptance are not performed; CI checks the deployment scripts.

## Disable or roll back

Set `DISCORD_BOT_ENABLED=0` in the VM `.env`, then recreate only the bot:

```sh
docker compose -f docker-compose.yml up -d --no-build --no-deps --force-recreate bot
```

The bot remains healthy and idle, with no login, command registration, database or outbox work. Existing commands stay registered; restrict access in Integrations if necessary. Set `DISCORD_ADMIN_OUTBOX_ENABLED=0` and recreate web to restore webhook delivery while the bot is disabled. For full code/database rollback, use the [matched release procedure](vm-runbook.md); the deployment script also accepts old releases with no bot image.
