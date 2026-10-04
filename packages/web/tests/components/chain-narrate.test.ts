import { describe, expect, it } from "vitest";
import type { DuelCard, DuelCardInfo, DuelEvent, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";

import { chainEffectText, chainKindLabel } from "@/components/duel/chain-effect-text";
import {
  buildPanelView,
  buildStripView,
  chainOutcomes,
  publicTargetName,
  rememberTargetNames,
  stripLabel,
  type TargetMemory,
  type Who,
} from "@/components/duel/chain-narrate";
import { applyChainEvent, chainFocusLink, deriveChainState, EMPTY_CHAIN } from "@/components/duel/chain-state";

const MZONE = 0x04;
const SZONE = 0x08;
const GRAVE = 0x10;
const HAND = 0x02;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });

const TRAP_TEXT = "When your opponent Normal or Flip Summons 1 monster with 1000 or more ATK: Target that monster; destroy that target.";
const RAIGEKI_TEXT = "Destroy all monsters your opponent controls.";
const SOLEMN_TEXT = "When a Spell/Trap Card, or monster effect, is activated that includes an effect that Special Summons a monster(s): Pay half your LP; negate the Summon or activation, and if you do that, destroy it.";
const DM_TEXT = "The ultimate wizard in terms of attack and defense.";
const TYPE_NORMAL_SPELL = 0x2;
const TYPE_NORMAL_TRAP = 0x4;
const TYPE_COUNTER_TRAP = 0x100004;
const TYPE_NORMAL_MONSTER = 0x11;

const info = (code: number, name: string, description: string, type: number): DuelCardInfo => ({
  code, name, description, type, attack: 0, defense: 0, level: 0, attribute: 0, race: "",
});
const TRAP_HOLE = info(4206964, "Trap Hole", TRAP_TEXT, TYPE_NORMAL_TRAP);
const RAIGEKI = info(12580477, "Raigeki", RAIGEKI_TEXT, TYPE_NORMAL_SPELL);
const SOLEMN = info(41420027, "Solemn Judgment", SOLEMN_TEXT, TYPE_COUNTER_TRAP);
const GAIA = info(6368038, "Gaia The Fierce Knight", "", 0x1);

let id = 0;
const next = () => ++id;
const activate = (chainIndex: number, seat: number, card: DuelCardInfo, extra: Partial<DuelEvent> = {}): DuelEvent => ({
  id: next(), kind: "activate", text: "a", seat, card, chainIndex, zone: z(seat, SZONE, 0), ...extra,
});
const chainEv = (kind: DuelEvent["kind"], chainIndex?: number, extra: Partial<DuelEvent> = {}): DuelEvent => ({
  id: next(), kind, text: kind, ...(chainIndex != null ? { chainIndex } : {}), ...extra,
});

const names = (seat: number) => `Player ${seat + 1}`;
const who: Who = { mySeat: 0, playerName: names };

describe("chainEffectText", () => {
  const link = (over: Partial<Parameters<typeof chainEffectText>[0]>) => ({ name: "Trap Hole", description: undefined, text: TRAP_TEXT, cardType: TYPE_NORMAL_TRAP, ...over });

  it("prefers the engine's own description of the activation", () => {
    expect(chainEffectText(link({ description: "Destroy that monster." }))).toEqual({ text: "Destroy that monster.", caption: "Effect" });
  });

  it("ignores a description that is only the card's name or a bare Activate", () => {
    for (const description of ["Trap Hole", "trap hole", "Activate", "Activate this card.", "Effect", ""]) {
      expect(chainEffectText(link({ description }))?.caption, description).toBe("Card text");
    }
  });

  it("reads a Spell or Trap's effect from after its first colon", () => {
    expect(chainEffectText(link({}))).toEqual({ text: "Target that monster; destroy that target.", caption: "Card text" });
    expect(chainEffectText(link({ name: "Solemn Judgment", text: SOLEMN_TEXT, cardType: TYPE_COUNTER_TRAP }))?.text)
      .toBe("Pay half your LP; negate the Summon or activation, and if you do that, destroy it.");
  });

  it("keeps a Spell with no colon whole", () => {
    expect(chainEffectText({ name: "Raigeki", description: undefined, text: RAIGEKI_TEXT, cardType: TYPE_NORMAL_SPELL })?.text).toBe(RAIGEKI_TEXT);
  });

  it("keeps a monster's printed text whole, since its colon is part of a sentence", () => {
    const text = "You can discard this card: Add 1 monster from your Deck to your hand.";
    expect(chainEffectText({ name: "Some Monster", description: undefined, text, cardType: TYPE_NORMAL_MONSTER })).toEqual({ text, caption: "Card text" });
  });

  it("flattens line breaks", () => {
    expect(chainEffectText(link({ text: "Line one.\nLine two.", cardType: TYPE_NORMAL_SPELL }))?.text).toBe("Line one. Line two.");
  });

  it("says nothing when it has nothing to say", () => {
    expect(chainEffectText(link({ text: null, description: undefined }))).toBeNull();
    expect(chainEffectText(link({ text: "   ", description: "Activate" }))).toBeNull();
  });

  it("never gives text for a card it does not know, whatever the link carries", () => {
    expect(chainEffectText(link({ name: null, description: "Destroy it.", text: TRAP_TEXT }))).toBeNull();
    expect(chainEffectText(link({ name: "  " }))).toBeNull();
  });
});

