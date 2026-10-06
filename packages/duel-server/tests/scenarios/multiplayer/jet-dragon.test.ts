import { beforeEach, describe, expect, it, vi } from "vitest";
import { OcgLocation, OcgMessageType, type OcgCoreSync, type OcgMessage } from "ocgcore-wasm";
import { createEngineGame, type EngineGame, type EngineStartupScript } from "../../../src/engine.js";
import { createEngineGame as createLegacyGame } from "../../../src/legacy/engine.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { runScenarios } from "../../support/runner.js";
import { Session } from "../../support/session.js";
import { JET_CASES, JET_CODE, JET_NEGATIVE_SCENARIOS, JET_NO_DESTRUCTION_SCENARIOS, VICTIM, type JetCase } from "./jet-dragon.js";
import { resolveCard } from "../../support/card-catalog.js";

// Record the real core output. Do not alter its messages or responses.
const observed = vi.hoisted(() => ({ messages: [] as OcgMessage[], legacyFixture: [] as EngineStartupScript[] }));
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: { sync: true }) => {
    const core = await actual.default(options);
    const start = core.startDuel;
    // The legacy wrapper has no startupScripts test hook. Load the same board through the real Debug API.
    core.startDuel = ((handle) => {
      for (const script of observed.legacyFixture) {
        if (!core.loadScript(handle, script.name, script.content)) throw new Error(`Cannot load ${script.name}`);
      }
      return start(handle);
    }) as OcgCoreSync["startDuel"];
    const read = core.duelGetMessage;
    core.duelGetMessage = ((handle) => {
      const messages = read(handle);
      observed.messages.push(...messages);
      return messages;
    }) as OcgCoreSync["duelGetMessage"];
    return core;
  } };
});
beforeEach(() => { observed.messages.length = 0; observed.legacyFixture = []; });

async function runJet(entry: JetCase, auto: boolean, legacy: boolean): Promise<void> {
  const { scenario } = entry;
  const compiled = compileBoard(scenario.setup);
  observed.legacyFixture = legacy ? compiled.options.startupScripts! : [];
  const create = legacy ? createLegacyGame as unknown as typeof createEngineGame : createEngineGame;
  const game: EngineGame = await create({
    ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
    settings: { ...compiled.options.settings!, stopAtEveryWindow: !auto },
  });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase();
    session.startRecording();
    let checked = false;
    for (const [index, step] of scenario.steps.entries()) {
      session.run(step, index + 1);
      if (step.op !== "expectPrompt") continue;
      const prompt = game.view(entry.owner).prompt!;
      expect(prompt.source?.code).toBe(JET_CODE);
      expect(prompt.source?.zone).toMatchObject({ controller: entry.owner, location: entry.from === "hand" ? OcgLocation.HAND : OcgLocation.GRAVE });
      for (let seat = 0; seat < game.view(entry.owner).seats.length; seat++) {
        if (seat !== entry.owner) expect(game.view(seat).prompt).toBeNull();
      }
      expect(game.view(null).prompt).toBeNull();
      const at = observed.messages.findIndex((m) =>
        m.type === OcgMessageType.SELECT_EFFECTYN && m.player === entry.owner && m.code === JET_CODE
        || m.type === OcgMessageType.SELECT_CHAIN && m.player === entry.owner && m.selects.some((card) => card.code === JET_CODE));
      expect(at, "The raw core must ask Jet's owner").toBeGreaterThanOrEqual(0);
      const destroyedAt = observed.messages.findIndex((m) => m.type === OcgMessageType.MOVE && m.card === resolveCard(VICTIM) && m.from.location === OcgLocation.MZONE && m.to.location === OcgLocation.GRAVE);
      expect(destroyedAt, "Destruction must precede Jet's prompt").toBeGreaterThanOrEqual(0);
      expect(at).toBeGreaterThan(destroyedAt);
      const afterDestruction = observed.messages.slice(destroyedAt, at);
      expect(afterDestruction.some((m) => m.type === OcgMessageType.DAMAGE_STEP_END), "Battle destruction trigger stays in the Damage Step").toBe(false);
      checked = true;
    }
    expect(checked).toBe(true);
  } finally { game.close(); }
}

for (const legacy of [false, true]) for (const auto of [false, true]) {
  const cases = JET_CASES.filter((entry) => !legacy || entry.scenario.setup.format === "1v1");
  describeWithCores(`Jet owner prompts: ${legacy ? "legacy" : "current"}, ${auto ? "Auto" : "Always"}`, [needs.cards(), needs.standard(), needs.domain(), needs.installedMulti()], () => {
    runScenarios("multiplayer/jet-dragon", cases.map((entry) => entry.scenario), async (scenario) => {
      await runJet(cases.find((entry) => entry.scenario === scenario)!, auto, legacy);
    });
    runScenarios("multiplayer/jet-dragon-controls", [...JET_NEGATIVE_SCENARIOS, ...JET_NO_DESTRUCTION_SCENARIOS]
      .filter(s => !legacy || s.setup.format === "1v1"), async scenario => {
      const compiled = compileBoard(scenario.setup);
      observed.legacyFixture = legacy ? compiled.options.startupScripts! : [];
      const create = legacy ? createLegacyGame as unknown as typeof createEngineGame : createEngineGame;
      const game = await create({ ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
        settings: { ...compiled.options.settings!, stopAtEveryWindow: !auto } });
      try {
        const session = new Session(scenario, game);
        session.reachMainPhase(); session.startRecording();
        scenario.steps.forEach((step, index) => session.run(step, index + 1));
        expect(observed.messages.some(m => m.type === OcgMessageType.SELECT_EFFECTYN && m.code === JET_CODE
          || m.type === OcgMessageType.SELECT_CHAIN && m.selects.some(c => c.code === JET_CODE))).toBe(false);
      } finally { game.close(); }
    });
  });
}

describe("Jet scenario coverage", () => {
  it("has a unique case for each owner, location, destruction type and battle role", () => {
    expect(new Set(JET_CASES.map((entry) => entry.scenario.id)).size).toBe(JET_CASES.length);
    expect(JET_CASES.filter((entry) => entry.scenario.setup.format === "ffa3" && entry.role === "observer")).toHaveLength(24);
  });
});
