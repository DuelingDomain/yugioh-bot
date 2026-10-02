import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";
import { autoFollowSeat, defaultTargetSeat, seatStatus, targetChoices } from "@/components/duel/table/targets";

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null], spells: [null, null, null, null, null, null],
    graveyard: [], banished: [], ...extra,
  };
}
function engine(seats: DuelSeatView[], turnSeat = 0): DuelEngineView {
  return { revision: 1, format: "ffa3", turn: 1, turnSeat, phase: "main1", seats, prompt: null, chain: [], events: [], log: [], result: null };
}
const THREE = engine([seatView(0), seatView(1), seatView(2)]);
const nameOf = (seat: number) => ["Ren", "Ryo", "Mika"][seat] ?? `Player ${seat + 1}`;

const monsterOption = (id: string, controller: number, sequence: number) => ({ id, label: id, controller, location: 4, sequence });
const attack = (options: DuelPrompt["options"], seat = 0): DuelPrompt => ({
  id: "p", seat, kind: "cards", title: "Select an attack target", min: 1, max: 1, options,
});

describe("targetChoices", () => {
  it("groups zone options by the seat that holds them", () => {
    const prompt = attack([monsterOption("a", 1, 0), monsterOption("b", 1, 2), monsterOption("c", 2, 1)]);
    const choices = targetChoices(prompt, THREE, 0, nameOf);
    expect(choices).toHaveLength(2);
    expect(choices[0]).toMatchObject({ seat: 1, zones: ["1:4:0", "1:4:2"], direct: false, optionIds: ["a", "b"], label: "Ryo" });
    expect(choices[1]).toMatchObject({ seat: 2, zones: ["2:4:1"], direct: false, optionIds: ["c"], label: "Mika" });
  });

  it("marks an option with a seat and no zone as a direct hit on that seat's LP", () => {
    const prompt: DuelPrompt = { id: "d", seat: 0, kind: "choice", title: "Select a duelist to attack", options: [{ id: "direct-1", label: "x", controller: 1 }] };
    expect(targetChoices(prompt, THREE, 0, nameOf)).toEqual([{ seat: 1, zones: [], direct: true, optionIds: ["direct-1"], label: "Ryo" }]);
  });

  it("merges zone and direct options of one seat", () => {
    const prompt = attack([monsterOption("a", 1, 0), { id: "direct-1", label: "x", controller: 1 }]);
    expect(targetChoices(prompt, THREE, 0, nameOf)).toEqual([
      { seat: 1, zones: ["1:4:0"], direct: true, optionIds: ["a", "direct-1"], label: "Ryo" },
    ]);
  });

  it("covers an opponent pick", () => {
    const prompt: DuelPrompt = {
      id: "o", seat: 0, kind: "choice", title: "Choose an opponent", context: { type: "opponent" },
      options: [{ id: "opp-1", label: "x", controller: 1 }, { id: "opp-2", label: "y", controller: 2 }],
    };
    expect(targetChoices(prompt, THREE, 0, nameOf).map((c) => [c.seat, c.direct])).toEqual([[1, true], [2, true]]);
  });

  it("is empty for another seat's prompt, a spectator, no prompt, or options on your own side", () => {
    const prompt = attack([monsterOption("a", 1, 0)], 2);
    expect(targetChoices(prompt, THREE, 0, nameOf)).toEqual([]);
    expect(targetChoices(attack([monsterOption("a", 1, 0)]), THREE, null, nameOf)).toEqual([]);
    expect(targetChoices(null, THREE, 0, nameOf)).toEqual([]);
    expect(targetChoices(attack([monsterOption("own", 0, 0)]), THREE, 0, nameOf)).toEqual([]);
  });

  it("leaves out eliminated seats and seats that are leaving", () => {
    const eng = engine([seatView(0), seatView(1, { eliminated: true }), seatView(2, { pendingElimination: true })]);
    expect(targetChoices(attack([monsterOption("a", 1, 0), monsterOption("c", 2, 1)]), eng, 0, nameOf)).toEqual([]);
  });

  it("falls back to a numbered name and skips options with no seat", () => {
    const prompt = attack([monsterOption("a", 1, 0), { id: "z", label: "z" }]);
    expect(targetChoices(prompt, THREE, 0)[0].label).toBe("Player 2");
    expect(targetChoices(prompt, THREE, 0)).toHaveLength(1);
  });
});

