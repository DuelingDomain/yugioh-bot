import { expect, it } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { Session, domainNseatWasmBinary, nseatWasmBinary } from "../../support/session.js";
import { expectPrompt, select, type Scenario } from "../../support/dsl.js";
import { OPPONENT_COUNT_GATES_SCENARIOS } from "./opponent-count-gates.js";
import { domainVariant } from "./domain-variants.js";
import { runScenarios } from "../../support/runner.js";
// The opening-draw skip is intentional: keep the card fixture hand and Deck counts fixed.
// rule-proof-ffa-order.test.ts checks the first draw without this skip in the default test:engine gate.
const SKIP_OPENING_DRAW = `
do local skip=Effect.GlobalEffect(); skip:SetType(EFFECT_TYPE_FIELD); skip:SetCode(EFFECT_SKIP_DP)
skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET); skip:SetTargetRange(1,1); Duel.RegisterEffect(skip,0)
local undo=Effect.GlobalEffect(); undo:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS); undo:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
undo:SetOperation(function(e) skip:Reset() e:Reset() end); Duel.RegisterEffect(undo,0) end`;
async function runCountGateScenario(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  compiled.options.startupScripts![0].content += SKIP_OPENING_DRAW;
  const count = scenario.setup.format === "1v1" ? 2 : scenario.setup.format === "ffa3" ? 3 : 4;
  const game = await createEngineGame({ ...compiled.options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary() });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording();
    let at = 1;
    for (const step of scenario.steps) {
      session.run(expectPrompt({}), at++);
      const prompt = Array.from({ length: count }, (_, seat) => game.view(seat).prompt).find(Boolean);
      if (step.op === "select" && prompt?.context?.type === "action") {
        throw new Error(`${scenario.id}: select() needs a card selection prompt, but an action prompt is open.`);
      }
      session.run(step, at++);
    }
    const negative = scenario.tags.includes("negative-count");
    if (scenario.tags.includes("asset")) {
      for (let seat = 0; seat < count; seat++) expect(game.view(seat).seats[seat].monsters[0]?.position).toBe(negative ? 1 : 4);
    }
    if (scenario.tags.includes("pendransaction")) {
      const card = game.view(0).seats[0].monsters[0];
      expect(card?.attack).toBe(negative ? 2000 : 3000);
      expect(card?.materials?.length).toBe(negative ? 1 : 0);
    }
  } finally { game.close(); }
}
describeWithCores("live opponent count gates", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("Standard count gates", OPPONENT_COUNT_GATES_SCENARIOS, runCountGateScenario);
  runScenarios("Domain count gates", OPPONENT_COUNT_GATES_SCENARIOS.map(domainVariant), runCountGateScenario);
  for (const domain of [false, true]) it(`rejects a card selection after the summon is complete${domain ? " (Domain)" : ""}`, async () => {
    const base = OPPONENT_COUNT_GATES_SCENARIOS.find((s) => s.id === "opponent-count-gates-linkerbell-ffa3-late-eligible-opponent")!;
    const scenario = domain ? domainVariant(base) : base;
    const bad = { ...scenario, steps: [...scenario.steps.slice(0, -1), select("Mystical Elf"), scenario.steps.at(-1)!] };
    await expect(runCountGateScenario(bad)).rejects.toThrow(/select|selection/i);
  });
});
