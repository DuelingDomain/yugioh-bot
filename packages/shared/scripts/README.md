# Repair scoring after overturned results

**Back up the database first. Run the dry run and review every change before
applying.** The command requires an explicit existing database with the current
schema. It never runs migrations or runs at startup.

## Deploying this fix

The first scored reopen after deployment rebuilds the whole guild and may
correct historically double-counted ratings. There is no switch to block
reopens, so ask organizers not to reopen tournaments until the repair is done.
After deploying, back up the database, run the repair dry run, review its
changes, apply the repair, and only then let organizers reopen tournaments.

## Production

The Dockerfile uses `WORKDIR /app` and copies shared's compiled output to
`/app/packages/shared/dist` in the bot, ws, duel, and web stages. The bot image
already has Node 22, the CLI, and its runtime dependencies; no build is needed
inside the container. From the directory containing `docker-compose.yml`:

```sh
# Dry run first, after backing up /app/data/bot.sqlite.
docker compose exec bot node packages/shared/dist/maintenance/repair-ratings.js --db /app/data/bot.sqlite
# Apply only after reviewing the dry run.
docker compose exec bot node packages/shared/dist/maintenance/repair-ratings.js --db /app/data/bot.sqlite --apply
```

## Local development

```sh
npm run build --workspace=packages/shared
npm run repair:ratings --workspace=packages/shared -- --db /explicit/path/bot.sqlite
npm run repair:ratings --workspace=packages/shared -- --db /explicit/path/bot.sqlite --apply
```

The default dry run opens the source read-only and rebuilds an in-memory copy.
The first output line counts changed players, season standings, award additions
and removals, and achievement additions and removals. Each change has one JSON
line: player Elo, aggregate W/L and career winnings; per-player season W/L,
winnings and streaks; awards including their season, points and opponent Elo;
and achievement keys and unlock times. Elo is continuous across seasons and
has no per-season snapshot in the schema. Altered awards appear as a removal
and an addition. Award ID changes alone are bookkeeping and are omitted.
`--apply` repairs all guilds in one immediate transaction.

Ordinary reopens replay recorded awards only. This maintenance repair explicitly
uses `recoverMissing: true` to recover approved matches without awards and
missing completion bonuses for completed round-robin or single-elimination
tournaments with complete recorded history, using the live win-count placement
rule. Recorded placement seasons and explicit bracket placements remain
authoritative. Recovery removes round-robin completion bonuses while open and
reconciles them from current completed history, even if final-match scoring
failed before a legacy reopen. Ordinary rebuilds exclude overturned scored
results and remove or recalculate affected round-robin bonuses, retaining their
recorded seasons. Rejected pending reports never invalidate placements.

Existing award IDs capture scoring order. Recovered matches are inserted by
`resolved_at` (or `created_at`), with match ID breaking ties, among recorded
events. Completion bonuses precede the final match at the same resolution time.
Recovery resequences award IDs once to persist that order; subsequent rebuilds
produce the same state. Missing-event seasons use the latest season started by
the resolution/completion time, or the earliest season for older events. Exact
historical scoring times and seasons cannot be known for unrecorded events,
especially if clocks moved backwards. Review these inferred changes in the dry
run. Achievements that still qualify retain their original unlock times.
