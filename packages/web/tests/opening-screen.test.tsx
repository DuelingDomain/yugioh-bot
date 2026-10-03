// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { findScenario, scenariosIn } from "@/components/duel/fx-lab/scenarios";
import { labOpeningView } from "@/components/duel/fx-lab/series-view";
import { OpeningScreen } from "@/components/duel/opening";

afterEach(cleanup);

const NAMES: [string, string] = ["Sulman", "Imran"];

function open(id: string, handlers: { onPick?: (move: string) => void; onChoose?: (choice: string) => void } = {}) {
  const spec = findScenario(id)!.build().opening!;
  const view = labOpeningView(spec);
  return render(<OpeningScreen opening={view} mySeat={0} names={NAMES}
    onPick={(handlers.onPick ?? (() => undefined)) as never} onChoose={(handlers.onChoose ?? (() => undefined)) as never} />);
}

describe("fx lab: rock-paper-scissors scenarios", () => {
  it("lists every opening scenario with an opening spec", () => {
    const ids = scenariosIn("Match").map((scenario) => scenario.id).filter((id) => id.startsWith("rps-"));
    expect(ids).toEqual([
      "rps-choosing", "rps-waiting", "rps-opponent-chose", "rps-reveal-win", "rps-reveal-lose",
      "rps-reveal-tie", "rps-choose-order", "rps-opponent-choosing", "rps-start",
    ]);
    for (const id of ids) expect(findScenario(id)!.build().opening).toBeDefined();
  });
});

describe("OpeningScreen", () => {
  it("offers three moves and sends the one clicked", () => {
    const onPick = vi.fn();
    open("rps-choosing", { onPick });
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    const group = screen.getByRole("group", { name: "Choose your move" });
    expect(group.querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByTestId("opening-opponent").textContent).toBe("Opponent is choosing…");
    fireEvent.click(screen.getByTestId("opening-move-scissors"));
    expect(onPick).toHaveBeenCalledWith("scissors");
  });

  it("locks the moves after a pick and shows the opponent state", () => {
    open("rps-waiting");
    expect((screen.getByTestId("opening-move-rock") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("opening-move-paper").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("opening-status").textContent).toContain("Opponent is choosing…");
  });

  it("says when the opponent chose, without the move", () => {
    open("rps-opponent-chose");
    expect(screen.getByTestId("opening-opponent").textContent).toBe("Opponent chose");
  });

  it("reveals a win, a loss and a tie", () => {
    const { unmount } = open("rps-reveal-win");
    expect(screen.getByTestId("opening-status").textContent).toBe("You win");
    expect(screen.getByTestId("opening-reveal")).toBeTruthy();
    unmount();
    const lost = open("rps-reveal-lose");
    expect(screen.getByTestId("opening-status").textContent).toBe("You lose");
    lost.unmount();
    open("rps-reveal-tie");
    expect(screen.getByTestId("opening-status").textContent).toBe("Tie — again");
  });

  it("lets the winner choose first or second", () => {
    const onChoose = vi.fn();
    open("rps-choose-order", { onChoose });
    fireEvent.click(screen.getByTestId("opening-second"));
    fireEvent.click(screen.getByTestId("opening-first"));
    expect(onChoose.mock.calls).toEqual([["second"], ["first"]]);
    expect(screen.getByTestId("opening-countdown")).toBeTruthy();
  });

  it("tells the loser that the opponent is choosing the order", () => {
    open("rps-opponent-choosing");
    expect(screen.getByTestId("opening-status").textContent).toBe("Opponent is choosing to go first or second…");
    expect(screen.queryByTestId("opening-first")).toBeNull();
  });

  it("shows the settled order", () => {
    open("rps-start");
    expect(screen.getByTestId("opening-status").textContent).toBe("You choose to go first");
  });
});