describe("chainKindLabel", () => {
  it("names Spells, Traps and monsters", () => {
    expect(chainKindLabel(TYPE_NORMAL_TRAP)).toBe("Normal Trap");
    expect(chainKindLabel(TYPE_COUNTER_TRAP)).toBe("Counter Trap");
    expect(chainKindLabel(0x20004)).toBe("Continuous Trap");
    expect(chainKindLabel(TYPE_NORMAL_SPELL)).toBe("Normal Spell");
    expect(chainKindLabel(0x10002)).toBe("Quick-Play Spell");
    expect(chainKindLabel(0x21)).toBe("Effect Monster");
    expect(chainKindLabel(0x11)).toBe("Monster");
    expect(chainKindLabel(null)).toBeNull();
    expect(chainKindLabel(0)).toBeNull();
  });
});

describe("publicTargetName", () => {
  const card = (over: Partial<DuelCard>): DuelCard => ({ controller: 1, location: MZONE, sequence: 2, position: 0x1, name: "Gaia The Fierce Knight", ...over });
  const seat = (n: number, over: Partial<DuelSeatView> = {}): DuelSeatView => ({
    seat: n, lp: 8000, hand: [], deckCount: 0, extraCount: 0, extra: [], monsters: [null, null, null, null, null], spells: [null, null, null, null, null], graveyard: [], banished: [], ...over,
  });
  const board = (over: Partial<DuelSeatView> = {}) => [seat(0), seat(1, over)];

  it("names a face-up card on the field", () => {
    const monsters = [null, null, card({}), null, null];
    expect(publicTargetName(z(1, MZONE, 2), board({ monsters }))).toBe("Gaia The Fierce Knight");
  });

  it("does not name a face-down card, even one the viewer can read", () => {
    const monsters = [null, null, card({ position: 0x8 }), null, null];
    expect(publicTargetName(z(1, MZONE, 2), board({ monsters }))).toBeNull();
    const spells = [card({ location: SZONE, sequence: 0, position: 0x8, name: "Solemn Judgment" }), null, null, null, null];
    expect(publicTargetName(z(1, SZONE, 0), board({ spells }))).toBeNull();
  });

  it("does not name a card the viewer's projection hides", () => {
    const monsters = [null, null, card({ name: undefined, position: 0x8 }), null, null];
    expect(publicTargetName(z(1, MZONE, 2), board({ monsters }))).toBeNull();
  });

  it("never names a card in a hand, a Deck or an Extra Deck", () => {
    const hand = [card({ location: HAND, sequence: 0, name: "Kuriboh" })];
    expect(publicTargetName(z(1, HAND, 0), board({ hand }))).toBeNull();
    expect(publicTargetName(z(1, 0x01, 0), board({}))).toBeNull();
    expect(publicTargetName(z(1, 0x40, 0), board({}))).toBeNull();
  });

  it("names a card in the Graveyard", () => {
    const graveyard = [card({ location: GRAVE, sequence: 0, name: "Dark Hole" })];
    expect(publicTargetName(z(1, GRAVE, 0), board({ graveyard }))).toBe("Dark Hole");
  });

  it("says nothing without a board or an empty zone", () => {
    expect(publicTargetName(z(1, MZONE, 2), undefined)).toBeNull();
    expect(publicTargetName(z(1, MZONE, 2), board())).toBeNull();
    expect(publicTargetName(z(5, MZONE, 2), board())).toBeNull();
  });

  it("remembers a name after the target has left its zone", () => {
    const memory: TargetMemory = new Map();
    const link = deriveChainState([activate(1, 1, TRAP_HOLE, { targets: [z(1, MZONE, 2)] })]).links;
    rememberTargetNames(memory, link, board({ monsters: [null, null, card({}), null, null] }));
    rememberTargetNames(memory, link, board());
    expect(memory.get("1:1:4:2")).toBe("Gaia The Fierce Knight");
    // A face-down occupant is never stored.
    const hidden: TargetMemory = new Map();
    rememberTargetNames(hidden, link, board({ monsters: [null, null, card({ position: 0x8 }), null, null] }));
    expect(hidden.size).toBe(0);
  });
});

