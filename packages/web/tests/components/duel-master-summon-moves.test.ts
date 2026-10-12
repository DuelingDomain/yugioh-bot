// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, LOCATION_MZONE } from "../../src/components/duel/constants";
import { withMasterSummonMoves } from "../../src/components/duel/master-summon-moves";
import { captureDepartureSnapshots, clearZoneSnapshots, getMovePlan, planMoves } from "../../src/components/duel/move-plan";
import batches from "../fixtures/dm-summon-batches.json";

// The batches are real: events of the live duels table (Domain duels on the shared server), read as stored. The server
// sends no move for a Deck Master leaving its zone (the core names it 0x4000, a byte-sized location reads 0, the move feed
// drops location 0), so a Deck Master summon arrives as the summon alone.
type Batch = { seat: number; deckMasterCode?: number; events: DuelEvent[] };
const dmNormal = batches.dmNormalSummon as unknown as Batch;
const dmTribute = batches.dmTributeSummon as unknown as Batch;
const handNormal = batches.handNormalSummon as unknown as Batch;

const seatView = (seat: number, code?: number, inZone = false): DuelSeatView =>
  ({ seat, deckMaster: code ? { card: { code, name: "Master" }, inZone, returns: 0, nextCost: 0 } : undefined }) as unknown as DuelSeatView;

/** The views one update apart: the master of `seat` sat in its zone before, and (unless `stays`) is out of it now. */
function update(seat: number, code: number, others: DuelSeatView[] = [], stays = false) {
  const was = [...others, seatView(seat, code, true)];
  const now = [...others, seatView(seat, code, stays)];
  withMasterSummonMoves([], was); // the update before: the first sight of a views array makes it the previous one
  return now;
}

describe("withMasterSummonMoves", () => {
  it("adds the missing move from the Deck Master Zone before a real Deck Master summon", () => {
    const seats = update(1, dmNormal.deckMasterCode!, [seatView(0)]);
    const out = withMasterSummonMoves(dmNormal.events, seats);
    expect(out).toHaveLength(dmNormal.events.length + 1);
    const summon = dmNormal.events.find((event) => event.kind === "summon")!;
    const at = out.findIndex((event) => event.kind === "move");
    expect(out[at + 1]).toBe(summon);
    expect(out[at]).toMatchObject({
      kind: "move", seat: 1, card: summon.card, zone: summon.zone, from: { controller: 1, location: LOCATION_DMZONE, sequence: 0 }, reason: "summon", faceDown: false,
    });
    // Its id sorts between the event before the summon and the summon: nothing real is replaced.
    expect(out[at].id).toBeGreaterThan(out[at - 1].id);
    expect(out[at].id).toBeLessThan(summon.id);
    expect(out.filter((event) => event.kind !== "move")).toEqual(dmNormal.events);
    // Same input, same output.
    expect(withMasterSummonMoves(dmNormal.events, seats)).toBe(out);
  });

  it("covers a Tribute Summon of the master (the Tribute keeps its own move)", () => {
    const out = withMasterSummonMoves(dmTribute.events, update(0, dmTribute.deckMasterCode!));
    const moves = out.filter((event) => event.kind === "move");
    expect(moves).toHaveLength(dmTribute.events.filter((event) => event.kind === "move").length + 1);
    expect(moves.find((event) => event.from?.location === LOCATION_DMZONE)).toMatchObject({ zone: dmTribute.events.find((event) => event.kind === "summon")!.zone });
  });

  it("leaves a summon that has its own move alone, even when the card is the seat's master", () => {
    const hand = handNormal.events.find((event) => event.kind === "summon")!;
    const seats = update(handNormal.seat, hand.card!.code);
    expect(withMasterSummonMoves(handNormal.events, seats)).toBe(handNormal.events);
  });

  it("leaves the batch alone for another card, another seat, a table without masters, and a Flip Summon", () => {
    const summon = dmNormal.events.find((event) => event.kind === "summon")!;
    expect(withMasterSummonMoves(dmNormal.events, update(1, 123))).toBe(dmNormal.events);
    expect(withMasterSummonMoves(dmNormal.events, update(0, dmNormal.deckMasterCode!))).toBe(dmNormal.events);
    expect(withMasterSummonMoves(dmNormal.events, [seatView(1)])).toBe(dmNormal.events);
    expect(withMasterSummonMoves(dmNormal.events, undefined)).toBe(dmNormal.events);
    const flip = dmNormal.events.map((event) => (event === summon ? { ...event, summonKind: "flip" as const } : event));
    expect(withMasterSummonMoves(flip, update(1, dmNormal.deckMasterCode!))).toBe(flip);
  });

  it("adds no flight for another copy of the master: the real one stays in its zone (Special Summon from Xyz material)", () => {
    // The server drops the moves of Xyz materials too, so the copy arrives as a summon alone, like the master does.
    const stays = update(1, dmNormal.deckMasterCode!, [seatView(0)], true);
    expect(withMasterSummonMoves(dmNormal.events, stays)).toBe(dmNormal.events);
    // The master was out of its zone already (it is on the board or the Graveyard): no flight from the plate.
    const was = [seatView(1, dmNormal.deckMasterCode, false)];
    withMasterSummonMoves([], was);
    expect(withMasterSummonMoves(dmNormal.events, [seatView(1, dmNormal.deckMasterCode, false)])).toBe(dmNormal.events);
  });

  it("looks back to the start of the batch for the card's own move, not only 8 events", () => {
    const code = 4242;
    const zone = { controller: 1, location: LOCATION_MZONE, sequence: 2 };
    const filler = Array.from({ length: 20 }, (_, i): DuelEvent => ({ id: 100 + i, kind: "phase", text: "Main Phase 1" }));
    const own: DuelEvent = { id: 99, kind: "move", text: "", seat: 1, card: { code, name: "Master" } as never, zone, from: { controller: 1, location: 2, sequence: 0 } };
    const summon: DuelEvent = { id: 200, kind: "summon", text: "", seat: 1, card: { code, name: "Master" } as never, zone, summonKind: "normal" } as DuelEvent;
    const batch = [own, ...filler, summon];
    expect(withMasterSummonMoves(batch, update(1, code))).toBe(batch);
    // A move of another card into that zone, long before, is not the master's.
    const other: DuelEvent = { ...own, card: { code: 7, name: "Other" } as never };
    const alien = [other, ...filler, summon];
    expect(withMasterSummonMoves(alien, update(1, code)).filter((event) => event.kind === "move")).toHaveLength(2);
  });

  it("adds a face-down move for a Set from the zone, also when the card is hidden from the viewer", () => {
    const set: DuelEvent = { id: 40, kind: "set", text: "Player 2 Sets a card", seat: 1, zone: { controller: 1, location: LOCATION_MZONE, sequence: 1 } };
    const out = withMasterSummonMoves([{ id: 39, kind: "phase", text: "Main Phase 1" }, set], update(1, 77));
    expect(out[1]).toMatchObject({ kind: "move", from: { controller: 1, location: LOCATION_DMZONE }, zone: set.zone, faceDown: true, reason: "set" });
    expect(out[2]).toBe(set);
  });
});

