import { describe, expect, it } from "vitest";
import type { DuelCardInfo, DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import {
  applyChainEvent,
  badgeCenter,
  chainAnchor,
  chainAnnouncement,
  chainCallout,
  chainCardName,
  chainFocusLink,
  chainLinkLabel,
  chainSeatLabel,
  chainStackRows,
  chainStepDelay,
  chainStateKey,
  chainWirePath,
  deriveChainState,
  EMPTY_CHAIN,
  isChainEvent,
  nextToResolve,
  strayLinks,
  type ChainState,
} from "../../src/components/duel/chain-state";

const HAND = 0x02;
const MZONE = 0x04;
const SZONE = 0x08;
const GRAVE = 0x10;

const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const info = (code: number, name = `Card ${code}`): DuelCardInfo => ({
  code, name, description: "", type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "Warrior",
});

let nextId = 1;
const activate = (chainIndex: number, seat: number, code: number, zone: DuelZoneRef): DuelEvent => ({
  id: nextId++, kind: "activate", text: "a", seat, card: info(code), chainIndex, zone,
});
const ev = (kind: DuelEvent["kind"], chainIndex?: number): DuelEvent => ({
  id: nextId++, kind, text: kind, ...(chainIndex != null ? { chainIndex } : {}),
});

const fold = (events: DuelEvent[], from: ChainState = EMPTY_CHAIN) => events.reduce(applyChainEvent, from);

describe("applyChainEvent", () => {
  it("ignores events that are not chain events", () => {
    const move: DuelEvent = { id: 1, kind: "move", text: "m" };
    expect(applyChainEvent(EMPTY_CHAIN, move)).toBe(EMPTY_CHAIN);
    expect(isChainEvent(move)).toBe(false);
    expect(isChainEvent({ id: 2, kind: "activate", text: "plain" })).toBe(false);
    expect(isChainEvent(activate(1, 0, 5, z(0, SZONE, 0)))).toBe(true);
  });

  it("adds a link per activation, numbered by the engine", () => {
    const state = fold([activate(1, 0, 11, z(0, SZONE, 2)), activate(2, 1, 22, z(1, HAND, 3))]);
    expect(state.links.map((l) => [l.index, l.seat, l.code, l.status, l.negated])).toEqual([
      [1, 0, 11, "pending", false],
      [2, 1, 22, "pending", false],
    ]);
    expect(state.links[1].zone).toEqual(z(1, HAND, 3));
    expect(state.links[0].name).toBe("Card 11");
    expect(state.resolving).toBeNull();
  });

  it("restarts the chain when a new link 1 arrives (a missed chain-end)", () => {
    const state = fold([activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0)), activate(1, 0, 33, z(0, MZONE, 0))]);
    expect(state.links.map((l) => l.code)).toEqual([33]);
  });

  it("resolves highest link first, one link at a time", () => {
    let state = fold([activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))]);
    state = fold([ev("chain-resolving", 2)], state);
    expect(state.resolving).toBe(2);
    expect(state.links.map((l) => l.status)).toEqual(["pending", "resolving"]);
    state = fold([ev("chain-resolved", 2), ev("chain-resolving", 1)], state);
    expect(state.resolving).toBe(1);
    expect(state.links.map((l) => l.status)).toEqual(["resolving", "resolved"]);
    state = fold([ev("chain-resolved", 1)], state);
    expect(state.resolving).toBeNull();
    expect(state.links.map((l) => l.status)).toEqual(["resolved", "resolved"]);
  });

  it("marks a negated link and keeps it negated after it resolves", () => {
    let state = fold([activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0)), ev("chain-resolving", 2), ev("chain-negated", 1)]);
    expect(state.links[0].negated).toBe(true);
    expect(state.links[1].negated).toBe(false);
    state = fold([ev("chain-resolved", 2), ev("chain-resolving", 1), ev("chain-resolved", 1)], state);
    expect(state.links[0]).toMatchObject({ status: "resolved", negated: true });
  });

  it("clears on chain-end", () => {
    const state = fold([activate(1, 0, 11, z(0, SZONE, 0)), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")]);
    expect(state).toBe(EMPTY_CHAIN);
  });

  it("makes a placeholder for a link whose activation left the event window", () => {
    const state = fold([ev("chain-resolving", 2)]);
    expect(state.links).toHaveLength(2);
    expect(state.links[1]).toMatchObject({ index: 2, status: "resolving", code: null, zone: null });
    expect(state.links[0]).toMatchObject({ index: 1, status: "pending", code: null });
  });

  it("does not mutate the previous state", () => {
    const before = fold([activate(1, 0, 11, z(0, SZONE, 0))]);
    const snapshot = JSON.stringify(before);
    fold([ev("chain-resolving", 1)], before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("deriveChainState", () => {
  const snapshot: DuelChainLink[] = [
    { index: 1, seat: 0, code: 11, name: "Card 11" },
    { index: 2, seat: 1, code: 22, name: "Card 22", description: "Negate" },
  ];

  it("folds the whole event window in id order", () => {
    const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))].reverse();
    const state = deriveChainState(events, snapshot);
    expect(state.links.map((l) => l.index)).toEqual([1, 2]);
  });

  it("is empty after a chain that ended", () => {
    const events = [activate(1, 0, 11, z(0, SZONE, 0)), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")];
    expect(deriveChainState(events, []).links).toEqual([]);
  });

  it("falls back to the snapshot chain when the window has no activations", () => {
    const state = deriveChainState([], snapshot);
    expect(state.links.map((l) => [l.index, l.seat, l.code, l.name, l.status, l.zone])).toEqual([
      [1, 0, 11, "Card 11", "pending", null],
      [2, 1, 22, "Card 22", "pending", null],
    ]);
    expect(state.links[1].description).toBe("Negate");
  });

  it("fills links the window lost from the snapshot, keeping the known zones", () => {
    const events = [activate(2, 1, 22, z(1, SZONE, 0))];
    const state = deriveChainState(events, snapshot);
    expect(state.links.map((l) => l.code)).toEqual([11, 22]);
    expect(state.links[1].zone).toEqual(z(1, SZONE, 0));
    expect(state.links[0].zone).toBeNull();
  });

  it("keeps one link per index when the snapshot lists an index twice", () => {
    const dup: DuelChainLink[] = [
      { index: 1, seat: 0, code: 11, name: "Card 11" },
      { index: 1, seat: 0, code: 12, name: "Card 12" },
      { index: 2, seat: 1, code: 22, name: "Card 22" },
    ];
    const state = deriveChainState([], dup);
    expect(state.links.map((l) => l.index)).toEqual([1, 2]);
    expect(state.links[0].code).toBe(12);
  });

  it("numbers a snapshot with a gap or a bad index without repeating a number", () => {
    const state = deriveChainState([], [
      { index: 3, seat: 0, code: 33, name: "Card 33" },
      { index: 0, seat: 0, code: 1, name: "Bad" },
      { index: 1, seat: 1, code: 11, name: "Card 11" },
    ]);
    expect(state.links.map((l) => l.index)).toEqual([1, 2, 3]);
    expect(state.links.map((l) => l.code)).toEqual([11, null, 33]);
  });

  it("shows a link once when the window and the snapshot both hold it, and keeps the window's zone", () => {
    const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 3))];
    const state = deriveChainState(events, snapshot);
    expect(state.links.map((l) => l.index)).toEqual([1, 2]);
    expect(state.links.map((l) => l.zone)).toEqual([z(0, SZONE, 0), z(1, SZONE, 3)]);
  });

  it("gives the same card two numbers when it activates twice, never the same number twice", () => {
    const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0)), activate(3, 0, 11, z(0, SZONE, 0))];
    const state = deriveChainState(events, [...snapshot, { index: 3, seat: 0, code: 11, name: "Card 11" }]);
    expect(state.links.map((l) => [l.index, l.code])).toEqual([[1, 11], [2, 22], [3, 11]]);
  });

  it("drops stale window links above the snapshot's top (the chain end was missed)", () => {
    const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0)), activate(3, 0, 33, z(0, SZONE, 1))];
    const state = deriveChainState(events, snapshot);
    expect(state.links.map((l) => l.index)).toEqual([1, 2]);
  });

  it("counts a repeated activation of one index once", () => {
    const state = deriveChainState([activate(1, 0, 11, z(0, SZONE, 0)), activate(1, 0, 11, z(0, SZONE, 0))], []);
    expect(state.links).toHaveLength(1);
  });
});

