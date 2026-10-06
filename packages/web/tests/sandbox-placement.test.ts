import { describe, expect, it } from "vitest";
import { TYPE_FIELD, TYPE_FUSION, TYPE_MONSTER, TYPE_PENDULUM, TYPE_SPELL, TYPE_TRAP } from "@/components/duel/constants";
import { createBuilderState, applyAction } from "@/components/sandbox/board-model";
import { firstEmptySlot, routeCard, slotRefusal } from "@/components/sandbox/placement";

const monster = { type: TYPE_MONSTER };
const fusion = { type: TYPE_MONSTER | TYPE_FUSION };
const spell = { type: TYPE_SPELL };
const trap = { type: TYPE_TRAP };
const fieldSpell = { type: TYPE_SPELL | TYPE_FIELD };
const pendulum = { type: TYPE_MONSTER | TYPE_PENDULUM };

describe("slotRefusal", () => {
  it("fits card types to zones", () => {
    expect(slotRefusal("monster", monster)).toBeNull();
    expect(slotRefusal("monster", spell)).toMatch(/Only monsters/);
    expect(slotRefusal("spell", trap)).toBeNull();
    expect(slotRefusal("spell", fieldSpell)).toMatch(/Field Zone/);
    expect(slotRefusal("field", fieldSpell)).toBeNull();
    expect(slotRefusal("field", spell)).toMatch(/Field Spells/);
    expect(slotRefusal("pendulum", pendulum)).toBeNull();
    expect(slotRefusal("pendulum", monster)).toMatch(/Pendulum/);
  });
  it("never refuses a card it knows nothing about", () => {
    expect(slotRefusal("monster", undefined)).toBeNull();
  });
});

describe("routeCard", () => {
  it("routes the field target by card type", () => {
    expect(routeCard("field", monster)).toEqual({ kind: "slot", zone: "monster" });
    expect(routeCard("field", trap)).toEqual({ kind: "slot", zone: "spell" });
    expect(routeCard("field", fieldSpell)).toEqual({ kind: "slot", zone: "field" });
  });
  it("sends an Extra Deck monster to the Extra Deck from hand or deck", () => {
    expect(routeCard("hand", fusion)).toMatchObject({ kind: "pile", zone: "extra" });
    expect(routeCard("deck", fusion)).toMatchObject({ kind: "pile", zone: "extra" });
    expect(routeCard("grave", fusion)).toEqual({ kind: "pile", zone: "grave" });
    expect(routeCard("hand", monster)).toEqual({ kind: "pile", zone: "hand" });
  });
});

describe("firstEmptySlot", () => {
  it("skips filled slots and returns null when full", () => {
    let state = createBuilderState();
    expect(firstEmptySlot(state, "p0", "monster")).toEqual({ seat: "p0", zone: "monster", index: 0 });
    state = applyAction(state, { type: "place", at: { seat: "p0", zone: "monster", index: 0 }, card: 1 }).state;
    expect(firstEmptySlot(state, "p0", "monster")).toEqual({ seat: "p0", zone: "monster", index: 1 });
  });
});
