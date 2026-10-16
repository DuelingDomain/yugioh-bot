# Genesys integration verification

## Source branch verification

The results below describe `feat/genesys-format` at `8ea246deb`.
For local port verification and scheduling differences, see the local port section.

The sync, legality, engine, deck UI and table UI branches were merged in that order.
Integration connects saved-deck tags (including imports), current canonical points in
all card transports and admission, Genesys card filters, engine field metadata in
live/replay boards, and startup/weekly points sync in the production worker.

Node 22.23.3 verification:

- Shared build passed; shared, web, duel-server, bot and worker typechecks passed.
- 954 targeted tests passed across 49 files: shared 204, duel-server 294, web 443,
  bot 4 and worker 9. This includes all piece tests, affected regressions and the
  worker process/shutdown tests. No package-wide suite was completed.
- All 32 real-worker Genesys cases passed with the provided read-only engine bundle,
  covering pinned/legacy Standard and Domain 1v1, Tag, FFA3, FFA4 and journal rebuilds.
- Chromium smoke checks used the real React components with mocked API responses:
  library points, zero-cap saves, points/type filters, room meter and four original
  FFA4 fields without EMZ. No browser runtime errors. This was not a deployed,
  authenticated end-to-end test.
- Independent integration review found no critical or important issues.

Operational limits:

- Future unfamiliar lists fail closed until their official effective date and exact
  revision are verified; see [sync procedures](genesys-sync.md).
- Older engine binaries do not support Genesys journals; see [engine notes](genesys-engine.md).

## Local port to `test/local-all`

The source diff from `68c28fcf5` to `8ea246deb` is applied as one squash on
`0d50c524e`; main is not merged. Discord sign-in and string owner IDs, sandbox
controls, facing pairs, and the local replay-rule identity (`duel-rules-3`) are
preserved. Genesys columns are added without the source branch identity migrations.
The DB must be backed up using SQLite online backup before opening it with the new schema.
The Discord bot retains startup/weekly sync; no standalone worker is included.
A web/duel-only deployment needs manual sync (see [sync procedures](genesys-sync.md)).

Local validation (Node 22.23.3):

- Shared, duel-server and web builds and typechecks passed. The bot source build passed.
- 849 tests passed in 36 targeted files: shared 173, duel-server 181 (including
  all 32 real-engine Genesys cases), web 491, bot sync lifecycle 4.
- Supplemental legality regressions: 141 passed; three multiplayer cases fail
  because the installed engine bundle lacks preview passcodes `100200298` and
  `101402094`. The baseline and port return identical unknown-card issues for
  those passcodes across all multiplayer formats.
- The optional full bot typecheck has an existing `rootDir` error from
  `tests/helpers/replay-fork-events.ts` importing a shared test helper.
- Online SQLite backup passed integrity checking. Rehearsing two migrations on
  a copy preserved every original row across 44 tables with no foreign-key errors.
- No services/containers were restarted, and no files were copied to web-live.

The single live-DB sync completed at `2026-10-16T04:29:25.675Z` against
`/home/sulman633/repos/yugioh-bot/.worktrees/domain-multiplayer/data/bot.sqlite`.
The online backup is the adjacent `bot.sqlite.bak-before-genesys` file.
It published `tcg-sha256-e2f9c29e9589771fd6f613c4b9d617ce86529f1d5aed548e97c7ed19d490977b` (effective `2026-10-05`):
14,615 identities have known points, including
750 nonzero identities. Including artwork rows,
14,788 catalog rows have points (765
nonzero and 14,023 zero). All 5 saved decks
remain present; live DB integrity and foreign-key checks pass.

No new environment variables are required. Optional scheduling overrides are
`GENESYS_SYNC_CRON` and `GENESYS_SYNC_TIMEZONE`; unfamiliar future lists require
the verified `GENESYS_LIST_EFFECTIVE_DATE` and `GENESYS_LIST_REVISION` pair.
