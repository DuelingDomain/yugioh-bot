# Differential tests

These tests prove that the multi core (patches 1 to 4) plays byte identical duels to the reference core (patches 1 and 2) when a duel has 2 duelists. The patches README (`domain-core/patches/README.md`) explains the two cores and the fixed Lua seed.

| File | What it does |
| --- | --- |
| `differential.test.ts` | Main test. Standard self-play, 400 steps. Run by the C++ gates. |
| `differential-extended.test.ts` | Extended test with three modes (below). |
| `extended-harness.ts` | Record and compare for any mode and any start (seeded decks or a Layer 1 board). |
| `failures.ts` | Writes a failing duel as a replayable file. |
| `summary.ts` | Writes the status summary and the history line. |
| `harness.ts`, `trace.ts`, `raw-messages.ts`, `first-diff.test.ts` | Shared comparison code of the main test. |

## Cores

The two cores must be built with `LUA_FIXED_SEED=1`. Default paths are in `domain-core/dist`.

| Mode | Reference | Multi |
| --- | --- | --- |
| long, scenarios (Standard) | `ocgcore.multi-ref.sync.wasm` | `ocgcore.multi.sync.wasm` |
| domain (and Domain scenarios) | `ocgcore.multi-ref-domain.sync.wasm` | `ocgcore.multi-domain.sync.wasm` |

Build the Standard cores as the patches README says. Build the Domain cores with the opt-in `APPLY_DOMAIN=1`. It applies `domain-core/src/apply-domain-patch.mjs` to a copy of the prepared tree and adds `domain_master.cpp`, like `build-domain-core.sh`. Use a separate tree. Run from the repository root:

```
for cfg in "2 multi-ref-domain" "4 multi-domain"; do set -- $cfg
  bash packages/duel-server/domain-core/.build/phase1/run-locked.sh build 2 docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache \
    -e PATCH_LIMIT=$1 -e APPLY_DOMAIN=1 -e LUA_FIXED_SEED=1 -e OUT_NAME=ocgcore.$2.sync.wasm \
    -e MULTI_TREE=/src/packages/duel-server/domain-core/.build/w2-domain-tree \
    -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9 \
    bash packages/duel-server/scripts/build-multi-core.sh
done
```

Without `APPLY_DOMAIN` the build script behaves as before and the output is byte for byte the same.

## Modes

Set `DIFF_EXT_MODE`.

- `long` (default): Standard self-play like the main test. `DIFF_MAX_STEPS` defaults to 2000.
- `domain`: Domain duels with Deck Masters and `domain.lua`, on the two Domain cores.
- `scenarios`: each Layer 1 scenario (`tests/scenarios/cases`) starts from its board. Then the seeded fuzz driver plays it on the reference core. The journal replays on both cores. Domain scenarios need the Domain cores, else they are skipped (the log lists skipped scenarios). The self-play seed of a scenario comes from its id and `DIFF_SEED`.

The test skips when the engine data or a wasm file is missing.

## Run

Use the diff lock. Use at most 20 seeds.

```
DUEL_DATA_DIR=$PWD/data/duel-engine-next DIFF_EXT_MODE=long DIFF_RUNS=20 \
  bash packages/duel-server/domain-core/.build/phase1/run-locked.sh diff 3 \
  npx vitest run packages/duel-server/tests/differential/differential-extended.test.ts
```

Environment variables:

- `DIFF_EXT_MODE`: `long`, `domain` or `scenarios`.
- `DIFF_RUNS` (20), `DIFF_SEED` (20260930), `DIFF_MAX_STEPS` (2000 for long, else 400), `DIFF_ONLY_SEEDS` (comma list, replaces the seed set; in scenarios mode it selects scenarios by their seed).
- `DIFF_REFERENCE_WASM`, `DIFF_MULTI_WASM`: the Standard pair. `DIFF_DOMAIN_REFERENCE_WASM`, `DIFF_DOMAIN_MULTI_WASM`: the Domain pair.
- `DIFF_EXT_SCENARIOS`: comma list. Only scenarios whose id contains one of the parts run.
- `DIFF_TIMEOUT_MS`, `DUEL_DATA_DIR`.

## Summary and history

Every run writes `.status/differential-summary.json` (overwritten) and appends one line to `.status/differential-history.tsv`, in the repository root.

Summary fields: `time`, `mode`, `reference` and `multi` (`{path, sha256}`), `baseSeed`, `seeds` (the number of seeds or scenarios that ran), `onlySeeds` (list, empty when unset), `maxSteps`, `differences` (seeds with a difference), `parseWarnings`, `firstFailingSeed` (or null), `durationMs`. In scenarios mode `reference` and `multi` are the Standard pair.

History columns (tab separated, no header): time, mode, differences, parseWarnings, seeds, baseSeed, maxSteps, firstFailingSeed, durationMs, first 12 characters of the reference sha256 and of the multi sha256. See `HISTORY_COLUMNS` in `summary.ts`.

## Failures and replay

For each seed with a difference the test writes `<dir>/<tag>-<mode>-<seed>.json` and prints a `next: <repro command>` line. `<dir>` is `DIFF_FAILURE_DIR` if set (the core gate sets `phase1/<TAG>/failures`), else `tests/differential/failures` (git ignored). `<tag>` is `GATE_TAG` if set, else `local`. `scripts/triage.ts <file>` replays a failure file and writes a scenario draft. The file has the fuzz failure format (`scenario`, `failure`, `decks`, `journal`, `repro`) plus `engine` (the options to start the duel again) and `differential` (the first difference text, both wasm paths, which check found it, the scenario id).

Replay the journal on any core:

```
cd packages/duel-server
DUEL_DATA_DIR=$PWD/../../data/duel-engine-next npx tsx scripts/fuzz-repro.ts \
  --file tests/differential/failures/local-long-123.json --wasm domain-core/dist/ocgcore.multi.sync.wasm
```

It prints the first difference, then replays every answer and prints the final views hash. Run it once with the reference wasm and once with the multi wasm, and compare. Add `--trace` to list every answer. Without `--wasm` the core of the data directory is used (the old behaviour). `--wasm` works only with a differential file. The replay freezes `Date.now` like the tests do.
