import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import ts from "typescript";

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

const packageRoot = new URL("../../packages/duel-server/", import.meta.url);
const testFile = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Partition files without importing test modules (which can open databases/workers).
 * Follow actual module imports, including shared test helpers and suite registrations.
 * Mixed files move as a whole to the engine lane, retaining their non-engine cases.
 */
export function duelTestFiles() {
  const sources = new Map();
  for (const dir of ["tests", "src", "scripts"]) {
    for (const file of readdirSync(new URL(dir + "/", packageRoot), { recursive: true })) {
      const path = dir + "/" + file;
      if (/\.[cm]?[jt]sx?$/.test(path)) sources.set(path, readFileSync(new URL(path, packageRoot), "utf8"));
    }
  }
  const imports = new Map([...sources].map(([file, source]) => [file,
    ts.preProcessFile(source, true, true).importedFiles.flatMap(({ fileName }) => {
      if (!fileName.startsWith(".")) return [];
      const path = posix.normalize(posix.join(posix.dirname(file), fileName));
      const stem = path.replace(/\.[cm]?jsx?$/, "");
      return [path, stem + ".ts", stem + ".tsx", path + "/index.ts"].filter(candidate => sources.has(candidate));
    }),
  ]));
  const needsCores = new Set(["tests/support/cores.ts"]);
  let added;
  do {
    added = false;
    for (const [file, dependencies] of imports) {
      if (!needsCores.has(file) && dependencies.some(path => needsCores.has(path))) {
        needsCores.add(file);
        added = true;
      }
    }
  } while (added);
  const all = [...sources.keys()].filter(file => file.startsWith("tests/") && testFile.test(file)).sort();
  const requiresEngine = file => needsCores.has(file) || NEEDS_ENGINE.some(pattern =>
    pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -2)) : file === pattern);
  return { all, unit: all.filter(file => !requiresEngine(file)), engine: all.filter(requiresEngine) };
}
