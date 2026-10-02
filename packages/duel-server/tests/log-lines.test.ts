import { describe, expect, it } from "vitest";
import type { DuelCardInfo, DuelSummonKind } from "@yugidraft/shared/duels";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import { destroyedLogText, moveLogLines, summonLogLines, type LogLine } from "../src/log-lines.js";

const NAMES: Record<number, string> = { 1: "Stardust Dragon", 2: "Mystical Space Typhoon", 3: "Pot of Greed", 4: "Man-Eater Bug" };
const info = (code: number): DuelCardInfo => ({
  code, name: NAMES[code] ?? `Card ${code}`, description: "", type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "",
});
const cards: CardDatabase = {
  search: () => [], get: info, deckCard: () => undefined, all: () => [], setnames: () => new Map(), cardData: () => null, resolveLabel: () => "", system: () => undefined,
  victory: () => undefined, counter: () => undefined, readScript: () => null, close() {},
};

const at = (controller: 0 | 1, location: OcgLocation, sequence: number, position: OcgPosition = OcgPosition.FACEUP_ATTACK) => ({
  controller, location, sequence, position,
});
type Place = ReturnType<typeof at>;
const move = (card: number, from: Place, to: Place) => ({ type: OcgMessageType.MOVE, card, from, to }) as Extract<OcgMessage, { type: OcgMessageType.MOVE }>;
const summon = (type: OcgMessageType.SUMMONING | OcgMessageType.SPSUMMONING | OcgMessageType.FLIPSUMMONING, position: OcgPosition) =>
  ({ type, code: 1, controller: 0, location: OcgLocation.MZONE, sequence: 2, position }) as Extract<OcgMessage, { type: typeof type }>;

/** What a viewer's Text log shows, filtered the way projectView filters log entries. */
function seen(lines: LogLine[], viewer: number | null): string[] {
  return lines.filter((line) => line.audience === "all" || line.audience === viewer).map((line) => line.text);
}

describe("summon log lines", () => {
  it.each<[DuelSummonKind, string]>([
    ["fusion", "Fusion Summons"],
    ["synchro", "Synchro Summons"],
    ["xyz", "Xyz Summons"],
    ["link", "Link Summons"],
    ["ritual", "Ritual Summons"],
    ["pendulum", "Pendulum Summons"],
    ["special", "Special Summons"],
  ])("names a face-up %s summon for everyone", (kind, verb) => {
    const lines = summonLogLines(summon(OcgMessageType.SPSUMMONING, OcgPosition.FACEUP_ATTACK), cards, kind);
    expect(lines).toEqual([{ text: `Player 1 ${verb} Stardust Dragon`, audience: "all" }]);
  });

  it("names Normal, Tribute and Flip Summons", () => {
    expect(seen(summonLogLines(summon(OcgMessageType.SUMMONING, OcgPosition.FACEUP_ATTACK), cards, "normal"), 1)).toEqual(["Player 1 Normal Summons Stardust Dragon"]);
    expect(seen(summonLogLines(summon(OcgMessageType.SUMMONING, OcgPosition.FACEUP_ATTACK), cards, "tribute"), 1)).toEqual(["Player 1 Tribute Summons Stardust Dragon"]);
    expect(seen(summonLogLines(summon(OcgMessageType.FLIPSUMMONING, OcgPosition.FACEUP_DEFENSE), cards, "flip"), 1)).toEqual(["Player 1 Flip Summons Stardust Dragon"]);
  });

  it("keeps the plain verb when the method is not known", () => {
    expect(seen(summonLogLines(summon(OcgMessageType.SPSUMMONING, OcgPosition.FACEUP_ATTACK), cards, undefined), null)).toEqual(["Player 1 Special Summons Stardust Dragon"]);
  });

  it("gives a face-down summon neither name nor method, except to its controller", () => {
    for (const kind of ["synchro", "xyz", "ritual", "special"] as const) {
      const lines = summonLogLines(summon(OcgMessageType.SPSUMMONING, OcgPosition.FACEDOWN_DEFENSE), cards, kind);
      for (const viewer of [1, null]) expect(seen(lines, viewer)).toEqual(["Player 1 Special Summons a face-down monster"]);
      expect(seen(lines, 0)).toEqual(["Player 1 Special Summons a face-down monster", "Player 1 Special Summons Stardust Dragon"]);
      expect(lines.map((line) => line.text).join(" ")).not.toMatch(/Synchro|Xyz|Ritual/);
    }
  });
});

