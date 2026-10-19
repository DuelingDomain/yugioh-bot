# Admin Discord bot setup

The runtime includes shared outbox delivery. The feature modules are empty. Startup replaces the guild command list with an empty list and removes the old player commands. An enabled bot delivers queued waitlist alerts, decision edits and moderation logs. Waitlist button handlers still require Phase 1; keep production disabled until those features are ready. The owner decisions exclude a deploy ping.

## Create the application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications). Use the existing Dueling Domain application if it has a bot user. Otherwise, create one. Copy the Application ID from General Information. Set it as `DISCORD_CLIENT_ID`.
2. Open Bot. Reset the token and save it only in the VM's private `.env`. Set Public Bot off and Requires OAuth2 Code Grant off.
3. Enable **Server Members Intent**. This is the privileged `GuildMembers` intent. Keep Presence Intent and Message Content Intent off. The code also requests `Guilds`, `GuildModeration`, and `AutoModerationExecution`. See [Discord's intent documentation](https://docs.discord.com/developers/events/gateway#privileged-intents).
4. In Installation, allow Guild Install only. Turn User Install off. For a private bot, use a custom install link or no provided install link if the Portal requires it.
5. In Discord, enable Developer Mode under User Settings → Advanced. Copy the target server ID.

## Invite and set permissions

Replace both placeholders, then open this URL as the server owner:

```text
https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands&permissions=1391837965494&guild_id=<DISCORD_GUILD_ID>&disable_guild_select=true&integration_type=0
```

The scopes are `bot applications.commands`. The value **1391837965494** matches the complete permission list in the plan. It does not include Administrator. It is the OR of bits `1,2,4,5,7,10,11,13,14,15,16,28,34,38,40`, checked against [Discord's permission flags](https://docs.discord.com/developers/topics/permissions#bitwise-permission-flags).

| Permission | Bit | Use |
| --- | ---: | --- |
| Kick Members | 1 | Remove a member from the server. |
| Ban Members | 2 | Ban and unban a member. |
| Manage Channels | 4 | Create, edit, move and delete channels or categories. |
| Manage Server | 5 | Manage native AutoMod rules. |
| View Audit Log | 7 | Read the server audit log for moderation events. |
| View Channels | 10 | Access the bot's destination channels. |
| Send Messages | 11 | Send announcements and staff messages. |
| Manage Messages | 13 | Delete messages during a purge. |
| Embed Links | 14 | Send formatted alerts and card results. |
| Attach Files | 15 | Attach card images or files. |
| Read Message History | 16 | Fetch messages through REST for purge and message repair. |
| Manage Roles | 28 | Manage lower roles and channel permission overwrites. |
| Manage Threads | 34 | Lock, archive and manage threads. |
| Send Messages in Threads | 38 | Reply inside a thread. |
| Moderate Members | 40 | Apply and remove timeouts. |

In Server Settings → Roles, put the bot role directly below the owner role and above the roles it must manage. Discord permits the bot to manage only lower roles. It can grant only permissions it holds. Feature handlers must also check the actor's hierarchy before acting.

## Create channels and link owners

Create private staff channels **#signups** and **#mod-log**. Use `DISCORD_WAITLIST_CHANNEL_ID` for #signups; the variable keeps the waitlist service name. Allow only owners and the bot to read #signups. Allow the intended staff and the bot to read #mod-log. Create the public **#announcements** channel. Give the bot View Channels, Send Messages and Embed Links in each destination. Channel overwrites can block the permissions in the invite.

Create a **Moderator** role and copy its ID to `DISCORD_MODERATOR_ROLE_ID`. Optional #admin-status uses `DISCORD_STATUS_CHANNEL_ID`. No #deploys channel is required.

Each owner must link Discord in the site's account settings. Put that account's application `users.id` in `OWNER_USER_IDS`. Do not put Discord IDs there. The server owner and Discord Administrator permission do not replace this link. Moderators can use moderation commands only; server management and waitlist actions require a linked owner.

After Phase 1 command deployment, check Server Settings → Integrations → Dueling Domain. Admin commands default to Administrator visibility. Moderation commands default to Moderate Members visibility. Add a command access override for the Moderator role if needed. The server-side access guard still checks each interaction.

## VM environment

Add these lines to the private VM `.env`. Use separate application credentials and a separate guild for a test run. Never put these values in a Docker build argument or a `NEXT_PUBLIC_` variable.

```dotenv
DISCORD_BOT_ENABLED=0
DISCORD_TOKEN=<bot-token>
DISCORD_CLIENT_ID=<application-id>
DISCORD_GUILD_ID=<server-id>
DISCORD_MODERATOR_ROLE_ID=<moderator-role-id>
DISCORD_MOD_LOG_CHANNEL_ID=<mod-log-channel-id>
DISCORD_WAITLIST_CHANNEL_ID=<signups-channel-id>
DISCORD_ANNOUNCE_CHANNEL_ID=<announcements-channel-id>
DISCORD_STATUS_CHANNEL_ID=
DISCORD_ADMIN_SHOW_FULL_EMAIL=0
DATABASE_PATH=/app/data/bot.sqlite
CLERK_SECRET_KEY=<existing-production-clerk-secret>
OWNER_USER_IDS=<application-user-ids-separated-by-commas>
```

Only literal `1` enables the bot. `DISCORD_CLIENT_ID` is the application's ID; do not use the plan's older `DISCORD_APPLICATION_ID` spelling. Emails stay masked. Compose passes these values explicitly to the bot, mounts `./data`, sets `BOT_HEALTH_PATH=/tmp/yugidraft-bot-health.json`, and sets `NODE_OPTIONS=--max-old-space-size=160`. The bot database must be the same file as web and worker. Compose uses a 256 MB memory limit and publishes no bot port.

For native development, export Node 22 in `PATH`, set an absolute checkout-local `DATABASE_PATH`, and choose a unique `BOT_HEALTH_PATH`. Keep native and VM database paths separate. Optional error reporting uses `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE`.

Web and worker keep their old gameplay Discord switch at `0` in Compose. Webhook join alerts continue there. The enabled bot polls `discord_outbox` every three seconds and sends the complete shared payload. It posts new messages and edits saved messages, checks the destination guild, disables all mentions, and preserves the stable post nonce. It claims one row at a time. SQLite limits all consumers to 30 claims per minute; the runtime also limits its attempts to 30 per rolling minute. Discord rate limits return to the shared retry service with their delay and pause further claims. Each claim uses a fresh REST manager so cached rate limits leave no wait timers at shutdown. Complete writes have a 30-second deadline within the container's 45-second stop grace. Permanent permission and payload errors stop that row. Phase 1 must separate the shared notifier switch from the old gameplay capabilities before enabling web outbox production. Do not enable the removed announce server.

## Deploy commands and run

The normal production workflow builds and pulls the `bot` image with the other services. It starts the bot after web. Gameplay health checks do not wait for Discord.

For an enabled test guild, set `DISCORD_BOT_ENABLED=1` in the environment and run:

```sh
DOTENV_CONFIG_PATH="$PWD/.env" npm run commands:deploy --workspace=packages/bot
DOTENV_CONFIG_PATH="$PWD/.env" npm run dev:bot
```

Run these commands from the repository root. The explicit dotenv path selects the root `.env` when npm changes to the bot workspace. They require `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`. The deploy script bulk replaces commands in that guild only. It never replaces global commands. Phase 0 deploys zero commands. If the old app has global commands from an earlier release, remove those separately through the global API after checking their origin; this script does not change them.

The production image deploys the same guild registry on every start. To repeat deployment with the running image:

```sh
docker compose -f docker-compose.yml exec -T bot node packages/bot/dist/deploy-commands.js
docker compose -f docker-compose.yml exec -T bot node packages/bot/dist/healthcheck.js
docker compose -f docker-compose.yml logs --tail=50 bot
```

## Private test-server check

1. Use a separate test application and guild. Set all IDs to test resources and use a test SQLite file. Enable only Server Members as a privileged intent.
2. Deploy the commands. Confirm that Phase 0 reports `Deployed 0 guild commands` and the old player commands disappear from the test guild.
3. Start the bot. Confirm `[bot] ready` and a healthy file heartbeat. In the shared SQLite database, `select id, at, pid from bot_heartbeat;` must return row `id=1` with the bot PID and a recent Unix time in milliseconds. It updates every 30 seconds while the Gateway is ready. A disconnect removes the row on the next heartbeat; shutdown removes this process's row. A missing row or a timestamp older than 120 seconds means the bot is unavailable. Container PIDs are local to the bot; use the timestamp in the admin console.
4. Stop with SIGTERM. Confirm a clean exit and removal of the file and database heartbeats. A started outbox write drains before SQLite closes; later rows stay unclaimed. Start with `DISCORD_BOT_ENABLED=0`; confirm `[bot] disabled` and a successful health check without Discord credentials.
5. After Phase 1, run each command once. Check a linked owner, an unlinked member, a Moderator, a DM and another guild. Check confirmation expiry/cancel, hierarchy refusal, and #mod-log. Submit a test waitlist request and check #signups, its buttons, and the web decision edit.

The automated runtime integration tests use real SQLite with local Discord REST and WebSocket servers. They cover stored posts and edits, nonces, mention suppression, retries, rejected destinations, deleted edit targets, restart deduplication, heartbeat migration, process exit after rate limits, and shutdown with a stalled response body. They do not contact Discord. A live test-guild check requires the owner's test credentials.

## Disable or roll back

Set `DISCORD_BOT_ENABLED=0` in the VM `.env`, then recreate only the bot:

```sh
docker compose -f docker-compose.yml up -d --no-build --no-deps --force-recreate bot
```

The bot stays healthy and idle. It does not log in, deploy commands, open SQLite or poll the outbox. Existing registered commands remain visible until the next enabled command deployment; disable their command access in Integrations if required. Task B's notifier uses webhooks when its own process has the switch off. Once Phase 1 passes the switch to web, recreate web with the same disabled value to restore that fallback. Use the normal matched code/database rollback procedure for a full release rollback. The deployment workflow also accepts older releases that have no bot image.
