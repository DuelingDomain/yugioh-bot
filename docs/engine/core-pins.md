# Engine pins and core hashes

This page records the pinned engine inputs, the verified core hashes and the local checks for the engine bundle.

`scripts/ci/build-core.test.mjs` reads the `| Domain 1v1 |`, `| Standard multiplayer |` and `| Domain multiplayer |` rows of the first hash table below. It compares them with `packages/duel-server/domain-core/expected-sha256.txt`. Keep that table format.

## Engine files and image build

Production prepares the pinned 1v1 bundle and both multiplayer cores in GitHub Actions.
The deploy bundle includes a checksum and source record for each multiplayer core.
The `duel-bundled` image uses that bundle through the named `engine` context.
The VM pulls the image and installs the matching bundle before starting services.
Production runs the carried `prepare-runtime-data.sh` ownership helper after bundle installation
and again immediately before starting services, so the pulled images can run as uid/gid 1000.
See [the deployment pipeline](../deployment/vm-runbook.md#deployment-pipeline) for the full procedure.

| Mode and layout | WASM loaded by the engine | Start guard |
| --- | --- | --- |
| Standard FFA3, FFA4, Tag | `ocgcore.multi.wasm` | Plain multi core must exist |
| Domain FFA3, FFA4, Tag | `ocgcore.multi-domain.wasm` | Both multi core files must exist |
| Standard 1v1, pinned engine (Compose default) | `ocgcore.standard.wasm` | Does not use multi cores |
| Domain 1v1, pinned engine | `ocgcore.domain.wasm` | Does not use multi cores |
| Legacy 1v1 (Domain Compose default; Standard rollback) | npm Standard core or `ocgcore.domain.legacy.wasm` | Does not use multi cores |

The Domain guard needs the plain multi file as well, even though the Domain game loads only the Domain
variant. The `capabilities` operation reports `multiDomainCoreReady` from the Domain file; preset
availability (`multiCoreAvailable`) checks the plain file. Neither existence check validates the WASM;
the deploy and image checks do that separately.

Both multi modes also read `cards.cdb`, the pinned `card-scripts` directory and the `multi-scripts` Lua
overlay (`mp-utility.lua`, `MANIFEST.json` and the card overrides). Domain loads `card-scripts/domain.lua`.
The startup bundle check also requires the pinned Standard/Domain 1v1 cores, `manifest.json` and the
legacy files/hashes. The installer requires `strings.conf` and verifies the overlay hash. Installing
only two WASMs into an empty directory is insufficient.

The production prepare job compiles both multiplayer cores on the GitHub runner using
`packages/duel-server/scripts/build-deploy-multi-cores.sh`. Nothing compiles a core on the VM.

## Engine pins

The build uses the same inputs as the engine session:

- `domain-core/pins.json`: ygopro-core `efc21aa433b88cd35b7c37db4072a35c58d9d435`, wrapper source
  `9f36452f2a2464f057f7fd6e2273aa5ab589401e`, Lua `75ea9ccbea7c4886f30da147fb67b693b2624c26`,
  and emsdk `4.0.9` at digest `sha256:3c853ef9c3b4c2708da1adac2fdfdba49c775fdc4144ceef4989423963e96811`.
- All numbered patches in `domain-core/patches` (currently 0001–0090, 0100, 0101 and 0105–0120, including both 0117 and both 0118 patches; 110 patches). No experimental patches or
  `PATCH_LIMIT`. The current series hash (concatenated patch bytes in filename order) is `43bf00f0ae8ac479b9f52841f54c4d3d2656244fc3d3532effc847b465946281`.
- Domain additionally uses `APPLY_DOMAIN=1 DOMAIN_MULTI=1`, the existing Domain patch, `domain_master.cpp`
  and `apply-domain-multi.mjs`. The current multi layer hash is
  `06d5cfbfba8719eb5fe0b3b0eb211a6264d96bb295a8669fe0680969c1822bb8`.

The 110-patch pinned builds use `LUA_FIXED_SEED=1` with the pinned image above. Patch 0089 was corrected on 2026-10-05 so delayed EVENT_CHAINING triggers from normally completed links remain legal. Patch 0101 follows the owner decision on 2026-10-05: control rotations complete the whole resolving chain link, including card choices and every placement, before pending surrender or timeout removal. Creature Swap (`c31036355.lua`) is the only multi-script that calls `MPRotateControl`; it marks the resolving link before the first card choice, including when an alias or a copying card such as Serial Spell calls the operation. Deferring that link is smaller than moving the Lua choices into the processor, and the existing host answers the leaving seat's required prompts. Patch 0105 sets the FFA4 facing pairs to 0/1 and 2/3. Patches 0106 and 0107 add the FFA3 column opponent and retain that choice through resolution. Patch 0108 restarts the FFA3/FFA4 response round after a cost elimination, so priority follows the newest living link (or the turn player when none is left). Patch 0109 clears the recorded opponent of an operation-based disabled-zone effect when its card leaves, so a revived Ojama King picks again. Patch 0110 keeps a resolved lock bound to its declared opponent after the registering seat leaves. Both changes are guarded by `n_duelists > 2`. Patches 0111–0115 implement Tag facing EMZ, Link and column geometry, one Field Spell per team, opposing-team direct-attack blocking and exact current/previous Lua geometry seats. Patch 0112 excludes the moved target when a partner Field Spell moves into the own Field Zone. Both multiplayer cores were rebuilt locally on 2026-10-07 from `feat/tag-facing-rules` with the review fixes, using the cached pinned image, the full 103-patch series and `LUA_FIXED_SEED=1`. Patch 0116 supersedes the column-peer rule: FFA3 seats 0/1 share fixed EMZ, Link arrows and columns; seat 2 is unpaired and no survivors regroup. Both multiplayer cores were rebuilt on 2026-10-11 from `feat/facing-pairs-fixed` with the full 104-patch series, pinned Docker image and `LUA_FIXED_SEED=1`. The multiplayer pins below were refreshed on 2026-10-18 from PR #391 CI for all 108 patches, including both 0117 and both 0118 patches. Both multiplayer pins were rebuilt locally on 2026-10-22 for PR #441 with all 109 patches, including patch 0119 for the read-only real-seat LP query, using the pinned image and `LUA_FIXED_SEED=1`. They were refreshed on 2026-10-24 from the CI builds of all 110 patches, including patch 0120 for the temporary-banish return after the banisher effect is deleted. The Domain 1v1 pin was refreshed the same day for the same guard in `src/apply-core-fixes.mjs`. The Domain 1v1 pin is unchanged:

| Pinned core | SHA-256 |
| --- | --- |
| Standard multiplayer | `fd67651cf72d4adcd3745e2a3abf06f91c8593fe896fa8dfcc59f81ee26eed82` |
| Domain multiplayer | `d499f74fa5c96e2c8f18b8a4063017bbcfc69a09bbfdac8a4953bdfdcceb060a` |
| Domain 1v1 | `0fc818d74544c4945983f8f6925b6e1ab10859840b1d050847991e1b12d18033` |

The 2026-10-22 mixed-LP follow-up changes only the Lua overlay and documentation: Supremacy Berry and Ancient Sacred Wyvern now use the higher branch for mixed LP and partial ties; all equal stays neutral. Unstable Evolution and Megamorph already implement that fallback. The overlay folder fingerprint is `7b3743963d0ad284cb074d5920ffc33699eaef43a578e09aa29f7c57837dbd1e`; `scripts/native/golden.tsv` records this new input fingerprint and retains its duel rows for CI verification. Both 109-patch multiplayer cores were rebuilt locally with Emscripten 4.0.9 and `LUA_FIXED_SEED=1` and match the pinned hashes above exactly, so `expected-sha256.txt` needs no change. The touched LP scenario suite passes all 172 real-engine cases with `NSEAT_LIVE=1 DUEL_REQUIRE_CORES=1`, including Soul Drain Dragon and Aromaseraphy Sweet Marjoram. No local unit or native suites were run.

The previous 103-patch inputs were also built locally on 2026-10-07 without `LUA_FIXED_SEED` for deployment:

| Deploy core | SHA-256 |
| --- | --- |
| Standard multiplayer | `49a33c6749993ede9b7e5256e77bee922234644fc4f352b67ab71eff7d618574` |
| Domain multiplayer | `c195dcac74314f8f73e5e55edb8cc44f1e84ffd826866e6a7013bee34531caff` |

The source and toolchain pins in `domain-core/pins.json` are unchanged. The fixed-seed hashes above are the CI binary pins in `domain-core/expected-sha256.txt`; deploy artifacts carry their own checked `.sha256` and `.SOURCE` sidecars. The 2026-10-07 Tag review kept local builds and test resources under `~/.cache/dk-duel-engine-tagrules`, with its shell env file at `~/.cache/dk-duel-engine-tagrules.env`. Its post-review native `run-nduel.sh --check` passed all 80 golden rows (20 seeds each for 1v1, FFA3, FFA4 and Tag), with no skips or mismatches. At that point, re-recording was required by the intentional overlay/patch fingerprint change; all 80 replay step counts and hashes were unchanged.

The 2026-10-07 merge of `origin/main` at `04e2bf878` into `feat/tag-facing-rules`
preserved the then-current 103-patch core inputs. The deploy hashes above describe
that earlier revision; the then-current 104-patch fixed-facing inputs required new
deployment builds and checked sidecars. The fixed-seed multiplayer hashes above
come from the 2026-10-24 CI builds with all 110 patches. At that merge, preparation included the prerelease
databases and the shared Steamed Sabersaurus script patch, yielding 14,984 passcodes
in the isolated Tag cache. The merged native golden
was explicitly re-recorded with fresh card data: all 60 1v1/FFA rows match main,
while 19 of 20 Tag rows differ with the Tag rules. `run-nduel.sh --check` passed
all 80 rows with no skips or mismatches. The Tag rules are in
[ADR 0002](../adr/0002-multiplayer-duel-rules.md).

The earlier released-card preparation used `cards.cdb` plus `release-betb.cdb` at the
same BabelCDB pin, yielding 14,845 passcodes (86 added). That data-only change
did not change the core or Lua build inputs. These data hashes were verified
in scratch preparation on 2026-10-06:

| Card data | SHA-256 |
| --- | --- |
| Base cards.cdb input | `3530f406ba92b0f8d5699aa107e95158a1f1b4816f8f5ca2dd82c490301ef632` |
| Release BETB input | `939a33357d6d43e0c392a33df4e31034152a7bec09696041239cded0d8d8e3ae` |
| Ordered input digest (`integrity.cards`) | `a71b47633363bede95e2858eaa6d1734f18735a0ecf27bd000d8d5e63c8dd9df` |
| Merged cards.cdb output (`integrity.cardsMerged`, SQLite 3.53.0) | `4c4025613e2fb7588ad8e520a16af72d9d7e509f7848a9bffec461f1cbcd0548` |

The input digest hashes newline-joined `<filename>:<input SHA-256>` records in load order,
without a trailing newline. `cardsMerged` verifies the cached file but is excluded from
`bundleVersion`, as is `multiScripts`, so SQLite version/layout changes alone preserve bundle identity.

The prepared bundle version without optional built-core metadata changes from
`23993561abcaedcdf5aacadbfb9b4f43c4484b2590a99e9906efe29fb59cdfa8` to
`661ab25721cdf1dfd2ad78e9e127899837ad769519c9ae5e3dd3d15ca815472d`.
Versions with built-core metadata change too. The owner must approve merging/deployment;
active-duel and replay version checks still apply. Selection, merge ordering and script
coverage are documented in [engine data updates](../deployment/engine-data-updates.md#released-and-prerelease-card-data).

Deploys omit `LUA_FIXED_SEED`; the differential test workflow uses it. The multi cache keys include all
build/packaging scripts, pins, patches and Domain sources. Each cache stores both WASMs and their
build-info JSON files. `package-deploy-multi-cores.mjs` checks those records and rejects test-seeded or
incomplete builds, then writes a `.sha256` and `.SOURCE` sidecar for **each** deployed core. Each build-info
JSON stores `builderCommit`; the sidecars and packaging logs print `builtBy=` from that record and
`deployedBy=` from the checked-out HEAD. A cache hit preserves the original builder. The prepare job records the exact release checkout as
deployer and verifies installation in a scratch directory before transfer. The VM fetches and checks
out that exact CI commit, even if main advances during compilation.

The ARM64 image job extracts the verified tarball into `.deploy-duel-engine` and passes it as the
named `engine` build context. `.dockerignore` excludes it from the application context. Docker target
`duel-bundled` copies the complete bundle once to `/opt/duel-engine` with readable permissions and
verifies it there with `verify-deploy-multi-cores.mjs`. No engine copy is baked into `/app/data`.
The VM pulls the recorded image digest and installs the same bundle on the host before startup.
Its runtime Compose model has no build definitions and starts with `--no-build`.
Production leaves `DUEL_BUNDLE_SRC` empty, so restarts only verify the installed volume.
The temporary transfer files are removed after deployment, including fetch failures.
The local dev override retains the bare `duel` target, clears the named context, and keeps its
existing volume.

The shared installer validates both checksums before writing, updates either multi core even under an
identical base manifest, and refuses a changed multi core while a Tag/FFA duel is active. The prepare
job supplies both WASMs and all four checksum/provenance sidecars. The VM runs the installer with
`DUEL_PREFLIGHT=1` before any checkout, image or service change. A base bundle change requires all
active duels to finish; a multi-only change requires active Tag/FFA duels to finish.
Production defaults `MULTIPLAYER_TABLES` to on (`docker-compose.yml`). Set `MULTIPLAYER_TABLES=0`
and recreate `duel` and `web` to close new multi tables.

### Local verification without starting services

From a disposable checkout, prepare the bundle and build the deploy image:

```sh
npm ci
mkdir -p .deploy-duel-engine
export DUEL_DATA_DIR="$PWD/.deploy-duel-engine"
npm run duel:prepare
npx tsx packages/duel-server/scripts/build-domain-core.ts
npx tsx packages/duel-server/scripts/build-domain-core.ts standard
npx tsx packages/duel-server/scripts/build-domain-core.ts legacy-domain
bash packages/duel-server/scripts/build-deploy-multi-cores.sh
node packages/duel-server/scripts/package-deploy-multi-cores.mjs "$DUEL_DATA_DIR"
docker build --target duel-bundled --build-context engine=./.deploy-duel-engine -t yugidraft-multicore-test .
docker run --rm --network none --env DUEL_DATA_DIR=/opt/duel-engine --entrypoint node yugidraft-multicore-test \
  packages/duel-server/scripts/verify-deploy-multi-cores.mjs --smoke
```

The check verifies the bundle, WASM syntax, both checksums, `multiCoreAvailable=true` and the real host
response `multiDomainCoreReady=true`. `--smoke` starts all six Standard/Domain FFA3, FFA4 and Tag layouts
from the deployed filenames and checks Domain Deck Masters. It opens no ports and uses an in-memory
application database. Repeat with an empty writable bind mount to test the startup copy:

```sh
mkdir -p .status/multicore-check
docker run --rm --network none --user "$(id -u):$(id -g)" \
  -v "$PWD/.status/multicore-check:/app/data" --entrypoint sh yugidraft-multicore-test \
  -c 'sh packages/duel-server/scripts/install-engine-bundle.sh && node packages/duel-server/scripts/verify-deploy-multi-cores.mjs --smoke'
docker image rm yugidraft-multicore-test
```

Remove only this checkout's generated `.deploy-duel-engine`, test data and core build output afterward.
Do not prune shared Docker images, volumes or build caches. No external release asset is required: all
patches and Domain sources are tracked, and upstream repositories are pinned to commits.
