import { describe, expect, it } from "vitest";
import type { DuelCard, DuelCardInfo, DuelEvent } from "@yugidraft/shared/duels";
import { buildHistoryView } from "../src/components/duel/history-entries";
import {
  emptyHistory,
  ingestHistory,
  shouldResetHistory,
  visibleHistory,
  type HistoryContext,
  type HistoryTile,
} from "../src/components/duel/history-model";

const MZONE = 0x04;

function info(code: number, name: string): DuelCardInfo {
  return { code, name, description: "", type: 1, attack: 1000, defense: 1000, level: 4, attribute: 1, race: "" };
}

function onField(controller: number, sequence: number, code?: number): DuelCard {
  return { controller, location: MZONE, sequence, position: 1, code };
}

function ctx(overrides: Partial<HistoryContext> = {}): HistoryContext {
  return { revision: 1, turn: 3, turnSeat: 0, phase: "battle", seatCount: 2, cards: [], ...overrides };
}

const zone = (controller: number, sequence: number) => ({ controller, location: MZONE, sequence });

function tiles(state: ReturnType<typeof ingestHistory>): HistoryTile[] {
  return state.items.filter((item): item is HistoryTile => item.type === "tile");
}

describe("history model", () => {
  it("consumes target updates without creating history tiles or changing the activation tile", () => {
    const activation: DuelEvent = { id: 1, kind: "activate", chainIndex: 1, seat: 0, text: "MST is activating" };
    const before = ingestHistory(emptyHistory(), [activation], ctx());
    const targets: DuelEvent[] = [
      { id: 2, kind: "target", chainIndex: 1, seat: 0, text: "Chain Link 1 targets 1 card", targets: [zone(1, 0)] },
      { id: 3, kind: "target", chainIndex: 1, seat: 0, text: "Chain Link 1 targets 0 cards", targets: [] },
    ];
    const after = ingestHistory(before, [activation, ...targets], ctx({ revision: 2 }));
    expect(after.items).toEqual(before.items);
    expect(after.lastId).toBe(3);
    expect(ingestHistory(emptyHistory(), targets, ctx()).items).toEqual([]);
  });

  it("merges attack + battle damage + destroy into one tile", () => {
    const events: DuelEvent[] = [
      { id: 10, kind: "attack", seat: 0, text: "Player 1 declares an attack", zone: zone(0, 0), target: zone(1, 0) },
      { id: 11, kind: "damage", seat: 1, amount: 800, cause: "battle", text: "Player 2 takes 800" },
      { id: 12, kind: "destroy", seat: 1, zone: zone(1, 0), card: info(2, "Target"), text: "Target destroyed" },
    ];
    const state = ingestHistory(
      emptyHistory(),
      events,
      ctx({ cards: [onField(0, 0, 1), onField(1, 0, 2)] }),
    );
    const list = tiles(state);
    expect(list).toHaveLength(1);
    const tile = list[0];
    expect(tile.kind).toBe("attack");
    expect(tile.card?.code).toBe(1);
    expect(tile.target).toMatchObject({ seat: 1, direct: false });
    expect(tile.target?.card?.code).toBe(2);
    expect(tile.hits).toEqual([{ seat: 1, amount: 800, cause: "battle" }]);
    expect(tile.destroyed).toHaveLength(1);
    expect(tile.destroyed[0].role).toBe("target");
  });

  it("looks up a destroyed target from the previous field snapshot", () => {
    const first = ingestHistory(emptyHistory(), [], ctx({ cards: [onField(0, 0, 1), onField(1, 0, 2)] }));
    // emptyHistory has no ids yet, so seed memory through a benign first event.
    const seeded = ingestHistory(first, [{ id: 1, kind: "phase", text: "Battle Phase" }], ctx({ cards: [onField(0, 0, 1), onField(1, 0, 2)] }));
    const next = ingestHistory(
      seeded,
      [
        { id: 2, kind: "attack", seat: 0, text: "attack", zone: zone(0, 0), target: zone(1, 0) },
        { id: 3, kind: "destroy", zone: zone(1, 0), text: "destroyed" },
      ],
      ctx({ cards: [onField(0, 0, 1)] }),
    );
    const tile = tiles(next)[0];
    expect(tile.target?.card?.code).toBe(2);
    expect(tile.destroyed[0].card?.code).toBe(2);
  });

  it("marks a direct attack and attaches damage to the defender", () => {
    const state = ingestHistory(
      emptyHistory(),
      [
        { id: 1, kind: "attack", seat: 1, text: "Player 2 declares a direct attack", zone: zone(1, 2) },
        { id: 2, kind: "damage", seat: 0, amount: 2500, cause: "battle", text: "" },
      ],
      ctx({ cards: [onField(1, 2, 7)] }),
    );
    const tile = tiles(state)[0];
    expect(tile.target).toMatchObject({ direct: true, seat: 0, card: null });
    expect(tile.hits[0]).toMatchObject({ seat: 0, amount: 2500 });
  });

  it("a battle tile does not swallow an unrelated destroy", () => {
    const state = ingestHistory(
      emptyHistory(),
      [
        { id: 1, kind: "attack", seat: 0, text: "attack", zone: zone(0, 0), target: zone(1, 0) },
        { id: 2, kind: "destroy", zone: zone(1, 3), card: info(9, "Bystander"), cause: "effect", text: "gone" },
      ],
      ctx(),
    );
    const list = tiles(state);
    expect(list.map((tile) => tile.kind)).toEqual(["attack", "destroy"]);
    expect(list[0].destroyed).toHaveLength(0);
  });

  it("groups a chain link with its resolution and effect damage", () => {
    const state = ingestHistory(
      emptyHistory(),
      [
        { id: 1, kind: "activate", seat: 0, card: info(5, "Trap"), chainIndex: 1, text: "Trap is activating" },
        { id: 2, kind: "activate", seat: 1, card: info(6, "Response"), chainIndex: 2, text: "Response is activating" },
        { id: 3, kind: "chain-resolving", seat: 1, chainIndex: 2, text: "" },
        { id: 4, kind: "damage", seat: 0, amount: 500, cause: "effect", text: "" },
        { id: 5, kind: "chain-resolved", seat: 1, chainIndex: 2, text: "" },
        { id: 6, kind: "chain-resolving", seat: 0, chainIndex: 1, text: "" },
        { id: 7, kind: "chain-negated", seat: 0, chainIndex: 1, text: "" },
        { id: 8, kind: "chain-end", text: "Chain ended" },
      ],
      ctx(),
    );
    const list = tiles(state);
    expect(list).toHaveLength(2);
    expect(list[0].chain).toEqual({ index: 1, size: 2, status: "negated" });
    expect(list[1].chain).toEqual({ index: 2, size: 2, status: "resolved" });
    expect(list[1].hits).toEqual([{ seat: 0, amount: 500, cause: "effect" }]);
  });

  it("keeps a negated link negated when its own resolving and resolved events follow", () => {
    const state = ingestHistory(
      emptyHistory(),
      [
        { id: 1, kind: "activate", seat: 0, card: info(5, "Searcher"), chainIndex: 1, text: "Searcher is activating" },
        { id: 2, kind: "activate", seat: 1, card: info(6, "Hand trap"), chainIndex: 2, text: "Hand trap is activating" },
        { id: 3, kind: "chain-resolving", seat: 1, chainIndex: 2, text: "" },
        { id: 4, kind: "chain-negated", seat: 0, chainIndex: 1, text: "" },
        { id: 5, kind: "chain-resolved", seat: 1, chainIndex: 2, text: "" },
        { id: 6, kind: "chain-resolving", seat: 0, chainIndex: 1, text: "" },
        { id: 7, kind: "chain-resolved", seat: 0, chainIndex: 1, text: "" },
        { id: 8, kind: "chain-end", text: "Chain ended" },
      ],
      ctx(),
    );
    const list = tiles(state);
    expect(list[0].chain?.status).toBe("negated");
    expect(list[1].chain?.status).toBe("resolved");
  });

  it("makes standalone tiles for damage and destroy that belong to nothing", () => {
    const state = ingestHistory(
      emptyHistory(),
      [
        { id: 1, kind: "damage", seat: 0, amount: 1000, cause: "cost", text: "" },
        { id: 2, kind: "destroy", zone: zone(1, 1), card: info(3, "Lonely"), text: "" },
      ],
      ctx(),
    );
    expect(tiles(state).map((tile) => tile.kind)).toEqual(["damage", "destroy"]);
  });

  it("keeps hidden summon and set tiles without identity", () => {
    const state = ingestHistory(
      emptyHistory(),
      [
        { id: 1, kind: "set", seat: 1, text: "Player 2 Sets a card" },
        { id: 2, kind: "summon", seat: 1, text: "Player 2 Special Summons a face-down monster" },
      ],
      ctx(),
    );
    const list = tiles(state);
    expect(list.every((tile) => tile.card == null)).toBe(true);
    expect(list[1].summonKind).toBe("special");
  });

  it("turns phase events into separators and counts turns backwards from the engine", () => {
    const state = ingestHistory(
      emptyHistory(),
      [
        { id: 1, kind: "phase", text: "Main Phase 1" },
        { id: 2, kind: "summon", seat: 1, card: info(1, "A"), text: "" },
        { id: 3, kind: "phase", text: "End Phase" },
        { id: 4, kind: "phase", text: "Main Phase 1" },
        { id: 5, kind: "summon", seat: 0, card: info(2, "B"), text: "" },
      ],
      ctx({ turn: 4, turnSeat: 1 }),
    );
    const list = tiles(state);
    expect(list.map((tile) => tile.turn)).toEqual([3, 4]);
    const seps = state.items.filter((item) => item.type === "sep");
    expect(seps).toHaveLength(3);
    expect(seps[0]).toMatchObject({ turn: 3, turnSeat: 0 });
    expect(seps[2]).toMatchObject({ turn: 4, turnSeat: 1 });
  });

  it("collapses empty phases", () => {
    const state = ingestHistory(
      emptyHistory(),
      [
        { id: 1, kind: "phase", text: "Main Phase 1" },
        { id: 2, kind: "phase", text: "Battle Phase" },
        { id: 3, kind: "phase", text: "Main Phase 2" },
        { id: 4, kind: "phase", text: "End Phase" },
      ],
      ctx(),
    );
    expect(state.items.map((item) => (item.type === "sep" ? item.label : ""))).toEqual(["Main Phase 1", "End Phase"]);
  });

  it("accumulates across a rolling window and ignores replays", () => {
    const a: DuelEvent[] = [{ id: 1, kind: "summon", seat: 0, card: info(1, "A"), text: "" }];
    let state = ingestHistory(emptyHistory(), a, ctx());
    expect(state.animateAfter).toBe(1);
    const window2: DuelEvent[] = [{ id: 2, kind: "summon", seat: 0, card: info(2, "B"), text: "" }];
    state = ingestHistory(state, window2, ctx({ revision: 2 }));
    expect(tiles(state).map((tile) => tile.key)).toEqual([1, 2]);
    expect(state.animateAfter).toBe(1);
    const again = ingestHistory(state, [...a, ...window2], ctx({ revision: 2 }));
    expect(again).toBe(state);
  });

  it("detects a different duel by revision drop or falling event ids", () => {
    const state = ingestHistory(emptyHistory(), [{ id: 50, kind: "phase", text: "End Phase" }], ctx({ revision: 9 }));
    expect(shouldResetHistory(state, [{ id: 3, kind: "phase", text: "x" }], 9)).toBe(true);
    expect(shouldResetHistory(state, [{ id: 51, kind: "phase", text: "x" }], 2)).toBe(true);
    expect(shouldResetHistory(state, [{ id: 51, kind: "phase", text: "x" }], 10)).toBe(false);
  });

  it("shows the newest tiles first and caps the tile count", () => {
    const events: DuelEvent[] = [];
    for (let i = 1; i <= 20; i += 1) events.push({ id: i, kind: "summon", seat: 0, card: info(i, `C${i}`), text: "" });
    const state = ingestHistory(emptyHistory(), events, ctx());
    const view = visibleHistory(state.items, 12);
    expect(view).toHaveLength(12);
    expect(view[0].key).toBe(20);
  });

  describe("turn seats with four seats", () => {
    // Seat 1 is eliminated on turn 3 (it lost at the end of its turn 2), so turn 5 skips it: turns go
    // seat 0, 1, 2, 3, then 0, 2, ... Counting back from "now" with modular arithmetic would be wrong.
    const turnLog = [
      { id: 1, text: "Turn 1 — Player 1" },
      { id: 2, text: "Turn 2 — Player 2" },
      { id: 3, text: "Turn 3 — Player 3" },
      { id: 4, text: "Player 2 is eliminated" },
      { id: 5, text: "Turn 4 — Player 4" },
      { id: 6, text: "Turn 5 — Player 1" },
      { id: 7, text: "Turn 6 — Player 3" },
    ];
    const window: DuelEvent[] = [3, 4, 5, 6].flatMap((turn, i) => [
      { id: i * 2 + 1, kind: "phase" as const, text: "Main Phase 1" },
      { id: i * 2 + 2, kind: "summon" as const, seat: 0, card: info(turn, `T${turn}`), text: "" },
    ]);
    const four = (overrides: Partial<HistoryContext> = {}) =>
      ctx({ turn: 6, turnSeat: 2, seatCount: 4, anySeatOut: true, ...overrides });
    const seps = (state: ReturnType<typeof ingestHistory>) =>
      state.items.filter((item) => item.type === "sep" && item.turn != null);
    const labels = (state: ReturnType<typeof ingestHistory>) =>
      buildHistoryView(state.items, { mySeat: 0, who: (seat) => `P${(seat ?? 0) + 1}`, seatCount: 4 }).groups.map((group) => group.label);

    it("takes each turn seat from the server's Turn N line, skipping the eliminated seat", () => {
      const state = ingestHistory(emptyHistory(), window, four({ log: turnLog }));
      expect(seps(state).map((sep) => (sep.type === "sep" ? [sep.turn, sep.turnSeat] : null))).toEqual([
        [3, 2],
        [4, 3],
        [5, 0],
        [6, 2],
      ]);
      expect(tiles(state).map((tile) => tile.turnSeat)).toEqual([2, 3, 0, 2]);
      expect(labels(state)).toEqual(["Turn 6 · P3", "Turn 5 · P1", "Turn 4 · P4", "Turn 3 · P3"]);
    });

    it("leaves the seat off an older turn it cannot read once a seat is out", () => {
      // The log no longer holds turns 3 to 5. The current turn still has the engine's turn seat.
      const state = ingestHistory(emptyHistory(), window, four({ log: [{ id: 7, text: "Turn 6 — Player 3" }] }));
      expect(tiles(state).map((tile) => tile.turnSeat)).toEqual([null, null, null, 2]);
      expect(labels(state)).toEqual(["Turn 6 · P3", "Turn 5", "Turn 4", "Turn 3"]);
      const noLog = ingestHistory(emptyHistory(), window, four());
      expect(labels(noLog)).toEqual(["Turn 6 · P3", "Turn 5", "Turn 4", "Turn 3"]);
    });

    it("does not count parity into a turn the window started inside once a seat is out", () => {
      const mid: DuelEvent[] = [
        { id: 1, kind: "summon", seat: 1, card: info(1, "A"), text: "" },
        { id: 2, kind: "phase", text: "Main Phase 1" },
        { id: 3, kind: "summon", seat: 0, card: info(2, "B"), text: "" },
      ];
      const state = ingestHistory(emptyHistory(), mid, four({ turn: 5, turnSeat: 0, log: [{ id: 6, text: "Turn 5 — Player 1" }] }));
      expect(labels(state)).toEqual(["Turn 5 · P1", "Turn 4"]);
    });

    it("counts turns back by modular arithmetic when no seat is out", () => {
      const state = ingestHistory(emptyHistory(), window, four({ anySeatOut: false }));
      expect(tiles(state).map((tile) => tile.turnSeat)).toEqual([3, 0, 1, 2]);
      expect(labels(state)).toEqual(["Turn 6 · P3", "Turn 5 · P2", "Turn 4 · P1", "Turn 3 · P4"]);
    });

    it("ignores log lines it cannot read or that name a seat outside the table", () => {
      const log = [
        { id: 1, text: "Turn 5 — Player 9" },
        { id: 2, text: "Turn five — Player 1" },
        { id: 3, text: "Player 1 wins (surrender)" },
      ];
      const state = ingestHistory(emptyHistory(), window, four({ log }));
      expect(tiles(state).map((tile) => tile.turnSeat)).toEqual([null, null, null, 2]);
    });
  });
});
