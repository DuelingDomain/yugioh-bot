// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
import { getDuelRoom } from "@/components/duel/api";
import { makeSeriesRoom } from "./helpers/duel-series";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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
      "rps-choosing", "rps-waiting", "rps-opponent-chose",
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
        <OpeningScreen opening={openingView(state, seat, serverNow)} mySeat={seat} names={NAMES}
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
    expect(seats[winnerSeat].getByTestId("opening-status")).toHaveTextContent("You win. Go first or second?");
    expect(seats[1 - winnerSeat].getByTestId("opening-status")).toHaveTextContent("You lose. Opponent is choosing…");

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

  it.each([0, 1] as const)("shows the next pick after a tie with the browser 60 seconds slow (seat %s)", (seat) => {
    const serverNow = 1_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(serverNow - 60_000);
    let state = newOpening(1, serverNow);
    state = submitOpeningPick(state, 0, "rock", serverNow);
    state = submitOpeningPick(state, 1, "rock", serverNow);
    const onPick = vi.fn();
    const opening = openingView(state, seat, serverNow);
    render(<OpeningScreen opening={opening} mySeat={seat} names={NAMES} onPick={onPick} onChoose={() => undefined} />);

    expect(screen.getByTestId("opening-screen")).toHaveAttribute("data-stage", "reveal");
    act(() => vi.advanceTimersByTime(2_999));
    expect(screen.queryByTestId("opening-move-paper")).toBeNull();
    act(() => vi.advanceTimersByTime(101));
    expect(screen.getByTestId("opening-screen")).toHaveAttribute("data-stage", "pick");
    expect(screen.getByTestId("opening-move-paper")).toBeEnabled();
    fireEvent.click(screen.getByTestId("opening-move-paper"));
    expect(onPick).toHaveBeenCalledWith("paper");
  });

  it.each([1_000, 4_000])("does not extend a tie reveal when the cached room is %s ms old", async (age) => {
    const serverNow = 1_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(serverNow - 60_000);
    const opening = labOpeningView({ stage: "reveal-tie" }, serverNow);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ...makeSeriesRoom({ series: null, status: "lobby" }), opening,
    })));
    const room = await getDuelRoom("table");
    act(() => vi.advanceTimersByTime(age));
    const draw = () => <OpeningScreen opening={room.opening!} receivedAt={room.receivedAt}
      mySeat={0} names={NAMES} onPick={() => undefined} onChoose={() => undefined} />;
    const { unmount } = render(draw());

    if (age < 3_000) {
      expect(screen.getByTestId("opening-screen")).toHaveAttribute("data-stage", "reveal");
      act(() => vi.advanceTimersByTime(3_100 - age));
    }
    expect(screen.getByTestId("opening-screen")).toHaveAttribute("data-stage", "pick");
    expect(screen.getByTestId("opening-move-paper")).toBeEnabled();
    const seconds = screen.getByTestId("opening-countdown").querySelector("b")?.textContent;
    unmount();
    render(draw());
    expect(screen.getByTestId("opening-screen")).toHaveAttribute("data-stage", "pick");
    expect(screen.getByTestId("opening-countdown").querySelector("b")?.textContent).toBe(seconds);
  });

  const countdownCases = ["pick", "choose", "wait-choose"] as const;
  it.each([...countdownCases, "reveal-tie"] as const)("uses browser time for an older host without serverNow in %s", (stage) => {
    const now = 1_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const opening = labOpeningView({ stage }, now);
    delete (opening as Partial<typeof opening>).serverNow;
    const draw = () => <OpeningScreen opening={opening} mySeat={0} names={NAMES} onPick={() => undefined} onChoose={() => undefined} />;
    const { rerender } = render(draw());
    const seconds = () => screen.getByTestId("opening-countdown").querySelector("b")?.textContent;

    if (stage === "reveal-tie") {
      expect(screen.getByTestId("opening-screen")).toHaveAttribute("data-stage", "reveal");
    } else {
      expect(seconds()).toBe("30");
    }
    act(() => vi.advanceTimersByTime(5_000));
    const remaining = stage === "reveal-tie" ? "28" : "25";
    expect(seconds()).toBe(remaining);
    vi.setSystemTime(Date.now() + 120_000);
    rerender(draw());
    expect(seconds()).toBe(remaining);
  });

  it.each(countdownCases.flatMap((stage) => [-60_000, 60_000].map((clockOffset) => ({ stage, clockOffset }))))(
    "counts down from server time in $stage with clock offset $clockOffset",
    ({ stage, clockOffset }) => {
      const serverNow = 1_000_000;
      vi.useFakeTimers();
      vi.setSystemTime(serverNow + clockOffset);
      const opening = labOpeningView({ stage }, serverNow);
      const draw = () => <OpeningScreen opening={opening} mySeat={0} names={NAMES} onPick={() => undefined} onChoose={() => undefined} />;
      const { rerender } = render(draw());
      const seconds = () => screen.getByTestId("opening-countdown").querySelector("b")?.textContent;

      expect(seconds()).toBe("30");
      act(() => vi.advanceTimersByTime(5_000));
      expect(seconds()).toBe("25");
      vi.setSystemTime(Date.now() + 120_000);
      rerender(draw());
      expect(seconds()).toBe("25");
      act(() => vi.advanceTimersByTime(25_000));
      expect(seconds()).toBe("0");
      act(() => vi.advanceTimersByTime(5_000));
      expect(seconds()).toBe("0");
    },
  );

  it("updates the countdown from a new server snapshot without reusing elapsed time", () => {
    const serverNow = 1_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(serverNow - 60_000);
    let opening = labOpeningView({ stage: "pick" }, serverNow);
    const draw = () => <OpeningScreen opening={opening} mySeat={0} names={NAMES} onPick={() => undefined} onChoose={() => undefined} />;
    const { rerender } = render(draw());
    const seconds = () => screen.getByTestId("opening-countdown").querySelector("b")?.textContent;
    act(() => vi.advanceTimersByTime(5_000));
    expect(seconds()).toBe("25");
    opening = { ...opening, serverNow: serverNow + 10_000 };
    rerender(draw());
    expect(seconds()).toBe("20");
    act(() => vi.advanceTimersByTime(1_000));
    expect(seconds()).toBe("19");
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

  it("shows win and loss during order choice, and reveals a tie", () => {
    const { unmount } = open("rps-choose-order");
    expect(screen.getByTestId("opening-status").textContent).toBe("You win. Go first or second?");
    expect(screen.getByTestId("opening-reveal")).toHaveAttribute("data-outcome", "win");
    expect(screen.getByTestId("opening-first")).toBeEnabled();
    unmount();
    const lost = open("rps-opponent-choosing");
    expect(screen.getByTestId("opening-status").textContent).toBe("You lose. Opponent is choosing…");
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
    expect(screen.getByTestId("opening-status").textContent).toBe("You lose. Opponent is choosing…");
    expect(screen.queryByTestId("opening-first")).toBeNull();
  });

  it.each([0, 1] as const)("tells spectators which player won and is choosing (winner %s)", (winnerSeat) => {
    const opening = labOpeningView({ stage: winnerSeat === 0 ? "choose" : "wait-choose" });
    render(<OpeningScreen opening={opening} mySeat={null} names={NAMES} onPick={() => undefined} onChoose={() => undefined} />);
    const winner = NAMES[winnerSeat];
    expect(screen.getByTestId("opening-status")).toHaveTextContent(`${winner} wins. ${winner} is choosing…`);
    expect(screen.queryByTestId("opening-first")).toBeNull();
    expect(screen.queryByTestId("opening-second")).toBeNull();
    expect(screen.getByTestId("opening-reveal")).toHaveAttribute("data-outcome", "decided");
  });

  it("shows the settled order", () => {
    open("rps-start");
    expect(screen.getByTestId("opening-status").textContent).toBe("You choose to go first");
  });
});

