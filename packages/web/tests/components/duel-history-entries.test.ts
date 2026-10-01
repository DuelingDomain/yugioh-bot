import { describe, expect, it } from "vitest";
import type { DuelCardInfo, DuelEvent } from "@yugidraft/shared/duels";
import { emptyHistory, ingestHistory, type HistoryContext } from "../../src/components/duel/history-model";
import {
  buildHistoryView,
  entryFor,
  sideOf,
  type HistoryEntry,
  type HistoryViewOptions,
} from "../../src/components/duel/history-entries";

const MZONE = 0x04;
const HAND = 0x02;
const GRAVE = 0x10;
const REMOVED = 0x20;

function info(code: number, name: string): DuelCardInfo {
  return { code, name, description: "", type: 1, attack: 1000, defense: 1000, level: 4, attribute: 1, race: "" };
}

function ctx(overrides: Partial<HistoryContext> = {}): HistoryContext {
  return { revision: 1, turn: 3, turnSeat: 0, phase: "main1", seatCount: 2, cards: [], ...overrides };
}

const zone = (controller: number, location: number, sequence = 0) => ({ controller, location, sequence });
const who = (seat: number | null) => (seat == null ? "Unknown" : seat === 0 ? "You" : "Rival");
const opts: HistoryViewOptions = { mySeat: 0, who };

function entries(events: DuelEvent[], context = ctx(), options = opts): HistoryEntry[] {
  const state = ingestHistory(emptyHistory(), events, context);
  const view = buildHistoryView(state.items, options);
  return view.groups.flatMap((group) => group.rows).filter((row): row is HistoryEntry => row.type === "entry");
}