describe("strayLinks", () => {
  const stack = () => fold([
    activate(1, 0, 11, z(0, SZONE, 0)),
    activate(2, 1, 22, z(1, SZONE, 0)),
    activate(3, 0, 33, z(0, SZONE, 1)),
  ]);

  it("is empty while every link has a card on the board: the badges are the only view", () => {
    expect(strayLinks(stack(), new Set())).toEqual([]);
    expect(strayLinks(EMPTY_CHAIN, new Set([1]))).toEqual([]);
  });

  it("lists a link the board could not place, top of the chain first", () => {
    expect(strayLinks(stack(), new Set([1, 3])).map((l) => l.index)).toEqual([3, 1]);
  });

  it("lists a link with no known zone without waiting for a measure", () => {
    const state = deriveChainState([], [{ index: 1, seat: 0, code: 11, name: "Card 11" }]);
    expect(strayLinks(state, new Set()).map((l) => l.index)).toEqual([1]);
  });

  it("never lists a link twice, and ignores lost indexes that are not in the chain", () => {
    const rows = strayLinks(stack(), new Set([2, 2, 9]));
    expect(rows.map((l) => l.index)).toEqual([2]);
  });
});

describe("badgeCenter", () => {
  const box = { left: 100, top: 200, width: 60, height: 80 };
  it("sits on the top right corner of the card, a third of the badge outside it", () => {
    const c = badgeCenter(box, 20, 0);
    expect(c.x).toBeCloseTo(100 + 60 + 20 * 0.34 - 10, 5);
    expect(c.y).toBeCloseTo(200 - 20 * 0.34 + 10, 5);
  });
  it("fans a second badge on the same card to the left", () => {
    expect(badgeCenter(box, 20, 1).x).toBeLessThan(badgeCenter(box, 20, 0).x);
  });
});

