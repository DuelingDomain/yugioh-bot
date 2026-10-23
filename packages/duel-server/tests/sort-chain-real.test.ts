import { expect, it } from "vitest";
import { OcgLocation, OcgMessageType, type OcgMessage } from "ocgcore-wasm";
import type { DuelAnswer } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { compileBoard } from "./support/board.js";
import { describeWithCores, needs } from "./support/cores.js";

const MAGICIAN = 46986414, SKULL_SERVANT = 32274490;
const SERVANT = 16762927, TOLL = 82003859, HIKE = 44716890;
const COSTS = [SERVANT, TOLL, HIKE];
// The cores use SELECT_CHAIN for monster triggers and SORT_CHAIN for multiple attack costs.
// Three costs are needed: every two-card permutation is self-inverse.
const ORDER = [2, 0, 1];

describeWithCores("SORT_CHAIN order on real engines", [needs.cards(DATA), needs.scripts(DATA), needs.standard(DATA)], () => {
  it.each([
    ["legacy", createLegacyEngineGame], ["pinned", createEngineGame],
  ] as const)("%s pays simultaneous attack costs in the chosen order", async (engine, create) => {
    const { options } = compileBoard({ skipOpeningDraw: true, attackFirstTurn: true, deckSize: 3,
      p0: { hand: [MAGICIAN], monsters: [MAGICIAN], deck: Array(3).fill(SKULL_SERVANT) },
      p1: { spells: COSTS },
    });
    const messages: OcgMessage[] = [];
    const game = await create({ ...options, dataDirectory: DATA, seed: ["1", "2", "3", "4"],
      firstTurnDraw: false, scriptErrorMode: "strict", onCoreMessage: message => messages.push(message) });
    try {
      let expected: number[] | undefined;
      for (let step = 0; step < 50; step++) {
        const events = game.view(null, { fullLog: true }).events;
        const paid = events.flatMap(event => {
          if (event.kind === "damage" && event.cause === "cost") return [TOLL];
          if (event.kind === "move" && event.seat === 0 && event.zone?.location === OcgLocation.GRAVE) {
            if (event.from?.location === OcgLocation.DECK) return [SERVANT];
            if (event.from?.location === OcgLocation.HAND) return [HIKE];
          }
          return [];
        });
        if (paid.length === 3) {
          expect(expected).toHaveLength(3);
          expect(paid).toEqual(expected);
          if (engine === "pinned") expect(messages.filter(message => message.type === OcgMessageType.SORT_CHAIN)).toHaveLength(1);
          const seat = game.view(0).seats[0]!;
          expect(seat.lp).toBe(7500);
          expect(seat.hand).toEqual([]);
          expect(seat.graveyard.map(card => card.code).sort()).toEqual([MAGICIAN, SKULL_SERVANT].sort());
          return;
        }
        const view = [game.view(0), game.view(1)].find(view => view.prompt);
        const prompt = view?.prompt;
        if (!view || !prompt || view.turn > 1) throw new Error(`Missed attack cost ordering: ${JSON.stringify({ paid, expected, events })}`);
        let answer: DuelAnswer | undefined;
        const attack = prompt.options.find(option => option.id.startsWith("attack:"));
        if (prompt.options.some(option => option.id === "to_bp")) answer = { choice: "to_bp" };
        else if (attack) answer = { choice: attack.id };
        else if (prompt.kind === "order") {
          expect(expected).toBeUndefined(); // A rejected response must not silently retry.
          expect(prompt.title).toBe("Sort the chain");
          expect(prompt.seat).toBe(0);
          expect(prompt.options.map(option => option.card?.code).sort()).toEqual([...COSTS].sort());
          expect(prompt.options.map(option => option.controller)).toEqual([1, 1, 1]);
          expected = ORDER.map(index => prompt.options[index]!.card!.code);
          answer = { selected: ORDER.map(index => prompt.options[index]!.id) };
        }
        game.answer(prompt.seat, prompt.id, answer ?? chooseSurrenderedAnswer(prompt));
      }
      throw new Error("Attack cost regression exceeded its step limit");
    } finally { game.close(); }
  }, 30_000);
});