describe("history entries: icon kinds and cards", () => {
  it("maps each summon kind to its own icon and keeps the card", () => {
    const list = entries([
      { id: 1, kind: "summon", seat: 0, card: info(1, "Dragon"), summonKind: "synchro", text: "" },
      { id: 2, kind: "summon", seat: 0, card: info(2, "Imp"), text: "Player 1 Tribute Summons" },
    ]);
    // Newest first.
    expect(list.map((entry) => entry.icon)).toEqual(["tribute", "synchro"]);
    expect(list[1].thumbs[0]).toMatchObject({ role: "main", code: 1, name: "Dragon" });
    expect(list[1].verb).toBe("Synchro Summon");
    expect(list[1].sentence).toBe("You Synchro Summoned Dragon.");
  });

  it("shows attacker and target thumbs, with LP loss and a struck target", () => {
    const list = entries(
      [
        { id: 1, kind: "attack", seat: 0, card: info(1, "Attacker"), text: "", zone: zone(0, MZONE, 0), target: zone(1, MZONE, 0) },
        { id: 2, kind: "damage", seat: 1, amount: 800, cause: "battle", text: "" },
        { id: 3, kind: "destroy", seat: 1, zone: zone(1, MZONE, 0), card: info(2, "Defender"), text: "" },
      ],
      ctx({ cards: [{ controller: 1, location: MZONE, sequence: 0, position: 1, code: 2, name: "Defender" }] }),
    );
    expect(list).toHaveLength(1);
    const [entry] = list;
    expect(entry.icon).toBe("attack");
    expect(entry.thumbs.map((thumb) => thumb.role)).toEqual(["attacker", "target"]);
    expect(entry.thumbs[0]).toMatchObject({ code: 1, struck: false, side: "you" });
    expect(entry.thumbs[1]).toMatchObject({ code: 2, struck: true, side: "opp" });
    expect(entry.lp).toEqual([{ side: "opp", seat: 1, delta: -800, cause: "battle", text: "−800" }]);
    expect(entry.title).toBe("Attacker → Defender");
    expect(entry.tags).toEqual([{ label: "Destroyed", tone: "loss" }]);
  });

  it("shows a direct attack as attacker plus a player portrait", () => {
    const [entry] = entries([
      { id: 1, kind: "attack", seat: 1, card: info(7, "Raider"), text: "Player 2 attacks directly", zone: zone(1, MZONE, 2) },
      { id: 2, kind: "damage", seat: 0, amount: 3000, cause: "battle", text: "" },
    ]);
    expect(entry.icon).toBe("direct");
    expect(entry.thumbs[1]).toMatchObject({ role: "portrait", code: null, side: "you" });
    expect(entry.lp[0]).toMatchObject({ delta: -3000, text: "−3,000", side: "you" });
    expect(entry.side).toBe("opp");
    expect(entry.title).toBe("Raider → You");
  });

  it("maps chain links, with resolution and negation tags", () => {
    const list = entries([
      { id: 1, kind: "activate", seat: 0, card: info(5, "Trap"), chainIndex: 1, text: "" },
      { id: 2, kind: "activate", seat: 1, card: info(6, "Response"), chainIndex: 2, text: "" },
      { id: 3, kind: "chain-negated", seat: 0, chainIndex: 1, text: "" },
    ]);
    const first = list.find((entry) => entry.title === "Trap");
    expect(first?.icon).toBe("chain");
    expect(first?.negated).toBe(true);
    expect(first?.tags).toEqual([
      { label: "Chain 1", tone: "chain" },
      { label: "Negated", tone: "loss" },
    ]);
    expect(first?.sentence).toContain("Chain link 1 of 2");
  });

  it("maps a lone activation, destroy, damage and cost rows", () => {
    const list = entries([
      { id: 1, kind: "activate", seat: 0, card: info(5, "Spell"), chainIndex: 1, text: "" },
      { id: 2, kind: "chain-end", text: "" },
      { id: 3, kind: "destroy", seat: 1, zone: zone(1, MZONE, 1), card: info(8, "Victim"), cause: "effect", text: "" },
      { id: 4, kind: "damage", seat: 0, amount: 1000, cause: "cost", text: "" },
    ]);
    expect(list.map((entry) => entry.icon).reverse()).toEqual(["activate", "destroy", "lp-loss"]);
    const cost = list[0];
    expect(cost.verb).toBe("Pays LP");
    expect(cost.lp[0].cause).toBe("cost");
    expect(list[1].thumbs[0]).toMatchObject({ code: 8, struck: true });
  });

  it("maps draws, banishes, Graveyard sends and position changes", () => {
    const list = entries([
      { id: 1, kind: "move", seat: 0, reason: "draw", card: info(1, "Mine"), zone: zone(0, HAND), text: "" },
      { id: 2, kind: "move", seat: 1, reason: "banish", card: info(2, "Gone"), zone: zone(1, REMOVED), text: "" },
      { id: 3, kind: "move", seat: 1, reason: "send", card: info(3, "Sent"), zone: zone(1, GRAVE), text: "" },
      { id: 4, kind: "position", seat: 0, card: info(4, "Wall"), zone: zone(0, MZONE), fromPosition: 1, toPosition: 4, text: "" },
      { id: 5, kind: "position", seat: 1, card: info(9, "Flip"), zone: zone(1, MZONE), fromPosition: 8, toPosition: 1, flip: true, text: "" },
    ]);
    expect(list.map((entry) => entry.icon).reverse()).toEqual(["draw", "banish", "grave", "position", "flip-up"]);
    const byIcon = Object.fromEntries(list.map((entry) => [entry.icon, entry]));
    expect(byIcon.draw.sentence).toBe("You drew Mine.");
    expect(byIcon.banish.sentence).toBe("Rival banished Gone.");
    expect(byIcon.grave.sentence).toBe("Rival sent Sent to the Graveyard.");
    expect(byIcon.position.verb).toBe("To Defense");
    expect(byIcon["flip-up"].verb).toBe("Flips face-up");
  });

  it("ignores moves that have their own tile (summon, destroy, set, activate)", () => {
    const list = entries([
      { id: 1, kind: "move", seat: 0, reason: "summon", card: info(1, "A"), zone: zone(0, MZONE), text: "" },
      { id: 2, kind: "move", seat: 1, reason: "destroy", card: info(2, "B"), zone: zone(1, GRAVE), text: "" },
      { id: 3, kind: "move", seat: 1, reason: "set", zone: zone(1, MZONE), text: "" },
    ]);
    expect(list).toHaveLength(0);
  });

  it("folds back-to-back draws by one seat into one entry", () => {
    const list = entries([
      { id: 1, kind: "move", seat: 1, reason: "draw", zone: zone(1, HAND), text: "" },
      { id: 2, kind: "move", seat: 1, reason: "draw", zone: zone(1, HAND), text: "" },
      { id: 3, kind: "move", seat: 1, reason: "draw", zone: zone(1, HAND), text: "" },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].verb).toBe("Draws 3");
    expect(list[0].title).toBe("3 cards");
    expect(list[0].tags).toEqual([{ label: "×3", tone: "quiet" }]);
  });
});

