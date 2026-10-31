# Card and rules tests run on the engine in Vitest; Playwright covers only a small set of multi-browser flows

**Status:** accepted (2026-09-30)

Multi-player duels multiply the card interactions that can go wrong. We want hundreds to thousands of automatic card scenarios, plus checks that no duel gets stuck and no hidden card leaks. Card rules do not depend on the UI, and a browser test is roughly 1,000 times slower than an engine test. So the card cases live on the engine, and the browser layer stays small.

## Layers

| Layer | Tool | Size | Covers |
|---|---|---|---|
| 1. Engine scenarios | Vitest + the wasm core | 500 to 3,000+ cases | Card rulings, chains, summons, multi-player rules. Each case sets an exact board, does actions, and checks the result against a named ruling source. |
| 2. Random self-play | Vitest + fast-check | ~100 seeds per PR, 10,000+ nightly | Invariants: no stuck duel, every prompt answerable, no hidden-card leak in any viewer's view, card conservation, integer LP, replay determinism, correct turn order for N duelists. |
| 3. Host and protocol | Vitest | 100 to 300 | Host ops, clocks, reconnect, per-seat privacy, journals. |
| 4. Browser flows | Playwright (`packages/e2e`) | 10 to 25 | Login, lobby, a full duel with 2 to 4 browsers, spectator, reconnect, replay. |

## Decisions

- **Playwright** for the browser layer: one test can drive several isolated browser contexts (one per duelist), with traces, sharding and a fake clock. Cypress cannot control more than one browser; WebdriverIO multiremote is not built for this.
- Layer 1 scenarios are a **TypeScript DSL** over a board-setup helper, so they are type checked and share the Vitest setup. Lua puzzles are used only when a case needs Lua state. Expected results are written by hand with a `source` (ruling URL); snapshots only guard against regressions and never prove a ruling.
- Playwright logs in through a **test-only Credentials provider** that exists only when `E2E_AUTH=1` and a strong `E2E_AUTH_SECRET` are set. Production never sets them. The E2E stack runs on its own ports with a temporary database, so it never touches the live test environment.
- Nightly jobs run the large fuzz counts; pull requests run the scenario suite and a small fuzz smoke.
- A fuzz seed that found a real defect goes into `tests/fuzz/regressions.test.ts` after the fix, so every run replays it.

## Consequences

