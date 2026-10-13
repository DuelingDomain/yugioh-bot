// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { buildFlight } from "@/components/duel/move-fx";
import { activationTurns, trackSetZones } from "@/components/duel/summon-fx";
import { zoneCardParts } from "@/components/duel/event-queue";
import { LOCATION_SZONE } from "@/components/duel/constants";

const CODE = 61740673;
const slot: DuelZoneRef = { controller: 0, location: LOCATION_SZONE, sequence: 1 };
const card = { code: CODE, name: "Imperial Order" } as DuelEvent["card"];

const set = (id: number): DuelEvent => ({ id, kind: "set", seat: 0, zone: slot, card, text: "" }) as DuelEvent;
const flip = (id: number): DuelEvent =>
  ({ id, kind: "position", seat: 0, zone: slot, card, fromPosition: 0x0a, toPosition: 0x01, flip: true, text: "" }) as unknown as DuelEvent;
const activate = (id: number): DuelEvent => ({ id, kind: "activate", seat: 0, zone: slot, card, chainIndex: 1, text: "" }) as DuelEvent;

/** Runs the events the way SummonFx does, batch by batch, and returns the activations that turn a Set card. */
function turnedActivations(batches: DuelEvent[][]): number[] {
  const zones = new Set<string>();
  const turned: number[] = [];
  for (const fresh of batches) {
    const activated = new Set<number>();
    for (const event of fresh) trackSetZones(zones, event, activated, fresh);
    turned.push(...activated);
  }
  return turned;
}

describe("a face-up card never plays a turn on activation", () => {
  it("turns a Set card exactly once", () => {
    expect(turnedActivations([[set(1)], [activate(2)]])).toEqual([2]);
  });

  it("lets the activation turn the card when the flip event comes in its own batch", () => {
    expect(turnedActivations([[set(1)], [flip(2), activate(3)]])).toEqual([3]);
  });

  it("does not turn the card again when a flip event already turned it in an earlier batch", () => {
    expect(turnedActivations([[set(1)], [flip(2)], [activate(3)]])).toEqual([]);
  });

  it("does not turn a card that was never Set (a face-up Spell, or a monster, using its effect)", () => {
    expect(turnedActivations([[activate(1)]])).toEqual([]);
    expect(turnedActivations([[set(1)], [activate(2)], [activate(3)]])).toEqual([2]);
  });

  it("does not turn a card that came from the hand, or under reduced motion", () => {
    const planned = { wasSet: true, plan: {} as never, reduced: false };
    expect(activationTurns({ wasSet: true, plan: null, reduced: false }, true)).toBe(true);
    expect(activationTurns(planned, true)).toBe(false);
    expect(activationTurns({ wasSet: true, plan: null, reduced: true }, true)).toBe(false);
    expect(activationTurns({ wasSet: undefined, plan: null, reduced: false }, true)).toBe(false);
  });
});

describe("a card keeps the full size of its zone while it is placed and activated", () => {
  const scales = (style: "place" | "draw") => buildFlight({ style, dx: 240, dy: 320, startScale: 1, startRot: 0, endRot: 0, cardH: 128, spin: 0 }).card
    .map((frame) => Number(/scale\(([\d.]+)\)/.exec(String(frame.transform))![1]));

  it("never goes under the size of the zone on its way down to it", () => {
    const sizes = scales("place");
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(1);
    expect(sizes[sizes.length - 1]).toBe(1);
  });

  it("hides only what shows the card, so the zone outline (the frame) stays drawn", () => {
    document.body.innerHTML = `<div data-zones="0:8:1"><button><div class="frame" id="frame">
      <div id="artWrap"><div data-card-art="1"><img alt=""></div></div><span id="plate"></span></div></button></div>`;
    const zone = document.querySelector<HTMLElement>("[data-zones]")!;
    const parts = zoneCardParts(zone).map((part) => part.id);
    expect(parts).toEqual(["artWrap", "plate"]);
    expect(parts).not.toContain("frame");
  });
});
