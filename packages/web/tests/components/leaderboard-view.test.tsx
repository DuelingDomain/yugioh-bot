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

const seasonList = () => screen.getByRole("list", { name: "Season leaderboard, ranked by winnings" });
const allList = () => screen.getByRole("list", { name: "All-time leaderboard, ranked by career winnings" });
const subOf = (container: HTMLElement) => container.querySelector(".sv-bar-sub")!;

describe("leaderboard view", () => {
  it("shows the season columns, live season, date and player count in plain commas", () => {
    const { container } = render(<LeaderboardView {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeInTheDocument();
    expect(subOf(container)).toHaveTextContent("Season 3, running since Tue, Aug 4, 11 ranked players");
    expect(subOf(container).textContent).not.toContain("·");
    expect(container.textContent).toContain("Winnings");
    for (const label of ["Player", "Win %", "Streak", "W–L"]) expect(container.textContent).toContain(label);
    expect(within(seasonList()).getAllByRole("listitem")).toHaveLength(referenceRows.length);
  });

  it("uses a named season and singular player count", () => {
    const { container } = render(<LeaderboardView {...props} rows={referenceRows.slice(0, 1)} activeSeason={{ ...activeSeason, name: "Autumn League" }} />);
    expect(subOf(container)).toHaveTextContent("Autumn League, running since Tue, Aug 4, 1 ranked player");
    expect(screen.getByRole("region", { name: "Top three" }).querySelectorAll("a")).toHaveLength(1);
  });

  it("omits the date when the season start is unavailable", () => {
    const { container } = render(<LeaderboardView {...props} seasonStartedOn={null} />);
    expect(subOf(container)).toHaveTextContent("Season 3, running, 11 ranked players");
  });

  it("puts a champion ring on first place and words on the podium", () => {
    render(<LeaderboardView {...props} />);
    const podium = screen.getByRole("region", { name: "Top three" });
    expect(within(podium).getByText("First")).toBeInTheDocument();
    expect(within(podium).getByText("Second")).toBeInTheDocument();
    expect(within(podium).getByText("Third")).toBeInTheDocument();
    expect(podium.querySelectorAll("[data-champion]")).toHaveLength(1);
    expect(within(podium).getByRole("link", { name: /Kestrel/ })).toHaveAttribute("href", "/player/1");
  });

  it("drops season statistics from every part of the all-time view", () => {
    const { container } = render(<LeaderboardView {...props} rows={allTimeRows} scope="all" />);
    expect(subOf(container)).toHaveTextContent("All seasons, ranked by career winnings");
    expect(within(allList()).getAllByRole("listitem")).toHaveLength(allTimeRows.length);
    expect(container.textContent).toContain("Career winnings");
    expect(container.textContent).not.toContain("Win %");
    expect(container.textContent).not.toContain("Streak");
    expect(container.textContent).not.toContain("0–0");
    expect(screen.getByRole("button", { name: "All-time" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "This season" })).toHaveAttribute("aria-pressed", "false");
  });

  it("treats the API's no-season fallback as all-time everywhere", () => {
    const { container } = render(<LeaderboardView {...props} rows={allTimeRows} activeSeason={null} seasonStartedOn={null} />);
    expect(subOf(container)).toHaveTextContent("No season running, all-time standings");
    expect(screen.queryByRole("group", { name: "Leaderboard scope" })).toBeNull();
    expect(container.textContent).not.toContain("Win %");
    expect(container.textContent).not.toContain("0–0");
    expect(container.textContent).not.toContain("0%");
  });

  it("highlights your row and gives every player a real profile link", () => {
    render(<LeaderboardView {...props} />);
    const list = within(seasonList());
    for (const player of referenceRows) {
      expect(list.getByRole("link", { name: player.displayName })).toHaveAttribute("href", `/player/${player.playerId}`);
    }
    const row = list.getByRole("link", { name: "Imran" }).closest("li")!;
    expect(row).toHaveAttribute("data-you", "true");
    expect(within(row).getByText("You")).toBeInTheDocument();
    expect(list.getAllByText("You")).toHaveLength(1);
  });

  it("shows a live dot with Watch for other players and Open duel for you", () => {
    render(<LeaderboardView {...props} liveDuels={{ 1: "kestrel-room", 5: "imran-room" }} />);
    const list = within(seasonList());
    const other = list.getByRole("link", { name: "Kestrel" }).closest("li")!;
    expect(within(other).getByRole("link", { name: "Watch" })).toHaveAttribute("href", "/duels/kestrel-room");
    const mine = list.getByRole("link", { name: "Imran" }).closest("li")!;
    expect(within(mine).getByRole("link", { name: "Open duel" })).toHaveAttribute("href", "/duels/imran-room");
    expect(within(mine).getByRole("img", { name: "Live, your duel" })).toBeInTheDocument();
    expect(list.getAllByRole("link", { name: "Watch" })).toHaveLength(1);
  });

  it("shows no duel controls when nobody is in a duel", () => {
    render(<LeaderboardView {...props} />);
    expect(screen.queryByRole("link", { name: "Watch" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open duel" })).toBeNull();
  });

  it("selects the season button accessibly and requests the other scope", () => {
    const onScopeChange = vi.fn();
    render(<LeaderboardView {...props} onScopeChange={onScopeChange} />);
    expect(screen.getByRole("button", { name: "This season" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All-time" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "All-time" }));
    expect(onScopeChange).toHaveBeenCalledWith("all");
  });

  it("renders the position numbers, actual current streak, and tier progress", () => {
    render(<LeaderboardView {...props} />);
    const card = screen.getByRole("region", { name: "Your season" });
    expect(within(card).getByText("#5")).toBeInTheDocument();
    expect(within(card).getByText("Gap to Toon Tina")).toBeInTheDocument();
    expect(within(card).getByText("22 winnings")).toBeInTheDocument();
    expect(within(card).getByText("15–9, 63%")).toBeInTheDocument();
    expect(card).not.toHaveTextContent("best");
    expect(within(card).getByRole("img", { name: "Gold tier, 84 of 250 points through" })).toBeInTheDocument();
    expect(card).toHaveTextContent("166 Elo to Platinum");
  });

  it("labels tied winnings as a zero gap", () => {
    const rows = referenceRows.map((row) => row.playerId === 5 ? { ...row, winnings: 198 } : row);
    render(<LeaderboardView {...props} rows={rows} />);
    const card = screen.getByRole("region", { name: "Your season" });
    expect(within(card).getByText("Gap to Toon Tina")).toBeInTheDocument();
    expect(within(card).getByText("0 winnings")).toBeInTheDocument();
  });

  it("shows Top tier with a full line for Diamond", () => {
    render(<LeaderboardView {...props} currentPlayerId={2} />);
    expect(screen.getAllByText("Top tier").length).toBeGreaterThan(0);
    const line = screen.getByRole("img", { name: "Diamond tier, Top tier" });
    expect((line as HTMLElement).style.getPropertyValue("--f")).toBe("1");
  });

  it("renders a quiet empty board and guidance for an unlisted player", () => {
    render(<LeaderboardView {...props} rows={[]} />);
    expect(screen.getByText("No one is on the board yet")).toBeInTheDocument();
    expect(screen.getByText("You're not on the board yet.")).toBeInTheDocument();
    expect(screen.getAllByText("Finish a ranked match to appear here.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "Top three" })).toBeNull();
  });

  it("preserves the list while it is busy", () => {
    render(<LeaderboardView {...props} loading />);
    expect(screen.getByRole("region", { name: "Leaderboard standings" })).toHaveAttribute("aria-busy", "true");
    expect(seasonList()).toBeInTheDocument();
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
  it("uses one list for desktop and phone, with a whole-row profile link", () => {
    const { container } = render(<LeaderboardView {...props} />);
    expect(container.querySelectorAll("ol.sv-rows")).toHaveLength(1);
    const row = within(seasonList()).getByRole("link", { name: "Imran" }).closest("li")!;
    expect(row.querySelectorAll("a")).toHaveLength(1);
  });

  it("gives the phone three readouts for your place, winnings and Elo", () => {
    render(<LeaderboardView {...props} />);
    const readouts = screen.getAllByLabelText("Your position");
    expect(readouts.length).toBeGreaterThan(0);
    const text = readouts[0].textContent!;
    expect(text).toContain("#5");
    expect(text).toContain("22 behind Toon Tina");
    expect(text).toContain("1184");
    expect(text).toContain("Gold");
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
    expect(allList()).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Leaderboard standings" })).toHaveAttribute("aria-busy", "false");
  });

  it("keeps the previous standings and announces a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<LeaderboardClient initialRows={referenceRows} currentPlayerId={5} activeSeason={activeSeason} seasonStartedOn={seasonStartedOn} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "All-time" })));
    expect(seasonList()).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't load the standings. Try again.");
  });
});