- The engine needs a board-setup path (the core's `Debug.AddCard` / `duelNewCard` with explicit locations) that tests can use without playing turns.
- Every multi-player engine change must come with Layer 1 cases and must keep Layer 2 green.

## Core availability in tests (`DUEL_REQUIRE_CORES`)

All core checks in the duel-server tests go through one helper: `packages/duel-server/tests/support/cores.ts`. It has `describeWithCores`, `itWithCores`, `itEachWithCores`, `failIfRequired` and the `needs.*` descriptions (standard, domain, multi, domain-multi, card data, scripts, SetupDuelists probe, live N-seat gate).

- Test default engine dir: `data/duel-engine-next` (`tests/engine-data-dir.ts`). `DUEL_DATA_DIR` overrides it. The production default in `src/server.ts` stays `data/duel-engine`.
- Without `DUEL_REQUIRE_CORES`, a test with a missing core is skipped, and the helper prints one warning.
- With `DUEL_REQUIRE_CORES=1` (`npm run test:engine`), the same test FAILS and the message names the missing file and the variable that fixes it. CI uses this mode.
- `NSEAT_LIVE=1` is a temporary gate for the outcome scenarios: the synchronous core can hang, and a test timeout cannot stop a hang. It is routed through `needs.liveNseat`. `npm run test:engine` sets `NSEAT_LIVE=1`, so the engine job runs these scenarios. Plain `DUEL_REQUIRE_CORES=1` without `NSEAT_LIVE=1` fails them on purpose. Remove the gate (one place in `cores.ts`) when the merged core is the default.
- Default multi cores: `MULTI_WASM` / `DOMAIN_MULTI_WASM`, else a local tagged build (`ocgcore.multi-<tag>.sync.wasm`, tags in `cores.ts`) if the file exists, else the canonical `ocgcore.multi.sync.wasm` / `ocgcore.multi-domain.sync.wasm` that CI builds. A clean checkout needs only the canonical build.
- A gitignored local file that is not a core (a fuzz failure record, a census file) uses `needs.localFile`. It stays a skip in require mode.
- The status board (`npm run status`) shows SKIPPED, not PASS, when a run has 0 passed tests and some skipped tests. Differential, fuzz and fuzz-n rows follow the same rule (no multi core: SKIPPED; 0 duels or seeds: MISSING).

## CI

`.github/workflows/test.yml` selects the same test groups on PRs and main pushes. PRs use the paginated changed-file API (including the previous name of renamed files), so detection needs only a shallow checkout. Pushes diff from the latest fully successful tested main ancestor, including changes from cancelled/failed runs. An unavailable base/diff or truncated PR file list runs everything. Manual and nightly runs also select every group. Nightly runs execute all pinned, legacy, surrender, differential, native, rule, app, effect and production smoke checks, plus nduel fuzz; a failure opens one deduplicated issue.

`changed-layers.mjs` selects web, bot, WS, worker, shared, duel without cores, E2E typecheck, and CI/deployment scripts independently. Each app group owns its typecheck; web also builds and runs three test shards. Shared source/configuration changes select all consumers. Shared tests select only shared. Pure effects/staples data changes run shared, duel and web consumer integration tests, skipping typechecks and the web production build; mixed or unknown data changes retain full relevant groups. WS changes also select the worker health integration group; duel source/test changes select direct web/shared/bot/E2E consumers, and web source changes select E2E typecheck. Root package/lockfile, Turbo, TypeScript, Node, patches and workflow configuration select every group. Unknown app/tooling paths select all app groups and CI helpers. Markdown, `docs/` and `site/` select no tests; Compose configuration is checked during detection.

Engine selection follows literal module references from `packages/duel-server/src` through shared package exports and relative imports, including barrels, type imports and dynamic imports. The graph retains missing dependency paths so deletions still select their callers. Shared `src/duels/` always selects the engine. Engine source/tests, core inputs, engine data, engine-specific CI/native tooling, install scripts and root configuration retain engine coverage. Shared data/tests, E2E, general scripts and proposal docs do not select engine suites. Shared package exports/configuration conservatively select the engine. Shared source outside the graph (for example `util/eastern-time.ts`) runs consumers without cores. PRs changing only duel test files retain the existing import-graph test selection; main always runs the full selected engine suites.

Duel test file ownership is computed by `scripts/ci/duel-test-files.mjs` without importing the tests. Files that import the cores helper directly or through another module, plus the explicit data/manifest requirements, run in the engine lane. The unit configuration includes the complement. Mixed files run wholly with the engine, so their pure cases are preserved without loading the file a second time just to skip the engine cases. Frozen `legacy-main` files run only in the legacy group; the three host/identity gates still run against both engines intentionally.

Pinned engine files use eight shards, balanced by longest-processing-time placement from `scripts/ci/engine-test-times.json` (run [40715150826](https://github.com/DuelingDomain/yugioh-bot/actions/runs/40715150826)). The plan is computed from the full current inventory even for changed-only runs; new files get a conservative default weight and are never omitted. The Table file retains its independent row partition on all eight shards. Exodia host, first-turn draw, host fork, fork launch and surrender each have two entry points sharing the same suite and alternating existing rows; singleton cases are assigned to one part. Surrender has four legs (two parts × two modes), while differential retains both seed partitions. No cases were added.

The regular engine matrix has 12 legs (8 pinned, 4 surrender), plus 2 legacy jobs. Native ASan/UBSan and both differential seed partitions run only for core inputs on PRs and main pushes, bringing core runs to 17 engine-side jobs. `engine-differential` owns the two differential legs; `engine-shards` and `engine-legacy-shards` retain the other suites. App checks and other workflow runs can still cause a startup queue.

The separate `core` selection covers C++ sources and source transforms, core Lua, core patches, current/legacy source and binary pins, native tooling, core build scripts, compiler wrappers and cache/assembly scripts. Package scripts, the root lockfile and the gate/build workflow wiring also select these checks conservatively. TS host/shared changes, test-only changes, card data and card-script overlays do not. Main applies this same rule to its last-successful-tested-ancestor diff; missing diffs and nightly/manual full runs select both checks. Golden hashes run only within a selected native job when its golden inputs changed, and always nightly/manually.

`node scripts/ci/check-engine-test-coverage.mjs` asks Vitest for the effective default, unit, pinned-config and legacy file lists without importing their modules, validates the workflow matrix and verifies complete ownership. It runs in pinned shard 1 on full PR/nightly runs and changed-only PRs. At this change, the inventory is 532 files: 100 unit-only, 406 pinned, 2 surrender, 2 differential and 22 legacy-only. The previous 527 files gain five entry points while the five split suites retain exactly the original 339 case names. The former unit lane loaded 396 files (171 passed, 225 entirely skipped); 71 of those passing files mixed pure checks with engine cases and now run wholly in the engine lane. The engine lane previously loaded all 527 duel files, including the 100 strictly unit-only files and the frozen legacy duplicates. Intentional Table/seed/mode partitions and the three dual-engine gates are reported separately by the check.

One final **CI result** job waits for every job. It accepts intentional skips, rejects any failed/cancelled job and requires every selected group to succeed, so a blocked required job cannot silently pass. The Test workflow's overall success still gates Deploy; no production deployment happens from a PR, schedule or manual Test run.

| Job | What it runs |
|---|---|
| `changes` | Path/dependency classification and Compose safety validation. |
| `unit-web`, `unit-web-build` | Selected web tests (three shards), typecheck and production build. |
| `unit-shared`, `unit-bot`, `unit-ws`, `unit-worker`, `unit-duel` | Selected package tests and typechecks; duel runs without cores. |
| `unit-e2e` | Selected E2E typecheck; browser flows remain local-only. |
| `ci-scripts` | Selected CI/deployment helper checks and actionlint. |
| `effect-protocol` | Effect-tagging integration and script typecheck, only for scripts/effects, its CI publisher, shared effects source/data or root configuration changes (PRs and main). Nightly/manual runs include it. |
| `core-cache`, `core-build`, `cores` | Build/restore and verify standard, Domain, legacy and multiplayer cores. |
| `engine-shards`, `engine-legacy-shards` | Selected pinned, surrender and legacy suites, plus web engine tests and smoke scripts. A missing required core fails. |
| `engine-differential`, `native` | Core-input-only differential seed partitions and ASan/UBSan checks, with golden hashes when relevant. Always selected nightly/manually. |
| `rule-coverage` | Strict ADR-0002 rule coverage for engine changes. |
| `nduel-nightly` | Nightly/manual fuzz for n2, n3, n4 and tag, with future checks and golden hashes. The schedule runs every group plus fuzz. |
| `production-bundle`, `production-images` | Main only: prepare verified bundle, then build five ARM64 images concurrently with app/engine checks, without a matrix parallelism limit. |
| `production-dry-run` | Only production-composite/Docker/bundle/deployment inputs or root configuration changes: prepare a bundle and build one amd64 bot image without publishing. Also runs nightly/manually; main uses the real bundle and image jobs instead. |
| `ci-result` | Final required-work and failure/cancellation aggregate. |

Main image artifacts remain unverified until the whole push Test succeeds. Deploy consumes immutable artifacts from that exact run/attempt and commit. Manual Deploy retains its successful-main-Test verification and rollback paths. Next/Turbo caches save only on main pushes.

All CI multi cores are built with `LUA_FIXED_SEED=1`, so one binary serves the engine tests and the differential tests. `deploy.yml` restores the pinned bundle and multi cores from separate caches and builds them only on a cache miss. Its multi cores use production Lua randomness, without `LUA_FIXED_SEED`.

The CI bundle cache key starts with `duel-engine-ci-v6`. It hashes pinned core/toolchain sources, patches, build/data preparation code and shared duel sources, plus the locked integrity of `ocgcore-wasm` (the wrapper included in the bundle). It excludes the whole root lockfile, shared package exports and TypeScript configuration: these do not change the pinned C++/Lua/WASM inputs. The wrapper integrity and its patch still invalidate the bundle when its actual runtime bytes change. Data-preparation helpers are retained because they can change the prepared card bundle. Per-target compiled-core keys remain conservative, and the existing bundle install, legacy-pin checks, fixed SHA256 checks and bundle/dist comparisons still run on restoration. Raise the literal version for workflow build flag/metadata changes; the file hash cannot see those. The emsdk image comes from `pins.json`.

A failing nightly seed goes into `tests/fuzz/regressions.test.ts` after the fix (see Decisions).
