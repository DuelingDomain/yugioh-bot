// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelFormat, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { MultiSeatStage } from "@/components/duel/multi-seat-stage";
import { SeatStrip } from "@/components/duel/seat-strip";
import { PromptCenter } from "@/components/duel/prompt-center";
import { promptLegalKeys, usePromptDraft } from "@/components/duel/prompts";
import { LOCATION_MZONE } from "@/components/duel/constants";
import { isOpponentPick, opponentPickLabel, opponentPickOptions, seatNamer, type SeatPick } from "@/components/duel/multi-seat";

afterEach(cleanup);

const NAMES = ["Ada", "Bo", "Cy", "Di"];

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null], spells: [null, null, null, null, null, null],
    graveyard: [], banished: [], ...extra,
  };
}

function makeEngine(format: DuelFormat, count: number, seatExtra: Record<number, Partial<DuelSeatView>> = {}): DuelEngineView {
  return {
    revision: 1, format, turn: 1, turnSeat: 0, phase: "main1",
    seats: Array.from({ length: count }, (_, seat) => seatView(seat, { team: format === "tag" ? seat % 2 : seat, ...seatExtra[seat] })),
    prompt: null, chain: [], events: [], log: [], result: null,
  };
}

function pickPrompt(seats: number[]): DuelPrompt {
  return {
    id: "p1", seat: 0, kind: "choice", title: "Choose an opponent", min: 1, max: 1, context: { type: "opponent" },
    options: seats.map((seat, index) => ({ id: `opt:${index}`, label: `Player ${seat + 1}`, controller: seat, values: [index] })),
  };
}

function stage(engine: DuelEngineView, mySeat: number | null, opts: { seatPick?: SeatPick | null; focusSeat?: number | null; legal?: Set<string>; onActivate?: (...args: unknown[]) => void } = {}) {
  return render(
    <MultiSeatStage engine={engine} mySeat={mySeat} masterRule={4} reducedMotion
      legalKeys={opts.legal ?? new Set()} selectedKeys={new Set()} onActivate={(opts.onActivate ?? vi.fn()) as never}
      onInspect={vi.fn()} nameOf={(seat) => NAMES[seat]} promptSeat={0}
      focusSeat={opts.focusSeat === undefined ? 1 : opts.focusSeat} onFocusSeat={vi.fn()} seatPick={opts.seatPick} />,
  );
}

describe("opponent pick helpers", () => {
  it("knows the pick by its context, not by its labels", () => {
    expect(isOpponentPick(pickPrompt([1, 2]))).toBe(true);
    expect(isOpponentPick({ ...pickPrompt([1]), context: undefined })).toBe(false);
    expect(isOpponentPick({ ...pickPrompt([1]), kind: "cards" })).toBe(false);
    expect(isOpponentPick(null)).toBe(false);
  });

  it("maps each offered seat to its option id", () => {
    expect([...opponentPickOptions(pickPrompt([1, 3]))]).toEqual([[1, "opt:0"], [3, "opt:1"]]);
  });

  it("leaves out Leaving and eliminated seats and options with no seat while a living seat is offered", () => {
    const engine = makeEngine("ffa4", 4, { 1: { eliminated: true }, 2: { pendingElimination: true } });
    const prompt = pickPrompt([1, 2, 3]);
    prompt.options.push({ id: "opt:9", label: "Nobody" });
    expect([...opponentPickOptions(prompt, engine)]).toEqual([[3, "opt:2"]]);
  });

  it("keeps every offered seat, with the same option ids, when none is living", () => {
    const engine = makeEngine("ffa4", 4, { 1: { pendingElimination: true }, 2: { pendingElimination: true } });
    expect([...opponentPickOptions(pickPrompt([1, 2]), engine)]).toEqual([[1, "opt:0"], [2, "opt:1"]]);
    const mixed = makeEngine("ffa4", 4, { 1: { eliminated: true }, 2: { pendingElimination: true } });
    expect([...opponentPickOptions(pickPrompt([1, 2]), mixed)]).toEqual([[1, "opt:0"], [2, "opt:1"]]);
  });

  it("returns nothing for any other prompt", () => {
    expect(opponentPickOptions({ ...pickPrompt([1]), context: undefined }).size).toBe(0);
    expect(opponentPickOptions(null).size).toBe(0);
  });

  it("names the seat in the aria label", () => {
    expect(opponentPickLabel("Cy")).toBe("Choose Cy as the opponent");
  });
});

