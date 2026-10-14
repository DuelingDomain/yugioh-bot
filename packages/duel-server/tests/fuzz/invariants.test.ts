import { describe, expect, it } from "vitest";
import type { DuelCard, DuelDeck, DuelEngineView } from "@yugidraft/shared/duels";
import type { Catalog } from "./card-pool.js";
import { InvariantChecker, LOC, type Views } from "./invariants.js";

const CALL = 64635042;
const SKULL = 70781052;
const NAME_CHANGE = 'This card\'s name becomes "Summoned Skull" on the field.';
const decks: [DuelDeck, DuelDeck] = [
  { main: [SKULL], extra: [CALL], side: [] },
  { main: [], extra: [], side: [] },
];
const catalog: Catalog = {
  byId: new Map([
    [CALL, { id: CALL, name: "Archfiend's Call", type: 8225, level: 6, atk: 2500, setcodes: [] }],
    [SKULL, { id: SKULL, name: "Summoned Skull", type: 17, level: 6, atk: 2500, setcodes: [] }],
  ]),
  main: [], mainMonsters: [], mainSpellTrap: [], extra: [], bySetcode: new Map(),
  xyz: new Map(), link: [], synchro: [], curated: { hand: [], spells: [], traps: [], monsters: [] },
};

function checker(): InvariantChecker {
  return new InvariantChecker({ mode: "normal", decks, disjoint: true, catalog });
}

function views(description = NAME_CHANGE, faceDown = false): Views {
  const view = (viewer: number | null): DuelEngineView => {
    const card: DuelCard = { controller: 0, location: LOC.MZONE, sequence: 0, position: faceDown ? 8 : 4,
      ...(!faceDown || viewer === 0 ? { code: CALL, name: "Archfiend's Call", description } : {}) };
    return {
      revision: 1, format: "1v1", turn: 1, turnSeat: 0, phase: "main1", result: null,
      seats: [0, 1].map(seat => ({ seat, lp: 8000, deckCount: seat === 0 ? 1 : 0, extraCount: 0,
        hand: [], monsters: seat === 0 ? [card] : [], spells: [], graveyard: [], banished: [], extra: [] })),
      prompt: viewer === 0 ? { id: "p1", seat: 0, kind: "choice", title: "Choose an action",
        options: [{ id: "end", label: "End Phase" }], context: { type: "action", phase: "main" } } : null,
      chain: [],
      log: [{ id: 1, text: "Chain Link 1: Infernity Doom Archfiend targets Summoned Skull" }],
      events: [{ id: 1, kind: "target", text: "Chain Link 1 targets Summoned Skull", seat: 0, chainIndex: 1,
        targets: [{ controller: 0, location: LOC.MZONE, sequence: 0 }], targetLabels: ["Summoned Skull"] }],
    };
  };
  return { v0: view(0), v1: view(1), vs: view(null) };
}

describe("privacy text: public name changes", () => {
  it("accepts a face-up card's declared name in target logs and events", () => {
    expect(checker().check(0, views())).toEqual([]);
  });

  it("remembers the public name after the card leaves the field", () => {
    const check = checker();
    check.check(0, views());
    const later = views();
    for (const view of Object.values(later)) {
      view.revision++;
      view.seats[0].monsters = [];
      view.seats[0].deckCount++;
      view.log[0].id++;
      view.events[0].id++;
    }
    expect(check.check(1, later)).toEqual([]);
  });

  it("does not learn a name-change effect from another seat's face-down card", () => {
    const violations = checker().check(0, views(NAME_CHANGE, true));
    expect(violations.filter(v => v.invariant === "privacy-text")).toHaveLength(4);
  });

  it("does not treat a printed reference to a different card as a public identity", () => {
    const violations = checker().check(0, views('You can Special Summon 1 "Summoned Skull" from your Deck.'));
    expect(violations.filter(v => v.invariant === "privacy-text")).toHaveLength(4);
  });

  it("keeps the hidden card's passcode private after learning the public name", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) view.log[0].text = `Secret card ${SKULL}`;
    expect(checker().check(0, snapshot).filter(v => v.invariant === "privacy-text" && v.message.includes("contains code"))).toHaveLength(2);
  });

  it("keeps hidden structures private", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) {
      view.seats[0].deckCount = 0;
      view.seats[0].hand = [{ controller: 0, location: LOC.HAND, sequence: 0, position: 8,
        code: SKULL, name: "Summoned Skull" }];
    }
    const violations = checker().check(0, snapshot);
    expect(violations.filter(v => v.invariant === "privacy-structure")).toHaveLength(2);
  });

  it("keeps hidden move event card identities private", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) {
      view.events[0].kind = "move";
      view.events[0].card = { code: SKULL, name: "Summoned Skull", description: "", type: 17,
        attack: 2500, defense: 1200, level: 6, attribute: 32, race: "fiend" };
    }
    const violations = checker().check(0, snapshot);
    expect(violations.filter(v => v.invariant === "privacy-event-card")).toHaveLength(2);
  });
});
