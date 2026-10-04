import { describe, expect, it } from "vitest";
import { isSolidStateId, SOLID_STATE_IDS, solidFixture } from "@/components/duel/solid/fixtures/states";

describe("3D mode preview fixtures", () => {
  it("builds all eight states of the preview", () => {
    expect([...SOLID_STATE_IDS]).toEqual(["m1", "summon", "battle", "chain", "chains", "damage", "m2", "end"]);
    for (const id of SOLID_STATE_IDS) {
      const { room } = solidFixture(id);
      expect(room.engine?.seats).toHaveLength(2);
      expect(room.session.format).toBe("1v1");
    }
  });

  it("opens the prompt each state needs", () => {
    const prompt = (id: Parameters<typeof solidFixture>[0]) => solidFixture(id).room.engine?.prompt;
    expect(prompt("m1")?.context).toMatchObject({ type: "action", phase: "main" });
    expect(prompt("battle")?.context).toMatchObject({ type: "action", phase: "battle" });
    expect(prompt("chain")?.context).toMatchObject({ type: "chain" });
    expect(prompt("m2")?.kind).toBe("places");
    expect(solidFixture("chain").room.engine?.chain).toHaveLength(1);
  });

  it("opens the card menu only on m1 and the attack confirm only on battle", () => {
    expect(solidFixture("m1").ui.menuHand).toBe(0);
    expect(solidFixture("battle").ui.confirm).toBeDefined();
    expect(solidFixture("chain").ui.menuHand).toBeUndefined();
  });

  it("starts the opening hand at five cards and keeps LP at 8000 until the damage step", () => {
    expect(solidFixture("m1").room.engine?.seats[0].hand).toHaveLength(5);
    expect(solidFixture("chain").room.engine?.seats.map((seat) => seat.lp)).toEqual([8000, 8000]);
    expect(solidFixture("damage").room.engine?.seats.map((seat) => seat.lp)).toEqual([4000, 7200]);
  });

  it("accepts only the known state ids", () => {
    expect(isSolidStateId("chain")).toBe(true);
    expect(isSolidStateId("main")).toBe(false);
    expect(isSolidStateId(null)).toBe(false);
  });
});