describe("chainWirePath", () => {
  it("draws a gentle arc between two badges", () => {
    expect(chainWirePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)).toBe("M0 0 Q50 18 100 0");
  });
  it("bows to the same side of the line whatever its direction", () => {
    expect(chainWirePath({ x: 0, y: 0 }, { x: 0, y: 100 }, 10)).toBe("M0 0 Q-18 50 0 100");
  });
  it("draws nothing when the badges touch (two links on one card)", () => {
    expect(chainWirePath({ x: 0, y: 0 }, { x: 8, y: 0 }, 10)).toBeNull();
  });
});

describe("chainLinkLabel", () => {
  const names = (seat: number) => `Player ${seat + 1}`;
  const state = fold([activate(1, 0, 11, z(0, SZONE, 0)), { ...activate(2, 1, 22, z(1, SZONE, 0)), description: "Negate it" }]);
  it("reads as Chain Link N, the card and who chained it", () => {
    expect(chainLinkLabel(state.links[1], 0, names)).toBe("Chain Link 2: Card 22, Opponent. Negate it");
    expect(chainLinkLabel(state.links[0], 0, names)).toBe("Chain Link 1: Card 11, You");
  });
  it("names the card Effect when the engine gave none, and the player to a spectator", () => {
    const gap = fold([ev("chain-resolving", 1)]);
    expect(chainLinkLabel(gap.links[0], null, names)).toBe("Chain Link 1: A card, Player 1, resolving");
  });
  it("says negated and resolved", () => {
    const done = fold([ev("chain-negated", 1), ev("chain-resolved", 1)], state);
    expect(chainLinkLabel(done.links[0], 0, names)).toBe("Chain Link 1: Card 11, You, negated, resolved");
  });
});

