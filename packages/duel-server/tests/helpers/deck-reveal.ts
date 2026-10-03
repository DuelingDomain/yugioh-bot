import assert from "node:assert/strict";
import { defaultDuelSettings, type DuelAnswer, type DuelPrompt } from "@yugidraft/shared/duels";
import { OcgLocation, OcgPosition } from "ocgcore-wasm";
import { createEngineGame } from "../../src/engine.js";
import { choosePracticeBotAnswer } from "../../src/practice-bot.js";
import { engineDataDirectory } from "../engine-data-dir.js";

const ROTA = 32807846, KOJIKOCY = 1184620, OGAMA = 645794, TEMPEST = 2572890;
const FILLER = 32274490; // Skull Servant, as in deck-reveal.test.ts.

/** The same unshuffled stock-core duels as deck-reveal.test.ts, stopped after resolution. */
export async function deckRevealViews(kind: "search" | "set") {
  const first = kind === "search" ? ROTA : OGAMA;
  const target = kind === "search" ? KOJIKOCY : TEMPEST;
  const location = kind === "search" ? OcgLocation.HAND : OcgLocation.SZONE;
  const game = await createEngineGame({
    mode: "normal", seed: ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    settings: { ...defaultDuelSettings("normal"), startingHand: 5, shuffleDeck: false, validateDeck: false, banlist: "none" },
    decks: [
      { main: [first, ...Array<number>(38).fill(FILLER), target], extra: [], side: [] },
      { main: Array<number>(40).fill(FILLER), extra: [], side: [] },
    ],
  });
  const option = (prompt: DuelPrompt, prefix: string) =>
    prompt.options.find((entry) => entry.id.startsWith(prefix) && entry.card?.code === first)?.id;
  try {
    for (let step = 0; step < 100; step++) {
      const owner = game.view(0);
      const cards = kind === "search" ? owner.seats[0].hand : owner.seats[0].spells;
      const card = cards.find((entry) => entry?.code === target);
      if (card && owner.chain.length === 0) {
        const event = [...owner.events].reverse().find((entry) => entry.card?.code === target && entry.zone?.location === location);
        assert(event, "Resolved deck effect must have an owner event");
        if (kind === "set") assert(card.position! & OcgPosition.FACEDOWN, "Ogama must Set Tempest face-down");
        return { owner, opponent: game.view(1), spectator: game.view(null), card, event };
      }
      const seat = owner.prompt ? 0 : 1;
      const prompt = game.view(seat).prompt;
      assert(prompt, "Deck reveal fixture lost its waiting prompt");
      let answer: DuelAnswer | undefined;
      if (seat === 0) {
        const action = kind === "search" ? option(prompt, "activate:")
          : option(prompt, "summon:") ?? option(prompt, "chain:");
        if (action) answer = { choice: action };
        else if (kind === "set" && prompt.options.some((entry) => entry.id === "yes")) answer = { choice: "yes" };
      }
      const ids = prompt.options.map((entry) => entry.id);
      game.answer(seat, prompt.id, answer ?? (ids.includes("no") ? { choice: "no" }
        : ids.includes("to_ep") ? { choice: "to_ep" } : choosePracticeBotAnswer(prompt)));
    }
    throw new Error("Deck reveal effect never resolved");
  } finally { game.close(); }
}
