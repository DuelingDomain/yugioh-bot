# FFA3 columns: local validation

Date: 2026-10-05. Rule: `R-FFA-THREE-COLUMNS`. Worktree: `/home/sulman633/orca/workspaces/yugioh-bot/ffa3-columns`. Branch: `feat/ffa3-columns-pick`, from `origin/main` at `049a4df7`.

See [card groups and UI needs](ffa3-columns.md). No host, preset, web, service or production-data changes were made.

## Before and after

The baseline uses a local copy of the read-only engine #178 bundle and its original overlays. Bundle version: `9c776e481006d875da1a66b2a905fe1cc04aadba6b9db7920055150645442a4f`. The final results use both locally built cores and this branch's overlays.

| Check | Before | After |
|---|---|---|
| New FFA3 live scenarios, Standard and Domain | 60 fail, 46 pass | 106 pass |
| Full-column follow-up, before its fix | 24 fail | 24 pass, included above |
| Existing EMZ/Link, shared-zone and local-zone scenarios | Not repeated on baseline | 307 pass |
| All four live scenario files | — | 413 pass, no skips |
| Native column/Link checks, ASan and UBSan | — | 5 pass, no skips |
| Overlay hashes, manifest, geometry audit and scanner | — | 142 pass; 1 optional metadata check skipped |
| Duel server typecheck | — | Pass |
| Strict rule coverage | — | 46 of 46 rules have outcome tests |

The one optional skip needs `.status/multiplayer-triage.json`, which is absent. No core, live scenario or stock-hash check was skipped. Existing shared-zone tests include `df-shared-zone-fix4.ts`. The native set includes the 1v1 zone check. Tag and FFA4 tests keep their prior results. The FFA3 Kidbrave expectation changes under the own-only interpretation stated in the rule handoff.

Tests were added and run before each implementation change. Review found the full-column count fault after the first green run. Its 24 tests failed before the count fix. These tests include two independent mirrored EMZ, an EMZ source card, and incomplete columns. Both cores were rebuilt after that fix.

## Exact local commands

Commands ran from the worktree above. `.local/engine` was a private copy of `/home/sulman633/.cache/dk-duel-engine-178`. The cache was read only. Root and package `node_modules` were linked with `cp -al` from `table-extra-summon-pile`. The local `better-sqlite3` directory was copied before rebuilding it for Node 22, to keep the source hardlinks unchanged.

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
npm rebuild better-sqlite3
npm run build --workspace=packages/shared

# Baseline: original cores and overlays.
DUEL_DATA_DIR=$PWD/.local/engine \
MULTI_WASM=$PWD/.local/engine/ocgcore.multi.wasm \
DOMAIN_MULTI_WASM=$PWD/.local/engine/ocgcore.multi-domain.wasm \
DUEL_MULTI_SCRIPTS_DIR=$PWD/.local/engine/multi-scripts \
DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 \
npx vitest run packages/duel-server/tests/scenarios/multiplayer/ffa3-columns.test.ts

# Local Standard multi core.
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache \
  -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9 \
  bash packages/duel-server/scripts/build-multi-core.sh

# Local Domain multi core.
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache \
  -e APPLY_DOMAIN=1 -e DOMAIN_MULTI=1 \
  -e OUT_NAME=ocgcore.multi-domain.sync.wasm \
  -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9 \
  bash packages/duel-server/scripts/build-multi-core.sh

# Live scenarios, both built cores.
DUEL_DATA_DIR=$PWD/.local/engine \
MULTI_WASM=$PWD/packages/duel-server/domain-core/dist/ocgcore.multi.sync.wasm \
DOMAIN_MULTI_WASM=$PWD/packages/duel-server/domain-core/dist/ocgcore.multi-domain.sync.wasm \
DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 \
npx vitest run \
  packages/duel-server/tests/scenarios/multiplayer/ffa3-columns.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/extra-monster-zones.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/df-shared-zones.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/df-local-zone-viewer.test.ts

# Native checks against the same patched source tree.
DUEL_DATA_DIR=$PWD/.local/engine \
MULTI_TREE=$PWD/packages/duel-server/domain-core/.build/multi-core-tree \
bash packages/duel-server/scripts/native/checks/run.sh link-column-zones

# Stock hashes and script checks.
DUEL_DATA_DIR=$PWD/.local/engine npx vitest run \
  packages/duel-server/tests/multi-scripts-manifest.test.ts \
  packages/duel-server/tests/multi-scripts.test.ts \
  packages/duel-server/tests/c6-geometry-audit.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/scan.test.ts

npm run typecheck --workspace=packages/duel-server
DUEL_DATA_DIR=$PWD/.local/engine npx tsx packages/duel-server/scripts/rule-coverage.ts --strict
DUEL_DATA_DIR=$PWD/.local/engine npx tsx packages/duel-server/scripts/rule-coverage.ts --strict --check
git diff --cached --check -- . ':(exclude)packages/duel-server/domain-core/patches/0106-ffa3-column-peer.patch'
git -C packages/duel-server/domain-core/.build/multi-core-tree diff HEAD^ --check
git diff --check
```

The full-column red run used the live-scenario environment above with only `ffa3-columns.test.ts -t full.emz`. Test output was saved in `.local/*.log`. The patch file contains required context whitespace, so the staged whitespace check excludes that file and checks the applied C++ diff instead. The build preparer's internal `git add -A` was temporarily replaced with `git add -- .` in its disposable core repository. That script change was restored before commits.

## Build and cleanup

Both builds use Emscripten 4.0.9 and all 94 patches, with `luaFixedSeed: 0`. Pinned source: `efc21aa433b88cd35b7c37db4072a35c58d9d435`. Patched core HEAD: `ed8ed32ab201ac03615b0620ea323ae33427782d`.

The compact evidence bundle is kept at `.local/verification/`: both WASM files, build-info files, SHA-256 sums and validation logs. This is the only retained engine output. The core `.build`, `.emcache`, original `dist`, shared build output, copied engine data and temporary dependency backup were deleted after checks. To repeat tests, restore the private data copy and rebuild using the commands above.

No existing patch file changed. The new patch is `0106-ffa3-column-peer.patch`. The final check found two committed overlaps with `fix/hand-effects-multi`: `multi-scripts/MANIFEST.json` and `scripts/generate-multi-scripts.ts` (the expected entry count). Preserve both sets of entries and combine the count changes during integration. No engine patch file overlaps. Other worktrees' uncommitted files were not read.
