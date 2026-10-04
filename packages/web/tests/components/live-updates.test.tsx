// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SheetRoot } from "@/components/sheet/sheet-root";
import { Roll } from "@/components/motion/roll";
import { StandingsFloor } from "@/components/tournament/standings/standings-floor";
import { StandingsGrid } from "@/components/tournament/standings/crosstable";
import { buildCrosstable } from "@/components/tournament/standings/standings-model";
import { SpectatorGrid, TableStrip } from "@/components/tournament/floor/tables";
import { LobbySeats } from "@/components/draft/lobby/lobby-seats";
import type { Match, TournamentDetail } from "@/components/tournament/types";
import { sheetTournament } from "../fixtures/tournament-sheet";
import { standingsMatch, standingsPlayers, standingsRatings, standingsTournament } from "../fixtures/standings";

type Call = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions };
let calls: Call[];
const realRect = Element.prototype.getBoundingClientRect;
const realMatchMedia = window.matchMedia;

/** Rows sit 40px apart in the order they have in the DOM, so a reorder is a real move to the hook. */
function layoutByDomOrder() {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const row = this.closest("[data-flip-id]");
    const parent = row?.parentElement;
    const top = row && parent ? Array.from(parent.children).indexOf(row) * 40 : 0;
    return { top, left: 0, right: 0, bottom: top, width: 300, height: 40, x: 0, y: top, toJSON() {} } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
}

function reducedMotion(on: boolean) {
  window.matchMedia = vi.fn(() => ({ matches: on, media: "", addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  calls = [];
  Element.prototype.animate = vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    calls.push({ el: this, keyframes, options });
    return { cancel: vi.fn(), onfinish: null, oncancel: null, addEventListener: vi.fn() } as unknown as Animation;
  }) as unknown as typeof Element.prototype.animate;
  reducedMotion(false);
  layoutByDomOrder();
});
afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = realRect;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  window.matchMedia = realMatchMedia;
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
});

const moves = () => calls.filter((c) => String(c.keyframes[0]?.transform ?? "").startsWith("translate(") && c.keyframes[1]?.transform === "none" && c.options.duration === 300);
const rolls = () => calls.filter((c) => c.options.duration === 220);
const arrivals = () => calls.filter((c) => c.keyframes[0]?.transform === "translateY(4px)");

describe("Roll", () => {
  it("shows the first value without animating, rolls a change in from below, and ignores the same value", () => {
    const { container, rerender } = render(<Roll value="1–0" />);
    expect(calls).toHaveLength(0);
    rerender(<Roll value="1–0" />);
    expect(calls).toHaveLength(0);
    rerender(<Roll value="2–0" />);
    const [incoming, outgoing] = rolls();
    expect(incoming.keyframes).toEqual([{ transform: "translateY(55%)", opacity: 0 }, { transform: "none", opacity: 1 }]);
    expect(outgoing.keyframes).toEqual([{ transform: "none", opacity: 1 }, { transform: "translateY(-55%)", opacity: 0 }]);
    // The old text is a hidden copy for the length of the roll, so the name a screen reader gets is unchanged.
    expect(container.querySelector("[aria-hidden=true]")).toHaveTextContent("1–0");
    expect(container).toHaveTextContent("2–0");
  });

  it("drops the outgoing copy after the roll", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<Roll value={1} />);
      rerender(<Roll value={2} />);
      expect(container.querySelectorAll(".mo-roll-v")).toHaveLength(2);
      act(() => void vi.advanceTimersByTime(220));
      expect(container.querySelectorAll(".mo-roll-v")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the roll under reduced motion", () => {
    reducedMotion(true);
    const { container, rerender } = render(<Roll value={5} />);
    rerender(<Roll value={6} />);
    expect(calls).toHaveLength(0);
    expect(container).toHaveTextContent("6");
    expect(container.querySelectorAll(".mo-roll-v")).toHaveLength(1);
  });
});

