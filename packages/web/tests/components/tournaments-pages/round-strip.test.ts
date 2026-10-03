import { describe, expect, it } from "vitest";
import {
  buildRoundStrip,
  currentRoundOf,
  initialsOf,
  leaderOf,
  roundCount,
  roundWindow,
  rowAction,
  type RoundsInput,
} from "../../../src/components/tournament/tournaments-list-model";
import type { Match, Participant } from "../../../src/components/tournament/types";

const people = (n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({ playerId: i + 1, displayName: `P${i + 1}` }));

let nextId = 1;
const match = (round: number, one: number, two: number | null, extra: Partial<Match> = {}): Match => ({
  id: nextId++,
  matchId: null,
  roundNumber: round,
  playerOneId: one,
  playerTwoId: two,
  playerOneName: `P${one}`,
  playerTwoName: two === null ? null : `P${two}`,
  status: "open",
  winnerId: null,
  reporterId: null,
  resolvedAt: null,
  metadata: two === null ? { bye: true } : {},
  series: null,
  ...extra,
});

const series = (status: "active" | "between_games", slug: string) =>
  ({ status, currentDuelSlug: slug, wins: [0, 0], playerIds: [1, 2], gameNumber: 1 }) as unknown as Match["series"];

describe("roundCount and roundWindow", () => {
  it("works out round robin rounds from the size, and single elimination rounds from log2", () => {
    expect(roundCount({ format: "round_robin", participants: people(6), matches: [] })).toBe(5);
    expect(roundCount({ format: "round_robin", participants: people(5), matches: [] })).toBe(5);
    expect(roundCount({ format: "single_elim", participants: people(8), matches: [] })).toBe(3);
    expect(roundCount({ format: "single_elim", participants: people(5), matches: [] })).toBe(3);
  });

  it("takes the played rounds over the estimate once the pairings exist", () => {
    expect(roundCount({ format: "round_robin", participants: people(4), matches: [match(1, 1, 2), match(3, 1, 3)] })).toBe(3);
  });

  it("shows every round when there are five or fewer, else a window around the current one", () => {
    expect(roundWindow(3, 1)).toEqual({ from: 1, to: 3 });
    expect(roundWindow(9, 1)).toEqual({ from: 1, to: 5 });
    expect(roundWindow(9, 5)).toEqual({ from: 3, to: 7 });
    expect(roundWindow(9, 9)).toEqual({ from: 5, to: 9 });
  });
});

describe("buildRoundStrip", () => {
  const input = (matches: Match[], extra: Partial<RoundsInput> = {}): RoundsInput => ({
    format: "round_robin",
    status: "active",
    participants: people(4),
    matches,
    ...extra,
  });

  it("marks a win, a loss, the round in play, a round not yet played and a bye", () => {
    const strip = buildRoundStrip(
      input([
        match(1, 1, 2, { status: "completed", winnerId: 1 }),
        match(2, 3, 1, { status: "completed", winnerId: 3 }),
        match(3, 1, 4),
      ]),
      1,
    );
    expect(strip.total).toBe(3);
    expect(strip.slots.map((s) => s.state)).toEqual(["won", "lost", "now"]);
    expect(strip.slots[0]).toMatchObject({ label: "Round 1, beat P2", children: "P2" });
    expect(strip.slots[1].label).toBe("Round 2, lost to P3");
    expect(strip.currentRound).toBe(3);

    const bye = buildRoundStrip(input([match(1, 1, null), match(2, 1, 2)], { participants: people(3) }), 1);
    expect(bye.slots[0]).toMatchObject({ state: "dashed", label: "Round 1, bye" });
    expect(bye.slots[1].state).toBe("now");
  });

  it("shows a result waiting to be confirmed as pending", () => {
    const strip = buildRoundStrip(input([match(1, 1, 2, { status: "pending_approval", reporterId: 1, winnerId: 1 })]), 2);
    expect(strip.slots[0].state).toBe("pending");
    expect(strip.slots[0].label).toContain("waiting to be confirmed");
  });

  it("names the last two knockout rounds and leaves rounds not drawn yet as outlines", () => {
    const strip = buildRoundStrip(
      { format: "single_elim", status: "active", participants: people(8), matches: [match(1, 1, 2)] },
      1,
    );
    expect(strip.slots.map((s) => s.label)).toEqual(["Round 1, playing P2", "Semifinal", "Final"]);
    expect(strip.slots.map((s) => s.state)).toEqual(["now", "empty", "empty"]);
  });

  it("windows a long tournament around the round in play", () => {
    const matches = Array.from({ length: 9 }, (_, i) =>
      match(i + 1, 1, 2, i < 6 ? { status: "completed", winnerId: 1 } : {}),
    );
    const strip = buildRoundStrip(input(matches, { participants: people(10) }), 1);
    expect(strip.total).toBe(9);
    expect([strip.from, strip.to]).toEqual([5, 9]);
    expect(strip.slots).toHaveLength(5);
    expect(strip.currentRound).toBe(7);
  });

  it("draws empty outlines for a viewer with no player", () => {
    const strip = buildRoundStrip(input([match(1, 1, 2)]), null);
    expect(strip.slots.every((s) => s.state === "empty")).toBe(true);
  });
});