describe("history entries: LP gain", () => {
  it("makes a +LP entry when LP rises without an event", () => {
    const first = ingestHistory(emptyHistory(), [{ id: 1, kind: "phase", text: "Main Phase 1" }], ctx({ lp: [8000, 8000] }));
    const next = ingestHistory(
      first,
      [{ id: 2, kind: "summon", seat: 0, card: info(1, "Healer"), text: "" }],
      ctx({ revision: 2, lp: [9000, 8000] }),
    );
    const view = buildHistoryView(next.items, opts);
    const gain = view.groups[0].rows[0] as HistoryEntry;
    expect(gain.icon).toBe("lp-gain");
    expect(gain.lp).toEqual([{ side: "you", seat: 0, delta: 1000, cause: "heal", text: "+1,000" }]);
    expect(gain.sentence).toBe("You gained 1,000 LP.");
    expect(view.latestKey).toBe(gain.key);
  });

  it("does not call damage a gain, and counts gain on top of damage", () => {
    const first = ingestHistory(emptyHistory(), [{ id: 1, kind: "phase", text: "Main Phase 1" }], ctx({ lp: [8000, 8000] }));
    const hurt = ingestHistory(
      first,
      [{ id: 2, kind: "damage", seat: 0, amount: 500, cause: "effect", text: "" }],
      ctx({ revision: 2, lp: [7500, 8000] }),
    );
    expect(hurt.items.some((item) => item.type === "tile" && item.kind === "heal")).toBe(false);
    const mixed = ingestHistory(
      hurt,
      [{ id: 3, kind: "damage", seat: 0, amount: 500, cause: "effect", text: "" }],
      ctx({ revision: 3, lp: [8000, 8000] }),
    );
    const heals = mixed.items.filter((item) => item.type === "tile" && item.kind === "heal");
    expect(heals).toHaveLength(1);
    expect(heals[0].type === "tile" && heals[0].gain).toEqual({ seat: 0, amount: 1000 });
  });

  it("gives each recovery its own key, even with no new event", () => {
    let state = ingestHistory(emptyHistory(), [{ id: 4, kind: "phase", text: "Main Phase 1" }], ctx({ lp: [8000, 8000] }));
    state = ingestHistory(state, [], ctx({ revision: 2, lp: [8500, 8000] }));
    state = ingestHistory(state, [], ctx({ revision: 3, lp: [9000, 8000] }));
    const keys = state.items.filter((item) => item.type === "tile").map((item) => item.key);
    expect(new Set(keys).size).toBe(2);
    expect(Math.min(...keys)).toBeGreaterThan(4);
    expect(Math.max(...keys)).toBeLessThan(5);
  });

  it("makes no gain tile when LP is not provided", () => {
    const first = ingestHistory(emptyHistory(), [{ id: 1, kind: "phase", text: "Main Phase 1" }], ctx());
    const next = ingestHistory(first, [{ id: 2, kind: "summon", seat: 0, card: info(1, "A"), text: "" }], ctx({ revision: 2 }));
    expect(next.items.some((item) => item.type === "tile" && item.kind === "heal")).toBe(false);
  });
});

