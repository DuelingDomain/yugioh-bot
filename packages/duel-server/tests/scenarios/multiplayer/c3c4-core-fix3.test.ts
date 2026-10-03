import { readFileSync } from "node:fs";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import type { Scenario } from "../../support/dsl.js";
import { C3C4_CORE_FIX3_SCENARIOS } from "./c3c4-core-fix3.js";

async function runWithFixture(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  const testCase = scenario.tags.find(tag => tag.startsWith("fixture:"))!.slice(8);
  const fixture = readFileSync(new URL("./fixtures/c3c4-core-fix3.lua", import.meta.url), "utf8");
  const game = await createEngineGame({ ...compiled.options, firstTurnDraw: scenario.setup.mode === "domain", dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
    startupScripts: [{ name: "c3c4-core-fix3.lua", content: `FIX3_CASE=${JSON.stringify(testCase)}\n${fixture}` },
      ...(compiled.options.startupScripts ?? [])], seed: ["1", "2", "3", "4"] });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
    for (let seat = 0; seat < (scenario.setup.format === "ffa3" ? 3 : 4); ++seat) {
      if (game.view(seat).prompt?.context?.type === "opponent") throw new Error("An opponent prompt is still open.");
    }
  } finally { game.close(); }
}

describeWithCores("C3/C4 fix3 core proofs", liveNseat, () => {
  runScenarios("multiplayer/c3c4-core-fix3", C3C4_CORE_FIX3_SCENARIOS, runWithFixture);
});
