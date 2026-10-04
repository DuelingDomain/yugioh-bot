import { describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, OcgResponseType } from "ocgcore-wasm";
import { DUEL_SEAT_LEFT_ERROR_CODE, type DuelAnswer, type DuelEngineView, type DuelPrompt } from "@yugidraft/shared/duels";
import type { CardDatabase } from "../src/cards.js";
import { HINT_PLACE_SEAT, autoResponse, directAttackSeat, isOpponentPick, mapPrompt, nextLivingOpponentSeat, opponentPickSeat, placeSeatHint, resolveAnswer } from "../src/prompts.js";
import { botTableOf, choosePracticeBotAnswer, chooseSeatOption, chooseSurrenderedAnswer, isSeatPick } from "../src/practice-bot.js";
import { chooseScripted, defaultAnswer, pickOpponent } from "../src/scripted-bot.js";
import { planAnswer } from "./fuzz/answers.js";
import { Rng } from "./fuzz/rng.js";

const cards = {
  get: (code: number) => ({ code, name: `Card ${code}`, description: "", type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "warrior" }),
  search: () => [],
  cardData: () => null,
  resolveLabel: () => "",
  system: () => undefined,
} as unknown as CardDatabase;

const pickMessage = (player: number, seats: number[]) =>
  ({ type: OcgMessageType.SELECT_OPTION, player, options: seats.map((seat) => 0xfffe0000 + seat).map(BigInt) }) as never;

const placeMessage = (player: number, mask: number, type = OcgMessageType.SELECT_PLACE) => ({ type, player, count: 1, field_mask: mask }) as never;

const hint = (hint_type: number, hintValue: bigint) => ({ type: OcgMessageType.HINT, hint_type, player: 0, hint: hintValue }) as never;

function viewOf(lp: number[], gone: number[] = []): DuelEngineView {
  return { seats: lp.map((value, seat) => ({ seat, lp: value, eliminated: gone.includes(seat) })) } as unknown as DuelEngineView;
}

describe("opponent pick decode", () => {
  it("reads 0xFFFE0000 | duelist and nothing else", () => {
    expect(opponentPickSeat(0xfffe0002n)).toBe(2);
    expect(opponentPickSeat(0xfffe0000)).toBe(0);
    expect(opponentPickSeat(0xfffe00ffn)).toBeNull();
    expect(opponentPickSeat(0xffff0001n)).toBeNull();
    expect(opponentPickSeat(0xfffdffffn)).toBeNull();
    expect(opponentPickSeat(1234)).toBeNull();
  });

  it("keeps the direct-attack decode apart", () => {
    expect(directAttackSeat(0xfffe0001n)).toBeNull();
    expect(directAttackSeat(0xffff0001n)).toBe(1);
  });

  it("isOpponentPick needs every entry to be a pick and at least one entry", () => {
    expect(isOpponentPick([0xfffe0001n, 0xfffe0003n])).toBe(true);
    expect(isOpponentPick([0xfffe0001n, 0xffff0003n])).toBe(false);
    expect(isOpponentPick([])).toBe(false);
  });
});