describe("chainAnnouncement", () => {
  const names = (seat: number) => `Player ${seat + 1}`;
  const one = fold([activate(1, 0, 11, z(0, SZONE, 0))]);
  const two = fold([activate(2, 1, 22, z(1, SZONE, 0))], one);

  it("announces a new link", () => {
    expect(chainAnnouncement(EMPTY_CHAIN, one, 0, names)).toBe("Chain Link 1: Card 11, You");
    expect(chainAnnouncement(one, two, 0, names)).toBe("Chain Link 2: Card 22, Opponent");
  });
  it("announces the link that starts resolving, and a negation", () => {
    const resolving = fold([ev("chain-resolving", 2)], two);
    expect(chainAnnouncement(two, resolving, 0, names)).toBe("Chain Link 2 resolving: Card 22, Opponent");
    const negated = fold([ev("chain-negated", 2)], resolving);
    expect(chainAnnouncement(resolving, negated, 0, names)).toBe("Chain Link 2 was negated");
  });
  it("announces the end of the chain", () => {
    expect(chainAnnouncement(two, EMPTY_CHAIN, 0, names)).toBe("Chain ended");
  });
  it("is silent when nothing the player needs changed", () => {
    expect(chainAnnouncement(two, two, 0, names)).toBeNull();
    expect(chainAnnouncement(EMPTY_CHAIN, EMPTY_CHAIN, 0, names)).toBeNull();
  });
});

describe("chainAnchor", () => {
  const link = (zone: DuelZoneRef | null) =>
    ({ index: 1, seat: 0, code: 1, name: "x", card: null, zone, status: "pending", negated: false }) as ChainState["links"][number];

  it("anchors a field card on its zone", () => {
    expect(chainAnchor(link(z(0, SZONE, 2)))).toEqual({ zone: z(0, SZONE, 2) });
    expect(chainAnchor(link(z(1, MZONE, 6)))).toEqual({ zone: z(1, MZONE, 6) });
  });
  it("anchors a hand card on its hand slot, falling back to the hand", () => {
    expect(chainAnchor(link(z(1, HAND, 3)))).toEqual({ zone: z(1, HAND, 3), fallback: { kind: "hand", controller: 1 } });
  });
  it("anchors a pile card on its card slot, falling back to the pile", () => {
    expect(chainAnchor(link(z(0, GRAVE, 4)))).toEqual({
      zone: z(0, GRAVE, 4),
      fallback: { kind: "pile", controller: 0, location: GRAVE },
    });
  });
  it("has no anchor when the zone is unknown", () => {
    expect(chainAnchor(link(null))).toBeNull();
  });
});

describe("chainSeatLabel", () => {
  const names = (seat: number) => `Player ${seat + 1}`;
  it("says you / opponent to a seated player", () => {
    expect(chainSeatLabel(0, 0, names)).toBe("You");
    expect(chainSeatLabel(1, 0, names)).toBe("Opponent");
  });
  it("uses the names for a spectator", () => {
    expect(chainSeatLabel(1, null, names)).toBe("Player 2");
  });
  it("names every rival at a table of 3 or 4, never Opponent", () => {
    expect(chainSeatLabel(0, 0, names, true)).toBe("You");
    expect(chainSeatLabel(1, 0, names, true)).toBe("Player 2");
    expect(chainSeatLabel(2, 0, names, true)).toBe("Player 3");
  });
});

describe("chainStepDelay", () => {
  it("gives every step a readable length", () => {
    expect(chainStepDelay("activate", 1, false)).toBeGreaterThanOrEqual(500);
    expect(chainStepDelay("chain-resolving", 1, false)).toBeGreaterThanOrEqual(600);
  });
  it("speeds up a long backlog but never below the floor", () => {
    const slow = chainStepDelay("chain-resolving", 1, false);
    const fast = chainStepDelay("chain-resolving", 20, false);
    expect(fast).toBeLessThan(slow);
    expect(fast).toBeGreaterThanOrEqual(220);
  });
});

