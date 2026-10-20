import type { DuelFormat, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame, type EngineGame } from "../../src/engine.js";
import { engineDataDirectory } from "../engine-data-dir.js";
import { compileBoard, xyz, type BoardSpec } from "./board.js";
import { activate, defineScenario } from "./dsl.js";
import { domainNseatWasmBinary, nseatWasmBinary, Session } from "./session.js";

// A real engine game where seat 0 can pay a detach cost: Tornado Dragon (a Quick Effect) with two different materials.
// The engine then asks which material to detach (a card select from the Overlay location, min 1 / max 1).
export const OVERLAY = 0x80;
export const XYZ = "Tornado Dragon";
export const FIRST = "Photon Thrasher";
export const SECOND = "Alexandrite Dragon";

export async function openDetachGame(mode: "normal" | "domain", format: DuelFormat): Promise<EngineGame> {
  const seats = format === "1v1" ? 2 : 3;
  const board: BoardSpec = { mode, format };
  for (const id of (["p0", "p1", "p2"] as const).slice(0, seats)) {
    board[id] = {
      monsters: id === "p0" ? [xyz(XYZ, [FIRST, SECOND])] : [],
      spells: id === "p1" ? [{ card: "Mystical Space Typhoon", pos: "set" }, { card: "Dark Hole", pos: "set" }] : [],
      ...(mode === "domain" ? { deckMaster: "Celtic Guardian" } : {}),
    };
  }
  return createEngineGame({
    ...compileBoard(board).options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    ...(format !== "1v1" ? { multiWasmBinary: mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary() } : {}),
  } as never);
}

/** Opens the Tornado Dragon effect (a Quick Effect, offered in the first chain window) and returns the detach prompt. */
export function reachDetach(game: EngineGame, seats: number): DuelPrompt {
  for (let guard = 0; guard < 40; guard++) {
    for (let seat = 0; seat < seats; seat++) {
      const prompt = game.view(seat).prompt;
      if (!prompt) continue;
      if (seat === 0 && prompt.kind === "cards" && prompt.options.every((option) => ((option.location ?? 0) & OVERLAY) !== 0)) return prompt;
      const mine = seat === 0 ? prompt.options.find((option) => option.label.startsWith(`${XYZ}:`)) : undefined;
      if (mine) game.answer(seat, prompt.id, { choice: mine.id });
      else if (prompt.cancelable) game.answer(seat, prompt.id, { cancel: true });
      else throw new Error(`Unexpected prompt for seat ${seat}: ${prompt.kind} ${prompt.title}`);
      break;
    }
  }
  throw new Error("The detach prompt never opened");
}


/**
 * Standard 1v1: Ryzeal Duo Drive (detach 2 materials) with three different materials. Returns the game and the prompt
 * (min 2 / max 2, three overlay options) so a test can pick two of them.
 */
export async function openDuoDrive(): Promise<{ game: EngineGame; prompt: DuelPrompt }> {
  const scenario = defineScenario({
    id: "xyz-detach-two", title: "Detach two materials of Ryzeal Duo Drive", source: "Ryzeal Duo Drive (2): detach 2 materials",
    tags: ["xyz", "detach"], steps: [activate("Ryzeal Duo Drive")],
    setup: { p0: { monsters: [xyz("Ryzeal Duo Drive", ["Celtic Guardian", "Axe Raider", "Mystical Elf"])], deck: ["Ryzeal Cross", "Ryzeal Detonator", "Ryzeal Mass Driver"] } },
  });
  const game = await createEngineGame({ ...compileBoard(scenario.setup).options, seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory } as never);
  const session = new Session(scenario, game);
  session.reachMainPhase();
  session.run(scenario.steps[0]!, 1);
  const prompt = game.view(0).prompt;
  if (!prompt) throw new Error("Expected the detach prompt");
  return { game, prompt };
}
