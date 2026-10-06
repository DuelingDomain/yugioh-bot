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

## Review follow-up, 2026-10-05

Base: `f0d4993b`. All changes are local on `feat/ffa3-columns-pick`.

- The first review changed Impermanence to save the target's seat at resolution. The re-review below corrects this to the activation's bound peer.
- The first FFA4 check missed the P0 cases. The re-review below restores the prior unbound Lua 1 result.
- A bound column peer stays bound after loss. Unbound column reads use `pick_opponents`, including its pending-loss rule.
- The declaration comment explains that `column_peer_of` is const for field state but marks the Lua probe.
- Tests cover two response links with different peers, nested scopes, a peer leaving before resolution, and both choices for p1 and p2 with three alive. Impermanence also leaves the third seat's continuous effect active.
- Review found a control-change edge case. Enemy Controller can move the target to the activator before Impermanence resolves. A new test failed in both cores. The filter now keeps the own column unmirrored.

### Results

| Check | Red evidence | Final result |
|---|---|---|
| Impermanence three-alive rule | 4 failures in both cores combined | Pass |
| Impermanence target becomes own | 2 failures in both cores combined | Pass |
| FFA4 unbound column | Native assertion failed | Pass |
| Bound peer leaves | 2 live failures; native seat and column assertions failed | Pass |
| Pending-loss peer eligibility | Native assertion failed | Pass |
| Response links and p1/p2 choices | 14 filtered scenarios failed on original engine #178 | Pass |
| Full FFA3 column suite | — | 120 pass |
| EMZ/Link, shared-zone and local-zone suites | — | 307 pass |
| Tag kinds, response order and team rules | — | 25 pass |
| Event binding and Domain variants, including Tag | — | 89 pass |
| All nine live test files | — | **541 pass, 0 fail, 0 skip** |
| Native checks, ASan and UBSan | — | **6 pass, 0 fail, 0 skip** |
| Manifest, stock hashes, script checks, geometry audit and scanner | Audit caught the new mirror expression; its reason was added | **142 pass, 1 optional skip** |
| Duel server typecheck | — | Pass |
| Strict rule coverage and generated-document check | — | 46 of 46 rules covered |

The optional script-test skip needs `.status/multiplayer-triage.json`, which is absent. Filtered red/green runs exclude unrelated tests; those exclusions are not missing final coverage. Item 5 changes a comment only; it has no new failing behavior test. The existing native checks were rerun after that change.

### Deferred work and integration

Item 6 is skipped under the owner's small-and-safe condition. `MPTarget` receives a Boolean target-check result. A legal own-card choice can make that check pass for each opponent. The wrapper cannot safely infer the side that supplied the choice. It needs more card-specific information to remove own-only menus. Existing per-opponent checks and automatic binding for a sole passing opponent stay in place.

Do not merge `fix/hand-effects-multi` in this task. Future integration must retain both sets of `MANIFEST.json` entries and use `EXPECTED_COUNTS.entries = 360` in `generate-multi-scripts.ts`.

### Exact local validation commands

Run from `/home/sulman633/orca/workspaces/yugioh-bot/ffa3-columns`. Node is `v22.23.3`. The source engine cache is read only. No ports or services are used.

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
mkdir -p .local/review
cp -a /home/sulman633/.cache/dk-duel-engine-178 .local/engine
node --version
npm run build --workspace=packages/shared

bash packages/duel-server/scripts/prepare-multi-core-tree.sh

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache \
  -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9 \
  bash packages/duel-server/scripts/build-multi-core.sh

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache \
  -e APPLY_DOMAIN=1 -e DOMAIN_MULTI=1 \
  -e OUT_NAME=ocgcore.multi-domain.sync.wasm \
  -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9 \
  bash packages/duel-server/scripts/build-multi-core.sh

DUEL_DATA_DIR=$PWD/.local/engine \
MULTI_WASM=$PWD/packages/duel-server/domain-core/dist/ocgcore.multi.sync.wasm \
DOMAIN_MULTI_WASM=$PWD/packages/duel-server/domain-core/dist/ocgcore.multi-domain.sync.wasm \
DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 \
npx vitest run \
  packages/duel-server/tests/scenarios/multiplayer/ffa3-columns.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/extra-monster-zones.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/df-shared-zones.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/df-local-zone-viewer.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/event-binding-staples.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/tag-kinds.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/tag-response-order.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/tag-team-rules.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/domain-variants.test.ts \
  --reporter=json --outputFile=.local/review/scenarios-final.json

DUEL_DATA_DIR=$PWD/.local/engine \
MULTI_TREE=$PWD/packages/duel-server/domain-core/.build/multi-core-tree \
bash packages/duel-server/scripts/native/checks/run.sh ffa3-column-review link-column-zones

