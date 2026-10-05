import { configDefaults, defineConfig } from "vitest/config";

// npm run test:unit: the tests that need neither a wasm core nor the engine data (cards.cdb, card scripts).
// CI runs them in the unit job, which has no engine bundle. Every other test file runs in the engine job
// (npm run test:engine, DUEL_REQUIRE_CORES=1), where a missing core is a failure.
//
// This list is an exclude list on purpose: a new test file runs here by default, so a new test that needs the engine
// data fails loudly in the unit job until it is added below. An include list would skip it without a word.
// A file in the list needs a core, cards.cdb or the bundle manifest for at least one of its tests. Checked on 2026-10-01: with DUEL_DATA_DIR and
// MULTI_WASM pointing at an empty folder, each file below fails or skips most of its tests. A few files still pass some
// tests there (for example tests/engine-nseat.test.ts and tests/engine.test.ts have pure projection and parsing tests),
// so those tests do not run in the unit job. Every file not in the list passes.
const NEEDS_ENGINE = [
  "tests/ffa-attack-target-pick.test.ts",
  // cards.cdb (card data, deck legality, scenario names)
  "tests/card-data-abi.test.ts",
  "tests/card-search.test.ts",
  "tests/deck-import.test.ts",
  "tests/deck-legality-multiplayer.test.ts",
  "tests/deck-legality-settings.test.ts",
  "tests/deck-legality.test.ts",
  "tests/domain-format-deck-rules.test.ts",
  "tests/scenarios/registry.test.ts",
  "tests/scenarios/multiplayer/catalog.test.ts",
  // the engine bundle manifest (the host reads it when it is made; the identity test hashes the legacy files)
  "tests/host-bug-context.test.ts",
  "tests/host-chain-mode.test.ts",
  "tests/host-coin-clock.test.ts",
  "tests/host-engine-switch.test.ts",
  "tests/host-multiplayer-flag.test.ts",
  "tests/legacy-engine-identity.test.ts",
  // cards.cdb and card scripts through a real duel (every test in these files loads the card database or starts an engine game)
  "tests/chain-targets.test.ts",
  "tests/replay-chain-mode-surrender.test.ts",
  "tests/material-count.test.ts",
  "tests/target-response.test.ts",
  "tests/c6-geometry-audit.test.ts",
  // a wasm core (engine, host, summons, presets, scenarios, fuzz, differential)
  "tests/battle-card-effects.test.ts",
  "tests/deck-reveal.test.ts",
  "tests/hand-order-engine.test.ts",
  "tests/hand-order-random-duels.test.ts",
  "tests/host-opening.test.ts",
  "tests/host-spectator-view.test.ts",
  "tests/domain-extra-bridge-invariants.test.ts",
  "tests/domain-leave-tax.test.ts",
  "tests/domain-pendulum.test.ts",
  "tests/domain-recall-kind.test.ts",
  "tests/engine-eliminate.test.ts",
  "tests/engine-elimination-order.test.ts",
  "tests/engine-multi-scripts.test.ts",
  "tests/engine-events.test.ts",
  "tests/engine-first-seat.test.ts",
  "tests/engine-master-rule.test.ts",
  "tests/engine-nseat-domain.test.ts",
  "tests/engine-nseat.test.ts",
  "tests/engine-settings.test.ts",
  "tests/engine.test.ts",
  "tests/failure-to-scenario.test.ts",
  "tests/host-bot-pacing.test.ts",
  "tests/host-bot-turn-limit.test.ts",
  "tests/host-eliminate.test.ts",
  "tests/host-domain-multi-real.test.ts",
  "tests/host-nseat.test.ts",
  "tests/host-report-replay.test.ts",
  "tests/host-series.test.ts",
  "tests/host-table-legality.test.ts",
  "tests/host.test.ts",
  "tests/multi-scripts-table.test.ts",
  "tests/ocgcore-wrapper-abi.test.ts",
  "tests/practice-bot.test.ts",
  "tests/presets.test.ts",
  "tests/scripted-bot.test.ts",
  "tests/summons.test.ts",
  "tests/differential/differential-extended.test.ts",
  "tests/differential/differential.test.ts",
  "tests/fuzz/fuzz.smoke.test.ts",
  "tests/fuzz/regressions.test.ts",
  "tests/scenarios/battle.test.ts",
  "tests/scenarios/chains.test.ts",
  "tests/scenarios/domain.test.ts",
  "tests/scenarios/spells.test.ts",
  "tests/scenarios/summons.test.ts",
  "tests/scenarios/traps.test.ts",
  "tests/scenarios/multiplayer/red-eyes-exceed.test.ts",
  "tests/scenarios/multiplayer/swiftwind-panther-warrior.test.ts",
  "tests/scenarios/multiplayer/nseat.test.ts",
  "tests/scenarios/multiplayer/action-seat.test.ts",
  "tests/scenarios/multiplayer/owner-seat.test.ts",
  "tests/domain-nseat-stress-fuzz-stall.test.ts",
  // Deck Master core rule tests read card scripts through tests/domain/helpers.ts
  "tests/domain/**",
  // main's engine tests, run against the legacy 1v1 engine (src/legacy): a Standard or Domain core each
  "tests/legacy-main/**",
];

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "domain-core/**", "tests/support/fixtures/**", ...NEEDS_ENGINE],
    setupFiles: ["./tests/support/setup.ts"],
  },
});