describe("FFA dice placeholder", () => {
  it("shows all rolls and final seats to players and spectators without RPS controls", () => {
    const opening = {
      phase: "dice" as const, round: 2, serverNow: 1000, deadlineAt: new Date(4000).toISOString(),
      rounds: [{ round: 1, rolls: [6, 6, 2, 2] }, { round: 2, rolls: [1, 2, 6, 5] }],
      order: [1, 0, 2, 3], finalSeats: [1, 0, 2, 3],
    };
    const pick = vi.fn(), choose = vi.fn();
    const props = { opening, names: ["Yugi", "Kaiba", "Joey", "Mai"], onPick: pick, onChoose: choose };
    const { rerender } = render(<OpeningScreen {...props} mySeat={2} />);
    expect(screen.getByText(/Round 2/)).toBeTruthy();
    expect(screen.getByText(/Joey: 6/)).toBeTruthy();
    expect(screen.getByText(/Kaiba.*Yugi.*Joey.*Mai/)).toBeTruthy();
    expect(screen.getByText(/Yugi.*seat 2/)).toBeTruthy();
    expect(screen.queryByTestId("opening-move-rock")).toBeNull();
    expect(screen.queryByTestId("opening-first")).toBeNull();
    rerender(<OpeningScreen {...props} mySeat={null} />);
    expect(screen.getByText(/Joey: 6/)).toBeTruthy();
    expect(pick).not.toHaveBeenCalled(); expect(choose).not.toHaveBeenCalled();
  });

  it("shows a non-rolling seat in a tie round and waits for the server order", () => {
    render(<OpeningScreen mySeat={null} names={["Yugi", "Kaiba", "Joey"]} onPick={() => {}} onChoose={() => {}}
      opening={{ phase: "dice", round: 2, serverNow: 1000, deadlineAt: new Date(4000).toISOString(),
        rounds: [{ round: 1, rolls: [6, 2, 2] }, { round: 2, rolls: [null, 3, 3] }], order: null, finalSeats: null }} />);
    expect(screen.getByText(/Yugi: No re-roll/)).toBeTruthy();
    expect(screen.getByText(/Tied players roll again/)).toBeTruthy();
  });
});