describe("history entries: privacy", () => {
  it("never shows an opponent's Set card, even if the identity leaks", () => {
    const [entry] = entries([{ id: 1, kind: "set", seat: 1, card: info(99, "Secret Trap"), text: "Player 2 Sets a card" }]);
    expect(entry.thumbs[0]).toMatchObject({ code: null, card: null, name: null });
    expect(entry.title).toBe("Face-down card");
    expect(entry.sentence).toBe("Rival Set a card.");
    expect(JSON.stringify(entry)).not.toContain("Secret Trap");
    expect(JSON.stringify(entry)).not.toContain("99");
  });

  it("shows your own Set card, but a spectator never sees one", () => {
    const events: DuelEvent[] = [{ id: 1, kind: "set", seat: 0, card: info(42, "My Trap"), text: "" }];
    const [mine] = entries(events);
    expect(mine.thumbs[0]).toMatchObject({ code: 42, name: "My Trap" });
    const [watched] = entries(events, ctx(), { mySeat: null, who });
    expect(watched.thumbs[0]).toMatchObject({ code: null, name: null });
  });

  it("keeps a face-down summon as a card back", () => {
    const [entry] = entries([{ id: 1, kind: "summon", seat: 1, text: "Player 2 Special Summons a face-down monster" }]);
    expect(entry.thumbs[0].code).toBeNull();
    expect(entry.title).toBe("Face-down monster");
  });

  it("hides an opponent's draw and face-down moves, shows yours", () => {
    const events: DuelEvent[] = [
      { id: 1, kind: "move", seat: 1, reason: "draw", card: info(5, "Leak"), zone: zone(1, HAND), text: "" },
      { id: 2, kind: "move", seat: 1, reason: "banish", card: info(6, "Down"), faceDown: true, zone: zone(1, REMOVED), text: "" },
      { id: 3, kind: "move", seat: 0, reason: "draw", card: info(7, "Own"), zone: zone(0, HAND), text: "" },
    ];
    const list = entries(events).reverse();
    expect(list[0].thumbs[0].code).toBeNull();
    expect(list[0].sentence).toBe("Rival drew a card.");
    expect(list[1].thumbs[0].code).toBeNull();
    expect(list[2].thumbs[0].code).toBe(7);
    expect(JSON.stringify(list.slice(0, 2))).not.toMatch(/Leak|Down/);
  });

  it("hides an opponent's face-down position change", () => {
    const [entry] = entries([
      { id: 1, kind: "position", seat: 1, card: info(11, "Hidden"), zone: zone(1, MZONE), fromPosition: 1, toPosition: 8, text: "" },
    ]);
    expect(entry.thumbs[0].code).toBeNull();
    expect(entry.sentence).toBe("Rival changed a monster to face-down Defense.");
  });
});

describe("history entries: turn grouping", () => {
  const events: DuelEvent[] = [
    { id: 1, kind: "phase", text: "Main Phase 1" },
    { id: 2, kind: "summon", seat: 1, card: info(1, "A"), text: "" },
    { id: 3, kind: "phase", text: "Battle Phase" },
    { id: 4, kind: "attack", seat: 1, card: info(1, "A"), text: "", zone: zone(1, MZONE, 0) },
    { id: 5, kind: "phase", text: "Main Phase 1" },
    { id: 6, kind: "summon", seat: 0, card: info(2, "B"), text: "" },
  ];

  it("groups newest turn first, newest row first, with a turn and player label", () => {
    const view = buildHistoryView(ingestHistory(emptyHistory(), events, ctx({ turn: 4, turnSeat: 0 })).items, opts);
    expect(view.groups.map((group) => group.label)).toEqual(["Turn 4 · You", "Turn 3 · Rival"]);
    expect(view.groups[1].rows.map((row) => row.type)).toEqual(["entry", "phase", "entry"]);
    expect(view.groups[1].rows[1]).toMatchObject({ type: "phase", label: "Battle Phase", battle: true });
    expect(view.latestKey).toBe(6);
    expect(view.entryCount).toBe(3);
  });

  it("works out the player of a turn the window started inside", () => {
    // No Main Phase 1 separator for the older turn: its seat comes from the later one by parity.
    const mid: DuelEvent[] = [
      { id: 1, kind: "summon", seat: 1, card: info(1, "A"), text: "" },
      { id: 2, kind: "phase", text: "Main Phase 1" },
      { id: 3, kind: "summon", seat: 0, card: info(2, "B"), text: "" },
    ];
    const view = buildHistoryView(ingestHistory(emptyHistory(), mid, ctx({ turn: 4, turnSeat: 0 })).items, opts);
    expect(view.groups.map((group) => group.label)).toEqual(["Turn 4 · You", "Turn 3 · Rival"]);
  });

  it("returns an empty view for no items", () => {
    expect(buildHistoryView([], opts)).toEqual({ groups: [], latestKey: null, entryCount: 0 });
  });
});

describe("history entries: actor side", () => {
  it("colours by viewer seat, and treats seat 0 as you for a spectator", () => {
    expect(sideOf(1, 1)).toBe("you");
    expect(sideOf(0, 1)).toBe("opp");
    expect(sideOf(0, null)).toBe("you");
    expect(sideOf(1, null)).toBe("opp");
    expect(sideOf(null, 0)).toBe("opp");
  });

  it("builds one entry from a tile", () => {
    const state = ingestHistory(emptyHistory(), [{ id: 1, kind: "summon", seat: 1, card: info(3, "C"), text: "" }], ctx());
    const tile = state.items[0];
    if (tile.type !== "tile") throw new Error("expected tile");
    expect(entryFor(tile, opts)).toMatchObject({ side: "opp", actor: "Rival", turn: 3 });
  });
});
