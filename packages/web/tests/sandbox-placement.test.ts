import { describe, expect, it } from "vitest";
import { TYPE_CONTINUOUS, TYPE_COUNTER, TYPE_EQUIP, TYPE_FIELD, TYPE_QUICKPLAY, TYPE_RITUAL, TYPE_FUSION, TYPE_MONSTER, TYPE_PENDULUM, TYPE_SPELL, TYPE_TRAP } from "@/components/duel/constants";
import { createBuilderState, applyAction } from "@/components/sandbox/board-model";
import { canStayFaceUp, firstEmptySlot, routeCard, slotPositions, slotRefusal } from "@/components/sandbox/placement";

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

describe("face-up Spells and Traps", () => {
  it("allows face-up only for Continuous and Equip Spells and Continuous Traps", () => {
    expect(canStayFaceUp({ type: TYPE_SPELL | TYPE_CONTINUOUS })).toBe(true);
    expect(canStayFaceUp({ type: TYPE_SPELL | TYPE_EQUIP })).toBe(true);
    expect(canStayFaceUp({ type: TYPE_TRAP | TYPE_CONTINUOUS })).toBe(true);
    expect(canStayFaceUp(spell)).toBe(false);
    expect(canStayFaceUp({ type: TYPE_SPELL | TYPE_QUICKPLAY })).toBe(false);
    expect(canStayFaceUp({ type: TYPE_SPELL | TYPE_RITUAL })).toBe(false);
    expect(canStayFaceUp(trap)).toBe(false);
    expect(canStayFaceUp({ type: TYPE_TRAP | TYPE_COUNTER })).toBe(false);
    expect(canStayFaceUp(undefined)).toBe(true);
  });

  it("disables Face-up in a Spell & Trap Zone for a card that cannot stay face-up", () => {
    expect(slotPositions("spell", spell)).toEqual([{ pos: "up", blocked: expect.stringMatching(/cannot stay face-up/) }, { pos: "set" }]);
    expect(slotPositions("spell", trap).find((entry) => entry.pos === "up")?.blocked).toBeTruthy();
    expect(slotPositions("spell", { type: TYPE_SPELL | TYPE_CONTINUOUS })).toEqual([{ pos: "up" }, { pos: "set" }]);
    expect(slotPositions("spell", undefined)).toEqual([{ pos: "up" }, { pos: "set" }]);
  });

  it("keeps every position of the other zones open", () => {
    expect(slotPositions("pendulum", pendulum)).toEqual([{ pos: "up" }, { pos: "set" }]);
    expect(slotPositions("field", fieldSpell)).toEqual([{ pos: "up" }, { pos: "set" }]);
    expect(slotPositions("monster", monster).map((entry) => entry.pos)).toEqual(["atk", "def", "set"]);
  });
});
