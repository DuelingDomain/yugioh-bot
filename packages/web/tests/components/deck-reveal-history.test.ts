import { describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { emptyHistory, ingestHistory } from "../../src/components/duel/history-model";
import { buildHistoryView, type HistoryEntry } from "../../src/components/duel/history-entries";

// Shape observed with real Reinforcement of the Army -> Kojikocy in deck-reveal.test.ts.
// The controller receives this identity today; the opponent fixture supplies the known
// confirmation identity to isolate the independent UI failure after server projection.
const searched: DuelEvent = {
  id: 17,
  kind: "move",
  seat: 0,
  text: "Kojikocy moved",
  from: { controller: 0, location: 1, sequence: 0 },
  zone: { controller: 0, location: 2, sequence: 4 },
  reason: "draw",
  addedToHand: true,
  card: { code: 1184620, name: "Kojikocy", description: "", type: 17,
    attack: 1500, defense: 1200, level: 4, attribute: 1, race: "warrior" },
};

function entry(mySeat: number): HistoryEntry {
  return historyEntry([searched], mySeat);
}

function historyEntry(events: DuelEvent[], mySeat: number | null): HistoryEntry {
  const state = ingestHistory(emptyHistory(), events, {
    revision: 1, turn: 1, turnSeat: 0, phase: "main1", seatCount: 2, cards: [],
  });
  const view = buildHistoryView(state.items, {
    mySeat, who: (seat) => seat === mySeat ? "You" : "Opponent",
  });
  return view.groups.flatMap((group) => group.rows).find((row): row is HistoryEntry => row.type === "entry")!;
}

describe("Deck search history diagnosis", () => {
  it("BUG 1 UI: labels a real effect addition as Add to hand", () => {
    expect(entry(0).verb).toBe("Add to hand");
  });

  it("BUG 1 UI: keeps a confirmed search identity visible to the opponent", () => {
    expect(entry(1).thumbs[0]?.code).toBe(1184620);
  });
});

describe("Deck Set history diagnosis", () => {
  const set: DuelEvent = {
    id: 19, kind: "set", seat: 0, text: "Player 1 Sets Majespecter Tempest",
    zone: { controller: 0, location: 8, sequence: 0 },
    card: { code: 2572890, name: "Majespecter Tempest", description: "", type: 1048580,
      attack: 0, defense: 0, level: 0, attribute: 0, race: "unknown" },
  };

  it("baseline: the controller's existing Set event shows its name and thumbnail", () => {
    const row = historyEntry([set], 0);
    expect(row.title).toBe("Majespecter Tempest");
    expect(row.thumbs[0]?.code).toBe(2572890);
  });

  it.each([1, null])("baseline: viewer %s sees a hidden Set in the currently projected history", (mySeat) => {
    const row = historyEntry([{ ...set, card: undefined, text: "Player 1 Sets a card" }], mySeat);
    expect(row.thumbs[0]?.code).toBeNull();
    expect(row.title).not.toContain("Majespecter Tempest");
  });
});


describe("confirmation event history", () => {
  const added: DuelEvent = { ...searched, reason: "add", card: undefined };
  const confirm: DuelEvent = { id: 18, kind: "confirm", text: "Confirmed Kojikocy", seat: 0,
    zone: searched.zone, card: searched.card, moveId: 17 };

  it.each([0, 1, null])("viewer %s sees the confirmed addition in one history row", (viewer) => {
    const row = historyEntry([added, confirm], viewer);
    expect(row.verb).toBe("Add to hand");
    expect(row.title).toBe("Kojikocy");
    expect(row.thumbs[0]?.code).toBe(1184620);
  });

  it("retains a late confirmation across snapshots and repeated event windows", () => {
    const ctx = { revision: 1, turn: 1, turnSeat: 0, phase: "main1", seatCount: 2, cards: [] };
    const initial = ingestHistory(emptyHistory(), [added], ctx);
    const confirmed = ingestHistory(initial, [added, confirm], { ...ctx, revision: 2 });
    const repeated = ingestHistory(confirmed, [added, confirm], { ...ctx, revision: 3 });
    expect(initial.items.filter((item) => item.type === "tile")[0].card).toBeNull();
    expect(repeated.items.filter((item) => item.type === "tile")).toHaveLength(1);
    expect(repeated.items.filter((item) => item.type === "tile")[0].card?.code).toBe(1184620);
  });

  it.each([1, null])("viewer %s sees a Deck Set confirmation as its own row", (viewer) => {
    const row = historyEntry([{ ...confirm, moveId: undefined,
      zone: { controller: 0, location: 8, sequence: 0 },
      card: { ...searched.card!, code: 2572890, name: "Majespecter Tempest" },
    }], viewer);
    expect(row.verb).toBe("Confirmed");
    expect(row.title).toBe("Majespecter Tempest");
    expect(row.thumbs[0]?.code).toBe(2572890);
  });

  it("keeps an unconfirmed search hidden", () => {
    expect(historyEntry([added], 1).thumbs[0]?.code).toBeNull();
  });
});