describe("chainOutcomes", () => {
  const settle = (events: DuelEvent[]) => deriveChainState(events);

  it("says what a destroy effect destroyed", () => {
    id = 0;
    const events = [
      activate(1, 1, TRAP_HOLE),
      chainEv("chain-resolving", 1),
      chainEv("destroy", undefined, { card: GAIA, zone: z(0, MZONE, 2), cause: "effect", sourceCode: TRAP_HOLE.code }),
      chainEv("chain-resolved", 1),
      chainEv("chain-end"),
    ];
    const out = chainOutcomes(events, { ...settle(events.slice(0, 4)) }, who);
    expect(out.get(1)).toEqual({ lines: ["Destroyed Gaia The Fierce Knight"], row: "Destroyed Gaia The Fierce Knight", tone: "ok" });
  });

  it("does not name a card the event does not carry", () => {
    id = 0;
    const events = [
      activate(1, 1, TRAP_HOLE),
      chainEv("chain-resolving", 1),
      chainEv("destroy", undefined, { zone: z(0, MZONE, 2), cause: "effect" }),
      chainEv("destroy", undefined, { zone: z(0, MZONE, 3), cause: "effect" }),
      chainEv("chain-resolved", 1),
    ];
    const out = chainOutcomes(events, settle(events), who);
    expect(out.get(1)?.lines).toEqual(["Destroyed 2 cards"]);
    expect(JSON.stringify([...out])).not.toMatch(/\d{6,}/);
  });

  it("lists two or more named cards", () => {
    id = 0;
    const events = [
      activate(1, 1, RAIGEKI),
      chainEv("chain-resolving", 1),
      chainEv("destroy", undefined, { card: GAIA, zone: z(0, MZONE, 0) }),
      chainEv("destroy", undefined, { card: info(1, "Kuriboh", "", 0x21), zone: z(0, MZONE, 1) }),
      chainEv("destroy", undefined, { card: info(2, "Celtic Guardian", "", 0x21), zone: z(0, MZONE, 2) }),
      chainEv("chain-resolved", 1),
    ];
    expect(chainOutcomes(events, settle(events), who).get(1)?.lines).toEqual(["Destroyed Gaia The Fierce Knight and 2 others"]);
  });

  it("falls back to Resolved, and ignores the source card going to the Graveyard afterwards", () => {
    id = 0;
    const events = [
      activate(1, 1, TRAP_HOLE),
      chainEv("chain-resolving", 1),
      chainEv("chain-resolved", 1),
      chainEv("move", undefined, { card: TRAP_HOLE, zone: z(1, GRAVE, 0), from: z(1, SZONE, 0), reason: "send" }),
      chainEv("chain-end"),
    ];
    expect(chainOutcomes(events, settle(events.slice(0, 3)), who).get(1)).toEqual({ lines: ["Resolved"], row: "Resolved", tone: "quiet" });
    const inside = [
      activate(1, 1, TRAP_HOLE),
      chainEv("chain-resolving", 1),
      chainEv("move", undefined, { card: TRAP_HOLE, zone: z(1, GRAVE, 0), from: z(1, SZONE, 0), reason: "send" }),
      chainEv("chain-resolved", 1),
    ];
    expect(chainOutcomes(inside, settle(inside), who).get(1)?.lines).toEqual(["Resolved"]);
  });

  it("attributes a destroy note that arrives after the link resolved, by the card that caused it", () => {
    id = 0;
    const events = [
      activate(1, 1, TRAP_HOLE),
      chainEv("chain-resolving", 1),
      chainEv("chain-resolved", 1),
      chainEv("destroy", undefined, { card: GAIA, zone: z(0, MZONE, 2), cause: "effect", sourceCode: TRAP_HOLE.code }),
      chainEv("chain-end"),
    ];
    expect(chainOutcomes(events, settle(events.slice(0, 3)), who).get(1)?.lines).toEqual(["Destroyed Gaia The Fierce Knight"]);
  });

  it("keeps each link's effects apart in a two link chain", () => {
    id = 0;
    const events = [
      activate(1, 0, RAIGEKI),
      activate(2, 1, TRAP_HOLE, { zone: z(1, SZONE, 1) }),
      chainEv("chain-resolving", 2),
      chainEv("destroy", undefined, { card: GAIA, zone: z(0, MZONE, 2) }),
      chainEv("chain-resolved", 2),
      chainEv("chain-resolving", 1),
      chainEv("destroy", undefined, { card: info(7, "Kuriboh", "", 0x21), zone: z(1, MZONE, 0) }),
      chainEv("chain-resolved", 1),
    ];
    const out = chainOutcomes(events, settle(events), who);
    expect(out.get(2)?.lines).toEqual(["Destroyed Gaia The Fierce Knight"]);
    expect(out.get(1)?.lines).toEqual(["Destroyed Kuriboh"]);
  });

  it("reports LP gained and effect damage by who took it", () => {
    id = 0;
    const events = [
      activate(1, 0, info(70368879, "Upstart Goblin", "Draw 1 card, then your opponent gains 1000 LP.", TYPE_NORMAL_SPELL)),
      chainEv("chain-resolving", 1),
      chainEv("recover", undefined, { seat: 1, amount: 1000 }),
      chainEv("damage", undefined, { seat: 0, amount: 500, cause: "effect" }),
      chainEv("chain-resolved", 1),
    ];
    expect(chainOutcomes(events, settle(events), who).get(1)?.lines).toEqual(["You took 500 damage", "Opponent gained 1000 LP"]);
    const mine = [
      activate(1, 0, RAIGEKI),
      chainEv("chain-resolving", 1),
      chainEv("recover", undefined, { seat: 0, amount: 800 }),
      chainEv("chain-resolved", 1),
    ];
    expect(chainOutcomes(mine, settle(mine), who).get(1)?.lines).toEqual(["Gained 800 LP"]);
  });

  it("does not count battle damage or a paid cost as an effect", () => {
    id = 0;
    const events = [
      activate(1, 0, RAIGEKI),
      chainEv("chain-resolving", 1),
      chainEv("damage", undefined, { seat: 1, amount: 500, cause: "cost" }),
      chainEv("damage", undefined, { seat: 1, amount: 100, cause: "battle" }),
      chainEv("chain-resolved", 1),
    ];
    expect(chainOutcomes(events, settle(events), who).get(1)?.lines).toEqual(["Resolved"]);
  });

  it("says what was summoned, banished or returned", () => {
    id = 0;
    const events = [
      activate(1, 0, RAIGEKI),
      chainEv("chain-resolving", 1),
      chainEv("summon", undefined, { card: GAIA, summonKind: "special", zone: z(0, MZONE, 1) }),
      chainEv("move", undefined, { card: info(9, "Kuriboh", "", 0x21), zone: z(1, 0x20, 0), from: z(1, MZONE, 0), reason: "banish" }),
      chainEv("move", undefined, { zone: z(1, HAND, 0), from: z(1, MZONE, 1), reason: "return", addedToHand: true }),
      chainEv("chain-resolved", 1),
    ];
    expect(chainOutcomes(events, settle(events), who).get(1)?.lines).toEqual([
      "Banished Kuriboh", "Returned a card to the hand", "Special Summoned Gaia The Fierce Knight",
    ]);
  });

  describe("negation, in the order the engine sends it", () => {
    // The real stock-core order (duel-server/tests/chain-resolution-events.test.ts): the negation arrives while
    // the negating link resolves, naming the negated one, and the negated link then still resolves.
    const negate = (destroyed: boolean): DuelEvent[] => {
      id = 0;
      return [
        activate(1, 0, RAIGEKI),
        activate(2, 1, SOLEMN),
        chainEv("chain-resolving", 2),
        chainEv("chain-negated", 1, { card: RAIGEKI }),
        ...(destroyed ? [chainEv("destroy", undefined, { card: RAIGEKI, zone: z(0, SZONE, 0), cause: "effect", sourceCode: SOLEMN.code })] : []),
        chainEv("chain-resolved", 2),
        chainEv("chain-resolving", 1),
        chainEv("chain-resolved", 1),
        chainEv("chain-end"),
      ];
    };

    it("tells the negated link who negated it, and the negator what it negated and destroyed", () => {
      const events = negate(true);
      const out = chainOutcomes(events, settle(events.slice(0, -1)), who);
      expect(out.get(1)).toEqual({ lines: ["Negated by Solemn Judgment, then destroyed"], row: "Negated by Chain Link 2", tone: "neg" });
      expect(out.get(2)).toEqual({ lines: ["Negated Raigeki and destroyed it"], row: "Negated Raigeki and destroyed it", tone: "ok" });
    });

    it("drops the destroyed note when nothing was destroyed", () => {
      const events = negate(false);
      const out = chainOutcomes(events, settle(events.slice(0, -1)), who);
      expect(out.get(1)?.lines).toEqual(["Negated by Solemn Judgment"]);
      expect(out.get(2)?.lines).toEqual(["Negated Raigeki"]);
    });

    it("does not call the negator's resolving beat a result of the negated link before it is reported", () => {
      const events = negate(true).slice(0, 3);
      const out = chainOutcomes(events, settle(events), who);
      expect(out.get(1)?.tone).not.toBe("neg");
    });

    it("says only Negated when the engine names no negating link", () => {
      id = 0;
      const events = [activate(1, 0, RAIGEKI), chainEv("chain-negated", 1, { card: RAIGEKI })];
      const out = chainOutcomes(events, settle(events), who);
      expect(out.get(1)).toEqual({ lines: ["Negated"], row: "Negated", tone: "neg" });
    });

    it("names the negator as a link when its card is unknown", () => {
      id = 0;
      const hidden = { ...SOLEMN, name: "" };
      const events = [
        activate(1, 0, RAIGEKI),
        activate(2, 1, hidden),
        chainEv("chain-resolving", 2),
        chainEv("chain-negated", 1, { card: RAIGEKI }),
        chainEv("chain-resolved", 2),
      ];
      expect(chainOutcomes(events, settle(events), who).get(1)?.lines).toEqual(["Negated by Chain Link 2"]);
    });
  });

  it("reads the open chain only, not an earlier one in the window", () => {
    id = 0;
    const events = [
      activate(1, 1, TRAP_HOLE),
      chainEv("chain-resolving", 1),
      chainEv("destroy", undefined, { card: GAIA, zone: z(0, MZONE, 2) }),
      chainEv("chain-resolved", 1),
      chainEv("chain-end"),
      activate(1, 0, RAIGEKI),
      chainEv("chain-resolving", 1),
      chainEv("chain-resolved", 1),
    ];
    expect(chainOutcomes(events, settle(events.slice(5)), who).get(1)?.lines).toEqual(["Resolved"]);
  });

  it("is empty for an empty chain", () => {
    expect(chainOutcomes([], EMPTY_CHAIN, who).size).toBe(0);
  });
});