describe("currentRoundOf, leaderOf and initialsOf", () => {
  it("reports the lowest round with anything undecided, ignoring byes", () => {
    const matches = [match(1, 1, 2, { status: "completed", winnerId: 1 }), match(1, 3, null), match(2, 1, 3)];
    expect(currentRoundOf({ format: "round_robin", participants: people(3), matches })).toEqual({ round: 2, total: 2 });
    expect(currentRoundOf({ format: "round_robin", participants: people(3), matches: [] })).toBeNull();
  });

  it("picks the player with the most wins and nobody when no one has won", () => {
    const matches = [
      match(1, 1, 2, { status: "completed", winnerId: 2 }),
      match(2, 2, 3, { status: "completed", winnerId: 2 }),
    ];
    expect(leaderOf({ participants: people(3), matches })).toEqual({ playerId: 2, displayName: "P2" });
    expect(leaderOf({ participants: people(3), matches: [match(1, 1, 2)] })).toBeNull();
  });

  it("makes two-letter initials", () => {
    expect(initialsOf("dara")).toBe("Da");
    expect(initialsOf("  ")).toBe("");
  });
});

describe("rowAction", () => {
  const base = (matches: Match[], status = "active"): RoundsInput => ({ format: "round_robin", status, participants: people(4), matches });

  it("offers nothing unless the tournament is running", () => {
    expect(rowAction(base([match(1, 1, 2)], "pending"), 1)).toBeNull();
  });

  it("offers Open duel for your live match before anything else", () => {
    const live = match(1, 1, 2, { series: series("active", "room-a") });
    const action = rowAction(base([live, match(2, 1, 3)]), 1);
    expect(action).toEqual({ kind: "open", href: "/duels/room-a" });
  });

  it("offers Confirm for a result the other player reported, and Start duel for an unstarted match", () => {
    const reported = match(1, 1, 2, { status: "pending_approval", reporterId: 2, winnerId: 2 });
    expect(rowAction(base([reported]), 1)?.kind).toBe("confirm");
    expect(rowAction(base([reported]), 2)?.kind).not.toBe("confirm");
    expect(rowAction(base([match(1, 1, 2)]), 1)?.kind).toBe("start");
    expect(rowAction(base([match(1, 3, 4)]), 1)).toBeNull();
  });

  it("offers Watch only for a single duel you are not in", () => {
    const one = base([match(1, 3, 4, { series: series("active", "room-b") })]);
    expect(rowAction(one, 1)).toEqual({ kind: "watch", href: "/duels/room-b" });
    expect(rowAction(one, null)).toEqual({ kind: "watch", href: "/duels/room-b" });
    const two = base([match(1, 3, 4, { series: series("active", "room-b") }), match(1, 5, 6, { series: series("active", "room-c") })]);
    expect(rowAction(two, 1)).toBeNull();
  });
});
