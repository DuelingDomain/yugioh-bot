import { describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, OcgPosition, OcgResponseType } from "ocgcore-wasm";
import { validateAnswer } from "../src/answer-validation.js";
import { mapPrompt, resolveAnswer } from "../src/prompts.js";
import { mergeAttackTargetPick } from "../src/attack-target-pick.js";
import type { CardDatabase } from "../src/cards.js";

const cards = { get: () => undefined, resolveLabel: () => "", system: () => undefined } as unknown as CardDatabase;

describe("existing answer formats", () => {
  it("accepts an at-least sum satisfied by required cards alone", () => {
    const pending = mapPrompt({ type: OcgMessageType.SELECT_SUM, player: 0, select_max: true, amount: 4, min: 1, max: 1,
      selects_must: [{ code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 0, amount: 4 }],
      selects: [{ code: 2, controller: 0, location: OcgLocation.MZONE, sequence: 1, amount: 2 }],
    } as never, cards, "p1");
    const answer = { selected: [] };
    expect(() => validateAnswer(pending.prompt, answer)).not.toThrow();
    expect(resolveAnswer(pending, 0, "p1", answer, cards)).toEqual({ type: OcgResponseType.SELECT_SUM, indicies: [] });
  });

  it.each([{ selected: ["card:0"] }, { selected: ["must:0", "card:0"] }])("accepts a sum with implicit or explicit required cards: %j", (answer) => {
    const pending = mapPrompt({ type: OcgMessageType.SELECT_SUM, player: 0, select_max: false, amount: 4, min: 1, max: 1,
      selects_must: [{ code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 0, amount: 2 }],
      selects: [{ code: 2, controller: 0, location: OcgLocation.MZONE, sequence: 1, amount: 2 }],
    } as never, cards, "p1");
    expect(() => validateAnswer(pending.prompt, answer)).not.toThrow();
    expect(resolveAnswer(pending, 0, "p1", answer, cards)).toEqual({ type: OcgResponseType.SELECT_SUM, indicies: [0] });
  });

  it.each([{ selected: ["card:0"] }, { selected: ["card:0"], choice: "direct:1" }])("accepts a combined target selection %j", (answer) => {
    const pending = mergeAttackTargetPick(mapPrompt({ type: OcgMessageType.SELECT_YESNO, player: 0, description: 0n } as never, cards, "p1"), {
      targets: [{ code: 1, controller: 1, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }], directSeats: [1],
    }, cards);
    expect(() => validateAnswer(pending.prompt, answer)).not.toThrow();
    expect(resolveAnswer(pending, 0, "p1", answer, cards)).toEqual({ type: OcgResponseType.SELECT_YESNO, yes: false });
  });
});
