import { describe, expect, it } from "vitest";
import { applyEdits, numberSteps } from "@/components/duel/fx-lab/board";
import { findScenario } from "@/components/duel/fx-lab/scenarios";
import { LOCATION_DECK, LOCATION_HAND } from "@/components/duel/constants";

describe("opening deal lab perspectives", () => {
  it.each([
    ["opening-deal", 0, 1],
    ["opening-deal-seat1", 1, 1],
    ["opening-deal-spectator", null, 1],
    ["opening-deal-game2-seat0", 0, 2],
    ["opening-deal-game2-seat1", 1, 2],
    ["opening-deal-game2-spectator", null, 2],
  ] as const)("shows %s with the engine's deck ownership and hand order", (id, viewer, game) => {
    const scenario = findScenario(id);
    expect(scenario).toBeDefined();
    const script = scenario!.build();
    expect(script.mySeat).toBe(viewer);
    expect(script.initial.seats.map((seat) => seat.hand.length)).toEqual([0, 0]);
    expect(script.series?.game ?? 1).toBe(game);
    const [opening, turn2] = numberSteps(script.steps, 0);
    const draws = opening.events.filter((event) => event.reason === "draw");
    expect(draws).toHaveLength(10);
    for (const event of draws) {
      expect(event.from).toEqual({ controller: event.seat, location: LOCATION_DECK, sequence: 0 });
      expect(event.zone?.controller).toBe(event.seat);
      expect(event.zone?.location).toBe(LOCATION_HAND);
      expect(event.card?.code != null).toBe(event.seat === viewer);
    }
    for (const seat of [0, 1]) expect(draws.filter((event) => event.seat === seat).map((event) => event.zone!.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(opening.events.slice(10).map((event) => event.text)).toEqual(["Draw Phase", "Standby Phase", "Main Phase 1"]);
    const dealt = applyEdits(script.initial, opening.step.edits ?? []);
    expect(dealt.seats.map((seat) => seat.deckCount)).toEqual([35, 35]);
    expect(dealt.seats.map((seat) => seat.hand.length)).toEqual([5, 5]);
    for (const seat of dealt.seats) expect(seat.hand.every((card) => card.code != null)).toBe(seat.seat === viewer);
    const drawn = applyEdits(dealt, turn2.step.edits ?? []);
    expect(drawn.seats.map((seat) => seat.hand.length)).toEqual([5, 6]);
    expect(turn2.events.map((event) => event.kind === "move" ? "draw" : event.text)).toEqual(["Draw Phase", "draw", "Standby Phase", "Main Phase 1"]);
  });
});
