import { beforeEach, expect, vi } from "vitest";
import type { OcgCoreSync } from "ocgcore-wasm";
import { createEngineGame, type EngineStartupScript } from "../../../src/engine.js";
import { createEngineGame as createLegacyGame } from "../../../src/legacy/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { runScenarios } from "../../support/runner.js";
import { Session } from "../../support/session.js";
import { HAND_RULE_MATRIX } from "./hand-rule-matrix.js";

const fixture = vi.hoisted(() => ({ scripts: [] as EngineStartupScript[] }));
vi.mock("ocgcore-wasm", async original => {
  const actual = await original<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: { sync: true }) => {
    const core = await actual.default(options); const start = core.startDuel;
    core.startDuel = ((handle) => {
      for (const script of fixture.scripts) if (!core.loadScript(handle, script.name, script.content)) throw new Error(`Cannot load ${script.name}`);
      return start(handle);
    }) as OcgCoreSync["startDuel"];
    return core;
  } };
});
beforeEach(() => { fixture.scripts = []; });

for (const legacy of [false, true]) for (const auto of [false, true]) {
  describeWithCores(`hand ruling matrix: ${legacy ? "legacy" : "current"}, ${auto ? "Auto" : "Always"}`, [needs.cards(), needs.standard(), needs.domain(), needs.installedMulti()], () => {
    runScenarios("multiplayer/hand-rule-matrix", HAND_RULE_MATRIX.filter(s => !legacy || s.setup.format === "1v1"), async scenario => {
      const compiled = compileBoard(scenario.setup);
      fixture.scripts = legacy ? compiled.options.startupScripts! : [];
      const create = legacy ? createLegacyGame as unknown as typeof createEngineGame : createEngineGame;
      const game = await create({ ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
        settings: { ...compiled.options.settings!, stopAtEveryWindow: !auto } });
      try {
        const session = new Session(scenario, game); session.reachMainPhase(); session.startRecording();
        scenario.steps.forEach((step, index) => {
          session.run(step, index + 1);
          if (step.op === "expectPrompt" && step.prompt.title === "Deep-Eyes White Dragon, the Blue Abyss") {
            const seat = Number(step.prompt.by![1]);
            expect(game.view(seat).prompt!.source).toMatchObject({ code: 67886895, seat, zone: { controller: seat, location: 16 } });
          }
        });
      } finally { game.close(); }
    });
  });
}
