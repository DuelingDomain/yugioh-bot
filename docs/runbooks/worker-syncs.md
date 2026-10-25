# Worker syncs (card sets, Genesys points, image cache)

Three cron jobs inside the `worker` service. The timers are on [Worker timers](worker-timers.md).

## Purpose

| Job | Purpose |
|---|---|
| Card set sync | Copies set and card data from ygoprodeck.com into `card_sets` and `card_catalog` |
| Genesys points sync | Updates Genesys card points. See [genesys-points.md](../architecture/card-data/genesys-points.md) |
| Image cache cleanup | Deletes the oldest cached card images when the cache is too big |

## Schedule & triggers

| Job | Cron (UTC) | Env to change it | At start |
|---|---|---|---|
| Card set sync | `0 6 * * *` daily 06:00 | `SETS_SYNC_CRON`, `SETS_SYNC_TIMEZONE` | Only if `card_sets` is empty |
| Genesys points | `0 6 * * 0` Sunday 06:00 | `GENESYS_SYNC_CRON`, `GENESYS_SYNC_TIMEZONE` | Yes |
| Image cleanup | `0 4 * * *` daily 04:00 | `IMAGE_CLEANUP_CRON`, `IMAGE_CLEANUP_TIMEZONE` | Yes |

The old docs say the bot runs these. The worker runs them now. The bot also starts the Genesys job when it is on.

## What it changes

- Tables `card_sets`, `card_catalog`, Genesys points and `genesys_points_meta` in `data/bot.sqlite`.
- Files in `CARD_IMAGE_CACHE_DIR` (`/app/data/card-images`). Oldest files go first when size is over `CARD_IMAGE_CACHE_MAX_BYTES` (15 GiB by default).

## Depends on

ygoprodeck.com (public). Absolute `DATABASE_PATH` and `CARD_IMAGE_CACHE_DIR`. For Genesys: `GENESYS_LIST_EFFECTIVE_DATE`, `GENESYS_LIST_REVISION` (default to the checked list).

## Run it by hand

A restart runs Genesys and image cleanup at once.

```bash
docker compose -f docker-compose.yml restart worker
docker compose -f docker-compose.yml logs --tail=100 worker | grep -iE "sync|genesys|image"
```

To run a set sync now, change `SETS_SYNC_CRON` in `.env` to the next minute, recreate the worker, then change it back. (No dedicated command exists. Ask the owner if one is wanted.)

Check a Genesys list update locally: see [genesys-points.md](../architecture/card-data/genesys-points.md#checking-a-list-update).

## Check it worked

```bash
du -sh /opt/yugioh-bot/data/card-images
sqlite3 /opt/yugioh-bot/data/bot.sqlite "select count(*) from card_sets;"
```

Logs show the last sync. A failed sync keeps the old data and tries again at the next cron time.

## When it fails

| Sign | Action |
|---|---|
| New set not in the catalog | Check worker logs for ygoprodeck errors. Wait for the next cron. |
| Genesys points unchanged | The sync refuses unverified changes. Read the doc, then update the checked list pin. |
| Disk full | Lower `CARD_IMAGE_CACHE_MAX_BYTES`, restart worker. See [VM upkeep](vm-upkeep.md). |

Health: cannot be checked from the repo.

## Cost/limits

Free API. Be kind to ygoprodeck.com: do not restart in a loop.
