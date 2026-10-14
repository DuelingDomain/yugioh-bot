import { describe, expect, it } from "vitest";
import type { DuelCard, DuelDeck, DuelEngineView } from "@yugidraft/shared/duels";
import type { Catalog } from "./card-pool.js";
import { InvariantChecker, LOC, type Violation, type Views, type Viewer } from "./invariants.js";

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

function textLeaks(violations: Violation[]) {
  return violations.filter(v => v.invariant === "privacy-text").map(v => ({
    message: v.message, text: (v.detail as { text: string }).text,
  }));
}

function expectedLeaks(viewers: Viewer[], sources: Array<{ where: string; text: string }>, reason = 'names hidden card "Summoned Skull"') {
  return viewers.flatMap(viewer => sources.map(({ where, text }) => ({
    message: `Viewer ${String(viewer)}: ${where} ${reason}`, text,
  })));
}

const TARGET_SOURCES = [
  { where: "log 1", text: "Chain Link 1: Infernity Doom Archfiend targets Summoned Skull" },
  { where: "event 1 text", text: "Chain Link 1 targets Summoned Skull" },
  { where: "event 1 target label 0", text: "Summoned Skull" },
];

describe("privacy text: public name changes", () => {
  it.each([
    NAME_CHANGE,
    'this card\'s name becomes "Summoned Skull" on the field.',
    'This card\'s name is treated as "Summoned Skull".',
    '(This card\'s name is also treated as "Summoned Skull".)',
    '(This card\'s name is always treated as "Summoned Skull".)',
  ])("accepts a face-up target's declared name: %s", description => {
    expect(checker().check(0, views(description))).toEqual([]);
  });

  it("accepts a target's name from its visible code", () => {
    const snapshot = views("");
    for (const view of Object.values(snapshot)) {
      view.seats[0].monsters[0]!.code = SKULL;
      view.seats[0].monsters[0]!.name = "Summoned Skull";
      view.seats[0].deckCount = 0;
      view.seats[0].extraCount = 1;
      view.seats[0].extra = [{ controller: 0, location: LOC.EXTRA, sequence: 0, position: 8,
        ...(view === snapshot.v0 ? { code: CALL, name: "Archfiend's Call" } : {}) }];
    }
    expect(checker().check(0, snapshot)).toEqual([]);
  });

  it("uses the previous view for a face-up target that moved during resolution", () => {
    const check = checker();
    const before = views();
    for (const view of Object.values(before)) { view.log = []; view.events = []; }
    check.check(0, before);
    const later = views();
    for (const view of Object.values(later)) {
      view.revision++;
      view.seats[0].monsters = [];
      view.seats[0].deckCount++;
    }
    expect(check.check(1, later)).toEqual([]);
  });

  it("forgets a target name after an intervening view without the card", () => {
    const check = checker();
    check.check(0, views());
    const absent = views();
    for (const view of Object.values(absent)) {
      view.seats[0].monsters = [];
      view.seats[0].deckCount++;
      view.log = [];
      view.events = [];
    }
    check.check(1, absent);
    const later = structuredClone(absent);
    for (const view of Object.values(later)) {
      view.log = [{ id: 2, text: TARGET_SOURCES[0].text }];
      view.events = [{ ...views().v0.events[0], id: 2 }];
    }
    expect(textLeaks(check.check(2, later))).toEqual(expectedLeaks([1, null], [
      { ...TARGET_SOURCES[0], where: "log 2" }, { ...TARGET_SOURCES[1], where: "event 2 text" },
      { ...TARGET_SOURCES[2], where: "event 2 target label 0" },
    ]));
  });

  it.each([
    { controller: 1, location: LOC.MZONE, sequence: 0 },
    { controller: 0, location: LOC.SZONE, sequence: 0 },
    { controller: 0, location: LOC.MZONE, sequence: 1 },
  ])("rejects a name declared by a card at different coordinates: %o", target => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) view.events[0].targets = [target];
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1, null], TARGET_SOURCES));
  });

  it("does not learn a name-change effect from another seat's face-down card", () => {
    const violations = checker().check(0, views(NAME_CHANGE, true));
    expect(textLeaks(violations)).toEqual(expectedLeaks([1, null], TARGET_SOURCES));
  });

  it("does not treat a printed reference as the target's name", () => {
    const violations = checker().check(0, views('You can Special Summon 1 "Summoned Skull" from your Deck.'));
    expect(textLeaks(violations)).toEqual(expectedLeaks([1, null], TARGET_SOURCES));
  });

  it("checks each target separately when a hidden copy has the same name", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) {
      view.events[0].targets!.push({ controller: 0, location: LOC.HAND, sequence: 0 });
      view.events[0].targetLabels!.push("Summoned Skull");
      view.events[0].text += " and Summoned Skull";
      view.log[0].text += " and Summoned Skull";
    }
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1, null],
      [...TARGET_SOURCES.slice(0, 2).map(source => ({ ...source, text: source.text + " and Summoned Skull" })),
        { where: "event 1 target label 1", text: "Summoned Skull" }]));
  });

  it.each([
    "Player 0 added Summoned Skull to the hand",
    "Summoned Skull moved to Player 0's hand",
  ])("catches a hidden copy in other text after a name-change card was seen: %s", text => {
    const check = checker();
    check.check(0, views());
    const later = views();
    for (const view of Object.values(later)) {
      view.seats[0].deckCount = 0;
      view.seats[0].hand = [{ controller: 0, location: LOC.HAND, sequence: 0, position: 8,
        ...(view === later.v0 ? { code: SKULL, name: "Summoned Skull" } : {}) }];
      view.log = [{ id: 2, text }];
      view.events = [{ id: 2, kind: "move", text }];
    }
    expect(textLeaks(check.check(1, later))).toEqual(expectedLeaks([1, null], [
      { where: "log 2", text }, { where: "event 2 text", text },
    ]));
  });

  it("keeps a hidden same-name reference outside the target phrase private", () => {
    const snapshot = views();
    const text = "Chain Link 1: Summoned Skull targets Summoned Skull";
    for (const view of Object.values(snapshot)) view.log[0].text = text;
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1, null], [{ where: "log 1", text }]));
  });

  it("requires a matching target event before exempting a log's target name", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) view.events = [];
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1, null], [TARGET_SOURCES[0]]));
  });

  it("keeps standalone prompt names strict after a name-change card was seen", () => {
    const check = checker();
    check.check(0, views());
    const later = views();
    const text = "Select Summoned Skull";
    later.v1.prompt = { ...later.v0.prompt!, id: "p2", seat: 1, title: text };
    later.v0.prompt = null;
    for (const view of Object.values(later)) { view.log = []; view.events = []; }
    expect(textLeaks(check.check(1, later))).toEqual(expectedLeaks([1], [{ where: "prompt p2", text }]));
  });

  it("does not exempt target-shaped text on another event kind", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) view.events[0].kind = "move";
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1, null], TARGET_SOURCES.slice(0, 2)));
  });

  it.each([false, true])("checks structured target labels even with generic event text (missing coordinates: %s)", missing => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) {
      view.log = [];
      view.events[0].text = "Chain Link 1 targets 1 card";
      if (missing) delete view.events[0].targets;
      else view.events[0].targets = [{ controller: 0, location: LOC.HAND, sequence: 0 }];
    }
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1, null], [TARGET_SOURCES[2]]));
  });

  it("checks numeric passcodes in structured target labels", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) {
      view.log = [];
      view.events[0].text = "Chain Link 1 targets 1 card";
      view.events[0].targetLabels = [String(SKULL)];
    }
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1, null],
      [{ where: "event 1 target label 0", text: String(SKULL) }], `contains code ${SKULL}`));
  });

  it("accepts a verified structured target label with generic event text", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) {
      view.log = [];
      view.events[0].text = "Chain Link 1 targets 1 card";
    }
    expect(checker().check(0, snapshot)).toEqual([]);
  });

  it("keeps the hidden card's passcode private after learning the public name", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) view.log[0].text = `Secret card ${SKULL}`;
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1, null],
      [{ where: "log 1", text: `Secret card ${SKULL}` }], `contains code ${SKULL}`));
  });

  it("keeps hidden structures private", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) {
      view.seats[0].deckCount = 0;
      view.seats[0].hand = [{ controller: 0, location: LOC.HAND, sequence: 0, position: 8,
        code: SKULL, name: "Summoned Skull" }];
    }
    const violations = checker().check(0, snapshot);
    expect(violations.filter(v => v.invariant === "privacy-structure").map(v => v.message)).toEqual([
      'Viewer 1 sees a hand card of seat 0: Summoned Skull',
      'Viewer null sees a hand card of seat 0: Summoned Skull',
    ]);
  });

  it("keeps hidden move event card identities private", () => {
    const snapshot = views();
    for (const view of Object.values(snapshot)) {
      view.events[0].kind = "move";
      view.events[0].card = { code: SKULL, name: "Summoned Skull", description: "", type: 17,
        attack: 2500, defense: 1200, level: 6, attribute: 32, race: "fiend" };
    }
    const violations = checker().check(0, snapshot);
    expect(violations.filter(v => v.invariant === "privacy-event-card").map(v => v.message)).toEqual([
      'Viewer 1: event 1 (move) shows hidden card Summoned Skull',
      'Viewer null: event 1 (move) shows hidden card Summoned Skull',
    ]);
  });
});

