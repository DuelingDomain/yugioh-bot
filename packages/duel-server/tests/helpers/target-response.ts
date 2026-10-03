import Database from "better-sqlite3";
import type { DuelAnswer, DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { OcgLocation } from "ocgcore-wasm";
import { createEngineGame, type EngineGame } from "../../src/engine.js";
import { choosePracticeBotAnswer } from "../../src/practice-bot.js";
import { engineDataDirectory } from "../engine-data-dir.js";

export const MST = 5318639;
export const MIRROR_FORCE = 44095762;
export const TORRENTIAL = 53582587;
export const firstTarget = { controller: 1, location: OcgLocation.SZONE, sequence: 0 };
export const secondTarget = { controller: 0, location: OcgLocation.SZONE, sequence: 0 };

function waiting(game: EngineGame): { seat: number; view: DuelEngineView; prompt: DuelPrompt } {
  for (const seat of [0, 1]) {
    const view = game.view(seat);
    if (view.prompt) return { seat, view, prompt: view.prompt };
  }
  throw new Error("No prompt before the targeting response window");
}

function pass(prompt: DuelPrompt): DuelAnswer {
  if (prompt.cancelable) return { cancel: true };
  if (prompt.options.some((option) => option.id === "no")) return { choice: "no" };
  if (prompt.options.some((option) => option.id === "to_ep")) return { choice: "to_ep" };
  return choosePracticeBotAnswer(prompt);
}

/** Real cards/scripts, stock core, deterministic hands; pause BEFORE the responder passes. */
export async function targetingResponseGame(laterLink = false): Promise<EngineGame> {
  const db = new Database(`${engineDataDirectory}/cards.cdb`, { readonly: true });
  let fillers: number[];
  try {
    fillers = (db.prepare("select id from datas where type = 17 and alias = 0 and (ot & 3) != 0 order by id limit 40")
      .all() as { id: number }[]).map((row) => row.id);
  } finally {
    db.close();
  }
  const deck = (head: number[]) => ({ main: [...head, ...fillers.slice(0, 40 - head.length)], extra: [], side: [] });
  const game = await createEngineGame({
    mode: "normal", decks: [deck([MST, MST]), deck([MIRROR_FORCE, TORRENTIAL, MST])],
    seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    settings: { ...defaultDuelSettings("normal"), validateDeck: false, shuffleDeck: false, stopAtEveryWindow: true },
  });
  let activated = false;
  let chained = false;
  try {
    for (let step = 0; step < 100; step++) {
      const { seat, view, prompt } = waiting(game);
      if (view.turn > 3) throw new Error("Missed MST response window on turn 3");
      if (seat === 1 && view.chain.length === 1 && prompt.context?.type === "chain") {
        if (!laterLink) return game;
        const response = prompt.options.find((option) => option.card?.code === MST);
        if (!response) throw new Error("Set MST was not offered as a chain response");
        chained = true;
        game.answer(seat, prompt.id, { choice: response.id });
        continue;
      }
      if (laterLink && chained && seat === 0 && view.chain.length === 2 && prompt.context?.type === "chain") return game;
      let answer: DuelAnswer | undefined;
      if (seat === 1 && view.turn === 2) {
        const set = prompt.options.find((option) => option.id.startsWith("sset:") &&
          [MIRROR_FORCE, TORRENTIAL, MST].includes(option.card?.code ?? 0));
        if (set) answer = { choice: set.id };
      }
      if (seat === 0 && view.turn === 3 && !activated) {
        const activate = prompt.options.find((option) => option.id.startsWith("activate:") && option.card?.code === MST);
        if (activate) { activated = true; answer = { choice: activate.id }; }
      }
      if (activated && prompt.kind === "cards") {
        const target = chained ? secondTarget : firstTarget;
        const pick = prompt.options.find((option) => option.controller === target.controller &&
          option.location === target.location && option.sequence === target.sequence);
        if (!pick) throw new Error(`Expected MST target was not selectable: ${JSON.stringify(prompt)}`);
        answer = { selected: [pick.id] };
      }
      game.answer(seat, prompt.id, answer ?? pass(prompt));
    }
    throw new Error("MST response scenario exceeded its step limit");
  } catch (error) {
    game.close();
    throw error;
  }
}