describe("buildPanelView", () => {
  const memory: TargetMemory = new Map();
  const build = (events: DuelEvent[], over: { resultsReady?: boolean; mem?: TargetMemory; whoOver?: Partial<Who> } = {}) => {
    const state = deriveChainState(events);
    const w = { ...who, ...over.whoOver };
    return buildPanelView({
      state, focus: chainFocusLink(state)!, outcomes: chainOutcomes(events, state, w), resultsReady: over.resultsReady ?? true, targets: over.mem ?? memory, who: w,
    });
  };

  it("shows an activated link as waiting, with its effect and no result", () => {
    id = 0;
    const view = build([activate(1, 1, TRAP_HOLE)]);
    expect(view.hero).toMatchObject({
      index: 1, total: 1, tone: "wait", eyebrow: "Activated", name: "Trap Hole", owner: "Opponent", kind: "Normal Trap", code: 4206964,
      outcome: null, waiting: false,
    });
    expect(view.hero.effect).toEqual({ text: "Target that monster; destroy that target.", caption: "Card text" });
  });

  it("holds the result of a resolving link until its effect has had time to play", () => {
    id = 0;
    const events = [
      activate(1, 1, TRAP_HOLE),
      chainEv("chain-resolving", 1),
      chainEv("destroy", undefined, { card: GAIA, zone: z(0, MZONE, 2) }),
    ];
    const early = build(events, { resultsReady: false });
    expect(early.hero).toMatchObject({ tone: "now", eyebrow: "Resolving", outcome: null, waiting: true });
    const late = build(events, { resultsReady: true });
    expect(late.hero.outcome?.lines).toEqual(["Destroyed Gaia The Fierce Knight"]);
    expect(late.hero.waiting).toBe(false);
  });

  it("keeps Resolving... for a link that did nothing visible, and says Resolved only once it has resolved", () => {
    id = 0;
    const events = [activate(1, 1, TRAP_HOLE), chainEv("chain-resolving", 1)];
    expect(build(events).hero).toMatchObject({ eyebrow: "Resolving", outcome: null, waiting: true });
    const done = build([...events, chainEv("chain-resolved", 1)]);
    expect(done.hero).toMatchObject({ eyebrow: "Resolved", waiting: false });
    expect(done.hero.outcome?.lines).toEqual(["Resolved"]);
  });

  it("calls the resolving link of a longer chain Now resolving, and the one before Just resolved", () => {
    id = 0;
    const events = [activate(1, 0, RAIGEKI), activate(2, 1, TRAP_HOLE), chainEv("chain-resolving", 2), chainEv("chain-resolved", 2), chainEv("chain-resolving", 1)];
    expect(build(events).hero).toMatchObject({ index: 1, eyebrow: "Now resolving" });
    const between = events.slice(0, 4);
    expect(build(between).hero).toMatchObject({ index: 2, eyebrow: "Just resolved" });
  });

  it("puts the result on a resolved link at once", () => {
    id = 0;
    const events = [
      activate(1, 1, TRAP_HOLE),
      chainEv("chain-resolving", 1),
      chainEv("destroy", undefined, { card: GAIA, zone: z(0, MZONE, 2) }),
      chainEv("chain-resolved", 1),
    ];
    const view = build(events, { resultsReady: false });
    expect(view.hero).toMatchObject({ tone: "done", eyebrow: "Resolved" });
    expect(view.hero.outcome?.lines).toEqual(["Destroyed Gaia The Fierce Knight"]);
  });

  it("lists every link, the top of the chain first, with one-line results", () => {
    id = 0;
    const events = [
      activate(1, 0, RAIGEKI),
      activate(2, 1, SOLEMN),
      chainEv("chain-resolving", 2),
      chainEv("chain-negated", 1, { card: RAIGEKI }),
      chainEv("destroy", undefined, { card: RAIGEKI, zone: z(0, SZONE, 0), sourceCode: SOLEMN.code }),
      chainEv("chain-resolved", 2),
      chainEv("chain-resolving", 1),
    ];
    const view = build(events);
    expect(view.rows.map((row) => row.index)).toEqual([2, 1]);
    expect(view.pips).toEqual(["neg", "done"]);
    // The hero is link 1 (negated and resolving), so its row carries no second copy of the result.
    expect(view.hero).toMatchObject({ index: 1, tone: "neg", eyebrow: "Negated" });
    expect(view.rows[0]).toMatchObject({ index: 2, tone: "done", result: "Negated Raigeki and destroyed it", isHero: false });
    expect(view.rows[1]).toMatchObject({ index: 1, result: null, isHero: true });
  });

  it("names targets only through the memory of public names", () => {
    id = 0;
    const events = [activate(1, 1, TRAP_HOLE, { targets: [z(0, MZONE, 2), z(0, MZONE, 3)] })];
    const mem: TargetMemory = new Map([["1:0:4:2", "Gaia The Fierce Knight"]]);
    const view = build(events, { mem });
    expect(view.hero.targets).toEqual([
      { name: "Gaia The Fierce Knight", place: "your Monster Zone 3" },
      { name: null, place: "your Monster Zone 4" },
    ]);
  });

  describe("an unknown card", () => {
    const hidden: DuelCardInfo = { code: 0, name: "", description: "", type: 0, attack: 0, defense: 0, level: 0, attribute: 0, race: "" };

    it("is A card, with no art, no kind and no text", () => {
      id = 0;
      const view = build([activate(1, 1, hidden)]);
      expect(view.hero).toMatchObject({ name: "A card", code: null, kind: null, effect: null });
      expect(view.rows[0]).toMatchObject({ name: "A card", code: null });
    });

    it("leaks no passcode or printed text even when the link carries them", () => {
      id = 0;
      const secret = info(55144522, "", TRAP_TEXT, TYPE_NORMAL_TRAP);
      const view = build([activate(1, 1, secret, { description: "Destroy it." })]);
      const dump = JSON.stringify(view);
      expect(dump).not.toContain("55144522");
      expect(dump).not.toContain("Destroy it");
      expect(dump).not.toContain("Target that monster");
      expect(view.hero.code).toBeNull();
    });

    it("leaks nothing through the strip or its label either", () => {
      id = 0;
      const secret = info(55144522, "", TRAP_TEXT, TYPE_NORMAL_TRAP);
      const view = build([activate(1, 1, secret)]);
      const strip = buildStripView(view);
      expect(strip).toMatchObject({ name: "A card", summary: "" });
      expect(stripLabel(strip)).not.toContain("55144522");
      expect(stripLabel(strip)).toBe("Chain Link 1 of 1: A card, activated. Show chain details");
    });
  });

  describe("a target in a hand or face-down", () => {
    it("shows the place only, and no name", () => {
      id = 0;
      const events = [activate(1, 1, TRAP_HOLE, { targets: [z(0, HAND, 1), z(0, SZONE, 0)] })];
      const view = build(events);
      expect(view.hero.targets.map((t) => t.name)).toEqual([null, null]);
      expect(JSON.stringify(view.hero.targets)).not.toMatch(/\d{5,}/);
    });
  });
});

