# Discord bot timers

Service: `bot` (`packages/bot`). Setup guide: [discord-bot.md](../deployment/discord-bot.md). Join alerts: [discord-join-alerts.md](../deployment/discord-join-alerts.md).

## Purpose

The admin Discord bot: moderation, waitlist and sign-up alerts, welcome cards and the "Online now" status message.

## Schedule & triggers

| Job | Every | What it does |
|---|---|---|
| Heartbeat | 30 s | Writes a database heartbeat. When the bot is off it writes a `disabled` heartbeat |
| Outbox poller | 3 s | Sends queued Discord messages. Max 30 per minute. Pauses on a rate limit |
| Online-now status | 60 s | Edits one embed in `DISCORD_STATUS_CHANNEL_ID`. Edits at most once per 30 s |
| Welcome card | On member join | Posts a card in `DISCORD_WELCOME_CHANNEL_ID` |

The bot does nothing unless `DISCORD_BOT_ENABLED=1`. The Compose default is `0`.

## What it changes

Messages in your Discord server. Rows in the outbox and heartbeat tables.

## Depends on

`DISCORD_BOT_ENABLED=1`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DISCORD_BOT_GUILD_ID`, channel ids (`DISCORD_STATUS_CHANNEL_ID`, `DISCORD_WELCOME_CHANNEL_ID`, `DISCORD_WAITLIST_CHANNEL_ID`, `DISCORD_MOD_LOG_CHANNEL_ID`, `DISCORD_ANNOUNCE_CHANNEL_ID`), `DISCORD_MODERATOR_ROLE_ID`, `DATABASE_PATH`, `CLERK_SECRET_KEY`. The bot needs permission to post and edit in those channels.

## Run it by hand

```bash
docker compose -f docker-compose.yml up -d bot
docker compose -f docker-compose.yml restart bot
docker compose -f docker-compose.yml logs --tail=100 bot
```

Set `DISCORD_BOT_ENABLED=1` in `/opt/yugioh-bot/.env` first. Do not copy values from `.env` into tickets.

## Check it worked

```bash
docker compose -f docker-compose.yml ps bot       # healthy
```

The "Online now" message in Discord must change when a person goes online.

## When it fails

| Sign | Action |
|---|---|
| Container healthy but silent | `DISCORD_BOT_ENABLED` is `0`. |
| `Status destination` error in logs | Channel id wrong, or the bot lacks permission. |
| Messages stuck | Outbox paused by a rate limit. Wait. Check logs. |
| Login fails | Reset `DISCORD_TOKEN` in the Discord developer portal. |

Health: **unknown**. The owner must say whether the bot runs in production. The [VM runbook](../deployment/vm-runbook.md) says there is no bot service. `docker-compose.yml` has one (default off). The worker always has `DISCORD_BOT_ENABLED=0`.

## Cost/limits

Free. Discord rate limits apply.