describe("opponent pick prompt", () => {
  it("gives a distinct error when the answer names a seat removed from the pick", () => {
    const pending = mapPrompt(pickMessage(0, [1, 2]), cards, "p1", undefined, { livingSeats: [0, 2] });
    expect(() => resolveAnswer(pending, 0, "p1", { choice: "opt:0" }, cards)).toThrowError(
      expect.objectContaining({ code: DUEL_SEAT_LEFT_ERROR_CODE, message: "That player has left. Pick again." }),
    );
  });

  it("accepts a leaving seat that is still in the prompt", () => {
    const pending = mapPrompt(pickMessage(0, [1, 2]), cards, "p1");
    const view = viewOf([8000, 8000, 8000]);
    view.seats[1]!.pendingElimination = true;
    expect(botTableOf(view).living).toEqual([0, 2]);
    expect(pending.prompt.options.map((option) => option.id)).toContain("opt:0");
    expect(resolveAnswer(pending, 0, "p1", { choice: "opt:0" }, cards)).toEqual({
      type: OcgResponseType.SELECT_OPTION, index: 0,
    });
  });

  it("still accepts a living seat after a different seat leaves", () => {
    const pending = mapPrompt(pickMessage(0, [1, 2]), cards, "p1");
    expect(resolveAnswer(pending, 0, "p1", { choice: "opt:1" }, cards)).toEqual({
      type: OcgResponseType.SELECT_OPTION, index: 1,
    });
  });

  it("keeps the old error for invalid choices outside an opponent pick", () => {
    const pending = mapPrompt({ type: OcgMessageType.SELECT_OPTION, player: 0, options: [30n, 31n] } as never, cards, "p1");
    expect(() => resolveAnswer(pending, 0, "p1", { choice: "opt:99" }, cards)).toThrowError("Invalid answer");
  });

  it("keeps wrong-seat and stale-prompt checks before the seat-left check", () => {
    const pending = mapPrompt(pickMessage(0, [1, 2]), cards, "p1", undefined, { livingSeats: [0, 2] });
    expect(() => resolveAnswer(pending, 1, "p1", { choice: "opt:0" }, cards)).toThrowError("Wrong seat");
    expect(() => resolveAnswer(pending, 0, "old", { choice: "opt:0" }, cards)).toThrowError("Stale prompt");
  });

  it.each(["opt:99", "opt:-1", "opt:00", "opt:0junk", ""])("keeps the old error for invalid opponent choice %j", (choice) => {
    const pending = mapPrompt(pickMessage(0, [1, 2]), cards, "p1", undefined, { livingSeats: [0, 2] });
    expect(() => resolveAnswer(pending, 0, "p1", { choice }, cards)).toThrowError("Invalid answer");
    try { resolveAnswer(pending, 0, "p1", { choice }, cards); } catch (error) {
      expect(error).not.toHaveProperty("code", "seat_left");
    }
  });

  it.each([{ choice: ["opt:99"] }, { choice: ["opt:0"] }, { choice: 1 }, { choice: {} }])("keeps the old error for non-string opponent choice $choice", ({ choice }) => {
    const pending = mapPrompt(pickMessage(0, [1, 2]), cards, "p1", undefined, { livingSeats: [0, 2] });
    expect(() => resolveAnswer(pending, 0, "p1", { choice } as unknown as DuelAnswer, cards)).toThrowError("Invalid answer");
  });

  it("maps to a choice with the opponent context and seat options", () => {
    const { prompt } = mapPrompt(pickMessage(0, [1, 2, 3]), cards, "p1");
    const choice = prompt as DuelPrompt;
    expect(choice.kind).toBe("choice");
    expect(choice.title).toBe("Choose an opponent");
    expect(choice.context).toEqual({ type: "opponent" });
    expect(choice.options.map((option) => [option.id, option.controller, option.values])).toEqual([
      ["opt:0", 1, [0]],
      ["opt:1", 2, [1]],
      ["opt:2", 3, [2]],
    ]);
    expect(choice.options.every((option) => !/attack/i.test(option.label))).toBe(true);
  });

  it("uses the select hint as the title", () => {
    expect(mapPrompt(pickMessage(0, [1, 2]), cards, "p1", "Choose the opponent that draws").prompt.title).toBe("Choose the opponent that draws");
  });

  it("does not mark a direct-attack pick as an opponent pick", () => {
    const { prompt } = mapPrompt({ type: OcgMessageType.SELECT_OPTION, player: 0, options: [0xffff0001n, 0xffff0002n] } as never, cards, "p1");
    expect(prompt.context).toBeUndefined();
    expect(prompt.options[0]!.label).toBe("Attack Player 2 directly");
  });

  it("leaves out seats that are not living but keeps the core's option index", () => {
    const { prompt, message } = mapPrompt(pickMessage(0, [1, 2, 3]), cards, "p1", undefined, { livingSeats: [0, 2, 3] });
    expect(prompt.options.map((option) => option.controller)).toEqual([2, 3]);
    expect(resolveAnswer({ id: "p1", seat: 0, prompt, message }, 0, "p1", { choice: "opt:1" }, cards)).toEqual({ type: OcgResponseType.SELECT_OPTION, index: 1 });
  });

  it.each([
    { format: "ffa3", offered: [1, 2], living: [0] },
    { format: "ffa4", offered: [1, 2, 3], living: [0] },
    { format: "tag", offered: [1, 3], living: [0, 2] },
  ])("accepts every fallback option and the bot answer when all offered seats have left in $format", ({ offered, living }) => {
    const pending = mapPrompt(pickMessage(0, offered), cards, "p1", undefined, { livingSeats: living });
    expect(pending.prompt.options.map((option) => option.controller)).toEqual(offered);
    for (const [index, option] of pending.prompt.options.entries()) {
      expect(resolveAnswer(pending, 0, "p1", { choice: option.id }, cards)).toEqual({
        type: OcgResponseType.SELECT_OPTION, index,
      });
    }
    const answer = choosePracticeBotAnswer(pending.prompt, { table: { living } });
    expect(resolveAnswer(pending, 0, "p1", answer, cards)).toEqual({
      type: OcgResponseType.SELECT_OPTION, index: 0,
    });
  });

  it("is answered by the core index even for one remaining seat", () => {
    const mapped = mapPrompt(pickMessage(0, [1, 2]), cards, "p1", undefined, { livingSeats: [0, 2] });
    expect(mapped.prompt.options).toHaveLength(1);
    expect(autoResponse(mapped)).toBeNull();
  });

  it("is answered automatically when the core offers one seat", () => {
    const mapped = mapPrompt(pickMessage(0, [3]), cards, "p1");
    expect(autoResponse(mapped)).toEqual({ type: OcgResponseType.SELECT_OPTION, index: 0 });
  });
});

