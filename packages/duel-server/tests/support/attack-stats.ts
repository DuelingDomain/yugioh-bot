import type { DuelFormat } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../../src/engine.js";
import { createLegacyEngineGame } from "../../src/legacy/index.js";
import { engineDataDirectory } from "../engine-data-dir.js";
import { compileBoard } from "./board.js";
import { choose, defineScenario, select, specialSummon, zone } from "./dsl.js";
import { Session } from "./session.js";

/** A legal summon, paused where Solemn Judgment can negate it and the core still reports printed ? stats. */
export async function oddEyesAtSummonWindow(format: DuelFormat = "1v1", legacy = false): Promise<EngineGame> {
  const scenario = defineScenario({
    id: "odd-eyes-attack", title: "Odd-Eyes summon stats", source: "ATK overflow regression",
    tags: ["summon", "attack"], setup: { format, skipOpeningDraw: true, attackFirstTurn: true, p0: {
      hand: [16306932], monsters: ["Blue-Eyes Ultimate Dragon", "Azure-Eyes Silver Dragon", "Number 46: Dragluon"],
    }, p1: { monsters: ["Mystical Elf"], spells: [{ card: "Solemn Judgment", pos: "set" }] } }, steps: [],
  });
  const game = await (legacy ? createLegacyEngineGame : createEngineGame)({
    ...compileBoard(scenario.setup, engineDataDirectory).options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
  });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase();
    const steps = [specialSummon(16306932), select("Blue-Eyes Ultimate Dragon"), select("Azure-Eyes Silver Dragon"),
      select("Number 46: Dragluon"), zone("p0", "m0"), choose("pos:1")];
    steps.forEach((step, index) => session.run(step, index + 1));
    return game;
  } catch (error) { game.close(); throw error; }
}
