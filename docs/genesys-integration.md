# Genesys integration verification

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