DUEL_DATA_DIR=$PWD/.local/engine npx vitest run \
  packages/duel-server/tests/multi-scripts-manifest.test.ts \
  packages/duel-server/tests/multi-scripts.test.ts \
  packages/duel-server/tests/c6-geometry-audit.test.ts \
  packages/duel-server/tests/scenarios/multiplayer/scan.test.ts
npm run typecheck --workspace=packages/duel-server
DUEL_DATA_DIR=$PWD/.local/engine npx tsx packages/duel-server/scripts/rule-coverage.ts --strict
DUEL_DATA_DIR=$PWD/.local/engine npx tsx packages/duel-server/scripts/rule-coverage.ts --strict --check
git diff --check
git -C packages/duel-server/domain-core/.build/multi-core-tree diff HEAD^ --check
```

Standard was rebuilt after the comment change. Both final build records have 95 patches, `luaFixedSeed: 0`, and core HEAD `e7b553053d01b6f4be6b99190180b6bae2159a57`. The compiler image is Emscripten 4.0.9. Long jobs ran in foreground tool sessions and were awaited to completion.

For the first Impermanence red/green runs, the live environment used `.local/verification/ocgcore.multi.sync.wasm` and `.local/verification/ocgcore.multi-domain.sync.wasm`, with `ffa3-columns.test.ts -t impermanence`. The seat-loss red run used the same cores and `-t 'response-chain|bound-peer|choose-p[12]-'`. The response/p1/p2 baseline used the original `.local/engine/ocgcore.multi.wasm`, `.local/engine/ocgcore.multi-domain.wasm`, `DUEL_MULTI_SCRIPTS_DIR=$PWD/.local/engine/multi-scripts`, and `-t 'response-chain|choose-p[12]-'`. The control-change red run used the final built cores and `-t target-becomes-own`; its green run used `-t impermanence`. Native red/green runs used `run.sh ffa3-column-review`, with `CHECKS_SKIP_LIB=1` only when the core library was unchanged. Logs are in `.local/review/`.

### Cleanup

The final WASM files, build records, checksums, and logs are retained in `.local/review/`. The prior `.local/verification/` evidence is unchanged. Temporary engine data, core source/cache/build trees, `domain-core/dist`, and the shared TypeScript build output were removed. No push, PR, merge, service start, or production-data change was made.

## High re-review, 2026-10-05

Base: `aaca1eae`. Two fixes, one commit per fix.

- FFA4 returns `false` for an unbound Lua 1 column origin before the FFA3 fallback. New native checks use scope P0 with seat-0 and seat-1 cards. Both fail before the fix. A third check detects the unwanted probe touch. All pass after the fix.
- Impermanence reads `aux.MPColumnPeerSeat(own)` during its opted-in activation. Patch 0107 keeps this bound seat. Target control changes cannot redirect the lasting column effects.
- Eight control-change tests fail before the second fix and pass after it: own or third-seat control, activation or continuous effects, Standard or Domain. P1's set Jar of Greed in `s3` draws no card. P1's Tenki in `s3` is disabled. P0's Tenki in `s1` is disabled. P2's Tenki in `s3` stays active. These results also confirm the existing `seat~=own` mirror test.

| Check | Result |
|---|---|
| Local Standard and Domain WASM builds | Both pass |
| Native review and column/Link checks, ASan and UBSan | 6 pass, 0 fail, 0 skip |
| Impermanence subset | 24 pass |
| Full FFA3 columns, EMZ/Link, shared zones and local viewer zones | 433 pass, 0 fail, 0 skip |
| Manifest, stock hashes, overlays, geometry audit and scanner | 142 pass, 1 optional skip |
| Duel server typecheck | Pass |

The optional skip needs `.status/multiplayer-triage.json`. Filtered red/green runs exclude unrelated tests. The full live run has no skips. The native build has no compiler warnings. Both WASM builds emit the existing upstream Lua C-as-C++ and string-pointer warnings. Both use Emscripten 4.0.9, 95 patches, `luaFixedSeed: 0`, and core HEAD `e7b553053d01b6f4be6b99190180b6bae2159a57`. No core patch changed.

Item 6 remains a deferred follow-up: offer only opponents with a legal choice. This needs `MPTarget` work to distinguish a legal own-card choice from a legal opponent-card choice. No GitHub issue was opened.

### Exact re-review commands

Run from this worktree. Node is `v22.23.3`. The source engine cache is read only. Commands use no service ports. Build and test jobs run in foreground sessions and are awaited.

```bash
export PATH=/home/sulman633/.nvm/versions/node/v22.23.3/bin:$PATH
mkdir -p .local/re-review
cp -a /home/sulman633/.cache/dk-duel-engine-178 .local/engine
node --version
npm run build --workspace=packages/shared
bash packages/duel-server/scripts/prepare-multi-core-tree.sh > .local/re-review/prepare.log 2>&1

