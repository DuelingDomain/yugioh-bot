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
- Nightly jobs run the large fuzz counts. Engine-area pull requests run the affected scenario and fuzz files.
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

PRs and the main push Test gate select tests by area. `scripts/ci/test-areas.mjs` owns the path rules, cross-package dependencies and fixed smoke files. GitHub paginates the PR file list and includes both names for renames. A missing or capped diff and changes to the root lockfile, root package/Turbo/TypeScript/Node configuration, root patches or any Vitest config select the full gate. Changes to workflow files, actions or CI helpers select the CI script suite and the fixed smokes. A mixed change takes the union of its selections.

| Area | Owned inputs | Selected test coverage |
|---|---|---|
| Web | `packages/web`, `site`, web seed and catalog scripts | Affected web files, and the production build for runtime web changes |
| WebSocket, worker, bot | Their respective packages | Affected files in each package, plus the worker health integration when its WS inputs change |
| E2E | `packages/e2e` | E2E typecheck. Browser flows use the separate Playwright stack. |
| Vision | `packages/vision`, `scripts/vision` | Affected Node test files and the workspace typecheck |
| Shared services | Shared runtime code including `services` and `remote` | Affected shared files and importing web, WS, worker, bot, vision and core-free duel tests |
| Shared DB/schema | Shared DB source, tests, migrations and schema | Shared DB tests and consumer smokes for runtime changes |
| Duel host | Remaining duel-server host, HTTP and app paths | Affected duel tests in the core-free inventory |
| Engine | Duel-server engine, worker protocol and rule files, core code, Lua and card-script patches, multi-scripts, legacy 1v1, engine data, engine-owned tests (including web files that import the cores helper) and shared duel code | Affected pinned, surrender and legacy files, dependent web engine files, strict rule coverage, and core-free tests that exercise the inputs. Core inputs also select differential/native. |
| Effects | Effect-tagging scripts, shared effects source/data and duel effect modules | Effect protocol and bridge checks, plus the mapped web, shared and core-free duel consumers for effects/staples data |
| CI and deployment | CI scripts, workflows/actions, deployment scripts and image/Compose inputs | CI/deploy script tests, actionlint, Compose validation, and the production dry run for its existing inputs |

The selector follows module references, named shared re-exports, aliases and known runtime file readers in the owning suite and its declared consumers. A missing file, runtime-only input or global setup change can use the owning suite's fallback. The engine graph receives only direct engine inputs. These include the new-card smoke implementation and the web `seat-state.ts` rules exercised by real-core scenarios. Supported TS/JS inputs narrow the pinned, surrender and legacy shards to affected files. Core, data and other engine inputs that the graph cannot bound use the full engine plan. Real-core coverage outside the gate selection runs in Full Suite. The automated card-data PR keeps its separate new-card smoke and reporting gate.

Runtime hubs include observability, analytics, logging, instrumentation, config/env helpers and generic utilities. The import graph stops at them. A hub change runs its dedicated tests and the following smokes. Workflow/CI changes use the same fixed list.

| Area | Fixed smoke files (relative to the area runner) |
|---|---|
| Web | `tests/observability-migration.test.ts` |
| WS | `tests/observability.test.ts` |
| Worker | `tests/analytics-drain.test.ts` |
| Bot | `tests/bot-enabled.test.ts` |
| Shared services and DB | `tests/services/drafts.test.ts`, `tests/db/schema.test.ts` |
| Duel host and engine | `tests/decision-clock-credit.test.ts`, `tests/sort-response.test.ts` (both core-free) |
| Vision | `src/face-state.test.ts` |
| Effects | `scripts/effects/tests/bridge-artifacts.integration.test.ts` |
| E2E | Workspace typecheck |

Area-selected runs typecheck touched workspaces and their direct dependents, including the effects script project for shared or duel-server inputs. Hub and workflow/CI changes typecheck every workspace. Declaration files and edits confined to TypeScript type-only declarations or exports run typechecks alone. The selector compares TypeScript runtime statements against the PR merge's first parent or the gate's deployed baseline, so removing a value export still selects runtime tests.