describe("a chain resolving, link by link", () => {
  const three = () => fold([activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0)), activate(3, 0, 33, z(0, SZONE, 1))]);
  const statuses = (s: ChainState) => s.links.map((l) => l.status);

  it("has no up next while the chain is still being built", () => {
    expect(nextToResolve(three())).toBeNull();
    expect(nextToResolve(EMPTY_CHAIN)).toBeNull();
  });

  it("marks the link below as up next as soon as the top link resolves", () => {
    const state = fold([ev("chain-resolving", 3)], three());
    expect(nextToResolve(state)).toBe(2);
  });

  it("walks resolving, resolved, then the next link, top down, with one up next each time", () => {
    let state = three();
    const steps: Array<[DuelEvent["kind"], number, string[], number | null]> = [
      ["chain-resolving", 3, ["pending", "pending", "resolving"], 2],
      ["chain-resolved", 3, ["pending", "pending", "resolved"], 2],
      ["chain-resolving", 2, ["pending", "resolving", "resolved"], 1],
      ["chain-resolved", 2, ["pending", "resolved", "resolved"], 1],
      ["chain-resolving", 1, ["resolving", "resolved", "resolved"], null],
      ["chain-resolved", 1, ["resolved", "resolved", "resolved"], null],
    ];
    for (const [kind, index, expected, next] of steps) {
      state = fold([ev(kind, index)], state);
      expect(statuses(state)).toEqual(expected);
      expect(nextToResolve(state)).toBe(next);
    }
  });

  it("removes every link when the chain ends", () => {
    const state = fold([ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")], fold([activate(1, 0, 11, z(0, SZONE, 0))]));
    expect(state.links).toEqual([]);
    expect(nextToResolve(state)).toBeNull();
  });

  it("keeps a negated link marked while it is still resolving, before it clears", () => {
    let state = fold([ev("chain-resolving", 3), ev("chain-negated", 3)], three());
    expect(state.links[2]).toMatchObject({ status: "resolving", negated: true });
    state = fold([ev("chain-resolved", 3)], state);
    expect(state.links[2]).toMatchObject({ status: "resolved", negated: true });
  });
});

describe("chainStateKey", () => {
  it("differs when a status changes and matches for equal states", () => {
    const a = fold([activate(1, 0, 11, z(0, SZONE, 0))]);
    const b = fold([ev("chain-resolving", 1)], a);
    expect(chainStateKey(a)).not.toBe(chainStateKey(b));
    expect(chainStateKey(a)).toBe(chainStateKey(fold([{ ...activate(1, 0, 11, z(0, SZONE, 0)), id: 999 }])));
  });
});

