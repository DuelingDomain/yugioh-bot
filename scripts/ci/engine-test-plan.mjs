import { readFileSync } from "node:fs";
import { balanceFiles } from "./test-shards.mjs";

// Files needing data/manifest access without importing the cores helper.
// Keep these explicit: a new unguarded data dependency fails in the unit lane.
export const NEEDS_ENGINE = [
  // Additional restored integration tests that need the installed engine data or script corpus.
  "tests/battle-command-attack-targets.test.ts",
  "tests/direct-attack-event.test.ts",
  "tests/engine-process-limit.test.ts",
  "tests/engine-resource-cache.test.ts",
  "tests/failure-to-scenario-first-draw.test.ts",
  "tests/failure-to-scenario-format.test.ts",
  "tests/fixtures/private-table-data.test.ts",
  "tests/fuzz-first-turn-draw.test.ts",
  "tests/multi-scripts-manifest.test.ts",
  "tests/multi-scripts-seat-helpers.test.ts",
  "tests/scenarios/multiplayer/scan.test.ts",
  "tests/script-error-loads.test.ts",
  "tests/script-error-noise.test.ts",
  "tests/script-error-repro.test.ts",
  "tests/target-names.test.ts",
  "tests/engine-declare-search.test.ts",
  "tests/prerelease-engine.test.ts",
  "tests/prerelease-catalog.test.ts",
  "tests/host-surrender-eot.test.ts",
  "tests/scenarios/multiplayer/leave-chains.test.ts",
  "tests/scenarios/multiplayer/leave-effects.test.ts",
  "tests/scenarios/multiplayer/leave-turns.test.ts",
  "tests/ffa-attack-target-pick.test.ts",
  // cards.cdb (card data, deck legality, scenario names)
  "tests/card-data-abi.test.ts",
  "tests/card-search.test.ts",
  "tests/effect-search.integration.test.ts",
  "tests/deck-import.test.ts",
  "tests/deck-legality-multiplayer.test.ts",
  "tests/deck-legality-settings.test.ts",
  "tests/deck-legality.test.ts",
  "tests/domain-format-deck-rules.test.ts",
  "tests/scenarios/registry.test.ts",
  "tests/scenarios/multiplayer/catalog.test.ts",
  // the engine bundle manifest (the host reads it when it is made; the identity test hashes the legacy files)
  "tests/host-bug-context.test.ts",
  "tests/host-coin-clock.test.ts",
  "tests/host-engine-switch.test.ts",
  "tests/host-multiplayer-flag.test.ts",
  "tests/legacy-engine-identity.test.ts",
  // cards.cdb and card scripts through a real duel (every test in these files loads the card database or starts an engine game)
  "tests/chain-targets.test.ts",
  "tests/replay-chain-mode-surrender.test.ts",
  "tests/material-count.test.ts",
  "tests/card-status-real.test.ts",
  "tests/card-hints-lifecycle-real.test.ts",
  "tests/protection-hints-real.test.ts",
  "tests/xyz-detach-prompt.test.ts",
  "tests/xyz-material-prompts.test.ts",
  "tests/legacy-xyz-material-prompt.test.ts",
  "tests/target-response.test.ts",
  "tests/c6-geometry-audit.test.ts",
  // a wasm core (engine, host, summons, presets, scenarios, fuzz, differential)
  "tests/battle-card-effects.test.ts",
  "tests/deck-reveal.test.ts",
  "tests/hand-order-engine.test.ts",
  "tests/hand-order-random-duels.test.ts",
  "tests/host-opening.test.ts",
  "tests/host-dice-opening-real.test.ts",
  "tests/host-spectator-view.test.ts",
  "tests/domain-extra-bridge-invariants.test.ts",
  "tests/domain-leave-tax.test.ts",
  "tests/domain-pendulum.test.ts",
  "tests/domain-recall-kind.test.ts",
  "tests/engine-eliminate.test.ts",
  "tests/engine-elimination-order.test.ts",
  "tests/engine-multi-scripts.test.ts",
  "tests/engine-artwork-start.test.ts",
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
  "tests/host-report-capture.integration.test.ts",
  "tests/report-full-log.integration.test.ts",
  "tests/host-table-legality.test.ts",
  "tests/host.test.ts",
  "tests/multi-scripts-table.test.ts",
  "tests/ocgcore-wrapper-abi.test.ts",
  "tests/practice-bot.test.ts",
  "tests/presets.test.ts",
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


export const PINNED_SHARDS = 8;
export const SHARED_ENGINE_SHARDS = 18;
export const LEGACY_SHARDS = 1;
export const SURRENDER_FILES = ["tests/host-surrender-eot.test.ts", "tests/host-surrender-eot-part2.test.ts"];
export const DIFFERENTIAL_FILES = ["tests/differential/differential.test.ts", "tests/differential/differential-extended.test.ts"];
export const TABLE_FILE = "tests/multi-scripts-table.test.ts";
export const timings = JSON.parse(readFileSync(new URL("./engine-test-times.json", import.meta.url), "utf8"));
export const isPinnedFile = file => !file.startsWith("tests/legacy-main/") && !SURRENDER_FILES.includes(file) && !DIFFERENTIAL_FILES.includes(file);
export const fileSeconds = file => file === TABLE_FILE ? timings.tableTotal / PINNED_SHARDS : timings.files[file] ?? 10; // New files always run; timing data is only a scheduling hint.

export function engineMatrix(sharedSourcePr) {
  const legs = (suite, count) => Array.from({ length: count }, (_, index) => ({ suite, shard: index + 1, count }));
  return sharedSourcePr ? legs("shared", SHARED_ENGINE_SHARDS)
    : [...legs("pinned", PINNED_SHARDS), ...legs("surrender", SURRENDER_FILES.length)];
}

export function sharedEnginePlan(files) {
  const regular = files.filter(file => file !== TABLE_FILE && (isPinnedFile(file) || SURRENDER_FILES.includes(file)));
  const tasks = new Map();
  const estimates = {};
  for (const file of regular) {
    const seconds = timings.surrenderFiles?.[file] ?? fileSeconds(file);
    // Long files can monopolize a worker even when aggregate work is balanced.
    const count = seconds > 110 ? Math.ceil(seconds / 75) : 1;
    for (let index = 0; index < count; index++) {
      const key = `${file}:${index}`;
      tasks.set(key, { file, index, count });
      estimates[key] = seconds / count + 0.7; // Collection and transformation work.
    }
  }
  const count = SHARED_ENGINE_SHARDS;
  const hasTable = files.includes(TABLE_FILE);
  const tableSeconds = hasTable ? timings.tableTotal / count : 0;
  const reserved = Array.from({ length: count }, (_, index) => tableSeconds + (index === 0 ? 120 : 0));
  return balanceFiles([...tasks.keys()], count, estimates, 10, reserved).map((shard, index) => ({
    seconds: shard.seconds,
    files: [...shard.files.map(key => tasks.get(key)), ...(hasTable ? [{ file: TABLE_FILE, index, count }] : [])],
  }));
}

/** Longest-processing-time placement, stable across full and changed-only runs.
 * Every shard also runs its own Table rows. New files participate immediately.
 */
export function pinnedPlan(files, count = PINNED_SHARDS) {
  const regular = files.filter(file => file !== TABLE_FILE && isPinnedFile(file));
  const tableSeconds = timings.tableTotal / count;
  // Shard 1 also builds the card tables and runs the web engine and smoke checks.
  // Reserve 120 worker-seconds to leave about 40 seconds of runner wall time for those steps.
  const reserved = Array.from({ length: count }, (_, index) => tableSeconds + (index === 0 ? 120 : 0));
  const shards = balanceFiles(regular, count, timings.files, 10, reserved);
  if (files.includes(TABLE_FILE)) for (const shard of shards) shard.files.push(TABLE_FILE);
  return shards;
}