set -o pipefail
# Before the FFA4 fix: both P0 assertions and the probe-touch check fail.
DUEL_DATA_DIR=$PWD/.local/engine MULTI_TREE=$PWD/packages/duel-server/domain-core/.build/multi-core-tree bash packages/duel-server/scripts/native/checks/run.sh ffa3-column-review 2>&1 | tee .local/re-review/ffa4-red.log
# After the FFA4 fix: 6 pass. The core library is unchanged.
DUEL_DATA_DIR=$PWD/.local/engine MULTI_TREE=$PWD/packages/duel-server/domain-core/.build/multi-core-tree CHECKS_SKIP_LIB=1 bash packages/duel-server/scripts/native/checks/run.sh ffa3-column-review link-column-zones 2>&1 | tee .local/re-review/ffa4-green.log

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9 bash packages/duel-server/scripts/build-multi-core.sh 2>&1 | tee .local/re-review/build-standard.log
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e EM_CACHE=/src/packages/duel-server/domain-core/.emcache -e APPLY_DOMAIN=1 -e DOMAIN_MULTI=1 -e OUT_NAME=ocgcore.multi-domain.sync.wasm -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9 bash packages/duel-server/scripts/build-multi-core.sh > .local/re-review/build-domain.log 2>&1

# Before the Impermanence fix: 8 failures, all at final board assertions.
DUEL_DATA_DIR=$PWD/.local/engine MULTI_WASM=$PWD/packages/duel-server/domain-core/dist/ocgcore.multi.sync.wasm DOMAIN_MULTI_WASM=$PWD/packages/duel-server/domain-core/dist/ocgcore.multi-domain.sync.wasm DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 npx vitest run packages/duel-server/tests/scenarios/multiplayer/ffa3-columns.test.ts -t target-becomes > .local/re-review/impermanence-red-final.log 2>&1
# After the Impermanence fix: 24 pass.
DUEL_DATA_DIR=$PWD/.local/engine MULTI_WASM=$PWD/packages/duel-server/domain-core/dist/ocgcore.multi.sync.wasm DOMAIN_MULTI_WASM=$PWD/packages/duel-server/domain-core/dist/ocgcore.multi-domain.sync.wasm DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 npx vitest run packages/duel-server/tests/scenarios/multiplayer/ffa3-columns.test.ts -t impermanence > .local/re-review/impermanence-green.log 2>&1

DUEL_DATA_DIR=$PWD/.local/engine MULTI_WASM=$PWD/packages/duel-server/domain-core/dist/ocgcore.multi.sync.wasm DOMAIN_MULTI_WASM=$PWD/packages/duel-server/domain-core/dist/ocgcore.multi-domain.sync.wasm DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1 npx vitest run packages/duel-server/tests/scenarios/multiplayer/ffa3-columns.test.ts packages/duel-server/tests/scenarios/multiplayer/extra-monster-zones.test.ts packages/duel-server/tests/scenarios/multiplayer/df-shared-zones.test.ts packages/duel-server/tests/scenarios/multiplayer/df-local-zone-viewer.test.ts > .local/re-review/scenarios-final.log 2>&1
DUEL_DATA_DIR=$PWD/.local/engine npx vitest run packages/duel-server/tests/multi-scripts-manifest.test.ts packages/duel-server/tests/multi-scripts.test.ts packages/duel-server/tests/c6-geometry-audit.test.ts packages/duel-server/tests/scenarios/multiplayer/scan.test.ts > .local/re-review/overlay-final.log 2>&1
npm run typecheck --workspace=packages/duel-server > .local/re-review/typecheck.log 2>&1
git diff --check

# Retain the evidence, then remove this run's temporary data and build files.
cp packages/duel-server/domain-core/dist/ocgcore.multi.sync.wasm packages/duel-server/domain-core/dist/ocgcore.multi-domain.sync.wasm packages/duel-server/domain-core/dist/ocgcore.multi-build-info.json packages/duel-server/domain-core/dist/ocgcore.multi-domain-build-info.json .local/re-review/
sha256sum .local/re-review/*.wasm > .local/re-review/SHA256SUMS
python3 - <<'PY'
from pathlib import Path
from shutil import rmtree
root = Path.cwd().resolve()
assert str(root) == '/home/sulman633/orca/workspaces/yugioh-bot/ffa3-columns'
for name in ('.local/engine', 'packages/duel-server/domain-core/.build', 'packages/duel-server/domain-core/.emcache', 'packages/duel-server/domain-core/dist', 'packages/shared/dist'):
    path = root / name
    if not path.exists():
        continue
    assert path.is_dir() and not path.is_symlink() and path.resolve().is_relative_to(root)
    rmtree(path)
    print(f'Removed {name}')
PY
git status --short
```

Logs, both WASM files, build records and checksums remain in `.local/re-review/`. Earlier evidence directories are unchanged. No push, PR, merge, service start, or production-data change was made.