describe("place seat hint", () => {
  it("reads only HINT type 0xF0", () => {
    expect(HINT_PLACE_SEAT).toBe(0xf0);
    expect(placeSeatHint(hint(0xf0, 2n))).toBe(2);
    expect(placeSeatHint(hint(0xf0, 0n))).toBe(0);
    expect(placeSeatHint(hint(0xf0, 0xffn))).toBeNull();
    expect(placeSeatHint(hint(3, 2n))).toBeNull();
    expect(placeSeatHint({ type: OcgMessageType.SELECT_PLACE } as never)).toBeNull();
  });

  const mask = ~(0b11 << 16) >>> 0; // upper half: MZONE 0 and 1 free

  it("replaces the placeOpponent guess for the high half of the mask", () => {
    const { prompt } = mapPrompt(placeMessage(2, mask), cards, "p1", undefined, { placeOpponent: 0, placeSeat: 3 });
    const upper = prompt.options.filter((option) => option.controller !== 2);
    expect(upper.map((option) => [option.controller, option.location, option.sequence])).toEqual([
      [3, OcgLocation.MZONE, 0],
      [3, OcgLocation.MZONE, 1],
    ]);
  });

  it("works for SELECT_DISFIELD as well", () => {
    const { prompt } = mapPrompt(placeMessage(0, mask, OcgMessageType.SELECT_DISFIELD), cards, "p1", undefined, { placeOpponent: 1, placeSeat: 2 });
    expect(new Set(prompt.options.map((option) => option.controller))).toEqual(new Set([2]));
  });

  it("falls back to placeOpponent, then to player ^ 1, without the hint", () => {
    const withGuess = mapPrompt(placeMessage(2, mask), cards, "p1", undefined, { placeOpponent: 1 });
    expect(withGuess.prompt.options.every((option) => option.controller === 1)).toBe(true);
    const plain = mapPrompt(placeMessage(0, mask), cards, "p1");
    expect(plain.prompt.options.every((option) => option.controller === 1)).toBe(true);
  });
});

