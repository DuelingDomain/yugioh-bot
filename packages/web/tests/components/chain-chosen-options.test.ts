import { describe, expect, it } from "vitest";
import type { DuelChainLink, DuelEvent } from "@yugidraft/shared/duels";

import { cardTextLines, chainFullText, markChosenLines } from "@/components/duel/chain-effect-text";
import { chainLinkLabel, chainStateKey, deriveChainState } from "@/components/duel/chain-state";

const PRAYERS = "Apply 1 of these effects.\r\n● Add 1 \"Mitsurugi\" monster from your Deck to your hand.\r\n● Take 800 damage.\r\nOnce per turn.";
const lines = () => cardTextLines(PRAYERS);
const chosenTexts = (marked: ReturnType<typeof markChosenLines>) => marked.filter((line) => line.chosen).map((line) => line.text);

describe("markChosenLines", () => {
  it("marks the bullet whose text equals the choice, whatever the final period or the quote style", () => {
    expect(chosenTexts(markChosenLines(lines(), [{ text: "Take 800 damage" }]))).toEqual(["Take 800 damage."]);
    expect(chosenTexts(markChosenLines(lines(), [{ text: "Add 1 “Mitsurugi” monster from your Deck to your hand" }]))).toEqual(["Add 1 \"Mitsurugi\" monster from your Deck to your hand."]);
  });

  it("matches by text and ignores the index, so a wrong index cannot move the mark", () => {
    expect(chosenTexts(markChosenLines(lines(), [{ index: 0, text: "Take 800 damage" }]))).toEqual(["Take 800 damage."]);
  });

  it("does not guess by the prompt index: the engine hides options, so the index is no bullet position", () => {
    expect(chosenTexts(markChosenLines(lines(), [{ index: 1, text: "Option 2" }]))).toEqual([]);
    expect(chosenTexts(markChosenLines(lines(), [{ index: 0, text: "Option 1" }]))).toEqual([]);
  });

  it("marks nothing when neither the text nor the index fits", () => {
    expect(chosenTexts(markChosenLines(lines(), [{ text: "Draw 3 cards" }]))).toEqual([]);
    expect(chosenTexts(markChosenLines(lines(), [{ index: 5, text: "Draw 3 cards" }]))).toEqual([]);
    expect(chosenTexts(markChosenLines(lines(), [{ index: 2, text: "Draw 3 cards" }]))).toEqual([]);
  });

  it("marks every chosen bullet, once each", () => {
    const both = markChosenLines(lines(), [{ text: "Take 800 damage" }, { index: 0, text: "Add 1 \"Mitsurugi\" monster from your Deck to your hand" }, { text: "Take 800 damage" }]);
    expect(chosenTexts(both)).toEqual(["Add 1 \"Mitsurugi\" monster from your Deck to your hand.", "Take 800 damage."]);
  });

  it("never marks a plain text line, and a short choice does not light a bullet by containment", () => {
    expect(chosenTexts(markChosenLines(lines(), [{ text: "Once per turn" }]))).toEqual([]);
    expect(chosenTexts(markChosenLines(lines(), [{ text: "Take" }]))).toEqual([]);
  });

  it("leaves the lines alone without a choice", () => {
    expect(chosenTexts(markChosenLines(lines(), undefined))).toEqual([]);
    expect(chosenTexts(markChosenLines(lines(), []))).toEqual([]);
  });
});

describe("chainFullText with a choice", () => {
  it("marks the chosen bullet and keeps the lead", () => {
    const full = chainFullText({ name: "Mitsurugi Prayers", description: "Apply 1 of these effects", text: PRAYERS, cardType: 0x10002, chosenOptions: [{ index: 1, text: "Take 800 damage" }] });
    expect(full?.lines.filter((line) => line.chosen).map((line) => line.text)).toEqual(["Take 800 damage."]);
  });
});

const ev = (extra: Partial<DuelEvent>): DuelEvent => ({ id: 1, kind: "activate", text: "a", seat: 0, chainIndex: 1, ...extra });

describe("chain state with chosen options", () => {
  const card = { code: 45171524, name: "Mitsurugi Prayers", description: PRAYERS, type: 0x10002, attack: 0, defense: 0, level: 0, attribute: 0, race: "" };

  it("takes the choice from the latest chain event and copies it", () => {
    const choice = [{ index: 1, text: "Take 800 damage" }];
    const events = [ev({ id: 1, card }), ev({ id: 2, kind: "chain-resolving", chosenOptions: choice })];
    const state = deriveChainState(events);
    expect(state.links[0].chosenOptions).toEqual(choice);
    expect(state.links[0].chosenOptions).not.toBe(choice);
  });

  it("keeps the choice after the link resolves, and has none on a link without one", () => {
    const events = [ev({ id: 1, card }), ev({ id: 2, kind: "chain-resolving", chosenOptions: [{ text: "Take 800 damage" }] }), ev({ id: 3, kind: "chain-resolved" })];
    expect(deriveChainState(events).links[0].chosenOptions).toEqual([{ text: "Take 800 damage" }]);
    expect(deriveChainState([ev({ id: 1, card })]).links[0].chosenOptions).toBeUndefined();
  });

  it("takes the choice from the snapshot when the event window lost it", () => {
    const snapshot: DuelChainLink[] = [{ index: 1, seat: 0, code: 45171524, name: "Mitsurugi Prayers", text: PRAYERS, cardType: 0x10002, chosenOptions: [{ index: 0, text: "Add 1 \"Mitsurugi\" monster" }] }];
    expect(deriveChainState([], snapshot).links[0].chosenOptions).toEqual([{ index: 0, text: "Add 1 \"Mitsurugi\" monster" }]);
    const kept = deriveChainState([ev({ id: 1, card, chosenOptions: [{ text: "Take 800 damage" }] })], [{ index: 1, seat: 0, code: 45171524 }]);
    expect(kept.links[0].chosenOptions).toEqual([{ text: "Take 800 damage" }]);
  });

  it("changes the state key when a choice arrives, so the panel draws it", () => {
    const before = deriveChainState([ev({ id: 1, card })]);
    const after = deriveChainState([ev({ id: 1, card }), ev({ id: 2, kind: "chain-resolving", chosenOptions: [{ text: "Take 800 damage" }] })]);
    expect(chainStateKey(before)).not.toBe(chainStateKey(after));
  });

  it("says the choice in the link label", () => {
    const state = deriveChainState([ev({ id: 1, card, chosenOptions: [{ text: "Take 800 damage" }] })]);
    expect(chainLinkLabel(state.links[0], 0, (seat) => `P${seat}`)).toContain("Chose Take 800 damage");
    expect(chainLinkLabel(state.links[0], 0, (seat) => `P${seat}`, false)).not.toContain("Chose");
  });
});
