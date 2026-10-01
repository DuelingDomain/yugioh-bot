import { describe, expect, it } from "vitest";
import type { DuelCardInfo, DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import {
  applyChainEvent,
  chainAnchor,
  chainPanelVisible,
  chainSeatLabel,
  chainStepDelay,
  chainStateKey,
  deriveChainState,
  EMPTY_CHAIN,
  isChainEvent,
  panelOrder,
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
});

describe("chainPanelVisible", () => {
  const link = (index: number, status: "pending" | "resolving" | "resolved") =>
    ({ index, seat: 0, code: 1, name: "x", card: null, zone: null, status, negated: false }) as ChainState["links"][number];
  const make = (links: ChainState["links"]): ChainState => ({ links, resolving: links.find((l) => l.status === "resolving")?.index ?? null });

  it("is hidden with no chain", () => expect(chainPanelVisible(EMPTY_CHAIN)).toBe(false));
  it("shows one pending link: a response window is open", () => expect(chainPanelVisible(make([link(1, "pending")]))).toBe(true));
  it("hides one link once it starts resolving", () => {
    expect(chainPanelVisible(make([link(1, "resolving")]))).toBe(false);
    expect(chainPanelVisible(make([link(1, "resolved")]))).toBe(false);
  });
  it("shows two or more links, whatever their status", () => {
    expect(chainPanelVisible(make([link(1, "resolved"), link(2, "resolving")]))).toBe(true);
  });
});

describe("panelOrder", () => {
  it("lists links bottom-up: the highest link first in reading order, chain link 1 at the bottom", () => {
    const state = fold([activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0)), activate(3, 0, 33, z(0, SZONE, 1))]);
    expect(panelOrder(state).map((l) => l.index)).toEqual([3, 2, 1]);
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

describe("chainStateKey", () => {
  it("differs when a status changes and matches for equal states", () => {
    const a = fold([activate(1, 0, 11, z(0, SZONE, 0))]);
    const b = fold([ev("chain-resolving", 1)], a);
    expect(chainStateKey(a)).not.toBe(chainStateKey(b));
    expect(chainStateKey(a)).toBe(chainStateKey(fold([{ ...activate(1, 0, 11, z(0, SZONE, 0)), id: 999 }])));
  });
});