describe("standings rows", () => {
  const props = { tournamentSlug: "t", currentUserPlayerId: 5, ratings: standingsRatings };
  const fresh: TournamentDetail = { ...standingsTournament, matches: [] };
  const withResult: TournamentDetail = {
    ...fresh,
    matches: [standingsMatch(1, 6, 1, { status: "completed", winnerId: 6, matchId: 101 })],
  };
  const show = (tournament: TournamentDetail) => <SheetRoot><StandingsFloor {...props} tournament={tournament} /></SheetRoot>;
  const rowFor = (name: string) => screen.getByRole("link", { name }).closest("li") as HTMLElement;

  it("carries the player id as the row id, so a row is the same row after a reorder", () => {
    render(show(fresh));
    expect(standingsPlayers.map((p) => rowFor(p.displayName).dataset.flipId)).toEqual(standingsPlayers.map((p) => String(p.playerId)));
  });

  it("glides a row that moves up from its old place, lifts it, and washes the rows whose record changed", () => {
    const { rerender } = render(show(fresh));
    expect(calls).toHaveLength(0);
    rerender(show(withResult));
    const marik = rowFor("Marik_Mains");
    const marikMove = moves().find((c) => c.el === marik);
    expect(marikMove).toBeTruthy();
    expect(marikMove!.options.easing).toContain("cubic-bezier");
    expect(marik).toHaveAttribute("data-lifted");
    expect(marik).toHaveAttribute("data-wash");
    expect(rowFor("Kestrel")).toHaveAttribute("data-wash");
    expect(rowFor("Imran")).not.toHaveAttribute("data-wash");
    // Only transform moves.
    for (const move of moves()) expect(Object.keys(move.keyframes[0])).toEqual(["transform"]);
  });

  it("rolls the record of a row whose result landed", () => {
    const { rerender } = render(show(fresh));
    rerender(show(withResult));
    const record = rowFor("Marik_Mains").querySelector("[aria-label$='losses']") as HTMLElement;
    expect(record).toHaveAttribute("aria-label", "1 wins, 0 losses");
    expect(rolls().some((c) => record.contains(c.el))).toBe(true);
  });

  it("makes no moves when nothing changed, and a row that joined arrives with a 4px rise", () => {
    const { rerender } = render(show(fresh));
    rerender(show({ ...fresh }));
    expect(calls).toHaveLength(0);
    rerender(show({ ...fresh, participants: [...fresh.participants, { playerId: 9, displayName: "Newcomer" }] }));
    expect(arrivals()).toHaveLength(1);
    expect(arrivals()[0].el).toBe(rowFor("Newcomer"));
  });

  it("does not move rows under reduced motion's rule for rolls, but still marks the wash", () => {
    reducedMotion(true);
    const { rerender } = render(show(fresh));
    rerender(show(withResult));
    expect(rolls()).toHaveLength(0);
    expect(rowFor("Kestrel")).toHaveAttribute("data-wash");
  });
});

describe("crosstable rows", () => {
  const rowsOf = (tournament: Pick<TournamentDetail, "participants" | "matches">) => buildCrosstable(tournament, 5);
  const fresh = { participants: standingsPlayers, matches: [] as Match[] };
  const after = { participants: standingsPlayers, matches: [standingsMatch(1, 6, 1, { status: "completed", winnerId: 6, matchId: 101 })] };
  const show = (t: typeof fresh) => <SheetRoot><StandingsGrid rows={rowsOf(t)} currentUserPlayerId={5} narrow={false} /></SheetRoot>;

  it("keys rows by player id and glides the row that moved", () => {
    const { rerender, container } = render(show(fresh));
    const ids = Array.from(container.querySelectorAll("tbody tr")).map((tr) => (tr as HTMLElement).dataset.flipId);
    expect(ids.sort()).toEqual(standingsPlayers.map((p) => String(p.playerId)).sort());
    rerender(show(after));
    expect(moves().length).toBeGreaterThan(0);
    for (const move of moves()) expect(move.el.tagName).toBe("TR");
  });
});

describe("floor tables", () => {
  const seat = { ...sheetTournament, participants: sheetTournament.participants };
  const first = sheetTournament.matches.find((m) => m.roundNumber === 1)!;

  it("gives every table of the strip and of the spectator grid its match id", () => {
    const { container, unmount } = render(<SheetRoot><TableStrip tournament={seat} round={1} viewerId={5} /></SheetRoot>);
    expect(container.querySelector(`[data-flip-id="${first.id}"]`)).not.toBeNull();
    unmount();
    const spectator = render(<SheetRoot><SpectatorGrid tournament={seat} round={1} viewerId={null} /></SheetRoot>);
    expect(spectator.container.querySelector(`[data-flip-id="${first.id}"]`)).not.toBeNull();
  });

  it("a table that starts later in the round arrives with a rise; an unchanged render plays nothing", () => {
    const extra: Match = { ...first, id: 9001, playerOneId: 1, playerTwoId: 2, playerOneName: "A", playerTwoName: "B" };
    const view = (t: TournamentDetail) => <SheetRoot><SpectatorGrid tournament={t} round={1} viewerId={null} /></SheetRoot>;
    const { rerender, container } = render(view(seat));
    rerender(view({ ...seat }));
    expect(calls).toHaveLength(0);
    rerender(view({ ...seat, matches: [...seat.matches, extra] }));
    expect(arrivals().some((c) => c.el === container.querySelector('[data-flip-id="9001"]'))).toBe(true);
  });
});

describe("draft lobby seats", () => {
  const a = { playerId: 1, displayName: "Ann" };
  const b = { playerId: 2, displayName: "Bo" };
  const show = (players: typeof a[]) => <SheetRoot><LobbySeats players={players} youIds={new Set([1])} isCreator={false} aux="" /></SheetRoot>;

  it("a player who joins rises in, and the others stay still", () => {
    const { rerender } = render(show([a]));
    rerender(show([a, b]));
    expect(arrivals()).toHaveLength(1);
    expect(arrivals()[0].el).toBe(screen.getAllByText("Bo")[0].closest("li"));
  });
});
