# 2026-11-09 engine data review

Reproduces the candidate from [failed scheduled run 42635826632](https://github.com/DuelingDomain/yugioh-bot/actions/runs/42635826632): 68 new cards, one changed card, no removals, 57 script changes and 54 shared/nonofficial script changes. The new known set codes are IMPH and RV02.

## Shared constants patch retirement

Compared stock `card_counter_constants.lua` at CardScripts `5caccbf54d7d` and `7e91edbb481d`. The complete diff is:

```diff
 CARD_PRANKKIDS_MEOWMU                = 25725326
+CARD_PRINCESS_COLOGNE                = 75574498
 CARD_PSYFRAME_DRIVER                 = 49036338
```

Old stock SHA-256: `aae363faae28e75d1fbca72aca938201e7a6b6bab3a396039d3715d12e746d5f`.
New stock SHA-256: `8283853c7862e8c8689b2201b87973db6c0abb30a8e3c98eb7bd9bfe297101f7`.

Upstream now supplies the exact value our suffix restored for Doll Happiness (71595845), Doll House (67331360) and Grandpa Demetto (44190146). Retire the suffix file and its MANIFEST entry, including the obsolete baseline hash. No replacement baseline is needed for a retired patch. Keeping and rebasing the suffix would duplicate the same assignment. There are no changes to COUNTER constants or their flags.

Reviewed `src/card-script-patches.ts`, `scripts/card-script-patches.ts` and `scripts/install-engine-bundle.sh` in duel-server. Runtime/installer validators derive integrity from the current receipt, not a required constants entry. Cached installation strips retired suffixes and writes a new receipt; changed data pins trigger fresh extraction. Existing receipt path support can remain for older bundles. Golden metadata must change because the shared-patch folder changed.

Consumer review:

- `packages/shared/src/duels/counters.ts` is a static numeric catalog. No IDs, flags or display names change.
- `packages/shared/src/deck-legality/index.ts` parses numeric Lua constants and fingerprints the constants source. It now resolves the same Princess Cologne code from stock.
- `scripts/vision/build-related.ts` parses CARD/SET assignments for named relationships. The restored stock assignment has the same meaning as the old suffix.
- `packages/duel-server/scripts/lib/new-card-smoke-companions.ts` likewise resolves listed CARD names to the same numeric passcode.

`utility.lua` and the multiplayer helper APIs did not change. The only changed shared constant file restores this card name; `mp-utility.lua` needs no adjustment. The other non-card helper change is `proc_rush.lua`, outside the supported Master Duel pool. Retained prerelease cards are checked by preparation and the legacy-core probe; skill/unofficial scripts are not added to the playable database.

## Multiplayer decisions

Both cards remain legal in ordinary 1v1. Add both to MULTIPLAYER_FORBIDDEN for Tag, FFA3 and FFA4, with stock line evidence in the scenario catalog. These are temporary implementation restrictions, following the existing prerelease review entries. No new ruling or gameplay proof is claimed.

- **101403005 — Amazoness Chain Master - Brink of Death Chain Dance:** the owner chooses one opponent; that same opponent offers a Level 10 monster from their own Deck/Extra Deck or loses one random hand card. In Tag this must be one opposing member. Stock has no explicit declaration wrapper: `s.sphandesop` saves only folded `1-tp`, then separately queries Deck/Extra Deck, prompts a chooser and reads a hand. An unbound or causal binding is insufficient to guarantee the freely chosen opponent and all branches. Forbid until an explicit binding adaptation and live scenario prove this sequence.
- **101403067 — Power of the Duelist:** its on-field target/negation choices need no facing restriction. The unsafe part is the global EVENT_CHAINING Attribute accumulator: it uses folded `rp` to read/write player flags, then a delayed End Phase effect reads `tp`. This can credit a different real duelist, incorrectly applying or waiving the send-to-GY penalty. Forbid until real-seat FFA tracking and Tag team tracking/reset are adapted and proven. The existing global-flag adaptations show why a generic folded player value is insufficient.

No open owner-rule question was needed. No changes to column/facing behavior are proposed.

## Validation

See the complete candidate report in the PR body. Validation commands/results are recorded there. WASM validation reuses Actions run 42519672772 artifacts after verifying Domain, multiplayer and legacy hashes against the checked-in approved hashes. No core code, core binary pins, Lua or Emscripten pins change. The native golden driver is built freshly from all 110 committed patches against the candidate database and patched scripts.


Commands use Node 22.23.3, `DUEL_DATA_DIR=$PWD/data/duel-engine-next`, and `prlimit --core=1:1` for every engine process. The updater SHA variables denote the exact candidate values in the PR report; tracked historical docs use abbreviations to preserve the updater pin allowlist. All commands below are from the worktree root except the Vitest commands, which run in `packages/duel-server`.

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
prlimit --core=1:1 -- npm ci
prlimit --core=1:1 -- npm run build --workspace=packages/shared
prlimit --core=1:1 -- node --import tsx packages/duel-server/scripts/update-engine-data.ts --scripts "$SCRIPTS_SHA" --database "$DATABASE_SHA" --strings "$STRINGS_SHA" --defer-validation --report .status/engine-data-update/report.md --metadata .status/engine-data-update/update.json
DUEL_DATA_DIR="$PWD/data/duel-engine-next" prlimit --core=1:1 -- npm run duel:prepare
DUEL_DATA_DIR="$PWD/data/duel-engine-next" prlimit --core=1:1 -- node --import tsx packages/duel-server/scripts/generate-multi-scripts.ts --check
DUEL_DATA_DIR="$PWD/data/duel-engine-next" UPDATE_ARTIFACT_DIR="$PWD/.status/engine-data-update" prlimit --core=1:1 -- node --import tsx packages/duel-server/scripts/validate-engine-data.ts
```

PASS: preparation registers 194 previews with zero exclusions. The candidate probe checks 292 scripts, 257 API names, 458 globals and 273 cards with zero errors. Overlay check exits 0. A separate `probeEngineData` call explicitly checks `official/c71595845.lua`, `official/c67331360.lua` and `official/c44190146.lua`: three cards, zero errors. Runtime admission checks reject each new restriction in normal/Domain Tag/FFA3/FFA4 and permit both in normal/Domain 1v1 (16 assertions).

```sh
# cwd: packages/duel-server; DUEL_DATA_DIR points to the worktree bundle
prlimit --core=1:1 -- node ../../node_modules/vitest/vitest.mjs run tests/card-script-patches.test.ts tests/update-engine-data.test.ts tests/probe-engine-data.test.ts tests/validate-engine-data.test.ts tests/install-engine-bundle.test.ts tests/engine-bundle.test.ts tests/multi-scripts-manifest.test.ts tests/multi-scripts-bundle.test.ts tests/scenarios/multiplayer/catalog.test.ts tests/c6-geometry-audit.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=15000
prlimit --core=1:1 -- node ../../node_modules/vitest/vitest.mjs run tests/scenarios/multiplayer/catalog.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=15000
DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 prlimit --core=1:1 -- node ../../node_modules/vitest/vitest.mjs run tests/prerelease-engine.test.ts tests/host-replay-cross-version-real.test.ts --maxWorkers=1 --no-file-parallelism --testTimeout=15000
```

PASS after correction: 256 tests across the ten targeted files; the optional local triage check is skipped and 35 existing scenario sketches remain todo. The combined run found two off-by-one evidence citations in the new catalog entries; the focused rerun passes all 61 catalog tests after correcting them. Earlier setup attempts encountered a deletion still present in the Git index and default five-second test timeouts; staging the retirement and using the package's 15-second timeout resolved those. The engine run passes all 13 tests: every retained preview initializes in legacy/pinned 1v1, FFA3/FFA4 and Tag, in normal/Domain modes; three replay tests use the documented single-bundle saved-version-label check. This does not claim true old/new-bundle replay comparison or callback gameplay coverage.

```sh
# cwd: worktree root
export DUEL_DATA_DIR="$PWD/data/duel-engine-next"
export NDUEL_DIR="$PWD/.status/native"
unset NDUEL_PATCHES NDUEL_PATCH_LIMIT DUEL_MULTI_SCRIPTS_DIR
NDUEL_CASES="n2 n3 n4 tag" NDUEL_SEEDS=20 NDUEL_TURNS=60 NDUEL_LP=3000 NDUEL_FUTURE=0 NDUEL_SKIP_BUILD=0 JOBS=4 prlimit --core=1:1 -- bash packages/duel-server/scripts/run-nduel.sh --record
NDUEL_SKIP_BUILD=1 NDUEL_FUTURE=0 prlimit --core=1:1 -- bash packages/duel-server/scripts/run-nduel.sh --check
node scripts/ci/card-data-history.integration.mjs
```

PASS: recorded and checked 80 rows, zero skips/failures/mismatches. All 80 rows change with the expanded card pool. The data/shared-patch fingerprints change; core-patch and multiplayer-overlay fingerprints do not. The history publication integration check also passes (local bare remote; simulated PR operations).


## Blocker: freshly generated archetype bridges fail the workflow quality gate

The engine candidate itself validates, but the workflow cannot complete successfully. Ran:

```sh
DUEL_DATA_DIR="$PWD/data/duel-engine-next" prlimit --core=1:1 -- node --import tsx scripts/effects/rebuild-bridges.ts --engine-directory "$PWD/data/duel-engine-next"
prlimit --core=1:1 -- npm run build --workspace=packages/shared
prlimit --core=1:1 -- node --import tsx scripts/effects/evaluate-bridges.ts --check
```

Rebuild: PASS (13,986 identities; 453 groups; 1,577 Advanced and 1,339 Genesys rows). Quality gate: **FAIL**, exit 1, in both formats:

- Precision at five is 0.8667 (required at least 0.9).
- One known false bridge: Blue-Eyes → Toon, using Blue-Eyes Toon Ultimate Dragon (71808988) and Toon support. All evidence cards in this row already existed in the previous loaded engine pool; none is one of this bump's 68 additions.
- Deep recall at ten is zero (required 1). Missing positives are Odion → Blue-Eyes and Odion → Altergeist in Advanced, and Odion → Altergeist in Genesys.

Restoring the exact committed bridge files and integrity pin, rebuilding shared and rerunning the same evaluator **passes**: precision 1, deep recall 1 and zero false bridges in both formats. Those restored, previously validated files are retained in this PR. The failed generation is not staged or published, and no golden labels, quality thresholds, bridge logic or profiles are changed to manufacture a pass.

Generation also consumes newer profile and bulk-API snapshots than the committed bridge artifact. Relative to the committed artifact, 32 capability identities are added and 1,343 existing capability rows change. These differences extend beyond the engine pin review; the precise cause of all ranking regressions remains open. This evidence does not prove the new pins alone caused the bridge failures.

The PR is a **draft and blocked from merge** until fresh bridge generation passes review and its quality gate, or the owner explicitly decides how to handle the existing bridge snapshot. Repairing recommendation logic/labels requires its own review; it is not folded into this engine-data review. All engine patch, multiplayer classification, bundle, probe, targeted-test and native golden work above is complete. CI review remains required after resolving this blocker.

Merge only after CI passes and at a quiet time. This changes bundleVersion: active-duel recovery can be interrupted and older replays become unavailable. The owner decides merge timing; this PR must not be auto-merged.
