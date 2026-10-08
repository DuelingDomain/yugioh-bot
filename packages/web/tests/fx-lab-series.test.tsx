// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { findScenario, scenariosIn } from "@/components/duel/fx-lab/scenarios";
import { labOpeningView, labSeriesRoom, OpeningLabScreen, SeriesLabHeader, SeriesLabScreen } from "@/components/duel/fx-lab/series-view";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function open(id: string) {
  const script = findScenario(id)!.build();
  const spec = script.series!;
  return { spec, room: labSeriesRoom(script.initial, spec) };
}

describe("fx lab: tied opening", () => {
  it("enables the next throw after two seconds with thirty seconds to pick", () => {
    const now = 1_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const spec = findScenario("rps-reveal-tie")!.build().opening!;
    expect(Date.parse(labOpeningView(spec, now).deadlineAt)).toBe(now + 2_000 + 30_000);
    render(<OpeningLabScreen spec={spec} />);
    expect(screen.getByTestId("opening-status")).toHaveTextContent("Tie — again");
    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.queryByTestId("opening-move-rock")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("opening-move-rock")).toBeEnabled();
    expect(screen.getByTestId("opening-countdown").querySelector("b")?.textContent).toBe("30");
  });
});

describe("fx lab: Best of 3 scenarios", () => {
  it("lists the Match scenarios, each with a series", () => {
    const ids = scenariosIn("Match").map((scenario) => scenario.id).filter((id) => !id.startsWith("rps-") && !id.startsWith("dice-"));
    expect(ids).toEqual([
      "match-label-game-2",
      "match-label-game-3",
      "match-side-deck",
      "match-side-deck-60",
      "match-side-even",
      "match-side-uneven",
      "match-side-none",
      "match-side-opponent-ready",
      "match-ready",
      "match-ready-opponent",
      "match-choose-first-second",
      "match-choose-second",
      "match-opponent-choosing",
      "match-opponent-chose",
      "match-bot-lost-game",
      "match-bot-won-game",
      "match-bot-side",
      "match-bot-won",
      "match-won",
      "match-lost",
      "match-spectator-siding",
      "match-spectator-next-live",
      "match-spectator-private-siding",
      "match-spectator-private-next-live",
      "match-spectator-chose-second",
      "match-spectator-bot-human-choosing",
      "match-spectator-bot-chose-first",
      "match-spectator-bot-won",
      "match-spectator-won",
    ]);
    for (const id of ids) expect(findScenario(id)!.build().series).toBeDefined();
  });

  it("shows the game label in the header", () => {
    const { room } = open("match-label-game-2");
    render(<SeriesLabHeader room={room} />);
    expect(screen.getByTestId("series-game-label").textContent).toBe("Game 2 of 3·1–0");
  });

  it("opens the between-games screen with the opponent still siding", () => {
    const { room, spec } = open("match-ready");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("Game 1 won by you · 1–0")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Game 2 of 3");
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent is siding…");
    expect(screen.getByRole("button", { name: "Ready" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Seats" })).toBeNull();
  });

  it("shows the opponent ready after a loss, and lets the loser choose first or second", () => {
    const { room, spec } = open("match-ready-opponent");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("Game 1 won by Imran · 0–1")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Who goes first in the next game" })).toBeTruthy();
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent ready");
    expect(screen.getByTestId("first-choice")).toBeTruthy();
  });

  it("shows the loser's choice with Go first selected by default", () => {
    const { room, spec } = open("match-choose-first-second");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByRole("button", { name: "Go first" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Go second" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a loser who chose second, and that the opponent goes first", () => {
    const { room, spec } = open("match-choose-second");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByRole("button", { name: "Go second" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("You will go second.")).toBeTruthy();
  });

  it("tells the winner that the opponent is choosing, and then what they chose", () => {
    const choosing = open("match-opponent-choosing");
    const { unmount } = render(<SeriesLabScreen room={choosing.room} spec={choosing.spec} reduced sound={false} />);
    expect(screen.getByTestId("opponent-first-status").textContent).toBe("Opponent is choosing to go first or second…");
    expect(screen.queryByTestId("first-choice")).toBeNull();
    unmount();
    const chose = open("match-opponent-chose");
    render(<SeriesLabScreen room={chose.room} spec={chose.spec} reduced sound={false} />);
    expect(screen.getByTestId("opponent-first-status").textContent).toBe("Opponent chose to go second");
    expect(screen.getByText("You go first (the opponent chose to go second)")).toBeTruthy();
  });

  it("opens the siding screen with the Main, Extra and Side Deck", () => {
    const { room, spec } = open("match-side-deck");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Game 2 of 3");
    expect(screen.getByTestId("swap-counter").textContent).toContain("0 out · 0 in");
    expect(screen.getByTestId("section-main")).toBeTruthy();
    expect(screen.getByTestId("section-extra")).toBeTruthy();
    expect(screen.getByTestId("section-side")).toBeTruthy();
    expect(room.mySide!.currentDeck.main).toHaveLength(40);
    expect(room.mySide!.currentDeck.extra).toHaveLength(15);
    expect(room.mySide!.currentDeck.side).toHaveLength(15);
  });

  it("offers a maximum-size deck for checking desktop layout", () => {
    const { room } = open("match-side-deck-60");
    expect(room.mySide!.currentDeck.main).toHaveLength(60);
    expect(room.mySide!.currentDeck.extra).toHaveLength(15);
    expect(room.mySide!.currentDeck.side).toHaveLength(15);
  });

  it("shows siding with matching counts: Ready is on", () => {
    const { room, spec } = open("match-side-even");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByTestId("swap-counter").textContent).toContain("2 out · 2 in");
    expect((screen.getByRole("button", { name: "Ready" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows siding with differing counts: Ready is off, with a reason", () => {
    const { room, spec } = open("match-side-uneven");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByTestId("swap-counter").textContent).toContain("2 out · 1 in");
    expect((screen.getByRole("button", { name: "Ready" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("ready-reason").textContent).toMatch(/Bring in 1 card/);
  });

  it("shows a player with no Side Deck waiting to click Ready", () => {
    const { room, spec } = open("match-side-none");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("No Side Deck. You play the same deck again.")).toBeTruthy();
    expect(screen.getByTestId("swap-counter").textContent).toContain("0 out · 0 in");
    expect(room.series!.sideReady[0]).toBe(false);
    expect(screen.getByTestId("my-side-status").textContent).toBe("You are not ready.");
    expect((screen.getByRole("button", { name: "Ready" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["match-side-even", "match-ready"])("does not send side-deck or un-ready writes from the %s preview", async (id) => {
    const fetchMock = vi.fn(async (_url: unknown) => Response.json({ cards: [], missing: [] }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { room, spec } = open(id);
      if (id === "match-ready") room.series!.sideReady[0] = true;
      render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
      await act(async () => { await Promise.resolve(); });
      expect(fetchMock.mock.calls.every(([url]) => !String(url).endsWith("/series/side"))).toBe(true);
      await act(async () => {
        fireEvent.click(screen.getAllByRole("button", { name: id === "match-ready" ? /, Main Deck$/ : /, Main Deck, going out$/ })[0]);
      });
      expect(fetchMock.mock.calls.every(([url]) => !String(url).endsWith("/series/unready"))).toBe(true);
      expect(fetchMock.mock.calls.every(([url]) => !String(url).endsWith("/series/side"))).toBe(true);
      expect(screen.getByTestId("swap-counter").textContent).toContain(id === "match-ready" ? "1 out · 0 in" : "1 out · 2 in");
      if (id === "match-ready") expect(screen.getByTestId("my-side-status").textContent).toMatch(/You are no longer ready/);
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the opponent ready while the player sides", () => {
    const { room, spec } = open("match-side-opponent-ready");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent ready");
  });

  it.each(["match-spectator-siding", "match-spectator-private-siding"])("shows side decking and normal follow behavior in %s", (id) => {
    const { room, spec } = open(id);
    expect(room.mySeat).toBeNull();
    expect(room.session.settings.visibility).toBe(id.includes("private") ? "private" : "public");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("Side decking in progress")).toBeTruthy();
    expect(screen.getAllByTestId("series-ready-row")).toHaveLength(2);
    expect(screen.getByText(/You will move to game 2 when it starts/)).toBeTruthy();
    expect(screen.getAllByText("Imran is choosing to go first or second…")).toHaveLength(1);
    expect(screen.queryByTestId("opponent-first-status")).toBeNull();
    expect(screen.getByTestId("between-games-info").textContent).not.toContain("goes first");
    expect(screen.queryByTestId("between-games")).toBeNull();
    expect(screen.queryByRole("button", { name: /Ready/ })).toBeNull();
  });

  it("names the first player to a spectator after the loser chose second", () => {
    const { room, spec } = open("match-spectator-chose-second");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("Sulman goes first (Imran chose to go second)")).toBeTruthy();
    expect(screen.queryByTestId("opponent-first-status")).toBeNull();
    expect(screen.queryByTestId("first-choice")).toBeNull();
  });

  it("shows a spectator the human's pending choice and the bot's Ready state", () => {
    const { room, spec } = open("match-spectator-bot-human-choosing");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("Game 1 won by Practice Bot · 0–1")).toBeTruthy();
    expect(screen.getAllByText("Sulman is choosing to go first or second…")).toHaveLength(1);
    expect(screen.getAllByTestId("series-ready-row").map((row) => row.textContent)).toEqual(["SulmanSide decking…", "Practice BotReady"]);
    expect(screen.queryByTestId("first-choice")).toBeNull();
    expect(screen.getByText(/You will move to game 2 when it starts/)).toBeTruthy();
  });

  it("shows a spectator that the bot chose first after losing", () => {
    const { room, spec } = open("match-spectator-bot-chose-first");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("Practice Bot goes first (Practice Bot chose to go first)")).toBeTruthy();
    expect(screen.queryByTestId("opponent-first-status")).toBeNull();
    expect(screen.getAllByTestId("series-ready-row")[1].getAttribute("data-ready")).toBe("true");
  });

  it("names the bot as the winner of a decided match for a spectator", () => {
    const { room, spec } = open("match-spectator-bot-won");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("Practice Bot wins the series")).toBeTruthy();
    expect(screen.getByText("Practice match. No result recorded")).toBeTruthy();
    expect(screen.queryByTestId("series-ready-row")).toBeNull();
    expect(screen.queryByRole("button", { name: /Watch game/ })).toBeNull();
  });

  it.each(["match-spectator-next-live", "match-spectator-private-next-live"])("offers the live next game in %s", (id) => {
    const { room, spec } = open(id);
    expect(room.session.settings.visibility).toBe(id.includes("private") ? "private" : "public");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("Game 2 of 3 is live")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Watch game 2" })).toBeTruthy();
  });

  it("ends the match with a result and no next game", () => {
    const { room, spec } = open("match-won");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("You win the series")).toBeTruthy();
    expect(screen.getByText("Final score 2 – 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ready/ })).toBeNull();
    expect(screen.queryByTestId("between-games-info")).toBeNull();
  });

  it("shows the practice bot between games: ready at once, and the loser of the game chooses", () => {
    const lost = open("match-bot-lost-game");
    expect(lost.room.series!.vsBot).toBe(true);
    expect(lost.room.session.seats[1]).toMatchObject({ playerId: null, isBot: true, displayName: "Practice Bot" });
    const { unmount } = render(<SeriesLabScreen room={lost.room} spec={lost.spec} reduced sound={false} />);
    expect(screen.getByText("Game 1 won by Practice Bot · 0–1")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Who goes first in the next game" })).toBeTruthy();
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent ready");
    unmount();
    const won = open("match-bot-won-game");
    render(<SeriesLabScreen room={won.room} spec={won.spec} reduced sound={false} />);
    expect(screen.getByText("Game 1 won by you · 1–0")).toBeTruthy();
    expect(screen.getByText("Practice Bot goes first (the opponent chose to go first)")).toBeTruthy();
  });

  it("opens the siding screen against the bot", () => {
    const { room, spec } = open("match-bot-side");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Game 3 of 3");
    expect(screen.getByText("The practice bot is always ready.")).toBeTruthy();
  });

  it("ends a match against the bot as a practice match", () => {
    const { room, spec } = open("match-bot-won");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("You win the series")).toBeTruthy();
    expect(screen.getByText("Practice match. No result recorded")).toBeTruthy();
  });
});
