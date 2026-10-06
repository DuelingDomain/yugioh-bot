import { describe, expect, it } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, domainNseatWasmBinary, nseatWasmBinary } from "../../support/session.js";
import type { Scenario } from "../../support/dsl.js";
import { EVENT_BINDING_SCENARIOS } from "./event-binding-staples.js";
import { FFA_SCENARIOS } from "./nseat-ffa.js";
import { HAND_EFFECTS_AUDIT_SCENARIOS } from "./hand-effects-audit.js";

async function runAutoScenario(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  const game = await createEngineGame({ ...compiled.options,
    settings: { ...compiled.options.settings!, stopAtEveryWindow: false },
    dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
    seed: scenario.seed ?? ["1", "2", "3", "4"],
  });
  try {
    for (const seat of game.view(0).seats) expect(game.view(seat.seat).chainMode).toBe("auto");
    const session = new Session(scenario, game);
    session.reachMainPhase();
    session.startRecording();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
  } finally { game.close(); }
}

describeWithCores("hand card audit in Auto", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/hand-effects-audit-auto", HAND_EFFECTS_AUDIT_SCENARIOS, runAutoScenario);
});

/** Existing outcomes additionally prove non-turn targets, far responders and Tag partner negatives. */
const STAPLE_SCENARIOS = [
  ...EVENT_BINDING_SCENARIOS.filter(s => /^(maxx-c|effect-veiler)-/.test(s.id)),
  ...FFA_SCENARIOS.filter(s => s.id === "nseat-ffa4-negate-effect-from-far-seat"),
];
describeWithCores("existing real-engine hand staple outcomes", liveNseat, () => {
  runScenarios("multiplayer/hand-effects-audit-staples-always", STAPLE_SCENARIOS);
  runScenarios("multiplayer/hand-effects-audit-kuriboh-always",
    HAND_EFFECTS_AUDIT_SCENARIOS.filter(s => s.id.includes("kuriboh-damage-calculation")));
});

describe("hand card audit scenario list", () => {
  it("uses distinct ids, card scripts, multi-seat fixtures and an outcome for every seat", () => {
    expect(new Set(HAND_EFFECTS_AUDIT_SCENARIOS.map(s => s.id)).size).toBe(HAND_EFFECTS_AUDIT_SCENARIOS.length);
    for (const s of HAND_EFFECTS_AUDIT_SCENARIOS) {
      expect(s.source).toBeTruthy();
      expect(s.tags.some(t => /^card:\d+$/.test(t))).toBe(true);
      expect(s.steps.at(-1)?.op).toBe("expectBoard");
      expect(s.steps.some(step => ["activate", "attack", "normalSummon", "specialSummon"].includes(step.op))).toBe(true);
    }
  });
});