describe("defaultTargetSeat", () => {
  const two = targetChoices(attack([monsterOption("a", 1, 0), monsterOption("c", 2, 1)]), THREE, 0, nameOf);
  const one = targetChoices(attack([monsterOption("a", 1, 0)]), THREE, 0, nameOf);

  it("takes the focused seat when it has a choice", () => {
    expect(defaultTargetSeat(two, { focusSeat: 2 })).toBe(2);
  });
  it("takes the only choice", () => {
    expect(defaultTargetSeat(one, { focusSeat: null })).toBe(1);
    expect(defaultTargetSeat(one, { focusSeat: 2 })).toBe(1);
  });
  it("is null when the choice is open", () => {
    expect(defaultTargetSeat(two, { focusSeat: null })).toBeNull();
    expect(defaultTargetSeat([], { focusSeat: 1 })).toBeNull();
  });
});

describe("seatStatus", () => {
  const eng = engine([seatView(0), seatView(1, { pendingElimination: true }), seatView(2, { eliminated: true })], 0);
  it("reads out and leaving first", () => {
    expect(seatStatus(eng, 2, null)).toBe("eliminated");
    expect(seatStatus(eng, 1, null)).toBe("leaving");
  });
  it("marks the turn seat, the choosing seat and the next seat", () => {
    const live = engine([seatView(0), seatView(1), seatView(2)], 0);
    expect(seatStatus(live, 0, null)).toBe("turn");
    expect(seatStatus(live, 1, null)).toBe("next");
    expect(seatStatus(live, 2, null)).toBe("active");
    expect(seatStatus(live, 2, 2)).toBe("choosing");
    expect(seatStatus(live, 0, 2)).toBe("turn");
  });
  it("skips eliminated seats when it finds the next seat", () => {
    const eng2 = engine([seatView(0), seatView(1, { eliminated: true }), seatView(2)], 0);
    expect(seatStatus(eng2, 2, null)).toBe("next");
  });
});

describe("autoFollowSeat", () => {
  it("follows the one rival that holds every target", () => {
    const choices = targetChoices(attack([monsterOption("a", 1, 0), monsterOption("b", 1, 1)]), THREE, 0, nameOf);
    expect(autoFollowSeat(choices, THREE, 0)).toEqual({ seat: 1, reason: "Pick a target" });
  });
  it("does not follow when the targets are split", () => {
    const choices = targetChoices(attack([monsterOption("a", 1, 0), monsterOption("c", 2, 0)]), THREE, 0, nameOf);
    expect(autoFollowSeat(choices, THREE, 0)).toBeNull();
  });
  it("does not follow for a direct pick or an open prompt", () => {
    const direct: DuelPrompt = { id: "d", seat: 0, kind: "choice", title: "x", options: [{ id: "d1", label: "x", controller: 1 }] };
    expect(autoFollowSeat(targetChoices(direct, THREE, 0, nameOf), THREE, 0)).toBeNull();
    expect(autoFollowSeat([], THREE, 0)).toBeNull();
  });
  it("keeps the table stable after elimination until a prompt has a target to inspect", () => {
    const eng = engine([seatView(0), seatView(1), seatView(2, { eliminated: true })]);
    expect(autoFollowSeat([], eng, 0)).toBeNull();
    const choices = targetChoices(attack([monsterOption("a", 1, 0)]), eng, 0, nameOf);
    expect(autoFollowSeat(choices, eng, 0)).toEqual({ seat: 1, reason: "Pick a target" });
  });
  it("is null for a spectator", () => {
    expect(autoFollowSeat([], THREE, null)).toBeNull();
  });
});