describe("move log lines", () => {
  const field = at(0, OcgLocation.MZONE, 1);
  const grave = at(0, OcgLocation.GRAVE, 0);

  it("says sent to the Graveyard, and marks lines from the field that may turn out to be destroys", () => {
    expect(moveLogLines(move(1, field, grave), cards)).toEqual([{ text: "Stardust Dragon was sent to the Graveyard", audience: "all", leftField: true }]);
    expect(destroyedLogText(cards, 1)).toBe("Stardust Dragon was destroyed");
    // A material or a cost from the hand or Deck can never be a destroy.
    expect(moveLogLines(move(1, at(0, OcgLocation.HAND, 0), grave), cards)).toEqual([{ text: "Stardust Dragon was sent to the Graveyard", audience: "all" }]);
    expect(seen(moveLogLines(move(1, at(0, OcgLocation.DECK, 0, OcgPosition.FACEDOWN_DEFENSE), grave), cards), null)).toEqual(["Stardust Dragon was sent to the Graveyard"]);
  });

  it("says banished for a face-up banish and nothing for a face-down one", () => {
    expect(seen(moveLogLines(move(1, field, at(0, OcgLocation.REMOVED, 0, OcgPosition.FACEUP_ATTACK)), cards), 1)).toEqual(["Stardust Dragon was banished"]);
    expect(moveLogLines(move(1, at(0, OcgLocation.HAND, 0), at(0, OcgLocation.REMOVED, 0, OcgPosition.FACEDOWN_ATTACK)), cards)).toEqual([]);
  });

  it("names a card added to the hand from a public place for everyone", () => {
    expect(seen(moveLogLines(move(3, grave, at(0, OcgLocation.HAND, 0)), cards), 1)).toEqual(["Pot of Greed was added to Player 1's hand"]);
    expect(seen(moveLogLines(move(1, field, at(0, OcgLocation.HAND, 0)), cards), null)).toEqual(["Stardust Dragon returned to Player 1's hand"]);
  });

  it("keeps a card added from the Deck private to the hand's owner", () => {
    const lines = moveLogLines(move(3, at(0, OcgLocation.DECK, 0, OcgPosition.FACEDOWN_DEFENSE), at(0, OcgLocation.HAND, 0)), cards);
    for (const viewer of [1, null]) expect(seen(lines, viewer)).toEqual(["Player 1 added a card to their hand"]);
    expect(seen(lines, 0)).toEqual(["Player 1 added a card to their hand", "You added Pot of Greed to your hand"]);
  });

  it("keeps a face-down card bounced to the hand private to the hand's owner", () => {
    const setCard = at(1, OcgLocation.SZONE, 2, OcgPosition.FACEDOWN_DEFENSE);
    const lines = moveLogLines(move(2, setCard, at(1, OcgLocation.HAND, 0)), cards);
    for (const viewer of [0, null]) expect(seen(lines, viewer)).toEqual(["A face-down card returned to Player 2's hand"]);
    expect(seen(lines, 1)).toEqual(["A face-down card returned to Player 2's hand", "Mystical Space Typhoon returned to your hand"]);
  });

  it("names a return to the Deck or Extra Deck only from a public place", () => {
    expect(seen(moveLogLines(move(1, field, at(0, OcgLocation.EXTRA, 0, OcgPosition.FACEDOWN_DEFENSE)), cards), 1)).toEqual(["Stardust Dragon returned to the Extra Deck"]);
    expect(seen(moveLogLines(move(3, grave, at(0, OcgLocation.DECK, 0, OcgPosition.FACEDOWN_DEFENSE)), cards), 1)).toEqual(["Pot of Greed returned to the Deck"]);
    // A Pendulum Monster leaving the field face-up for the Extra Deck may have been destroyed.
    expect(moveLogLines(move(1, field, at(0, OcgLocation.EXTRA, 0, OcgPosition.FACEUP_DEFENSE)), cards)[0]?.leftField).toBe(true);
    // Hidden: a Set card shuffled back, or a card from the hand.
    expect(moveLogLines(move(4, at(0, OcgLocation.MZONE, 0, OcgPosition.FACEDOWN_DEFENSE), at(0, OcgLocation.DECK, 0, OcgPosition.FACEDOWN_DEFENSE)), cards)).toEqual([]);
    expect(moveLogLines(move(3, at(0, OcgLocation.HAND, 0), at(0, OcgLocation.DECK, 0, OcgPosition.FACEDOWN_DEFENSE)), cards)).toEqual([]);
  });

  it("names a Deck Master leaving the Deck Master Zone, which the core reports as location 0", () => {
    const master = at(0, 0 as OcgLocation, 0);
    expect(seen(moveLogLines(move(1, master, at(0, OcgLocation.GRAVE, 0)), cards), 1)).toEqual(["Stardust Dragon was sent to the Graveyard"]);
    expect(seen(moveLogLines(move(1, master, at(0, OcgLocation.REMOVED, 0)), cards), null)).toEqual(["Stardust Dragon was banished"]);
    expect(seen(moveLogLines(move(1, master, at(0, OcgLocation.HAND, 0)), cards), 1)).toEqual(["Stardust Dragon was added to Player 1's hand"]);
  });

  it("says nothing for field arrivals and moves within one place", () => {
    expect(moveLogLines(move(1, at(0, OcgLocation.EXTRA, 0, OcgPosition.FACEDOWN_DEFENSE), field), cards)).toEqual([]);
    expect(moveLogLines(move(1, at(0, OcgLocation.GRAVE, 1), grave), cards)).toEqual([]);
  });

  it("never names a hidden card to anyone but the owner of the hand it joins", () => {
    const hidden: Array<[Place, Place]> = [
      [at(0, OcgLocation.DECK, 0, OcgPosition.FACEDOWN_DEFENSE), at(0, OcgLocation.HAND, 0)],
      [at(0, OcgLocation.EXTRA, 0, OcgPosition.FACEDOWN_DEFENSE), at(0, OcgLocation.HAND, 0)],
      [at(0, OcgLocation.MZONE, 0, OcgPosition.FACEDOWN_DEFENSE), at(0, OcgLocation.HAND, 0)],
      [at(0, OcgLocation.REMOVED, 0, OcgPosition.FACEDOWN_ATTACK), at(0, OcgLocation.HAND, 0)],
      [at(0, OcgLocation.HAND, 0), at(0, OcgLocation.REMOVED, 0, OcgPosition.FACEDOWN_ATTACK)],
      [at(0, OcgLocation.SZONE, 0, OcgPosition.FACEDOWN_DEFENSE), at(0, OcgLocation.DECK, 0, OcgPosition.FACEDOWN_DEFENSE)],
    ];
    for (const [from, to] of hidden) {
      const lines = moveLogLines(move(1, from, to), cards);
      for (const viewer of [1, null]) expect(seen(lines, viewer).join(" ")).not.toContain("Stardust Dragon");
      // A hidden line is never marked for the destroy rewrite, which would name the card.
      expect(lines.some((line) => line.leftField)).toBe(false);
    }
  });
});