describe("buildStripView", () => {
  it("says state and effect, then the result", () => {
    id = 0;
    const events = [activate(1, 1, TRAP_HOLE), chainEv("chain-resolving", 1)];
    const state = deriveChainState(events);
    const view = buildPanelView({ state, focus: chainFocusLink(state)!, outcomes: new Map(), resultsReady: true, targets: new Map(), who });
    expect(buildStripView(view)).toEqual({
      index: 1, total: 1, name: "Trap Hole", stateLabel: "Resolving", tone: "now", summary: "Target that monster; destroy that target.",
    });
    const done = [...events, chainEv("destroy", undefined, { card: GAIA, zone: z(0, MZONE, 2) }), chainEv("chain-resolved", 1)];
    const state2 = deriveChainState(done);
    const after = buildPanelView({ state: state2, focus: chainFocusLink(state2)!, outcomes: chainOutcomes(done, state2, who), resultsReady: true, targets: new Map(), who });
    expect(buildStripView(after)).toMatchObject({ stateLabel: "Resolved", summary: "Destroyed Gaia The Fierce Knight" });
  });

  it("applies one beat at a time with the same result as folding the window", () => {
    id = 0;
    const events = [activate(1, 1, TRAP_HOLE), chainEv("chain-resolving", 1), chainEv("chain-resolved", 1)];
    expect(events.reduce(applyChainEvent, EMPTY_CHAIN)).toEqual(deriveChainState(events));
  });
});