describe("the planner flies the Deck Master from its plate", () => {
  const plateRect = { left: 20, top: 700, width: 90, height: 130 };
  let seats: DuelSeatView[] = [];

  beforeEach(() => { clearZoneSnapshots(); document.body.innerHTML = ""; seats = update(1, dmNormal.deckMasterCode!, [seatView(0)]); });

  function hud() {
    const board = document.createElement("div");
    const plate = document.createElement("span");
    plate.dataset.masterSource = "1";
    plate.getBoundingClientRect = () => ({ ...plateRect, x: plateRect.left, y: plateRect.top, right: plateRect.left + plateRect.width, bottom: plateRect.top + plateRect.height, toJSON: () => ({}) });
    document.body.append(board, plate); // the HUD plate is outside the board
    return board;
  }

  it("plans no flight for the raw batch (what the live table did)", () => {
    expect(planMoves(dmNormal.events, { now: 1000, reduced: false, duelKey: "raw", geometry: () => ({ distance: 300 }) })).toEqual([]);
  });

  it("plans a flight that starts on the plate and carries the summon", () => {
    const fresh = withMasterSummonMoves(dmNormal.events, seats);
    captureDepartureSnapshots(fresh, hud());
    const created = planMoves(fresh, { now: 1000, reduced: false, duelKey: "plate", geometry: () => ({ distance: 300 }) });
    expect(created).toHaveLength(1);
    const summon = dmNormal.events.find((event) => event.kind === "summon")!;
    expect(created[0].source?.rect).toEqual(plateRect);
    expect(created[0].pairedIds).toEqual([summon.id]);
    expect(created[0].style).toBe("place");
    expect(getMovePlan(created[0].id)).toBe(created[0]);
  });

  it("under reduced motion the flight is a fade at the zone", () => {
    const fresh = withMasterSummonMoves(dmNormal.events, seats);
    captureDepartureSnapshots(fresh, hud());
    const created = planMoves(fresh, { now: 1000, reduced: true, duelKey: "reduced", geometry: () => ({ distance: 300 }) });
    expect(created).toHaveLength(1);
    expect(created[0].style).toBe("fade");
  });
});
