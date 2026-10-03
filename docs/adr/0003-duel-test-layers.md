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

`.github/workflows/test.yml` runs the layers on every pull request and every push to main. It has these jobs:

| Job | What it runs |
|---|---|
| `cores` | Builds the standard, domain and multi cores, or restores them from the Actions cache. The key hashes the pins, the core patches, the build scripts and `package-lock.json`. The other core jobs use this bundle (`data/duel-engine-next`). |
| `unit` | `npm ci`, build shared, `npm run typecheck`, then the tests that need no core: shared, bot, web, duel-server `test:unit`, e2e `test:unit`. |
| `engine` | `DUEL_REQUIRE_CORES=1 npm run test:engine`. A missing core fails the job. It never skips. |
| `native` | `npm run test:native` (ASan/UBSan build and the committed native checks). |
| `rule-coverage` | `rule-coverage.ts --check --strict`: every rule of ADR-0002 needs a covering test. |
| `nduel-nightly` | Scheduled at 03:17 UTC (and by hand). Runs the nduel fuzz for n2, n3, n4 and tag with `--check-future`, and the golden hash check (`--check`). |

All multi cores are built with `LUA_FIXED_SEED=1`, so one binary serves the engine tests and the differential tests. Open item: `deploy.yml` builds no multi core yet. When the install step adds one, it must use the same flags, so that the tested binary is the deployed binary (ADVISOR-4 section 3.5).

The cache key starts with `duel-engine-ci-v1`. Raise the number when the build steps or flags in `test.yml` change: the file hash does not see them. The emsdk image comes from `pins.json`.

A failing nightly seed goes into `tests/fuzz/regressions.test.ts` after the fix (see Decisions).