describe("place guess for the high half of a mask (nextLivingOpponentSeat)", () => {
  it("FFA: the next living seat in turn order, skipping eliminated seats", () => {
    expect(nextLivingOpponentSeat("ffa4", 4, 0, new Set())).toBe(1);
    expect(nextLivingOpponentSeat("ffa4", 4, 0, new Set([1]))).toBe(2);
    expect(nextLivingOpponentSeat("ffa4", 4, 3, new Set([0, 1]))).toBe(2);
  });

  it("1v1: the other seat", () => {
    expect(nextLivingOpponentSeat("1v1", 2, 0, new Set())).toBe(1);
    expect(nextLivingOpponentSeat("1v1", 2, 1, new Set())).toBe(0);
  });

  it("Tag: never the partner (seats 0 and 2, 1 and 3 are partners)", () => {
    expect(nextLivingOpponentSeat("tag", 4, 0, new Set())).toBe(1);
    expect(nextLivingOpponentSeat("tag", 4, 1, new Set())).toBe(2);
    expect(nextLivingOpponentSeat("tag", 4, 2, new Set([3]))).toBe(1);
    expect(nextLivingOpponentSeat("tag", 4, 0, new Set([1]))).toBe(3);
  });

  it("with no opponent alive it still names an opposing seat, never a partner or the seat itself", () => {
    // Opposing team (1 and 3) is out: the guess stays on that side.
    expect(nextLivingOpponentSeat("tag", 4, 0, new Set([1, 3]))).toBe(1);
    expect(nextLivingOpponentSeat("tag", 4, 2, new Set([1, 3]))).toBe(3);
    // FFA: everybody else is out.
    expect(nextLivingOpponentSeat("ffa3", 3, 0, new Set([1, 2]))).toBe(1);
  });

  it("the mask prompt uses that seat for the high half", () => {
    const mask = ~(0b1 << 16) >>> 0;
    const seat = nextLivingOpponentSeat("tag", 4, 0, new Set([1]));
    const { prompt } = mapPrompt(placeMessage(0, mask), cards, "p1", undefined, { placeOpponent: seat });
    expect(prompt.options.filter((option) => option.controller !== 0).every((option) => option.controller === 3)).toBe(true);
  });

  it("the HINT_PLACE_SEAT of the core wins in Tag too", () => {
    const mask = ~(0b1 << 16) >>> 0;
    const { prompt } = mapPrompt(placeMessage(0, mask), cards, "p1", undefined, { placeOpponent: 1, placeSeat: 3 });
    expect(prompt.options.filter((option) => option.controller !== 0).every((option) => option.controller === 3)).toBe(true);
  });
});

