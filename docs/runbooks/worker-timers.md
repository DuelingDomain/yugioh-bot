# Worker timers

Service: `worker` (`packages/worker`, Compose service `worker`). Code: `packages/worker/src/index.ts`. Map: [architecture](../architecture/README.md).

## Purpose

Runs the short loops that keep drafts, tournaments, presence and analytics current. One process per SQLite file. Never run two.

## Schedule & triggers

| Job | Every | What it does | Code |
|---|---|---|---|
| Draft timer | 1 s | Expires late picks, sweeps lobbies, retries Discord completion posts (each 60 s) | `draft-timer.ts` |
| Worker heartbeat | 30 s | Writes row `worker_heartbeat`. Admin console warns if older than 3 min | `index.ts` |
| Tournament timer | 60 s | Auto-approves late confirmations, closes late tournaments, announces results | `tournament-timer.ts` |
| VPS health sample | 60 s | Records host load and memory | `vps-health.ts` |
| Product-event drain | 10 s | Sends queued analytics to PostHog. Retries with back-off, 10 tries max | `analytics-drain.ts` |
| Presence cleanup | 10 min | Drops presence rows older than 24 h | `index.ts` |
| Disk usage snapshot | 1 h | Stores disk use. Keeps 7 days | `disk-usage.ts` |
| Health file | each draft tick | Writes `WORKER_HEALTH_PATH` (`/tmp/yugidraft-worker-health.json`). Docker health check fails after 120 s | `healthcheck.ts` |

Overlapping ticks are merged (`loop.ts`).

## What it changes

Rows in `data/bot.sqlite` (drafts, tournaments, presence, analytics queue, health). Posts signed updates to `ws`. Sends events to PostHog. Sent events are deleted after 7 days. Unsent after 30 days.

## Depends on

| Need | Note |
|---|---|
| `DATABASE_PATH` (absolute) | `/app/data/bot.sqlite` in Compose |
| `WS_INTERNAL_URL`, `WS_INTERNAL_SECRET` | Updates reach browsers |
| `POSTHOG_KEY` | If empty the queue is cleared and nothing is sent |
| `DISCORD_GUILD_ID`, `OWNER_USER_IDS` | Scope and owner CLI |

## Run it by hand

```bash
# On the VM, in /opt/yugioh-bot
docker compose -f docker-compose.yml restart worker
docker compose -f docker-compose.yml logs --tail=100 worker
```

Local: `npm run dev --workspace=packages/worker` with an absolute `DATABASE_PATH`. Owner CLI (season, merge-users, delete-user, Clerk checks) lives in `packages/worker/src/ops/`.

## Check it worked

```bash
docker compose -f docker-compose.yml ps worker      # healthy
docker compose -f docker-compose.yml exec -T worker cat /tmp/yugidraft-worker-health.json
```

Or open the admin console: the heartbeat must be under 3 minutes old.

## When it fails

| Sign | Action |
|---|---|
| Heartbeat warning | Check `ps` and logs. Restart `worker`. |
| Picks never time out | Worker is down. Restart it. |
| Analytics missing | Check `POSTHOG_KEY` in `.env`. |
| Two workers | Stop one. Two writers on SQLite cause double actions. |

Health: cannot be checked from the repo.

## Cost/limits

Memory limit 384 MB. The grace period on stop is 150 s so loops can finish.
