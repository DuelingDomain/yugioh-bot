// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { StationTrack, type StationSeatChip } from "@/components/duel/station-track";

afterEach(cleanup);

const base = {
  phase: "main1",
  turn: 2,
  turnSeat: 0,
  mySeat: 0,
  playerName: (seat: number) => `Duelist ${seat}`,
  actionOptions: [],
  canAct: false,
  noLegalMoves: false,
  onChoose: vi.fn(),
  reducedMotion: true,
};
const chips: StationSeatChip[] = [
  { seat: 0, name: "Ren Arata", tone: { main: "#9b7eff", ink: "#c6b6ff" }, you: true, status: "turn" },
  { seat: 1, name: "Ryo Sato", tone: { main: "#5cb8f5", ink: "#a9dcfb" }, you: false, status: "active" },
  { seat: 2, name: "Mika Hana", tone: { main: "#8fd36b", ink: "#c4ecad" }, you: false, status: "eliminated" },
];

describe("StationTrack seat strip", () => {
  it("shows the duelists in order with their tones and standing", () => {
    const { container } = render(<StationTrack {...base} seatStrip={chips} />);
    const items = [...container.querySelectorAll<HTMLElement>("ol[aria-label='Turn order'] > li")];
    expect(items.map((item) => item.getAttribute("data-status"))).toEqual(["turn", "active", "eliminated"]);
    expect(items[1].style.getPropertyValue("--seat-main")).toBe("#5cb8f5");
    expect(items[0].textContent).toContain("You");
    expect(items[1].textContent).toContain("Ryo");
  });

  it("shows the attack lock only while attacks are shut", () => {
    const { rerender } = render(<StationTrack {...base} attackLock={{ firstTurn: 4, turnsLeft: 2 }} />);
    expect(screen.getByTestId("attack-lock").textContent).toContain("turn 4");
    rerender(<StationTrack {...base} attackLock={null} />);
    expect(screen.queryByTestId("attack-lock")).toBeNull();
  });

  it("draws nothing extra for a two seat duel", () => {
    const { container } = render(<StationTrack {...base} />);
    expect(container.querySelector("ol[aria-label='Turn order']")).toBeNull();
    expect(screen.queryByTestId("attack-lock")).toBeNull();
  });
});
