import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, type OcgResponse } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import * as pinned from "../src/prompts.js";
import * as legacy from "../src/legacy/prompts.js";

// The wrapper does not export its byte encoder. Exercise the installed encoder and writer,
// just as ocgcore-wrapper-abi.test.ts exercises its private parsers, rather than duplicating the codec.
const wrapper = readFileSync(fileURLToPath(import.meta.resolve("ocgcore-wasm")), "utf8");
function block(start: string): string {
  const at = wrapper.indexOf(start);
  if (at < 0) throw new Error(`Wrapper no longer contains ${start}`);
  const open = wrapper.indexOf("{", at);
  let depth = 0;
  for (let index = open; index < wrapper.length; index++) {
    if (wrapper[index] === "{") depth++;
    else if (wrapper[index] === "}" && --depth === 0) return wrapper.slice(at, index + 1);
  }
  throw new Error(`Unbalanced wrapper block ${start}`);
}
const encode = new Function(`${block("H=class").replace(/^H=/, "const H=")};\n${block("function ce(e){")}\nreturn ce;`)() as
  (response: OcgResponse) => Uint8Array;
const cards: CardDatabase = {
  search: () => [], get: () => undefined, deckCard: () => undefined, all: () => [], setnames: () => new Map(),
  cardData: () => null, resolveLabel: () => "", system: () => undefined, victory: () => undefined,
  counter: () => undefined, readScript: () => null, close() {},
};

describe("exported sortCardResponse", () => {
  for (const version of [0, 1] as const) {
    it(`rejects malformed permutations for version ${version}`, () => {
      for (const order of [[1], [-1, 0], [0, 0], [0, 2], [0, 0.5], [0, NaN], [0, Infinity], Array<number>(2)]) {
        expect(() => pinned.sortCardResponse(order, version)).toThrow(pinned.EngineAnswerError);
      }
    });

    it(`keeps valid trivial orders for version ${version}`, () => {
      for (const order of [null, [], [0]]) {
        expect([...encode(pinned.sortCardResponse(order, version))]).toEqual([255]);
      }
    });

    it(`encodes a valid permutation without changing the input for version ${version}`, () => {
      const order = [2, 0, 1];
      expect([...encode(pinned.sortCardResponse(order, version))]).toEqual(version === 1 ? [1, 2, 0] : [2, 0, 1]);
      expect(order).toEqual([2, 0, 1]);
    });
  }
});

for (const [engine, prompts] of Object.entries({ pinned, legacy })) {
  for (const type of [OcgMessageType.SORT_CARD, OcgMessageType.SORT_CHAIN] as const) {
    const pending = (count: number) => prompts.mapPrompt({
      type, player: 0,
      cards: Array.from({ length: count }, (_, sequence) => ({ code: 1, controller: 0, location: OcgLocation.DECK, sequence })),
    }, cards, "sort");

    describe(`${engine} ${OcgMessageType[type]} wire response`, () => {
      for (const [order, ranks] of [
        [[1, 0], [1, 0]],
        [[2, 0, 1], [1, 2, 0]],
        [[3, 1, 0, 2], [2, 1, 3, 0]],
        [[4, 2, 0, 3, 1], [2, 4, 1, 3, 0]],
      ] as const) {
        const count = order.length;
        it(`sends ${count} destination ranks starting at byte zero`, () => {
          const response = prompts.resolveAnswer(pending(count), 0, "sort", { selected: order.map(index => `card:${index}`) }, cards);
          // The core consumes exactly count bytes; any trailing padding is ignored.
          expect([...encode(response)].slice(0, count)).toEqual(ranks);
        });
      }

      it("preserves historical bytes when replaying an unversioned command", () => {
        const selected = ["card:3", "card:1", "card:0", "card:2"];
        const response = prompts.resolveAnswer(pending(4), 0, "sort", { selected }, cards, 0);
        expect([...encode(response)].slice(0, 4)).toEqual([3, 1, 0, 2]);
        expect(selected).toEqual(["card:3", "card:1", "card:0", "card:2"]);
      });

      for (const count of [0, 1]) {
        it(`automatically keeps the order of ${count} cards using the -1 sentinel`, () => {
          expect([...encode(prompts.autoResponse(pending(count))!)]).toEqual([255]);
        });
      }

      it("preserves the keep-order sentinel when cancellation is allowed", () => {
        const prompt = pending(3);
        prompt.prompt.cancelable = true;
        expect([...encode(prompts.resolveAnswer(prompt, 0, "sort", { cancel: true }, cards))]).toEqual([255]);
      });

      it("rejects incomplete, duplicate and out-of-range orders", () => {
        for (const selected of [["card:0"], ["card:0", "card:0", "card:1"], ["card:0", "card:1", "card:3"]]) {
          expect(() => prompts.resolveAnswer(pending(3), 0, "sort", { selected }, cards)).toThrow("Invalid answer");
        }
      });
    });
  }
}