describe("bots", () => {
  const pick = () => mapPrompt(pickMessage(0, [1, 2, 3]), cards, "p1").prompt as DuelPrompt;

  it("the practice bot picks the first living opponent without LP", () => {
    expect(choosePracticeBotAnswer(pick())).toEqual({ choice: "opt:0" });
    expect(choosePracticeBotAnswer(pick(), { table: { living: [0, 2, 3] } })).toEqual({ choice: "opt:1" });
  });

  it("the practice bot prefers the living opponent with the lowest LP", () => {
    const table = botTableOf(viewOf([8000, 6000, 2500, 4000]));
    expect(choosePracticeBotAnswer(pick(), { table })).toEqual({ choice: "opt:1" });
    const dead = botTableOf(viewOf([8000, 6000, 0, 4000], [2]));
    expect(choosePracticeBotAnswer(pick(), { table: dead })).toEqual({ choice: "opt:2" });
  });

  it("never answers an eliminated seat, but still answers when only dead seats are listed", () => {
    const prompt = pick();
    const table = { living: [0], lp: { 1: 10, 2: 20, 3: 30 } };
    expect(chooseSeatOption(prompt, table)?.controller).toBe(1);
    expect(chooseSurrenderedAnswer(prompt, { table: { living: [0, 3] } })).toEqual({ choice: "opt:2" });
  });

  it("an eliminated or leaving seat is not living in the table of a view", () => {
    const view = { seats: [{ seat: 0, lp: 1, pendingElimination: true }, { seat: 1, lp: 2 }, { seat: 2, lp: 0, eliminated: true }] } as unknown as DuelEngineView;
    expect(botTableOf(view)).toEqual({ living: [1], lp: { 0: 1, 1: 2, 2: 0 } });
    expect(botTableOf({} as DuelEngineView)).toEqual({});
  });

  it("takes the direct-attack pick as a seat pick too", () => {
    const { prompt } = mapPrompt({ type: OcgMessageType.SELECT_OPTION, player: 0, options: [0xffff0001n, 0xffff0002n] } as never, cards, "p1");
    expect(isSeatPick(prompt as DuelPrompt)).toBe(true);
    expect(choosePracticeBotAnswer(prompt as DuelPrompt, { table: { living: [0, 2] } })).toEqual({ choice: "opt:1" });
  });

  it("answers a place prompt with zones of the hinted seat only", () => {
    const mask = (0xffff | (~(0b101 << 16) & 0xffff0000)) >>> 0; // own zones blocked, upper half: MZONE 0 and 2 free
    const { prompt } = mapPrompt(placeMessage(0, mask), cards, "p1", undefined, { placeSeat: 3, placeOpponent: 1 });
    const answer = choosePracticeBotAnswer(prompt as DuelPrompt, { table: { living: [0, 3] } });
    const chosen = prompt.options.filter((option) => answer.selected?.includes(option.id));
    expect(chosen).toHaveLength(1);
    expect(chosen[0]!.controller).toBe(3);
  });

  it("does not answer a zone of an eliminated seat when a living seat has zones", () => {
    const prompt: DuelPrompt = {
      id: "p1", seat: 0, kind: "places", title: "Select a zone", min: 1, max: 1,
      options: [
        { id: "place:0", label: "z", controller: 2, location: OcgLocation.MZONE, sequence: 0 },
        { id: "place:1", label: "z", controller: 3, location: OcgLocation.MZONE, sequence: 0 },
      ],
    };
    expect(choosePracticeBotAnswer(prompt, { table: { living: [0, 3] } })).toEqual({ selected: ["place:1"] });
  });

  it("the scripted bot default picks a living opponent, lowest LP first", () => {
    const view = viewOf([8000, 5000, 1000, 3000], [2]);
    expect(chooseScripted([], pick(), view, { seat: 0 })).toMatchObject({ answer: { choice: "opt:2" }, rule: -1 });
    expect(defaultAnswer(pick(), { table: { living: [0, 1, 2, 3], lp: { 1: 9, 2: 3, 3: 6 } } }).answer).toEqual({ choice: "opt:1" });
  });

  it("pickOpponent matches the new opponent pick and skips an eliminated seat", () => {
    const view = viewOf([8000, 5000, 1000, 3000]);
    expect(chooseScripted([pickOpponent(3)], pick(), view, { seat: 0 }).answer).toEqual({ choice: "opt:2" });
    const gone = viewOf([8000, 5000, 1000, 0], [3]);
    expect(chooseScripted([pickOpponent(3)], pick(), gone, { seat: 0 })).toMatchObject({ rule: -1, answer: { choice: "opt:1" } });
  });
});

describe("fuzz-n answers", () => {
  const ctx = (living?: number[]) => ({ rng: new Rng(7), turnActions: 0, toggleSteps: 0, searchCards: () => [], living });

  it("picks only a living seat in an opponent pick", () => {
    const prompt = mapPrompt(pickMessage(0, [1, 2, 3]), cards, "p1").prompt as DuelPrompt;
    for (let run = 0; run < 20; run++) {
      const plan = planAnswer(prompt, { ...ctx([0, 2]), rng: new Rng(run) });
      expect(plan.exact).toBe(true);
      expect(plan.candidates).toEqual([{ choice: "opt:1" }]);
    }
  });

  it("picks only zones of a living seat in a place prompt", () => {
    const prompt: DuelPrompt = {
      id: "p1", seat: 0, kind: "places", title: "z", min: 1, max: 1,
      options: [
        { id: "place:0", label: "z", controller: 1, location: OcgLocation.MZONE, sequence: 0 },
        { id: "place:1", label: "z", controller: 2, location: OcgLocation.MZONE, sequence: 0 },
      ],
    };
    for (let run = 0; run < 10; run++) {
      expect(planAnswer(prompt, { ...ctx([0, 2]), rng: new Rng(run) }).candidates).toEqual([{ selected: ["place:1"] }]);
    }
  });
});
