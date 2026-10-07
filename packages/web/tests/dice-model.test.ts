import { describe, expect, it } from "vitest";
import { DUEL_DICE_REVEAL_MS, type DuelDiceOpeningView, type DuelDiceRound } from "@yugidraft/shared/duels";
import {
  DICE_TIMELINE, DICE_TIMELINE_REDUCED, RANDOM_BREAK_LINE, brokenAtRandom, diceBeat, dicePlan, diceStatus, diceSub, dieValue, facingSeat, landingOf, landsAt,
  myLobbySeat, nameList, nameOfLobby, replayGroups, rollPath, rollingSeats, roundStartMs, seatCountOf, seatLine, seatMoveText, seatsMoved, tileOf, tiedGroups, topRoll,
} from "../src/components/duel/dice-model";

const DEADLINE = Date.parse("2026-10-07T12:00:03.000Z");

function view(rounds: Array<Array<number | null>>, over: Partial<DuelDiceOpeningView> = {}): DuelDiceOpeningView {
  const list: DuelDiceRound[] = rounds.map((rolls, index) => ({ round: index + 1, rolls }));
  return { phase: "dice", round: list.length, serverNow: DEADLINE - 3000, deadlineAt: new Date(DEADLINE).toISOString(), rounds: list, order: null, finalSeats: null, ...over };
}
function withOrder(rounds: Array<Array<number | null>>, order: number[], over: Partial<DuelDiceOpeningView> = {}) {
  return view(rounds, { order, finalSeats: order.map((_, lobby) => order.indexOf(lobby)), ...over });
}
const NAMES = ["Mira", "Dax", "Rin", "Kade"];
const nameOf = (seat: number) => NAMES[seat]!;

describe("round display", () => {
  it("starts the round three seconds before the deadline", () => {
    expect(roundStartMs(view([[1, 2, 3]]))).toBe(DEADLINE - DUEL_DICE_REVEAL_MS);
  });
  it("counts the seats from the first round or the order", () => {
    expect(seatCountOf(view([[1, 2, 3, 4]]))).toBe(4);
    expect(seatCountOf(view([], { order: [1, 0, 2] }))).toBe(3);
  });
  it("lists the seats that roll and their roll path", () => {
    const v = view([[5, 3, 5], [2, null, 4]]);
    expect(rollingSeats(v.rounds[1]!)).toEqual([0, 2]);
    expect(rollPath(v, 0)).toEqual([5, 2]);
    expect(rollPath(v, 1)).toEqual([3]);
    expect(dieValue(v, 2)).toBe(4);
  });
  it("finds the top roll and flags a 6 as big", () => {
    const round: DuelDiceRound = { round: 1, rolls: [4, 6, 2] };
    expect(topRoll(round)).toBe(6);
    expect(landingOf(round, 1)).toBe("big");
    expect(landingOf(round, 0)).toBe("land");
    expect(landingOf({ round: 1, rolls: [4, 3, 2] }, 0)).toBe("top");
    expect(landingOf({ round: 2, rolls: [null, 3, 3] }, 0)).toBeNull();
  });
  it("gives every die the same throw on every screen, inside the timeline", () => {
    const a = dicePlan(2, 1, DICE_TIMELINE);
    expect(dicePlan(2, 1, DICE_TIMELINE)).toEqual(a);
    expect(dicePlan(2, 2, DICE_TIMELINE)).not.toEqual(a);
    for (let round = 1; round <= 10; round += 1) for (let seat = 0; seat < 4; seat += 1) {
      const plan = dicePlan(round, seat, DICE_TIMELINE);
      expect(plan.dur).toBeGreaterThanOrEqual(DICE_TIMELINE.tumbleMin);
      expect(plan.dur).toBeLessThanOrEqual(DICE_TIMELINE.tumbleMax);
      expect(plan.delay).toBeLessThanOrEqual(DICE_TIMELINE.stagger);
      expect(Math.abs(plan.spinX) % 360).toBe(0);
      expect(landsAt(plan, DICE_TIMELINE)).toBeLessThan(DICE_TIMELINE.tieAt);
      expect(landsAt(plan, DICE_TIMELINE)).toBeLessThan(DICE_TIMELINE.orderAt);
    }
    expect(landsAt(dicePlan(1, 0, DICE_TIMELINE_REDUCED), DICE_TIMELINE_REDUCED)).toBe(400);
  });
});

