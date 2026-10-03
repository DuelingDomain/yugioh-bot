import { describe, expect, it } from "vitest";
import { buildCrosstable, buildStandings } from "@/components/tournament/standings/standings-model";
import { standingsMatch, standingsPlayers, standingsSeries, standingsTournament } from "./fixtures/standings";

describe("standings order", () => {
  it("matches the route's wins-descending, losses-ascending order and shares competition places", () => {
    expect(buildStandings(standingsTournament)).toEqual([
      { playerId: 1, displayName: "Kestrel", wins: 3, losses: 0, place: 1 },
      { playerId: 5, displayName: "Imran", wins: 2, losses: 1, place: 2 },
      { playerId: 2, displayName: "voidpriest", wins: 2, losses: 1, place: 2 },
      { playerId: 3, displayName: "duelist.josh", wins: 1, losses: 2, place: 4 },
      { playerId: 4, displayName: "BlueEyesBen", wins: 1, losses: 2, place: 4 },
      { playerId: 6, displayName: "Marik_Mains", wins: 0, losses: 3, place: 6 },
    ]);
  });

  it("breaks ties by fewest losses, then retains participant order rather than name or Elo", () => {
    const tournament = { ...standingsTournament, participants: [standingsPlayers[2], standingsPlayers[1], standingsPlayers[0]], matches: [
      standingsMatch(20, 1, 5, { status: "completed", winnerId: 1 }),
      standingsMatch(21, 5, 2, { status: "completed", winnerId: 5 }),
      standingsMatch(22, 2, 5, { status: "completed", winnerId: 2 }),
    ] };
    expect(buildStandings(tournament).map(({ playerId, wins, losses, place }) => [playerId, wins, losses, place])).toEqual([
      [1, 1, 0, 1], [2, 1, 1, 2], [5, 1, 2, 3],
    ]);
    expect(buildStandings({ ...tournament, matches: [] }).map(({ playerId, place }) => [playerId, place])).toEqual([
      [2, 1], [5, 1], [1, 1],
    ]);
  });

  it("excludes byes and unconfirmed reports from both wins and losses", () => {
    const tournament = { ...standingsTournament, matches: [
      standingsMatch(30, 1, null, { status: "completed", winnerId: 1, metadata: { bye: true, winnerId: 1 } }),
      standingsMatch(31, 5, 2, { status: "completed", winnerId: 5, metadata: { bye: true } }),
      standingsMatch(32, 3, 4, { status: "pending_approval", winnerId: 3, reporterId: 3 }),
      standingsMatch(33, 4, 6, { status: "pending", winnerId: 4, reporterId: 4 }),
    ] };
    expect(buildStandings(tournament).map(({ wins, losses, place }) => [wins, losses, place])).toEqual([
      [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1],
    ]);
  });

  it("leaves the incoming participant and match arrays unchanged", () => {
    const tournament = structuredClone(standingsTournament);
    const before = structuredClone(tournament);
    buildCrosstable(tournament, 5);
    expect(tournament).toEqual(before);
  });
});

function cell(rowId: number, columnId: number, tournament = standingsTournament, viewer: number | null = 5) {
  const grid = buildCrosstable(tournament, viewer);
  return grid.find((row) => row.playerId === rowId)!.cells[grid.findIndex((row) => row.playerId === columnId)];
}

describe("crosstable cells", () => {
  it.each([
    [1, 1, "self", "", null],
    [1, 5, "w", "2–1", "won"], [5, 1, "l", "1–2", "lost"],
    [4, 6, "w", "W", "won"], [6, 4, "l", "L", "lost"],
    [1, 2, "live", "1–0", "game 2"], [2, 1, "live", "0–1", "game 2"],
    [3, 6, "wait", "L", "reported"], [6, 3, "wait", "W", "reported"],
    [5, 4, "you", "Play", null], [4, 5, "open", "·", null],
    [5, 6, "you", "Play", null], [6, 5, "open", "·", null],
    [1, 3, "open", "·", null], [3, 1, "open", "·", null],
  ] as const)("shows row %i vs column %i as %s (%s)", (row, column, result, text, label) => {
    expect(cell(row, column)).toMatchObject({ result, text, label });
  });

  it("maps reversed series player order before flipping the player-two row", () => {
    const slot = standingsMatch(40, 1, 5);
    const tournament = { ...standingsTournament, matches: [{ ...slot, series: standingsSeries(slot, {
      playerIds: [5, 1], displayNames: ["Imran", "Kestrel"], wins: [0, 1],
    }) }] };
    expect(cell(1, 5, tournament)).toMatchObject({ text: "1–0", label: "game 2" });
    expect(cell(5, 1, tournament)).toMatchObject({ text: "0–1", label: "game 2" });
  });

  it("keeps the next game label between games even when the last game was a draw", () => {
    const slot = standingsMatch(41, 1, 5);
    const tournament = { ...standingsTournament, matches: [{ ...slot, series: standingsSeries(slot, {
      status: "between_games", wins: [1, 1], gameNumber: 3,
    }) }] };
    expect(cell(1, 5, tournament)).toMatchObject({ result: "live", text: "1–1", label: "game 4" });
    expect(cell(5, 1, tournament)).toMatchObject({ result: "live", text: "1–1", label: "game 4" });
  });

  it("uses W/L for a result with a cancelled series, and Play when the slot reopens", () => {
    const slot = standingsMatch(42, 1, 5, { status: "completed", winnerId: 5 });
    const series = standingsSeries(slot, { status: "cancelled", wins: [1, 0] });
    const tournament = { ...standingsTournament, matches: [{ ...slot, series }] };
    expect(cell(5, 1, tournament)).toMatchObject({ result: "w", text: "W" });
    expect(cell(1, 5, tournament)).toMatchObject({ result: "l", text: "L" });
    expect(cell(5, 1, { ...tournament, matches: [{ ...slot, series, status: "open", winnerId: null }] })).toMatchObject({ result: "you", matchId: 42 });
  });

  it("gives spectators no Play cells and cannot link a pair without a slot", () => {
    expect(cell(5, 4, standingsTournament, null).result).toBe("open");
    expect(cell(5, 4, { ...standingsTournament, matches: [] })).toMatchObject({ result: "open", matchId: null });
  });

  it("describes both opponents, result, score and game for assistive technology", () => {
    expect(cell(1, 2).accessibleName).toBe("Kestrel vs voidpriest: live, game 2, Kestrel leads 1–0");
    expect(cell(2, 1).accessibleName).toBe("voidpriest vs Kestrel: live, game 2, voidpriest trails 0–1");
    expect(cell(5, 4).accessibleName).toBe("Imran vs BlueEyesBen: not started, play now");
    expect(cell(6, 3).accessibleName).toBe("Marik_Mains vs duelist.josh: reported win, awaiting confirmation");
  });
});
