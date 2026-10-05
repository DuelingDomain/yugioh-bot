// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { captureZoneSnapshots, clearZoneSnapshots, planMoves, resetMoveSchedule } from "@/components/duel/move-plan";
import { CARDS } from "@/components/duel/fx-lab/cards";

const HAND = 0x02;
const MZONE = 0x04;
const SZONE = 0x08;
const GRAVE = 0x10;
const DECK = 0x01;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const key = "field-face";
const geometry = () => ({ distance: 300 });

let board: HTMLElement;

beforeEach(() => {
  clearZoneSnapshots();
  resetMoveSchedule(key);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return { left: 100, top: 100, width: 70, height: 100 } as DOMRect;
  });
});
afterEach(() => {
  board?.remove();
  clearZoneSnapshots();
  vi.restoreAllMocks();
});

/** The board as it was when the batch was sent: `faceUp` zones show a card image, the others are empty or a sleeve. */
function snapshot(zones: Array<{ zone: DuelZoneRef; faceUp?: boolean }>) {
  board = document.createElement("div");
  for (const { zone, faceUp } of zones) {
    const el = document.createElement("div");
    el.dataset.zones = `${zone.controller}:${zone.location}:${zone.sequence}`;
    el.dataset.side = zone.controller === 0 ? "you" : "opp";
    if (faceUp) el.innerHTML = '<img src="/x.png" />';
    board.append(el);
  }
  document.body.append(board);
  captureZoneSnapshots(board);
}

function faces(events: DuelEvent[]): Map<number, boolean | undefined> {
  return new Map(planMoves(events, { now: 0, reduced: false, duelKey: key, geometry }).map((plan) => [plan.id, plan.source?.faceUp]));
}

const move = (id: number, card: DuelEvent["card"], from: DuelZoneRef, zone: DuelZoneRef, extra: Partial<DuelEvent> = {}): DuelEvent =>
  ({ id, kind: "move", text: "moved", seat: zone.controller, card, from, zone, ...extra });
const flip = (id: number, zone: DuelZoneRef, fromPosition: number, toPosition: number, card?: DuelEvent["card"]): DuelEvent =>
  ({ id, kind: "position", text: "position", card, zone, fromPosition, toPosition } as DuelEvent);

describe("the face of a card that passes through a field zone in one batch", () => {
  // Tag and FFA seats address their own zones; the Field Zone is sequence 5 and the Pendulum Zones 0 and 4.
  it.each([[0, 0], [1, 2], [2, 5], [3, 0], [1, 4]])("starts the departure of a card activated from the hand face-up (seat %s, zone %s)", (seat, sequence) => {
    const zone = z(seat, SZONE, sequence);
    snapshot([{ zone }]);
    const result = faces([
      move(1, CARDS.raigeki, z(seat, HAND, 0), zone, { reason: "activate", faceDown: false }),
      move(2, CARDS.raigeki, zone, z(seat, GRAVE, 0), { reason: "send" }),
    ]);
    expect(result.get(2)).toBe(true);
  });

  it("keeps a card Set from the hand face-down when it leaves, for its owner and for the opponent", () => {
    const zone = z(1, SZONE, 2);
    for (const card of [CARDS.mst, undefined]) {
      resetMoveSchedule(key);
      snapshot([{ zone }]);
      // The opponent is not told what was Set; the Graveyard makes it public on the way out.
      const result = faces([
        move(1, card, z(1, HAND, 0), zone, { reason: "set", faceDown: true }),
        move(2, CARDS.mst, zone, z(1, GRAVE, 0), { reason: "destroy" }),
      ]);
      expect(result.get(2)).toBe(false);
      board.remove();
    }
  });

  it("keeps a card that left face-down to the Deck hidden: no code, no face", () => {
    const zone = z(1, SZONE, 0);
    snapshot([{ zone }]);
    const result = faces([
      move(1, undefined, z(1, HAND, 0), zone, { reason: "set", faceDown: true }),
      move(2, undefined, zone, z(1, DECK, 0), { reason: "return" }),
    ]);
    expect(result.get(2)).toBe(false);
  });

  it("starts a Set card flipped face-up in the batch from its face", () => {
    const zone = z(0, SZONE, 1);
    snapshot([{ zone }]);
    const result = faces([
      flip(1, zone, 0x0a, 0x05, CARDS.mst),
      move(2, CARDS.mst, zone, z(0, GRAVE, 0), { reason: "send" }),
    ]);
    expect(result.get(2)).toBe(true);
  });

  it("starts a card that arrived face-up and was turned face-down in the batch from its sleeve", () => {
    const zone = z(0, MZONE, 2);
    snapshot([{ zone }]);
    const result = faces([
      move(1, CARDS.celtic, z(0, HAND, 0), zone, { reason: "summon", faceDown: false }),
      flip(2, zone, 0x01, 0x08),
      move(3, CARDS.celtic, zone, z(0, DECK, 0), { reason: "return" }),
    ]);
    expect(result.get(3)).toBe(false);
  });

  it("follows two cards through one zone: the second, Set card does not borrow the first card's face", () => {
    const zone = z(0, SZONE, 3);
    // A face-up card was in the zone before the batch.
    snapshot([{ zone, faceUp: true }]);
    const result = faces([
      move(1, CARDS.raigeki, zone, z(0, GRAVE, 0), { reason: "send" }),
      move(2, CARDS.mst, z(0, HAND, 0), zone, { reason: "set", faceDown: true }),
      move(3, CARDS.mst, zone, z(0, GRAVE, 1), { reason: "destroy" }),
      move(4, CARDS.raigeki, z(0, HAND, 0), zone, { reason: "activate", faceDown: false }),
      move(5, CARDS.raigeki, zone, z(0, GRAVE, 2), { reason: "send" }),
    ]);
    expect([result.get(1), result.get(3), result.get(5)]).toEqual([true, false, true]);
  });

  it("does not take the face from the same zone number of another seat", () => {
    const arrival = z(2, SZONE, 0);
    const other = z(3, SZONE, 0);
    snapshot([{ zone: arrival }, { zone: other }]);
    const result = faces([
      move(1, CARDS.raigeki, z(2, HAND, 0), arrival, { reason: "activate", faceDown: false }),
      move(2, CARDS.mst, other, z(3, GRAVE, 0), { reason: "destroy" }),
    ]);
    expect(result.get(2)).toBe(false);
  });
});
