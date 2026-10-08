import { describe, expect, it } from "vitest";
import { TABLE_STATE_IDS } from "@/components/duel/table/fixtures/common";
import { TAG_FIXTURES, tagSearchVariant } from "@/components/duel/tag/fixtures";
import { firstInspectCard, responseWindow, teamLoss } from "@/components/duel/tag/tag-logic";

describe("tag fixtures", () => {
  it("has the nine states and each has an engine view", () => {
    for (const id of TABLE_STATE_IDS) {
      const state = TAG_FIXTURES.states[id];
      expect(state.id).toBe(id);
      expect(state.room.engine?.format).toBe("tag");
      expect(state.room.engine?.seats).toHaveLength(4);
    }
  });

  it("gives partners the same team LP in every state", () => {
    for (const id of TABLE_STATE_IDS) {
      const seats = TAG_FIXTURES.states[id].room.engine!.seats;
      expect(seats[0].lp).toBe(seats[2].lp);
      expect(seats[1].lp).toBe(seats[3].lp);
    }
  });

  it("shows the partner hand and hides the rival hands for seat 0", () => {
    const seats = TAG_FIXTURES.states.main.room.engine!.seats;
    expect(seats[2].hand.every((card) => card.code != null)).toBe(true);
    expect(seats[1].hand.every((card) => card.code == null)).toBe(true);
    expect(seats[3].hand.every((card) => card.code == null)).toBe(true);
  });

  it("hides every hand for the spectator and the Set cards too", () => {
    const state = TAG_FIXTURES.states.spectator;
    expect(state.room.mySeat).toBeNull();
    for (const seat of state.room.engine!.seats) {
      expect(seat.hand.every((card) => card.code == null)).toBe(true);
      expect(seat.spells.every((card) => card == null || card.code == null)).toBe(true);
    }
  });

  it("the chain state has two links and your team may respond, rivals passed", () => {
    const engine = TAG_FIXTURES.states["chain-2"].room.engine!;
    expect(engine.chain.map((link) => link.seat)).toEqual([1, 2]);
    const window = responseWindow(engine, engine.prompt, engine.prompt!.seat);
    expect(window).toMatchObject({ team: 0, otherPassed: true, passedSeats: [1, 3] });
  });

  it("the direct attack state leaves Juniper with no monster", () => {
    const seats = TAG_FIXTURES.states["direct-attack"].room.engine!.seats;
    expect(seats[3].monsters.every((card) => card == null)).toBe(true);
    expect(seats[1].monsters.some((card) => card != null)).toBe(true);
  });

  it("the elimination state cracks the Thornveil plate and the result state names team 0", () => {
    expect(teamLoss(TAG_FIXTURES.states.elimination.room.engine!)).toEqual({ lostTeam: 1, cracking: true });
    expect(TAG_FIXTURES.states.result.room.engine!.result).toMatchObject({ winnerTeam: 0 });
  });

  it("the choose-opponent state offers both rivals", () => {
    const options = TAG_FIXTURES.states["choose-opponent"].room.engine!.prompt!.options;
    expect(options.map((option) => option.controller)).toEqual([1, 3]);
  });

  it("the main phase action prompt lists the phase moves for the station track", () => {
    const prompt = TAG_FIXTURES.states.main.room.engine!.prompt!;
    expect(prompt.context).toMatchObject({ type: "action" });
    const ids = prompt.options.map((option) => option.id);
    expect(ids).toContain("to_bp");
    expect(ids).toContain("to_ep");
  });

  it("the inspector starts on your first face-up monster, a spectator gets the turn player's", () => {
    const you = TAG_FIXTURES.states.main.room.engine!;
    expect(firstInspectCard(you, 0)?.name).toBe("Dark Magician");
    const watch = TAG_FIXTURES.states.spectator.room.engine!;
    const seen = firstInspectCard(watch, null);
    expect(seen).not.toBeNull();
    expect(seen?.controller).toBe(watch.turnSeat);
  });

  it("asks for one of 14 Deck cards in the `cards` preview pick, to review a long card strip", () => {
    const prompt = tagSearchVariant(TAG_FIXTURES).states.main.room.engine!.prompt!;
    expect(prompt.kind).toBe("cards");
    expect(prompt.options).toHaveLength(14);
  });
});