describe("privacy text: quoted references in visible card text", () => {
  const description = 'You can Special Summon 1 "Summoned Skull" from your Deck.';
  const title = 'Special Summon 1 "Summoned Skull" from your Deck?';
  function promptViews(text = title, faceDown = false): Views {
    const snapshot = views(description, faceDown);
    for (const view of Object.values(snapshot)) { view.log = []; view.events = []; }
    snapshot.v1.prompt = { ...snapshot.v0.prompt!, seat: 1, title: text };
    snapshot.v0.prompt = null;
    return snapshot;
  }

  it("allows a quoted printed reference in a prompt", () => {
    expect(checker().check(0, promptViews())).toEqual([]);
  });

  it("still catches a standalone reference next to an allowed quote", () => {
    const text = `${title} Hidden card: Summoned Skull`;
    expect(textLeaks(checker().check(0, promptViews(text)))).toEqual(expectedLeaks([1], [{ where: "prompt p1", text }]));
  });

  it.each(["Summoned Skull", 'Choose "Summoned Skull"'])('rejects a name absent from visible printed quotes: %s', text => {
    const snapshot = promptViews(text);
    for (const view of Object.values(snapshot)) view.seats[0].monsters[0]!.description = "No quoted card references.";
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1], [{ where: "prompt p1", text }]));
  });

  it("does not use another viewer's face-down card text", () => {
    expect(textLeaks(checker().check(0, promptViews(title, true)))).toEqual(expectedLeaks([1], [{ where: "prompt p1", text: title }]));
  });

  it("keeps quoted names strict in non-prompt text", () => {
    const snapshot = promptViews();
    for (const view of Object.values(snapshot)) view.log = [{ id: 1, text: title }];
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1, null], [{ where: "log 1", text: title }]));
  });

  it("keeps numeric passcodes strict inside printed quotes", () => {
    const text = `Choose "${SKULL}"`;
    const snapshot = promptViews(text);
    for (const view of Object.values(snapshot)) view.seats[0].monsters[0]!.description = text;
    expect(textLeaks(checker().check(0, snapshot))).toEqual(expectedLeaks([1], [{ where: "prompt p1", text }], `contains code ${SKULL}`));
  });

  function tokenPrompt(text: string): Views {
    const snapshot = promptViews(text);
    snapshot.v1.prompt!.options[0].card = { code: 44052075, name: "Summoned Skull Token", description: "",
      type: 16401, attack: 0, defense: 0, level: 1, attribute: 1, race: "fiend" };
    return snapshot;
  }

  it("matches a visible token's full name before a hidden shorter card name", () => {
    expect(checker().check(0, tokenPrompt("Select a position for Summoned Skull Token"))).toEqual([]);
  });

  it("still catches a separate hidden name beside a visible token name", () => {
    const text = "Summoned Skull Token; hidden card: Summoned Skull";
    expect(textLeaks(checker().check(0, tokenPrompt(text)))).toEqual(expectedLeaks([1], [{ where: "prompt p1", text }]));
  });

  it("does not let an unknown prompt card authorize its own name or printed quotes", () => {
    const text = 'Summoned Skull Token; choose "Summoned Skull"';
    const snapshot = tokenPrompt(text);
    snapshot.v1.prompt!.options[0].card!.code = SKULL;
    snapshot.v1.prompt!.options[0].card!.description = description;
    for (const view of Object.values(snapshot)) view.seats[0].monsters[0]!.description = "";
    const violations = checker().check(0, snapshot);
    expect(textLeaks(violations)).toEqual(expectedLeaks([1], [
      { where: "prompt p1", text }, { where: "prompt p1", text: "Summoned Skull Token" },
    ]));
    expect(violations.filter(v => v.invariant === "privacy-prompt").map(v => v.message)).toEqual([
      `Viewer 1: prompt "${text}" shows hidden card code ${SKULL} (code)`,
    ]);
  });
});