describe("tie state", () => {
  it("replays the rounds into rank groups", () => {
    expect(replayGroups([{ round: 1, rolls: [5, 3, 5] }], 3)).toEqual([[0, 2], [1]]);
    expect(replayGroups([{ round: 1, rolls: [5, 3, 5] }, { round: 2, rolls: [2, null, 4] }], 3)).toEqual([[2], [0], [1]]);
  });
  it("names the tied players of a 3-way and keeps the others out", () => {
    const v = view([[5, 3, 5]]);
    expect(tiedGroups(v)).toEqual([[0, 2]]);
    expect(tileOf(v, 0, 2200, DICE_TIMELINE).state).toBe("tied");
    expect(tileOf(v, 1, 2200, DICE_TIMELINE).state).toBe("kept");
    expect(tileOf(v, 0, 2200, DICE_TIMELINE).chip).toEqual({ text: "Tie", kind: "tie", first: false });
  });
  it("handles a double tie as two groups in one round", () => {
    const v = view([[5, 2, 5, 2]]);
    expect(tiedGroups(v)).toEqual([[0, 2], [1, 3]]);
    expect(diceStatus(v, 0, nameOf, "tie", false)).toEqual({ main: "Tie — roll again", note: "You and Rin tied on 5 · Dax and Kade tied on 2", kind: "tie" });
  });
  it("does not call equal rolls in different groups a tie", () => {
    // Seats 1 and 3 hold a 3 in their own group, seats 0 and 2 tie on 5 and then roll 3 each: the two groups stay apart.
    const v = view([[5, 3, 5, 3], [3, null, 3, null]]);
    expect(replayGroups(v.rounds, 4)).toEqual([[0, 2], [1, 3]]);
    const stillTied = view([[5, 3, 5], [3, null, 3]]);
    expect(tiedGroups(stillTied)).toEqual([[0, 2]]);
  });
  it("shows no tie once the order is set", () => {
    const v = withOrder([[5, 3, 5], [2, null, 4]], [2, 0, 1]);
    expect(tiedGroups(v)).toEqual([]);
  });
  it("only rolls the tied players again and shows the rest as kept", () => {
    const v = view([[5, 3, 5], [2, null, 4]]);
    const kept = tileOf(v, 1, 500, DICE_TIMELINE);
    expect(kept.rolling).toBe(false);
    expect(kept.caption).toEqual({ main: "Keeps 3", note: null });
    const rolling = tileOf(v, 0, 100, DICE_TIMELINE);
    expect(rolling.state).toBe("rolling");
    expect(rolling.caption.main).toBe("Rolling…");
    const landed = tileOf(v, 0, 2000, DICE_TIMELINE);
    expect(landed.caption).toEqual({ main: "Rolled 2", note: "was 5" });
  });
});

describe("beats", () => {
  it("names a tie late in the round and the order before the seat move", () => {
    const tie = view([[5, 3, 5]]);
    expect(diceBeat(tie, 1000, DICE_TIMELINE)).toBe("rolling");
    expect(diceBeat(tie, 2200, DICE_TIMELINE)).toBe("tie");
    const final = withOrder([[4, 6, 2]], [1, 0, 2]);
    expect(diceBeat(final, 1500, DICE_TIMELINE)).toBe("rolling");
    expect(diceBeat(final, 2100, DICE_TIMELINE)).toBe("order");
    expect(seatsMoved(final, 2100, DICE_TIMELINE)).toBe(false);
    expect(seatsMoved(final, 2400, DICE_TIMELINE)).toBe(true);
    expect(seatsMoved(tie, 2900, DICE_TIMELINE)).toBe(false);
  });
  it("shows the moved layout for a view that is already in the start phase", () => {
    const start = withOrder([[4, 6, 2]], [1, 0, 2], { phase: "start" });
    expect(diceBeat(start, 0, DICE_TIMELINE)).toBe("order");
    expect(seatsMoved(start, 0, DICE_TIMELINE)).toBe(true);
  });
});

describe("final order", () => {
  it("ranks the tiles and flags the first player", () => {
    const v = withOrder([[4, 6, 2]], [1, 0, 2]);
    const first = tileOf(v, 1, 2100, DICE_TIMELINE);
    expect(first.chip).toEqual({ text: "1st", kind: "rank", first: true });
    expect(tileOf(v, 0, 2100, DICE_TIMELINE).chip).toEqual({ text: "2nd", kind: "rank", first: false });
    expect(tileOf(v, 2, 2100, DICE_TIMELINE).chip?.text).toBe("3rd");
  });
  it("says who goes first and the turn order, from the viewer's side", () => {
    const v = withOrder([[4, 6, 2]], [1, 0, 2]);
    expect(diceStatus(v, 0, nameOf, "order", false)).toEqual({ main: "Dax goes first", note: "Turn order: Dax → You → Rin", kind: "win" });
    expect(diceStatus(v, 1, nameOf, "order", false).main).toBe("You go first");
    expect(diceStatus(v, null, nameOf, "order", false).note).toBe("Turn order: Dax → Mira → Rin");
  });
});

