# Droll & Lock Bird verification plan

**Goal:** Allow Droll & Lock Bird in FFA only after real engine scenarios prove its multiplayer behavior.

**Architecture:** Use the existing scenario board compiler, Session actions, real card scripts, and Standard and Domain multi cores. Keep the existing event-bit patch unless a scenario proves a small defect. Follow ADR-0002 R-COMMON-EACH-PLAYER and R-TAG-PARTNER.

- [x] Test every searcher/holder seat pair in FFA3, FFA4 and Tag on both cores.
- [x] Test Deck searches and draws for every seat under the resolved lock, and its End Phase reset.
- [x] Test Draw Phase searches and draws for every seat. The official card text has no once-per-turn limit; prove repeated use instead of adding one.
- [x] Test activation and the lock after elimination in both FFA layouts.
- [x] If all checks pass, remove the FFA ban, update catalog expectations and documentation, and check the deck-check path for Tag and the web UI.
- [x] Run only the relevant scenario/catalog tests and the duel-server, shared and web typechecks. Commit small changes with the requested co-author. Do not push.

Use Node 22.23.3. The private data copy is `/tmp/droll-engine`, copied from `/home/sulman633/repos/yugioh-bot/data/duel-engine`. Its manifest records the worktree wrapper hash. The supplied bundle lacks two unrelated cards required by the current catalog: 100200298 and 101402094. Only the private copy receives those two CDB rows and their scripts, from the worktree's pinned BabelCDB and CardScripts sources. The private manifest records these sources and its new CDB hash. Droll's CDB row, stock script, overlay and both cores are unchanged. No service or shared data changes are part of this task.

Core SHA-256:

- Standard multi: `5070da424a30ee8bf8ec18ed799af263eb44a01ff99ec1cdc6f35c9faef17f4f`
- Domain multi: `51e41ea7e8620b46fbdb5685341d2b20eae224bfb0870aec6fea52c09d15cac4`

Run from `packages/duel-server` after the shared build:

```sh
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
DUEL_DATA_DIR=/tmp/droll-engine \
MULTI_WASM=/tmp/droll-engine/ocgcore.multi.wasm \
DOMAIN_MULTI_WASM=/tmp/droll-engine/ocgcore.multi-domain.wasm \
DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 \
npx vitest run tests/scenarios/multiplayer/droll-lock-bird.test.ts tests/scenarios/multiplayer/catalog.test.ts
```

Final result: 266 passed (206 real-engine checks and 60 catalog checks), 36 existing catalog TODO items, no failures or skipped engine checks. The new catalog legality assertion failed with the old ban and passed after its removal. The duel-server, shared and web typechecks passed. Read-only code review found no issues. The supplied Droll row, stock script and core hashes still match the private copy.