describe("MultiSeatStage with an opponent pick", () => {
  const picks = (seats: number[], onPick = vi.fn()): SeatPick => ({
    options: new Map(seats.map((seat, index) => [seat, `opt:${index}`])),
    onPick,
  });

  it("makes the offered compact boards and strip entries clickable", () => {
    const onPick = vi.fn();
    stage(makeEngine("ffa4", 4), 0, { seatPick: picks([1, 2, 3], onPick), focusSeat: 1 });
    expect(screen.getByTestId("multi-seat-stage").getAttribute("data-picking")).toBe("true");
    expect(screen.getByTestId("seat-board-2").getAttribute("data-pickable")).toBe("true");
    expect(screen.getByTestId("seat-board-3").getAttribute("data-pickable")).toBe("true");
    fireEvent.click(within(screen.getByTestId("seat-board-2")).getByRole("button", { name: "Choose Cy as the opponent" }));
    expect(onPick).toHaveBeenLastCalledWith(2);
    // The focused opponent has no compact board: its strip entry answers.
    const entry = within(screen.getByTestId("seat-strip-1")).getByRole("button", { name: "Choose Bo as the opponent" });
    expect(screen.getByTestId("seat-strip-1").getAttribute("data-pickable")).toBe("true");
    fireEvent.click(entry);
    expect(onPick).toHaveBeenLastCalledWith(1);
  });

  it("offers only the seats of the pick: an eliminated or unlisted seat has no button", () => {
    const engine = makeEngine("ffa4", 4, { 2: { eliminated: true } });
    stage(engine, 0, { seatPick: picks([1, 3]), focusSeat: 1 });
    expect(screen.queryByTestId("seat-pick-2")).toBeNull();
    expect(screen.getByTestId("seat-board-2").getAttribute("data-pickable")).toBeNull();
    expect(screen.queryByTestId("seat-strip-pick-2")).toBeNull();
    expect(screen.getByTestId("seat-pick-3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose Ada as the opponent" })).toBeNull();
  });

  it("is reachable by keyboard: the controls are real buttons that take focus", () => {
    stage(makeEngine("ffa3", 3), 0, { seatPick: picks([1, 2]), focusSeat: 1 });
    const button = screen.getByTestId("seat-pick-2");
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("the large focused opponent has its own Choose button, with the same answer as the rail boards", () => {
    const onPick = vi.fn();
    stage(makeEngine("ffa4", 4), 0, { seatPick: picks([1, 2, 3], onPick), focusSeat: 1 });
    const bar = screen.getByTestId("seat-focus-pick-1");
    expect(bar.getAttribute("data-pickable")).toBe("true");
    const button = within(bar).getByRole("button", { name: "Choose Bo as the opponent" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onPick).toHaveBeenLastCalledWith(1);
    // The rail boards keep their own buttons, and there is one control for the focused seat only.
    expect(screen.queryByTestId("seat-focus-pick-2")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Choose Bo as the opponent" })).toHaveLength(2); // bar + strip entry
  });

  it("gives the focused opponent no Choose button when the pick does not offer it or it is out", () => {
    stage(makeEngine("ffa4", 4), 0, { seatPick: picks([2, 3]), focusSeat: 1 });
    expect(screen.queryByTestId("seat-focus-pick-1")).toBeNull();
    cleanup();
    stage(makeEngine("ffa4", 4, { 1: { eliminated: true } }), 0, { seatPick: picks([1, 2]), focusSeat: 1 });
    expect(screen.queryByTestId("seat-focus-pick-1")).toBeNull();
    cleanup();
    stage(makeEngine("ffa4", 4), 0, { focusSeat: 1 });
    expect(screen.queryByTestId("seat-focus-pick-1")).toBeNull();
  });

  it("keeps Leaving focused and compact opponents selectable with their badges", () => {
    const onPick = vi.fn();
    stage(makeEngine("ffa4", 4, { 1: { pendingElimination: true }, 2: { pendingElimination: true } }), 0,
      { seatPick: picks([1, 2], onPick), focusSeat: 1 });
    fireEvent.click(within(screen.getByTestId("seat-focus-pick-1")).getByRole("button"));
    expect(onPick).toHaveBeenLastCalledWith(1);
    const compact = screen.getByTestId("seat-board-2");
    expect(within(compact).getByText("Leaving")).toBeTruthy();
    fireEvent.click(within(compact).getByRole("button", { name: "Choose Cy as the opponent" }));
    expect(onPick).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByTestId("seat-strip-pick-2"));
    expect(onPick).toHaveBeenLastCalledWith(2);
  });

  it("Tag: the focused opposing seat can be picked from its bar", () => {
    const onPick = vi.fn();
    stage(makeEngine("tag", 4), 0, { seatPick: picks([1, 3], onPick), focusSeat: 1 });
    fireEvent.click(within(screen.getByTestId("seat-focus-pick-1")).getByRole("button"));
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it("adds no pick controls without an open pick, so the table is unchanged", () => {
    stage(makeEngine("ffa4", 4), 0, { focusSeat: 1 });
    expect(screen.getByTestId("multi-seat-stage").getAttribute("data-picking")).toBeNull();
    expect(screen.queryAllByTestId(/^seat-pick-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^seat-strip-pick-/)).toHaveLength(0);
    expect(document.querySelectorAll("[data-pickable]")).toHaveLength(0);
    // The strip keeps its focus buttons.
    expect(within(screen.getByTestId("seat-strip-1")).getByRole("button", { name: "Show Bo on the main field" })).toBeTruthy();
  });

  it("Tag: the opposing team can be picked, the partner is not offered", () => {
    const onPick = vi.fn();
    stage(makeEngine("tag", 4), 0, { seatPick: picks([1, 3], onPick), focusSeat: 1 });
    expect(screen.getByTestId("seat-board-3").getAttribute("data-pickable")).toBe("true");
    expect(screen.getByTestId("seat-board-2").getAttribute("data-pickable")).toBeNull();
    fireEvent.click(screen.getByTestId("seat-pick-3"));
    expect(onPick).toHaveBeenCalledWith(3);
  });
});

describe("SeatStrip alone", () => {
  it("does not offer a Leaving seat while a living seat is offered, and offers it when none is living", () => {
    const options = new Map([[1, "opt:0"], [2, "opt:1"]]);
    const { rerender } = render(<SeatStrip engine={makeEngine("ffa4", 4, { 1: { pendingElimination: true } })} mySeat={0}
      nameOf={(seat) => NAMES[seat]} promptSeat={0} pick={{ options, onPick: vi.fn() }} />);
    expect(screen.queryByTestId("seat-strip-pick-1")).toBeNull();
    expect(screen.getByTestId("seat-strip-pick-2")).toBeTruthy();
    rerender(<SeatStrip engine={makeEngine("ffa4", 4, { 1: { pendingElimination: true }, 2: { pendingElimination: true } })} mySeat={0}
      nameOf={(seat) => NAMES[seat]} promptSeat={0} pick={{ options, onPick: vi.fn() }} />);
    expect(screen.getByTestId("seat-strip-pick-1")).toBeTruthy();
    expect(screen.getByTestId("seat-strip-pick-2")).toBeTruthy();
  });

  it("shows the pick as a button with an aria label and keeps the focus buttons for other seats", () => {
    const engine = makeEngine("ffa4", 4);
    const onPick = vi.fn();
    render(<SeatStrip engine={engine} mySeat={0} nameOf={(seat) => NAMES[seat]} promptSeat={0} focusSeat={1} onFocusSeat={vi.fn()}
      pick={{ options: new Map([[2, "opt:0"]]), onPick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose Cy as the opponent" }));
    expect(onPick).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: "Show Bo on the main field" })).toBeTruthy();
  });
});

describe("a place prompt on an opponent field", () => {
  const place = (seat: number): DuelPrompt => ({
    id: "p2", seat: 0, kind: "places", title: "Select a zone", min: 1, max: 1,
    options: [{ id: "place:0", label: "z", controller: seat, location: LOCATION_MZONE, sequence: 2 }],
  });

  it("shows the selectable zone on that opponent's compact board and expands it", () => {
    const onActivate = vi.fn();
    const prompt = place(3);
    stage(makeEngine("ffa4", 4), 0, { legal: promptLegalKeys(prompt), onActivate, focusSeat: 1 });
    const board = screen.getByTestId("seat-board-3");
    expect(board.getAttribute("data-expanded")).toBe("true");
    const cell = within(board).getByRole("button", { name: "Di monster zone 3, selectable" });
    expect(cell.closest("[data-legal]")?.getAttribute("data-legal")).toBe("true");
    expect(screen.getByTestId("seat-board-2").getAttribute("data-expanded")).toBe("false");
    fireEvent.click(cell);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect((onActivate.mock.calls[0]![0] as string[])).toContain(`3:${LOCATION_MZONE}:2`);
  });

  it("shows the selectable zone on the focused opponent's field band", () => {
    const prompt = place(1);
    const { container } = stage(makeEngine("ffa4", 4), 0, { legal: promptLegalKeys(prompt), focusSeat: 1 });
    const legal = [...container.querySelectorAll('[data-legal="true"]')].map((node) => node.getAttribute("data-zones") ?? "");
    expect(legal.some((zones) => zones.split(" ").includes(`1:${LOCATION_MZONE}:2`))).toBe(true);
    // No compact board of another seat is lit by it.
    expect(screen.getByTestId("seat-board-2").querySelector('[data-legal="true"]')).toBeNull();
  });
});

describe("PromptCenter with an opponent pick", () => {
  function Harness({ prompt, onSubmit, withNames = true }: { prompt: DuelPrompt; onSubmit: (answer: unknown) => void; withNames?: boolean }) {
    const draft = usePromptDraft(prompt);
    return (
      <div style={{ position: "relative" }}>
        <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={draft} onSubmit={onSubmit as never}
          menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} nameOf={withNames ? (seat) => NAMES[seat] : undefined} />
      </div>
    );
  }

  it("lists the opponents by display name, never as an attack, and submits the option", () => {
    const onSubmit = vi.fn();
    render(<Harness prompt={pickPrompt([1, 3])} onSubmit={onSubmit} />);
    expect(screen.getByText("Choose an opponent")).toBeTruthy();
    const bo = screen.getByRole("button", { name: "Choose Bo as the opponent" });
    expect(screen.getByRole("button", { name: "Choose Di as the opponent" })).toBeTruthy();
    expect(screen.queryByText(/attack/i)).toBeNull();
    fireEvent.click(bo);
    expect(onSubmit).toHaveBeenCalledWith({ choice: "opt:0" });
  });

  it("falls back to the engine label when no name is known", () => {
    render(<Harness prompt={pickPrompt([2])} onSubmit={vi.fn()} withNames={false} />);
    expect(screen.getByRole("button", { name: "Choose Player 3 as the opponent" })).toBeTruthy();
  });

  it("tells apart three bots that share one display name", () => {
    const onSubmit = vi.fn();
    const nameOf = seatNamer([
      { seat: 0, displayName: "Ada" }, { seat: 1, displayName: "Practice Bot" },
      { seat: 2, displayName: "Practice Bot" }, { seat: 3, displayName: "Practice Bot" },
    ]);
    function Same() {
      const prompt = pickPrompt([1, 2, 3]);
      const draft = usePromptDraft(prompt);
      return (
        <div style={{ position: "relative" }}>
          <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={draft} onSubmit={onSubmit as never}
            menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} nameOf={nameOf} />
        </div>
      );
    }
    render(<Same />);
    for (const seat of [2, 3, 4]) expect(screen.getAllByRole("button", { name: `Choose Practice Bot (seat ${seat}) as the opponent` })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Choose Practice Bot (seat 3) as the opponent" }));
    expect(onSubmit).toHaveBeenCalledWith({ choice: "opt:1" });
  });
});

describe("seatNamer", () => {
  it("keeps unique names and numbers shared ones", () => {
    const name = seatNamer([{ seat: 0, displayName: "Ada" }, { seat: 1, displayName: "Bot" }, { seat: 2, displayName: " bot" }]);
    expect(name(0)).toBe("Ada");
    expect(name(1)).toBe("Bot (seat 2)");
    expect(name(2)).toBe(" bot (seat 3)");
    expect(name(5)).toBe("Player 6");
  });

  it("gives the seat strip and boards distinct pick labels for one shared name", () => {
    const nameOf = seatNamer([0, 1, 2, 3].map((seat) => ({ seat, displayName: seat === 0 ? "Ada" : "Practice Bot" })));
    const engine = makeEngine("ffa4", 4);
    const pick: SeatPick = { options: new Map([[1, "opt:0"], [2, "opt:1"], [3, "opt:2"]]), onPick: vi.fn() };
    render(
      <MultiSeatStage engine={engine} mySeat={0} masterRule={4} reducedMotion
        legalKeys={new Set()} selectedKeys={new Set()} onActivate={vi.fn() as never}
        onInspect={vi.fn()} nameOf={nameOf} promptSeat={0} focusSeat={1} onFocusSeat={vi.fn()} seatPick={pick} />,
    );
    for (const seat of [2, 3, 4]) {
      expect(screen.getAllByRole("button", { name: `Choose Practice Bot (seat ${seat}) as the opponent` }).length).toBeGreaterThan(0);
    }
    expect(screen.queryAllByRole("button", { name: "Choose Practice Bot as the opponent" })).toHaveLength(0);
  });
});
