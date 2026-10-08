# Tag rules verification, 2026-10-07

Engine worktree: `feat/tag-facing-rules`, starting at `af33138d8`. Seat setup is read from `teamOfSeat` in shared settings and the engine's numeric four-seat turn order: p0=1A, p1=2A, p2=1B, p3=2B. Facing pairs are p0/p1 and p2/p3; partners are p0/p2 and p1/p3.

Patches 0111–0115 implement facing geometry, partner Field Spell replacement, the opposing-team direct attack guard, and exact current/previous Lua geometry seats. Partner materials, shared LP and turn/Battle Phase rules retain their existing implementation. No `owner-decisions.md` exists in this worktree; ADR 0002 records and cites the supplied owner decision of 2026-10-07. `attack-direct-all.ts` is an FFA effect table; the former Tag per-member attack expectation was in `tag-direct-attack-rule.ts` and has been replaced there. The table header points to that Tag suite.

## Passing checks

All runs use Node 22.23.3, `ulimit -c 0`, fresh pinned engine resources and the production multi cores.

| Related check | Result |
| --- | --- |
| Tag facing rules, Standard and Domain | 106 passed |
| Tag direct attack rules, Standard and Domain | 32 passed |
| Shared-zone API/FFA4 scenarios, including old previous-seat API fallback | 250 passed |
| Existing EMZ and local-zone scenarios | 63 passed |
| Capabilities, snapshot metadata and deploy packaging | 46 passed |
| 19 other related Tag files, including partner materials/LP/order/turn count | 278 passed |
| `multi-scripts-table.test.ts -t 'Mekk-Knight Purple Nightfall\|Link Spider\|Imduk\|Saryuja\|Firewall Dragon\|Gouki Thunder Ogre\|Orange Light\|World Chalice Guardragon'` | 6 passed; other rows excluded by filter |
| Shared facing-seat helper (`settings.test.ts -t sharedExtraSeatOf`) | 3 passed |
| Duel-server TypeScript check | passed |
| Rule coverage `--strict --check` | 49 rules covered, no pending/weak entries |
| `run-nduel.sh --check` | 80 checked, zero skipped/mismatches/errors |

Tests reproduced the old column/EMZ/Field/direct behavior before the fixes. Review regressions also reproduced the partner Firewall departure bug and the missing previous-seat API error. The final suites assert no Lua errors. Final review found no substantive issues.

## Native golden change

Initial `--check` refused the changed patch/overlay fingerprints. A fresh baseline native build with the original 98 patches and original overlay reproduced all 80 historical rows exactly. This comparison used a newly prepared catalog because the shared local cache contained test fixture cards; it was read only and was not changed by this task. The accepted `--record` uses the full 103-patch native core with ASan/UBSan and `YGO_N_TRAP`. A subsequent `--check` checks the same freshly built binary and final overlay.

All 60 n2/FFA3/FFA4 step counts and hashes remain byte-for-byte identical. Only the 20 Tag transcripts change, as expected when shared geometry and direct-attack legality change available actions and prompts. For seed 4, a before/after trace differs only by removal of one `MSG_SELECT_YESNO` direct-attack choice (565 → 564 steps); the turn count, winner and number of attacks remain identical. Larger differences follow changed legal choices and subsequent game paths; the table records the exact step deltas rather than claiming every seed's divergence is a single rule.

| Tag seed | Before | After | Delta |
| --- | --- | --- | --- |
| 1 | 921 | 717 | -204 |
| 2 | 922 | 1475 | +553 |
| 3 | 798 | 408 | -390 |
| 4 | 565 | 564 | -1 |
| 5 | 510 | 549 | +39 |
| 6 | 877 | 965 | +88 |
| 7 | 1177 | 794 | -383 |
| 8 | 1373 | 1896 | +523 |
| 9 | 1205 | 1179 | -26 |
| 10 | 920 | 442 | -478 |
| 11 | 1347 | 1241 | -106 |
| 12 | 1562 | 1167 | -395 |
| 13 | 1647 | 2098 | +451 |
| 14 | 702 | 699 | -3 |
| 15 | 466 | 654 | +188 |
| 16 | 935 | 850 | -85 |
| 17 | 847 | 1338 | +491 |
| 18 | 748 | 1095 | +347 |
| 19 | 1075 | 640 | -435 |
| 20 | 1617 | 1531 | -86 |

## Local artifacts

Both WASM cores were built in the pinned emsdk Docker image with the same flags/Domain transform as `build-deploy-multi-cores.sh`, redirecting `MULTI_DIST` into the task cache. Image: `docker.io/emscripten/emsdk:4.0.9@sha256:3c853ef9c3b4c2708da1adac2fdfdba49c775fdc4144ceef4989423963e96811`. Build metadata reports 103 patches and `luaFixedSeed: 0`. The disposable source tree and Emscripten cache in the worktree are deleted after verification. No shared engine directory, checkout engine bundle, service or systemd unit was modified.

Artifacts: `/home/sulman633/.cache/dk-duel-engine-tagrules`. Env: `/home/sulman633/.cache/dk-duel-engine-tagrules.env`.

| Artifact | SHA-256 |
| --- | --- |
| `ocgcore.multi.wasm` | `4db01523d214a3e7e399aba7bb76454c7664d2ad145b4b15300df615d43a71ed` |
| `ocgcore.multi-domain.wasm` | `a29470b902405851f05db341e8ef43bead64d7b98834a0059a6a271b9f33d668` |

From the worktree, run the local Tag suites with:

```bash
ulimit -c 0
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
set -a
source /home/sulman633/.cache/dk-duel-engine-tagrules.env
set +a
cd packages/duel-server
npx vitest run tests/scenarios/multiplayer/tag-facing-rules.test.ts tests/scenarios/multiplayer/tag-direct-attack-rule.test.ts
```

The full snapshot/rendering handoff is in [Tag shared EMZ UI contract](2026-10-07-tag-shared-emz-ui.md). Web rendering remains for the UI worker. No rule questions remain.
