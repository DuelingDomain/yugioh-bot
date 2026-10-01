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
