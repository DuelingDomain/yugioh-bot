import { describe, expect, it } from "vitest";
import { generateSingleElimFirstRound } from "@yugidraft/shared/tournaments";
import { buildBracket, currentBracketRound, feeders, roundCount } from "@/components/tournament/bracket/bracket-model";
import type { Match, Participant } from "@/components/tournament/types";

function players(count: number): Participant[] {
  return Array.from({ length: count }, (_, i) => ({ playerId: i + 1, displayName: `P${i + 1}` }));
}
const name = (id: number | null) => (id === null ? null : `P${id}`);

/** Matches exactly as the engine's start inserts them: byes first, then pairings, no shuffle. */
function firstRound(count: number): Match[] {
  const { byes, pairings } = generateSingleElimFirstRound(players(count).map((p) => p.playerId));
  const rows = [
    ...byes.map((id) => ({ one: id, two: null as number | null, bye: true })),
    ...pairings.map((p) => ({ one: p.playerOneId, two: p.playerTwoId as number | null, bye: false })),
  ];
  return rows.map((row, i) => ({
    id: i + 1, matchId: null, roundNumber: 1, playerOneId: row.one, playerTwoId: row.two,
    playerOneName: name(row.one)!, playerTwoName: name(row.two),
    status: row.bye ? "completed" : "open", winnerId: row.bye ? row.one : null, reporterId: null, resolvedAt: null,
    metadata: row.bye ? { bye: true, winnerId: row.one } : {},
  }));
}

const sideName = (side: { kind: string; name?: string; label?: string } | null) => (side === null ? null : side.kind === "player" ? side.name : side.label);

describe("bracket round names and counts", () => {
  it.each([[2, 1], [3, 2], [4, 2], [5, 3], [8, 3], [9, 4]])("%i players make %i rounds", (n, rounds) => {
    expect(roundCount(n)).toBe(rounds);
  });

  it("names rounds from the end", () => {
    const rounds = buildBracket({ participants: players(8), matches: firstRound(8) });
    expect(rounds.map((r) => r.name)).toEqual(["Quarterfinals", "Semifinals", "Final"]);
    expect(rounds.map((r) => r.short)).toEqual(["Quarters", "Semis", "Final"]);
    expect(rounds.map((r) => r.code)).toEqual(["QF", "SF", "F"]);
    expect(buildBracket({ participants: players(16), matches: [] })[0].name).toBe("Round 1");
  });
});

describe("8 players", () => {
  const rounds = buildBracket({ participants: players(8), matches: firstRound(8) });

  it("pairs first with last, as the engine does, with join-order seeds", () => {
    const pairs = rounds[0].slots.map((s) => [sideName(s.a), sideName(s.b)]);
    expect(pairs).toEqual([["P1", "P8"], ["P2", "P7"], ["P3", "P6"], ["P4", "P5"]]);
    expect(rounds[0].slots[0].a).toMatchObject({ seed: 1 });
    expect(rounds[0].slots[0].b).toMatchObject({ seed: 8 });
  });

  it("draws later rounds as Winner of boxes, grouped by the slot each pair feeds", () => {
    expect(rounds.map((r) => r.slots.length)).toEqual([4, 2, 1]);
    expect(rounds[0].paired).toBe(true);
    expect(rounds[1].paired).toBe(false);
    // Engine: round 2 pairs the first winner with the last (slot 0 v slot 3), then 1 v 2.
    expect(rounds[1].slots.map((s) => [sideName(s.a), sideName(s.b)])).toEqual([
      ["Winner of P1 – P8", "Winner of P4 – P5"],
      ["Winner of P2 – P7", "Winner of P3 – P6"],
    ]);
    expect(rounds[2].slots[0].a).toMatchObject({ kind: "from" });
    expect(rounds[1].slots.every((s) => s.state === "tbd")).toBe(true);
  });

  it("orders the first-round columns so each pair sits beside the slot it feeds", () => {
    expect(rounds[2].groups).toHaveLength(1);
    expect(rounds[1].groups.map((g) => g.map((s) => s.index))).toEqual([[0, 1]]);
    expect(rounds[0].groups.map((g) => g.map((s) => s.index))).toEqual([[0, 3], [1, 2]]);
  });

  it("opens on the first round with something left to play", () => {
    expect(currentBracketRound(rounds)).toBe(1);
  });
});

describe("5 players and the bye", () => {
  const matches = firstRound(5);
  const rounds = buildBracket({ participants: players(5), matches });

  it("gives seat 1 the bye, listed first, then pairs the rest first with last", () => {
    expect(rounds.map((r) => r.slots.length)).toEqual([3, 2, 1]);
    expect(rounds[0].slots[0].bye).toBe(true);
    expect(sideName(rounds[0].slots[0].a)).toBe("P1");
    expect(rounds[0].slots[0].b).toBeNull();
    expect(rounds[0].slots[0].winnerId).toBe(1);
    expect(rounds[0].slots.slice(1).map((s) => [sideName(s.a), sideName(s.b)])).toEqual([["P2", "P5"], ["P3", "P4"]]);
  });

  it("feeds round 2 by the engine: the bye winner is a lone odd slot first", () => {
    // Three winners (bye, then two matches): the engine gives the first a bye again.
    expect(feeders(3)).toEqual([[0], [1, 2]]);
    expect(rounds[1].slots[0].bye).toBe(true);
    expect(rounds[1].slots[0].b).toBeNull();
    expect(rounds[1].slots[1].bye).toBe(false);
  });

  it("carries a decided winner into the next round's box by name", () => {
    const decided = matches.map((m) => m.id === 2 ? { ...m, status: "completed", winnerId: 5 } : m);
    const next = buildBracket({ participants: players(5), matches: decided });
    expect(next[0].slots[1].a).toMatchObject({ won: false });
    expect(next[0].slots[1].b).toMatchObject({ won: true });
    expect(next[0].done).toBe(2);
    expect(next[1].slots[1].a).toMatchObject({ kind: "player", name: "P5" });
  });
});

describe("unpaired and paired later rounds", () => {
  it("uses the real matches once a round is generated", () => {
    const first = firstRound(4).map((m) => ({ ...m, status: "completed", winnerId: m.playerOneId }));
    const final: Match = {
      id: 3, matchId: null, roundNumber: 2, playerOneId: 1, playerTwoId: 2, playerOneName: "P1", playerTwoName: "P2",
      status: "open", winnerId: null, reporterId: null, resolvedAt: null, metadata: {},
    };
    const rounds = buildBracket({ participants: players(4), matches: [...first, final] });
    expect(rounds.map((r) => r.name)).toEqual(["Semifinals", "Final"]);
    expect(rounds[1].paired).toBe(true);
    expect(rounds[1].slots[0].state).toBe("open");
    expect(currentBracketRound(rounds)).toBe(2);
  });

  it("opens on the final when everything is decided, and on round 1 before the start", () => {
    expect(buildBracket({ participants: [], matches: [] })).toEqual([]);
    const before = buildBracket({ participants: players(4), matches: [] });
    expect(before[0].paired).toBe(false);
    expect(currentBracketRound(before)).toBe(1);
  });
});