describe("seat move text", () => {
  it("says where each player moves", () => {
    const v = withOrder([[4, 6, 2]], [1, 0, 2]);
    expect(seatMoveText(v, 1)).toBe("Moves to seat 1");
    expect(seatMoveText(v, 0)).toBe("Moves to seat 2");
    expect(seatMoveText(v, 2)).toBe("Stays in seat 3");
    expect(seatMoveText(view([[1, 2, 3]]), 0)).toBeNull();
  });
  it("follows the order in a 3-way", () => {
    const v = withOrder([[4, 6, 2]], [1, 0, 2]);
    expect(seatLine(v, 0, nameOf)).toBe("Seats follow the turn order");
    expect(diceStatus(v, 0, nameOf, "order", true).note).toBe("Seats follow the turn order");
  });
  it("pairs rank 1 with 2 and rank 3 with 4 in a 4-way", () => {
    const v = withOrder([[3, 6, 1, 4]], [1, 3, 0, 2]);
    expect(facingSeat(v, 1)).toBe(3);
    expect(facingSeat(v, 3)).toBe(1);
    expect(facingSeat(v, 0)).toBe(2);
    expect(facingSeat(v, 2)).toBe(0);
    expect(seatLine(v, 0, nameOf)).toBe("You face Rin");
    expect(seatLine(v, null, nameOf)).toBe("Dax faces Kade · Mira faces Rin");
    expect(facingSeat(withOrder([[1, 2, 3]], [2, 1, 0]), 0)).toBeNull();
  });
  it("re-indexes the viewer and the names after the server's seat move", () => {
    const dice = withOrder([[4, 6, 2]], [1, 0, 2]);
    expect(myLobbySeat(dice, 0)).toBe(0);
    expect(nameOfLobby(dice, ["A", "B", "C"], 1)).toBe("B");
    const start = { ...dice, phase: "start" as const };
    // Lobby seat 1 sits in public seat 0 now, and the room reports names and mySeat by public seat.
    expect(myLobbySeat(start, 0)).toBe(1);
    expect(myLobbySeat(start, null)).toBeNull();
    expect(nameOfLobby(start, ["Dax", "Mira", "Rin"], 1)).toBe("Dax");
    expect(nameOfLobby(start, ["Dax", "Mira", "Rin"], 0)).toBe("Mira");
    expect(nameOfLobby(start, [], 2)).toBe("Player 3");
  });
});

describe("random tie-break", () => {
  const rounds = Array.from({ length: 10 }, () => [4, 4, 4, 2] as Array<number | null>);
  it("is detected when the order arrives next to tied rolls", () => {
    const v = withOrder(rounds, [2, 0, 1, 3], { phase: "start", round: 10 });
    expect(brokenAtRandom(v)).toBe(true);
    expect(brokenAtRandom(withOrder([[4, 6, 2]], [1, 0, 2]))).toBe(false);
    expect(brokenAtRandom(view([[4, 4, 2]]))).toBe(false);
  });
  it("adds the short line to the status", () => {
    const v = withOrder(rounds, [2, 0, 1, 3], { phase: "start", round: 10 });
    expect(RANDOM_BREAK_LINE).toBe("Tie broken at random");
    expect(diceStatus(v, 0, nameOf, "order", true).note.startsWith("Tie broken at random")).toBe(true);
    expect(diceStatus(withOrder([[4, 6, 2]], [1, 0, 2]), 0, nameOf, "order", false).note).not.toContain("random");
  });
  it("still ranks every tile", () => {
    const v = withOrder(rounds, [2, 0, 1, 3], { phase: "start", round: 10 });
    expect(tileOf(v, 2, 0, DICE_TIMELINE).chip?.first).toBe(true);
    expect(tileOf(v, 1, 0, DICE_TIMELINE).chip?.text).toBe("3rd");
  });
});

describe("text helpers", () => {
  it("lists names with the viewer first", () => {
    expect(nameList([0, 2], 2, nameOf)).toBe("You and Mira");
    expect(nameList([1, 2, 3], 2, nameOf)).toBe("You, Dax and Kade");
    expect(nameList([1], 2, nameOf)).toBe("Dax");
  });
  it("describes the round and the viewer", () => {
    expect(diceSub(view([[1, 2, 3]]), 0, false)).toBe("3-way · Round 1");
    expect(diceSub(view([[5, 3, 5], [1, null, 2]]), null, false)).toBe("3-way · You are watching · Round 2 · tied players only");
    expect(diceSub(withOrder([[1, 2, 3, 4]], [3, 2, 1, 0]), 0, true)).toBe("4-way · Seats in turn order");
  });
  it("says what the first and the later rolls are", () => {
    expect(diceStatus(view([[1, 2, 3]]), 0, nameOf, "rolling", false)).toEqual({ main: "Rolling…", note: "Everyone rolls at once", kind: "plain" });
    expect(diceStatus(view([[5, 3, 5], [null, null, null]]), 0, nameOf, "rolling", false).main).toBe("Rolling again…");
  });
});
