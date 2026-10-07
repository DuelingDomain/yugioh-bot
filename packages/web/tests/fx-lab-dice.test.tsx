// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { findScenario, scenariosIn } from "@/components/duel/fx-lab/scenarios";
import { DICE_OPENING_SPECS } from "@/components/duel/fx-lab/dice-scenarios";
import { DiceLabScreen, labDiceRoom, labDiceView } from "@/components/duel/fx-lab/dice-view";
import { DEFAULT_DICE_SKIN, getDiceSkin, setDiceSkin } from "@/components/duel/dice-skins";
import { brokenAtRandom, replayGroups, tiedGroups } from "@/components/duel/dice-model";
import type { LabDiceOpening } from "@/components/duel/fx-lab/board";

beforeEach(() => { window.localStorage.clear(); act(() => setDiceSkin(DEFAULT_DICE_SKIN)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const IDS = ["dice-3way", "dice-4way-tie", "dice-4way-double-tie", "dice-spectator", "dice-random-break"];
const spec = (id: string): LabDiceOpening => findScenario(id)!.build().diceOpening!;

describe("fx lab: dice opening scenarios", () => {
  it("lists the five scenarios under Match, each with a dice opening", () => {
    const ids = scenariosIn("Match").map((scenario) => scenario.id).filter((id) => id.startsWith("dice-"));
    expect(ids).toEqual(IDS);
    for (const id of IDS) expect(spec(id)).toBe(DICE_OPENING_SPECS[id]);
  });

  it("scripts rolls that agree with the order the server would send", () => {
    for (const id of IDS.filter((id) => id !== "dice-random-break")) {
      const { rounds, order } = spec(id);
      const view = labDiceView(spec(id), rounds.length - 1, 0);
      const groups = replayGroups(view.rounds, rounds[0]!.length);
      expect(groups.every((group) => group.length === 1), id).toBe(true);
      expect(groups.flat(), id).toEqual(order);
      // Only seats still tied roll again: every later round has nulls for the seats that settled.
      for (let i = 1; i < rounds.length; i += 1) {
        const before = labDiceView(spec(id), i - 1, 0);
        const tied = new Set(tiedGroups({ ...before, order: null }).flat());
        rounds[i]!.forEach((roll, seat) => expect(roll == null, `${id} round ${i + 1} seat ${seat}`).toBe(!tied.has(seat)));
      }
    }
  });

  it("covers a double tie, a 3-player tie, a spectator and a random break", () => {
    expect(tiedGroups(labDiceView(spec("dice-4way-double-tie"), 0, 0)).map((g) => g.length)).toEqual([2, 2]);
    expect(tiedGroups(labDiceView(spec("dice-4way-tie"), 0, 0)).map((g) => g.length)).toEqual([3]);
    expect(spec("dice-spectator").mySeat).toBeNull();
    const random = labDiceView(spec("dice-random-break"), 0, 0);
    expect(random.phase).toBe("start");
    expect(brokenAtRandom(random)).toBe(true);
    expect(random.rounds).toHaveLength(10);
  });

  it("gives the start view names and viewer by the new seats", () => {
    const start = labDiceView(spec("dice-3way"), 1, 0);
    expect(start.phase).toBe("start");
    expect(labDiceRoom(spec("dice-3way"), start)).toEqual({ names: ["Dax", "Mira", "Rin"], mySeat: 1 });
    expect(labDiceRoom(spec("dice-3way"), labDiceView(spec("dice-3way"), 0, 0))).toEqual({ names: ["Mira", "Dax", "Rin"], mySeat: 0 });
  });
});

describe("fx lab: dice opening screen", () => {
  it("plays each round for three seconds, then holds the start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    render(<DiceLabScreen spec={spec("dice-4way-tie")} reduced={false} />);
    expect(screen.getByTestId("dice-sub").textContent).toBe("4-way · Round 1");
    expect(screen.getByTestId("dice-row").getAttribute("data-n")).toBe("4");
    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.getByTestId("dice-status").textContent).toContain("You, Mira and Rin tied on 4");
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.getByTestId("dice-sub").textContent).toContain("Round 2");
    expect(tile(0).getAttribute("data-state")).toBe("rolling");
    expect(tile(1).getAttribute("data-state")).toBe("kept");
    act(() => { vi.advanceTimersByTime(2600); });
    expect(screen.getByTestId("dice-status").textContent).toContain("Dax goes first");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId("opening-screen").getAttribute("data-stage")).toBe("start");
    expect(screen.getByTestId("dice-status").textContent).toContain("You face");
    expect(within(tile(3)).getByText("You")).toBeTruthy();
  });

  it("opens the random break on the finished screen", () => {
    render(<DiceLabScreen spec={spec("dice-random-break")} reduced={false} />);
    expect(screen.getByTestId("dice-status").textContent).toContain("Tie broken at random");
  });

  it("switches the die skin from the lab picker", () => {
    render(<DiceLabScreen spec={spec("dice-3way")} reduced />);
    expect(screen.getAllByTestId("dice-die")[0]!.getAttribute("data-skin")).toBe("gold");
    act(() => { screen.getByRole("button", { name: "Crest" }).click(); });
    expect(getDiceSkin()).toBe("crest");
    expect(screen.getAllByTestId("dice-die")[0]!.getAttribute("data-skin")).toBe("crest");
  });
});

const tile = (seat: number) => screen.getByTestId(`dice-tile-${seat}`);
