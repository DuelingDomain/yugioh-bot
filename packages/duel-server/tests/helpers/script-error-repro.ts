import type { DuelAnswer, DuelEngineView, DuelFormat, DuelMode, DuelPrompt } from "@yugidraft/shared/duels";
import { readFileSync } from "node:fs";
import type { EngineGame } from "../../src/engine.js";
import { chooseSurrenderedAnswer } from "../../src/practice-bot.js";
import { compileBoard } from "../support/board.js";
import { engineDataDirectory as DATA } from "../engine-data-dir.js";

export function reproOptions(format: DuelFormat = "1v1", mode: DuelMode = "normal") {
  const seat = { deck: Array(20).fill("Mystical Elf"), ...(mode === "domain" ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
  const compiled = compileBoard({ format, mode, attackFirstTurn: true,
    p0: { ...seat, monsters: ["Inaba White Rabbit"] },
    p1: { ...seat, monsters: ["Steamed Sabersaurus"] },
    ...(format === "ffa4" ? { p2: seat, p3: seat } : {}),
  }, DATA);
  const fixture = readFileSync(new URL("../fixtures/card-scripts/runtime-error.lua", import.meta.url), "utf8");
  return { ...compiled.options, mode, seed: ["1", "2", "3", "4"], dataDirectory: DATA,
    // Explicit Lua chunk names survive the host's saved startup-script renaming and worker replay.
    startupScripts: [...compiled.options.startupScripts!, { name: "runtime-error-fixture.lua", content:
      `assert(load([=[${fixture}]=], 'c3743515.lua'))().register(Duel.GetFieldCard(1,LOCATION_MZONE,0))` }],
  };
}

export function waiting(game: Pick<EngineGame, "view">): { seat: number; view: DuelEngineView; prompt: DuelPrompt } {
  for (let seat = 0; seat < game.view(null).seats.length; seat++) {
    const view = game.view(seat);
    if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  throw new Error("No prompt after script error");
}

export function attackAnswer(prompt: DuelPrompt): DuelAnswer {
  const ids = prompt.options.map((entry) => entry.id);
  if (ids.includes("to_bp")) return { choice: "to_bp" };
  const attack = ids.find((id) => id.startsWith("attack:"));
  if (attack) return { choice: attack };
  const opponent = prompt.options.find((entry) => entry.id === "opponent:1");
  if (opponent) return { choice: opponent.id };
  if (ids.includes("direct")) return { choice: "direct" };
  return chooseSurrenderedAnswer(prompt);
}

export function reachScriptError(game: EngineGame) {
  for (let step = 0; step < 80; step++) {
    if (game.view(null).events.some((event) => event.kind === "script-error")) return;
    const { seat, prompt } = waiting(game);
    game.answer(seat, prompt.id, attackAnswer(prompt));
  }
  throw new Error("Synthetic card condition did not fail");
}