On a main push, **Test** uses the PR selector with an exact tree diff from the last confirmed Deploy target. A missing or unusable baseline selects every regular group. A successful same-repository PR Test can satisfy the test portion when its artifact proves the same tree, baseline and changed paths. The gate still requires the production bundle, voice inputs and verified images for that SHA.

**Full Suite** runs independently on main pushes. It uses the same job definitions with full app, effects, pinned, surrender, legacy, differential, native, nduel golden and production dry-run coverage. New main pushes cancel superseded Full Suite runs. The nightly schedule has its own concurrency group and retains all groups plus extended nduel fuzz. Manual Test uses all regular groups and can also run extended fuzz. A main Full Suite failure opens or updates the `ci-full-suite-red` issue. A later green main run closes it. A regression outside the selected gate may reach production before the issue appears. Rollback requires an operator. See the [test runbook](../runbooks/test-and-nightly.md#when-it-fails).

Duel test file ownership is computed by `scripts/ci/duel-test-files.mjs` without importing the tests. Files that import the cores helper directly or through another module, plus the explicit data/manifest requirements, run in the engine lane. The unit configuration includes the complement. Mixed files run wholly with the engine, so their pure cases are preserved without loading the file a second time just to skip the engine cases. Frozen `legacy-main` files run only in the legacy group; the three host/identity gates still run against both engines intentionally.

Full web runs use three shards with four Vitest workers each. Vitest discovers files using the web configuration, and the runner assigns them longest-first to the lightest shard. New files have a five-second weight. Area-selected runs pass their selected files to the same runner and use up to three shards, capped by the number of selected files. Effects and staples data use this runner for their mapped web tests. The initial web weights came from the three web jobs in [run 44668415489](https://github.com/DuelingDomain/yugioh-bot/actions/runs/44668415489).

Area-selected engine runtime changes use #680's compact matrix. Nine jobs balance pinned and surrender cases using four Vitest workers, and the tenth uses one worker for `new-card-smoke-pool.test.ts` and its Table partition. Long files can be split by Vitest case ID. A selected list filters assignments from that plan, preserving case partitions and Table row coverage. The legacy 1v1 job receives the same selection with its own file inventory. The first compact job also runs the generated card-table checks, selected web engine tests and smoke scripts.

Full Suite, nightly, manual, full fallbacks and engine-test-only selections use eight pinned and two surrender jobs. Each surrender file part runs normal and Domain cases in separate Vitest processes. The Table file keeps its own row partition across all pinned shards. The timing history starts with [run 40715150826](https://github.com/DuelingDomain/yugioh-bot/actions/runs/40715150826), and the runner estimates ten seconds for a new engine file. Core inputs in the area-selected gate also select the two differential seed partitions and native checks.

Full Suite jobs upload `test-timings-web-*` or `test-timings-engine-*` artifacts. The reporter records each completed Vitest file's test, setup, collection and environment time. Timing artifacts cover web unit, pinned, surrender and legacy files. To refresh the checked-in weights, run `node scripts/ci/refresh-test-timings.mjs` with Node 22 and an authenticated `gh` from the repository. It finds the latest successful main Full Suite push with each suite's artifacts (or a historical full Test push), validates the reports, and updates `scripts/ci/test-timings/web.json` and `scripts/ci/engine-test-times.json`. The latest qualifying web and engine push can differ. PR jobs read the checked-in weights directly.

Area-selected `core` coverage includes C++ and Lua inputs, core and card-script patches, current/legacy pins, native tooling, core build inputs and differential/fuzz test inputs. It controls differential and native jobs. `golden` further selects native hash checks when the relevant overlays, pins or native tooling changed. Full runs select both flags.

`node scripts/ci/check-engine-test-coverage.mjs` compares Vitest's default, unit, pinned and legacy discovery with the duel inventory and verifies the pinned assignments. It runs in the first pinned or compact shard. Sharded web and engine runs verify the files completed by Vitest against their assignments. Compact shards also verify case IDs for files split across jobs. The final gate requires the selected matrix jobs to succeed. Table row, surrender mode and differential seed partitions intentionally execute their source file more than once, and three host and identity gates run against both engines.

The final **CI result** accepts intentional skips, rejects failed or cancelled jobs, and requires every selected group to succeed. Deploy waits for a green main push **Test** for the exact SHA. Full Suite, PR, scheduled and manual Test runs have no automatic deployment trigger.

| Job | What it runs |
|---|---|
| `changes` | Area and file selection, PR proof lookup and Compose safety validation. |
| `unit-web`, `unit-web-build` | Selected web tests (up to three timed shards), typecheck and production build when selected. |
| `unit-shared`, `unit-duel`, `small-checks` | Shared, core-free duel, bot, WS, worker and vision tests, workspace typechecks including E2E, and strict rule coverage. |
| `ci-scripts` | Selected CI/deployment helper checks and actionlint. |
| `effect-protocol` | Effect-tagging integration and script typecheck, full for effects changes or full runs, with a fixed smoke for hub/CI changes. |
| `changes`, `core-build`, `cores` | Look up the engine bundle, then build, restore and verify standard, Domain, legacy and multiplayer cores in three groups when needed. |
| `engine-shards`, `engine-legacy-shards` | Selected pinned, surrender and legacy suites, plus web engine tests and smoke scripts. A missing required core fails. |
| `engine-differential`, `native` | Core-input-only differential seed partitions and ASan/UBSan checks, with golden hashes when relevant. Always selected for Full Suite, nightly and manual runs. |
| `nduel-nightly` | Nightly/manual fuzz for n2, n3, n4 and tag, with future checks and golden hashes. The schedule runs every group plus fuzz. |
| `production-bundle`, `production-images` | Main only: prepare verified bundle, then build five ARM64 images concurrently with app/engine checks, without a matrix parallelism limit. |
| `production-dry-run` | Only production-composite/Docker/bundle/deployment inputs or root configuration changes: prepare a bundle and build one amd64 bot image without publishing. Also runs in Full Suite, nightly and manual Test. The main Test gate builds or verifies the release images directly. |
| `image-prebuild`, `service-image-prebuild` | Eligible same-repository PRs prebuild web separately and share one ARM64 job for WS, worker and bot. |
| `ci-result` | Final required-work and failure/cancellation aggregate. |

Main image artifacts remain unverified until the push Test gate succeeds. Deploy consumes immutable artifacts from that exact run/attempt and commit. Manual Deploy retains its successful-main-Test verification and rollback paths. Next/Turbo caches save only on main pushes.

All CI multi cores are built with `LUA_FIXED_SEED=1`, so one binary serves the engine tests and the differential tests. `deploy.yml` restores the pinned bundle and multi cores from separate caches and builds them only on a cache miss. Its multi cores use production Lua randomness, without `LUA_FIXED_SEED`.

The CI bundle cache key starts with `duel-engine-ci-v6`. It hashes pinned core/toolchain sources, patches, build/data preparation code and shared duel sources, plus the locked integrity of `ocgcore-wasm` (the wrapper included in the bundle). It excludes the whole root lockfile, shared package exports and TypeScript configuration: these do not change the pinned C++/Lua/WASM inputs. The wrapper integrity and its patch still invalidate the bundle when its actual runtime bytes change. Data-preparation helpers are retained because they can change the prepared card bundle. Per-target compiled-core keys remain conservative, and the existing bundle install, legacy-pin checks, fixed SHA256 checks and bundle/dist comparisons still run on restoration. Raise the literal version for workflow build flag/metadata changes; the file hash cannot see those. The emsdk image comes from `pins.json`.

A failing nightly seed goes into `tests/fuzz/regressions.test.ts` after the fix (see Decisions).
