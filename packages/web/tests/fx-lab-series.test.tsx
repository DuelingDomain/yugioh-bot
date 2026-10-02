// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { findScenario, scenariosIn } from "@/components/duel/fx-lab/scenarios";
import { labSeriesRoom, SeriesLabHeader, SeriesLabScreen } from "@/components/duel/fx-lab/series-view";

afterEach(cleanup);

function open(id: string) {
  const script = findScenario(id)!.build();
  const spec = script.series!;
  return { spec, room: labSeriesRoom(script.initial, spec) };
}

describe("fx lab: Best of 3 scenarios", () => {
  it("lists the Match scenarios, each with a series", () => {
    const ids = scenariosIn("Match").map((scenario) => scenario.id).filter((id) => !id.startsWith("rps-"));
    expect(ids).toEqual([
      "match-label-game-2",
      "match-label-game-3",
      "match-side-deck",
      "match-ready",
      "match-ready-opponent",
      "match-choose-first-second",
      "match-choose-second",
      "match-opponent-choosing",
      "match-opponent-chose",
      "match-won",
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
    expect(screen.getByText("Game 2 of 3")).toBeTruthy();
    expect(screen.getByTestId("opponent-side-status").textContent).toBe("Opponent is siding…");
    expect(screen.getByRole("button", { name: "Ready for next game" })).toBeTruthy();
  });

  it("shows the opponent ready after a loss, and lets the loser choose first or second", () => {
    const { room, spec } = open("match-ready-opponent");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("Game 1 won by Imran · 0–1")).toBeTruthy();
    expect(screen.getByText("You choose to go first or second")).toBeTruthy();
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
    expect(screen.getByText("Imran goes first (you chose to go second)")).toBeTruthy();
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

  it("opens the side deck screen", async () => {
    const { room, spec } = open("match-side-deck");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByRole("dialog", { name: "Side deck" })).toBeTruthy();
    expect(screen.getByText("Game 2 of 3")).toBeTruthy();
    expect(screen.getByText("Side 3")).toBeTruthy();
  });

  it("ends the match with a result and no next game", () => {
    const { room, spec } = open("match-won");
    render(<SeriesLabScreen room={room} spec={spec} reduced sound={false} />);
    expect(screen.getByText("You win the series")).toBeTruthy();
    expect(screen.getByText("Final score 2 – 1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ready/ })).toBeNull();
    expect(screen.queryByTestId("between-games-info")).toBeNull();
  });
});
