import { describe, expect, it } from "vitest";
import {
  groupTournaments,
  listSummaryParts,
  tournamentHref,
  type TournamentListItem,
} from "../../../src/components/tournament/tournaments-list-model";

const t = (id: number, status: string, extra: Partial<TournamentListItem> = {}): TournamentListItem => ({
  id, name: `T${id}`, format: "round_robin", status, participantCount: 4, ...extra,
});

describe("tournaments list model", () => {
  it("groups running, open and finished and keeps the incoming (newest first) order", () => {
    const g = groupTournaments([t(5, "active"), t(4, "active"), t(3, "pending"), t(2, "completed"), t(1, "completed"), t(9, "cancelled")]);
    expect(g.running.map((x) => x.id)).toEqual([5, 4]);
    expect(g.open.map((x) => x.id)).toEqual([3]);
    expect(g.finished.map((x) => x.id)).toEqual([2, 1]);
  });

  it("leaves cancelled tournaments off the list", () => {
    const g = groupTournaments([t(1, "cancelled")]);
    expect(g.running.length + g.open.length + g.finished.length).toBe(0);
  });

  it("links to the slug, falling back to the id", () => {
    expect(tournamentHref({ id: 7, webSlug: "friday-12" })).toBe("/tournament/friday-12");
    expect(tournamentHref({ id: 7 })).toBe("/tournament/7");
  });

  it("builds the header summary without zero counts", () => {
    const g = groupTournaments([t(1, "active"), t(2, "completed"), t(3, "completed")]);
    expect(listSummaryParts(g)).toEqual(["1 in progress", "2 finished"]);
  });
});