// The recorded chain from the report: Dark Dust Spirit's trigger (89111398), answered by My Body as a Shield (69279219).
describe("chain stack and callout", () => {
  const you = (seat: number) => (seat === 0 ? "You" : "Practice Bot");
  const dust = (): DuelEvent => ({
    id: nextId++, kind: "activate", text: "a", seat: 0, chainIndex: 1, zone: z(0, MZONE, 2),
    card: info(89111398, "Dark Dust Spirit"), description: "Destroy all other face-up monsters",
  });
  const shield = (): DuelEvent => ({
    id: nextId++, kind: "activate", text: "a", seat: 1, chainIndex: 2, zone: z(1, SZONE, 0),
    card: info(69279219, "My Body as a Shield"),
  });

  it("lists the chain top first with its owner, so link 1 is at the bottom", () => {
    const state = fold([dust(), shield()]);
    const rows = chainStackRows(state);
    expect(rows.map((r) => r.index)).toEqual([2, 1]);
    expect(rows.map((r) => r.seat)).toEqual([1, 0]);
    expect(chainStackRows(EMPTY_CHAIN)).toEqual([]);
  });

  it("does not reorder or change the state it reads", () => {
    const state = fold([dust(), shield()]);
    chainStackRows(state);
    expect(state.links.map((l) => l.index)).toEqual([1, 2]);
  });

  it("focuses the newest activation, then the resolving link, and nothing when the chain is empty", () => {
    const opened = fold([dust()]);
    expect(chainFocusLink(opened)?.index).toBe(1);
    const two = fold([shield()], opened);
    expect(chainFocusLink(two)?.index).toBe(2);
    const resolving = fold([ev("chain-resolving", 2)], two);
    expect(chainFocusLink(resolving)?.index).toBe(2);
    const next = fold([ev("chain-resolved", 2), ev("chain-resolving", 1)], resolving);
    expect(chainFocusLink(next)?.index).toBe(1);
    expect(chainFocusLink(fold([ev("chain-end")], next))).toBeNull();
    expect(chainFocusLink(EMPTY_CHAIN)).toBeNull();
  });

  it("keeps the focus on the link that resolved last, not back on the top link", () => {
    const base = fold([dust(), shield()]);
    const afterTop = fold([ev("chain-resolving", 2), ev("chain-resolved", 2)], base);
    expect(chainFocusLink(afterTop)?.index).toBe(2);
    const afterLast = fold([ev("chain-resolving", 1), ev("chain-resolved", 1)], afterTop);
    expect(afterLast.links.every((link) => link.status === "resolved")).toBe(true);
    expect(chainFocusLink(afterLast)?.index).toBe(1);
  });

  it("clears the stack when the chain ends", () => {
    const state = fold([dust(), shield(), ev("chain-resolving", 2), ev("chain-resolved", 2), ev("chain-end")]);
    expect(chainStackRows(state)).toEqual([]);
  });

  it("marks a resolved link as resolved and keeps the others waiting", () => {
    const state = fold([dust(), shield(), ev("chain-resolving", 2), ev("chain-resolved", 2)]);
    expect(chainStackRows(state).map((r) => r.status)).toEqual(["resolved", "pending"]);
  });

  it("says a card activates its effect, with the engine's effect text, never trigger or quick", () => {
    const callout = chainCallout(fold([dust()]).links[0], 0, you);
    expect(callout.label).toBe("Chain 1");
    expect(callout.title).toBe("Dark Dust Spirit");
    expect(callout.owner).toBe("You");
    expect(callout.action).toBe("activates its effect");
    expect(callout.effect).toBe("Destroy all other face-up monsters");
    expect(callout.text).toBe("Chain 1 · Dark Dust Spirit · activates its effect · You");
    expect(callout.text).not.toMatch(/trigger|quick/i);
  });

  it("names the rival as Opponent, or by name at a table", () => {
    const link = fold([dust(), shield()]).links[1];
    expect(chainCallout(link, 0, you).owner).toBe("Opponent");
    expect(chainCallout(link, 0, you, true).owner).toBe("Practice Bot");
    expect(chainCallout(link, null, you).owner).toBe("Practice Bot");
    expect(chainCallout(link, 0, you).effect).toBeNull();
  });

  it("falls back to 'activates an effect' when the card is unknown", () => {
    const state = fold([ev("chain-resolving", 3)]);
    const callout = chainCallout(state.links[2], 0, you);
    expect(callout.title).toBe("A card");
    expect(callout.action).toBe("is resolving");
    const pending = chainCallout(deriveChainState([], [{ index: 1, seat: 1 }]).links[0], 0, you);
    expect(pending.action).toBe("activates an effect");
    expect(pending.text).toBe("Chain 1 · A card · activates an effect · Opponent");
  });

  it("uses one label for an unknown card everywhere and never shows a passcode", () => {
    const unnamed = deriveChainState([], [{ index: 1, seat: 1, code: 89111398 }]).links[0];
    expect(unnamed.name).toBeNull();
    expect(chainCardName(unnamed)).toBe("A card");
    expect(chainCardName({ name: "  " })).toBe("A card");
    expect(chainCallout(unnamed, 0, you).title).toBe("A card");
    expect(chainLinkLabel(unnamed, 0, you)).toBe("Chain Link 1: A card, Opponent");
    const said = chainAnnouncement(EMPTY_CHAIN, unnamed ? { links: [unnamed], resolving: null } : EMPTY_CHAIN, 0, you);
    expect(said).toBe("Chain Link 1: A card, Opponent");
    const resolving = { links: [{ ...unnamed, status: "resolving" as const }], resolving: 1 };
    expect(chainAnnouncement({ links: [unnamed], resolving: null }, resolving, 0, you)).toBe("Chain Link 1 resolving: A card, Opponent");
    expect(`${chainCallout(unnamed, 0, you).title}${chainLinkLabel(unnamed, 0, you)}`).not.toMatch(/89111398|Card \d/);
  });

  it("follows the link through resolving, resolved and negated", () => {
    const base = fold([dust(), shield()]);
    expect(chainCallout(fold([ev("chain-resolving", 2)], base).links[1], 0, you).action).toBe("is resolving");
    expect(chainCallout(fold([ev("chain-resolving", 2), ev("chain-resolved", 2)], base).links[1], 0, you).action).toBe("resolved");
    expect(chainCallout(fold([ev("chain-negated", 2)], base).links[1], 0, you).action).toBe("was negated");
  });
});
