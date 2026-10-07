// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  newOpening, openingView, submitOpeningChoice, submitOpeningPick,
  type DuelFirstChoice, type DuelRpsMove,
} from "../../shared/src/duels/opening.js";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { findScenario, scenariosIn } from "@/components/duel/fx-lab/scenarios";
import { labOpeningView } from "@/components/duel/fx-lab/series-view";
import { OpeningScreen } from "@/components/duel/opening";

afterEach(() => { cleanup(); vi.useRealTimers(); });

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
  const choices: DuelFirstChoice[] = ["first", "second"];
  const immediateCases = ([0, 1] as const).flatMap((winnerSeat) =>
    [-60_000, 0, 60_000].flatMap((clockOffset) => choices.map((choice) => ({ winnerSeat, clockOffset, choice }))));

  it.each(immediateCases)("shows the result and order buttons at once (winner $winnerSeat, clock offset $clockOffset, $choice)", ({ winnerSeat, clockOffset, choice }) => {
    const serverNow = 1_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(serverNow + clockOffset);
    let state = newOpening(1, serverNow);
    const draw = () => <>{([0, 1] as const).map((seat) => (
      <section key={seat} data-testid={`seat-${seat}`}>
        <OpeningScreen opening={openingView(state, seat)} mySeat={seat} names={NAMES}
          onPick={(move) => { state = submitOpeningPick(state, seat, move, serverNow); }}
          onChoose={(order) => { state = submitOpeningChoice(state, seat, order, serverNow); }} />
      </section>
    ))}</>;
    const { rerender } = render(draw());
    const seats = [within(screen.getByTestId("seat-0")), within(screen.getByTestId("seat-1"))];
    const moves: [DuelRpsMove, DuelRpsMove] = winnerSeat === 0 ? ["rock", "scissors"] : ["paper", "scissors"];
    fireEvent.click(seats[0].getByTestId(`opening-move-${moves[0]}`));
    rerender(draw());
    expect(seats[1].queryByTestId("opening-reveal")).toBeNull();
    fireEvent.click(seats[1].getByTestId(`opening-move-${moves[1]}`));
    rerender(draw());

    for (const seat of [0, 1] as const) {
      expect(seats[seat].getByTestId("opening-reveal")).toHaveAttribute("data-outcome", seat === winnerSeat ? "win" : "lose");
      expect(seats[seat].getByTestId("opening-reveal")).toHaveTextContent(/Rock|Paper/);
      expect(seats[seat].getByTestId("opening-reveal")).toHaveTextContent("Scissors");
    }
    expect(seats[winnerSeat].getByTestId("opening-first")).toBeEnabled();
    expect(seats[winnerSeat].getByTestId("opening-second")).toBeEnabled();
    expect(seats[1 - winnerSeat].queryByTestId("opening-first")).toBeNull();
    expect(seats[1 - winnerSeat].getByTestId("opening-status")).toHaveTextContent("Opponent is choosing to go first or second…");

    fireEvent.click(seats[winnerSeat].getByTestId(`opening-${choice}`));
    rerender(draw());
    expect(state.phase).toBe("start");
    expect(state.choiceByTimeout).toBe(false);
    for (const seat of seats) expect(seat.getByTestId("opening-screen")).toHaveAttribute("data-stage", "start");
    // No timer or deadline was advanced to make either transition.
    expect(Date.now()).toBe(serverNow + clockOffset);
  });

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
    expect(screen.getByTestId("opening-status").textContent).toBe("You win. Go first or second?");
    expect(screen.getByTestId("opening-reveal")).toHaveAttribute("data-outcome", "win");
    expect(screen.getByTestId("opening-first")).toBeEnabled();
    unmount();
    const lost = open("rps-reveal-lose");
    expect(screen.getByTestId("opening-status").textContent).toBe("Opponent is choosing to go first or second…");
    expect(screen.getByTestId("opening-reveal")).toHaveAttribute("data-outcome", "lose");
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
