// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/font/google", () => {
  // ./fonts loads every duel family; the LP digits use Oxanium.
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";
import { LeaderboardClient } from "../../app/(app)/leaderboard/leaderboard-client";
import { activeSeason, allTimeRows, referenceRows, seasonStartedOn } from "../fixtures/leaderboard";

const props = { rows: referenceRows, activeSeason, seasonStartedOn, currentPlayerId: 5, scope: "season" as const, onScopeChange: vi.fn() };

afterEach(() => vi.unstubAllGlobals());

describe("leaderboard view", () => {
  it("shows the season columns, live season, date and player count", () => {
    render(<LeaderboardView {...props} />);
    expect(screen.getByText("Season 3 · running")).toBeInTheDocument();
    expect(screen.getByText("since Tue, Aug 4")).toBeInTheDocument();
    expect(screen.getByText("11 ranked players")).toBeInTheDocument();
    const board = screen.getByRole("table", { name: "Season leaderboard" });
    expect(within(board).getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
      "#", "Player", "Tier", "Elo", "Winnings", "W–L", "Win %", "Streak",
    ]);
  });

  it("uses a named season and singular player count", () => {
    render(<LeaderboardView {...props} rows={referenceRows.slice(0, 1)} activeSeason={{ ...activeSeason, name: "Autumn League" }} />);
    expect(screen.getByText("Autumn League · running")).toBeInTheDocument();
    expect(screen.getByText("1 ranked player")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Top three" }).querySelectorAll("a")).toHaveLength(1);
  });

  it("drops season statistics from every part of the all-time view", () => {
    const { container } = render(<LeaderboardView {...props} rows={allTimeRows} scope="all" />);
    expect(screen.getByText("All seasons · ranked by career winnings")).toBeInTheDocument();
    const board = screen.getByRole("table", { name: "All-time leaderboard" });
    expect(within(board).getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
      "#", "Player", "Tier", "Elo", "Career winnings",
    ]);
    expect(screen.queryByText("Record")).toBeNull();
    expect(screen.queryByText("Streak")).toBeNull();
    expect(container.textContent).not.toContain("0–0");
    expect(screen.getByRole("button", { name: "All-time" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "This season" })).toHaveAttribute("aria-pressed", "false");
  });

  it("treats the API's no-season fallback as all-time everywhere", () => {
    const { container } = render(<LeaderboardView {...props} rows={allTimeRows} activeSeason={null} seasonStartedOn={null} />);
    expect(screen.getByText("No season running · all-time standings")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Leaderboard scope" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Win %" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "W–L" })).toBeNull();
    expect(screen.queryByText("Your season")).toBeNull();
    expect(screen.queryByText("Record")).toBeNull();
    expect(screen.queryByText("Streak")).toBeNull();
    expect(container.textContent).not.toContain("0–0");
    expect(container.textContent).not.toContain("0%");
  });

  it("highlights the current row and gives every player a real profile link", () => {
    render(<LeaderboardView {...props} />);
    const board = screen.getByRole("table", { name: "Season leaderboard" });
    for (const player of referenceRows) {
      expect(within(board).getByRole("link", { name: player.displayName })).toHaveAttribute("href", `/player/${player.playerId}`);
    }
    const row = within(board).getByRole("link", { name: "Imran" }).closest("tr")!;
    expect(within(row).getByText("you")).toBeInTheDocument();
    expect(row.className).toContain("me");
  });

  it("selects the season button accessibly and requests the other scope", () => {
    const onScopeChange = vi.fn();
    render(<LeaderboardView {...props} onScopeChange={onScopeChange} />);
    expect(screen.getByRole("button", { name: "This season" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All-time" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "All-time" }));
    expect(onScopeChange).toHaveBeenCalledWith("all");
  });

  it("renders the position card, actual current streak, and tier progress", () => {
    render(<LeaderboardView {...props} />);
    const card = screen.getByRole("region", { name: "Your season" });
    expect(within(card).getByText("#5")).toBeInTheDocument();
    expect(within(card).getByText("To pass Toon Tina")).toBeInTheDocument();
    expect(within(card).getByText("22 winnings")).toBeInTheDocument();
    expect(within(card).getByText("15–9 · 63%")).toBeInTheDocument();
        expect(card).not.toHaveTextContent("best");
    expect(screen.getByRole("img", { name: "Gold tier, 84 of 250 points through" })).toBeInTheDocument();
    expect(card).toHaveTextContent("166 Elo to Platinum");
  });

  it("shows Top tier with a full meter for Diamond", () => {
    render(<LeaderboardView {...props} currentPlayerId={2} />);
    expect(screen.getAllByText("Top tier").length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "Diamond tier, Top tier" }).firstElementChild).toHaveStyle({ width: "100%" });
  });

  it("renders a quiet empty board and guidance for an unlisted player", () => {
    render(<LeaderboardView {...props} rows={[]} />);
    expect(screen.getByText("No one is on the board yet")).toBeInTheDocument();
    expect(screen.getByText("You're not on the board yet.")).toBeInTheDocument();
    expect(screen.getAllByText("Finish a ranked match to appear here.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "Top three" })).toBeNull();
  });

  it("preserves the ledger while it is busy", () => {
    render(<LeaderboardView {...props} loading />);
    expect(screen.getByRole("region", { name: "Leaderboard standings" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("table", { name: "Season leaderboard" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your position, pinned" })).toBeNull();
  });
});

function observeCurrentRow() {
  let notify: IntersectionObserverCallback;
  const observed: Element[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe(el: Element) { observed.push(el); }
    disconnect() {}
  });
  return (visible: boolean) => act(() => notify(
    observed.map((target) => ({ isIntersecting: visible, target }) as IntersectionObserverEntry),
    {} as IntersectionObserver,
  ));
}

describe("leaderboard layout", () => {
  it("states the winnings sort and links whole rows, with the phone list beside the table", () => {
    const { container } = render(<LeaderboardView {...props} />);
    expect(screen.getByRole("columnheader", { name: "Winnings" })).toHaveAttribute("aria-sort", "descending");
    expect(container.querySelector(".lb-ph")).not.toBeNull();
    const phone = container.querySelector(".lb-ph")!;
    expect(within(phone as HTMLElement).getAllByRole("link")).toHaveLength(referenceRows.length);
    expect(within(phone as HTMLElement).getByRole("link", { name: "Imran" }).closest("li")!.className).toContain("me");
  });

  it("gives the phone two readouts for your place and Elo", () => {
    const { container } = render(<LeaderboardView {...props} />);
    const readouts = container.querySelector(".lps")!;
    expect(readouts.textContent).toContain("#5");
    expect(readouts.textContent).toContain("22 behind Toon Tina");
    expect(readouts.textContent).toContain("166 to Platinum");
  });

  it("puts the tier ladder on the page with an anchor the profile can link to", () => {
    const { container } = render(<LeaderboardView {...props} />);
    const ladder = container.querySelector("#tiers")!;
    expect(ladder).not.toBeNull();
    expect(within(ladder as HTMLElement).getAllByRole("listitem")).toHaveLength(5);
    expect(ladder.querySelector("li.here")!.textContent).toContain("Gold");
  });
});

describe("pinned position", () => {
  it("appears whenever the current row is out of view and hides when it returns", () => {
    const notify = observeCurrentRow();
    const { rerender } = render(<LeaderboardView {...props} />);
    notify(false); // Below the fold on first load, as on a phone.
    expect(screen.getByRole("region", { name: "Your position, pinned" })).toBeInTheDocument();
    notify(true);
    expect(screen.queryByRole("region", { name: "Your position, pinned" })).toBeNull();
    notify(false); // Scrolled past it.
    const bar = screen.getByRole("region", { name: "Your position, pinned" });
    expect(bar).toHaveTextContent("22 behind Toon Tina");
    expect(within(bar).getByText("176")).toBeInTheDocument();
    rerender(<LeaderboardView {...props} loading />);
    expect(screen.getByRole("region", { name: "Your position, pinned" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Leaderboard standings" })).toHaveAttribute("aria-busy", "true");
    notify(true);
    expect(screen.queryByRole("region", { name: "Your position, pinned" })).toBeNull();
  });

  it("omits the gap for first place", () => {
    const notify = observeCurrentRow();
    render(<LeaderboardView {...props} currentPlayerId={1} />);
    notify(false);
    expect(screen.getByRole("region", { name: "Your position, pinned" })).not.toHaveTextContent("behind");
  });

  it("never pins a player absent from the board", () => {
    observeCurrentRow();
    render(<LeaderboardView {...props} currentPlayerId={99} />);
    expect(screen.queryByRole("region", { name: "Your position, pinned" })).toBeNull();
  });
});

describe("leaderboard scope fetch", () => {
  it("keeps the laid-out page during a fetch, then renders all-time data", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    render(<LeaderboardClient initialRows={referenceRows} currentPlayerId={5} activeSeason={activeSeason} seasonStartedOn={seasonStartedOn} />);
    fireEvent.click(screen.getByRole("button", { name: "All-time" }));
    expect(fetcher).toHaveBeenCalledWith("/api/leaderboard?scope=all");
    expect(screen.getByRole("region", { name: "Leaderboard standings" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { name: "Leaderboard" })).toBeInTheDocument();
    await act(async () => finish(new Response(JSON.stringify({ rows: allTimeRows }))));
    expect(screen.getByRole("table", { name: "All-time leaderboard" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Leaderboard standings" })).toHaveAttribute("aria-busy", "false");
  });

  it("keeps the previous standings and announces a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<LeaderboardClient initialRows={referenceRows} currentPlayerId={5} activeSeason={activeSeason} seasonStartedOn={seasonStartedOn} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "All-time" })));
    expect(screen.getByRole("table", { name: "Season leaderboard" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't load the standings. Try again.");
  });
});
