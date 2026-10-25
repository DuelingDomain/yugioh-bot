# Duel server timers

Service: `duel` (`packages/duel-server`). Code: `packages/duel-server/src/host.ts`, `packages/shared/src/services/duel-snapshot-retention.ts`.

## Purpose

Keeps live duels healthy: closes idle ones, settles clocks, and trims old stored boards.

## Schedule & triggers

| Job | Every | What it does |
|---|---|---|
| Poll tick | 30 s | Writes the host heartbeat. Closes live duels idle for 10 min. Closes waiting lobbies idle for 10 min. Settles ranked deadlines and turn clocks. Starts series games. Archives expired tables |
| Idle worker drop | 5 min idle | Frees an engine worker. A spare worker is kept 120 s |
| Stall checker | continuous | Flags a duel that stops answering |
| Snapshot retention | 6 h (first pass 60 s after start) | Compresses old duel snapshots. Turn-count backfill |
| Service reporter | 60 s | Reports service health |

Idle close is on in production (`DUEL_IDLE_CLOSE=1`, set by Deploy).

## What it changes

Duel rows and snapshots in `data/bot.sqlite`. Posts signed change events to `ws`. Compression only runs if `DUEL_SNAPSHOT_RETENTION_ENABLED=1`. The Compose default is `0`.

| Variable | Default | Meaning |
|---|---|---|
| `DUEL_SNAPSHOT_RETENTION_ENABLED` | `0` | Turn compression on |
| `DUEL_SNAPSHOT_RETENTION_DAYS` | `30` | Age before compression |
| `DUEL_TURN_BACKFILL_ENABLED` | `1` | Fill `turn_count` |
| `DUEL_IDLE_WORKER_MS` | `300000` | Worker idle drop |

## Depends on

Engine bundle in `DUEL_DATA_DIR` (`npm run duel:prepare`, validated at start). `DATABASE_PATH`. `WS_INTERNAL_URL` and `WS_INTERNAL_SECRET`. `DUEL_INTERNAL_SECRET` for calls from web.

## Run it by hand

```bash
docker compose -f docker-compose.yml restart duel      # last resort, ends live games
docker compose -f docker-compose.yml logs --tail=100 duel
```

Do not restart while duels are live on production. Deploy has a guard for this. Manual VACUUM after compaction: [Manual duel storage VACUUM](../deployment/vm-runbook.md#manual-duel-storage-vacuum).

## Check it worked

```bash
docker compose -f docker-compose.yml ps duel
docker compose -f docker-compose.yml exec -T duel node -e 'fetch("http://127.0.0.1:4003/",{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.status===404?0:1),()=>process.exit(1))'
```

Exit code 0 means the private listener answers. The admin console shows the host heartbeat.

## When it fails

| Sign | Action |
|---|---|
| Idle duels stay open | Host is down. Check logs, restart when no duel is live. |
| Database grows fast | Owner decides on `DUEL_SNAPSHOT_RETENTION_ENABLED=1` (approved in principle, not on in Compose). |
| Engine files missing | Run `packages/duel-server/scripts/install-engine-bundle.sh`. See [engine data update](engine-data-update.md). |

Health: cannot be checked from the repo.

## Cost/limits

Compression saves disk. It never deletes the final board. Old replays across data updates can fail to open.
