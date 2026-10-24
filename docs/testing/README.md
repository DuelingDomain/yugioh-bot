# Testing

This page is the map of all tests in the repo. It tells you where each test layer lives, how to run it, and what CI runs.

The layer decision is [ADR 0003](../adr/0003-duel-test-layers.md). The CI job details are in that ADR (section "CI") and in the [Test runbook](../runbooks/test-and-nightly.md).

## Rules

- Use Node 22.
- Build shared first: `npm run build --workspace=packages/shared`. Other packages import `shared/dist`.
- Do not add new unit tests. New tests are e2e (`packages/e2e`) or integration tests (engine scenarios, host tests with a real core). Owner rule, 2026-10-16.
- Locally, run only the test files for the areas you changed. CI runs the full suites.
- Engine tests need the built engine bundle in `data/duel-engine-next` (or set `DUEL_DATA_DIR`).

## Layers

| Layer | Where | Tool | Covers | CI |
|---|---|---|---|---|
| Package tests | `packages/{shared,web,ws,worker,bot}/tests` | Vitest | Services, API routes, components, socket events, timers | `unit` job, every PR and main push |
| Duel-server unit | `packages/duel-server/tests` (files not in `NEEDS_ENGINE`) | Vitest, `vitest.unit.config.ts` | Host code that needs no wasm core and no card data | `unit` job |
| 1. Engine scenarios | `packages/duel-server/tests/scenarios` | Vitest + wasm core | Card rulings, chains, multi-player rules, from an exact board | `engine` job when `engine=true` |
| 2. Random self-play | `packages/duel-server/tests/fuzz`, `tests/fuzz-n` | Vitest + fast-check | No stuck duel, no hidden-card leak, card count, replay determinism | `engine` job (smoke), `nduel-nightly` (large counts) |
| 3. Host and protocol | `packages/duel-server/tests/*.test.ts` | Vitest + wasm core | Host ops, clocks, reconnect, per-seat privacy, journals | `engine` job |
| Legacy 1v1 engine | `packages/duel-server/tests/legacy-main` | Vitest | The pre-n-seat 1v1 engine | `engine-legacy` job |
| Differential | `packages/duel-server/tests/differential` | Vitest | Multi core plays the same 2-duelist duels as the reference core | `engine` job |
| Native checks | `packages/duel-server/scripts/native/checks` | C++, ASan + UBSan | Core rules for 3 and 4 duelists, Tag, elimination, zones | `native` job |
| nduel fuzz | `packages/duel-server/scripts/native` | C++ driver `nduel` | Whole seeded duels for n2, n3, n4, Tag; golden hashes | `nduel-nightly` (daily 03:17 UTC) |
| Rule coverage | `packages/duel-server/scripts/rule-coverage.ts` | tsx | Every ADR 0002 rule has an outcome scenario | `rule-coverage` job (`--check --strict`) |
| 4. Browser flows | `packages/e2e/tests` | Playwright | Sign-in, lobby, duels with 2 to 4 browsers, spectator, reconnect, replay, drafts, admin | Local only |
| Web browser checks | `packages/web/e2e/*.playwright.ts` | Playwright (external) | Single-page visual checks (3D mode, drawers, hand fit) against a dev page | Local only |

## Run

### Package tests

```bash
npm test --workspace=packages/shared
npx vitest run packages/shared/tests/<file>.test.ts            # one file (shared, bot)
npx vitest run packages/web/tests/<file>.test.ts -c packages/web/vitest.config.ts   # one web file
npm test --workspace=packages/ws
npm test --workspace=packages/worker
```

### Duel-server

```bash
cd packages/duel-server
npm run test:unit                                 # no core needed
export DUEL_DATA_DIR=<repo>/data/duel-engine-next
npx vitest run tests/<file>.test.ts               # one engine file
npx vitest run tests/scenarios -t "raigeki"       # scenarios by name
npm run test:engine                               # full engine suite, DUEL_REQUIRE_CORES=1 NSEAT_LIVE=1
npm run fuzz                                      # 200 fuzz runs
npm run test:native                               # native checks (from the repo root also works)
npx tsx scripts/rule-coverage.ts --check --strict # rule coverage, as CI runs it
npm run status                                    # status board in <repo>/.status/
```

Without `DUEL_REQUIRE_CORES=1`, a test with a missing core is skipped with a warning. With it, the test fails and names the missing file. The helper is `packages/duel-server/tests/support/cores.ts`.

Build the multi cores first with `npx tsx packages/duel-server/scripts/build-domain-core.ts multi` and `multi-domain`. They are not part of `npm run duel:prepare`.

### Browser flows

```bash
npx playwright install chromium            # once
npm run e2e                                # builds, starts an isolated stack, runs, stops
npx playwright test duel-1v1-match         # one spec, from packages/e2e
E2E_SLOT=3 npm run e2e                     # concurrent stack on its own ports
```

The stack uses its own ports (3300 family, or `3301 + 10*N` with `E2E_SLOT=N`) and a new SQLite file. It never uses `data/bot.sqlite`. Test login uses `E2E_AUTH=1` and `POST /api/test-auth/session`, not Clerk.

## Where to read more

| Topic | Doc |
|---|---|
| Layer decision, core availability, CI jobs | [ADR 0003](../adr/0003-duel-test-layers.md) |
| CI triggers, nightly fuzz, new-card smoke, failures | [Test runbook](../runbooks/test-and-nightly.md) |
| Browser stack, test login, adding a flow, failure evidence | [`packages/e2e/README.md`](../../packages/e2e/README.md) |
| Manual stack with no test run, slot ports | [`packages/e2e/stack/MANUAL.md`](../../packages/e2e/stack/MANUAL.md) |
| Scenario DSL, filters, card names | [`tests/scenarios/README.md`](../../packages/duel-server/tests/scenarios/README.md) |
| Scenarios made from fuzz failures or duel journals | [`tests/scenarios/generated/README.md`](../../packages/duel-server/tests/scenarios/generated/README.md) |
| Differential cores and modes | [`tests/differential/README.md`](../../packages/duel-server/tests/differential/README.md) |
| nduel driver and native tools | [`scripts/native/README.md`](../../packages/duel-server/scripts/native/README.md) |
| Native rule checks | [`scripts/native/checks/README.md`](../../packages/duel-server/scripts/native/checks/README.md) |
| Rule coverage table (generated, do not edit) | [`specs/multiplayer-rule-coverage.md`](../specs/multiplayer-rule-coverage.md) |
| Which paths start the engine CI layer | `scripts/ci/changed-layers.mjs` |
| Deck suggestion quality check | [deck-suggestions-quality.md](deck-suggestions-quality.md), [lists](deck-suggestions-quality-lists.md) |
