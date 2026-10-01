// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";
import type { DuelFormat } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { MultiSeatStage } from "@/components/duel/multi-seat-stage";
import { activatePromptFromField, promptLegalKeys } from "@/components/duel/prompts";
import {
  compactSeats,
  engineFormat,
  focusOpponentSeat,
  isMultiSeat,
  nextSeatAfter,
  seatRelation,
  winnerLabel,
} from "@/components/duel/multi-seat";
import { LOCATION_MZONE } from "@/components/duel/constants";

afterEach(cleanup);

const NAMES = ["Ada", "Bo", "Cy", "Di"];

function monster(seat: number, sequence: number, code: number): DuelCard {
  return { controller: seat, location: LOCATION_MZONE, sequence, position: 1, code, name: `Card ${code}` };
}

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat,
    lp: 8000,
    hand: [],
    deckCount: 30,
    extraCount: 0,
    extra: [],
    monsters: [null, null, null, null, null],
    spells: [null, null, null, null, null, null],
    graveyard: [],
    banished: [],
    ...extra,
  };
}

function makeEngine(format: DuelFormat, count: number, extra: Partial<DuelEngineView> = {}, seatExtra: Record<number, Partial<DuelSeatView>> = {}): DuelEngineView {
  return {
    revision: 1,
    format,
    turn: 1,
    turnSeat: 0,
    phase: "main1",
    seats: Array.from({ length: count }, (_, seat) => seatView(seat, { team: format === "tag" ? seat % 2 : seat, ...seatExtra[seat] })),
    prompt: null,
    chain: [],
    events: [],
    log: [],
    result: null,
    ...extra,
  };
}

function stage(engine: DuelEngineView, mySeat: number | null, opts: { onActivate?: (...args: unknown[]) => void; legal?: Set<string>; focusSeat?: number | null; promptSeat?: number | null } = {}) {
  const legal = opts.legal ?? new Set<string>();
  const focusSeat = opts.focusSeat !== undefined ? opts.focusSeat
    : focusOpponentSeat({ engine, mySeat, legalKeys: legal });
  return render(
    <MultiSeatStage engine={engine} mySeat={mySeat} masterRule={4} reducedMotion
      legalKeys={legal} selectedKeys={new Set()} onActivate={(opts.onActivate ?? vi.fn()) as never}
      onInspect={vi.fn()} nameOf={(seat) => NAMES[seat]} promptSeat={opts.promptSeat ?? null}
      focusSeat={focusSeat} onFocusSeat={vi.fn()} />,
  );
}

describe("multi-seat helpers", () => {
  it("reads the format and seat relations", () => {
    expect(engineFormat(makeEngine("ffa3", 3))).toBe("ffa3");
    expect(engineFormat({ seats: [seatView(0), seatView(1), seatView(2), seatView(3)] })).toBe("ffa4");
    expect(isMultiSeat(makeEngine("1v1", 2))).toBe(false);
    expect(isMultiSeat(makeEngine("tag", 4))).toBe(true);
    expect(seatRelation("tag", 0, 2)).toBe("partner");
    expect(seatRelation("tag", 0, 1)).toBe("opponent");
    expect(seatRelation("ffa4", 0, 2)).toBe("opponent");
    expect(seatRelation("ffa3", null, 1)).toBe("other");
  });

  it("skips eliminated seats for the next seat", () => {
    const engine = makeEngine("ffa4", 4, {}, { 1: { eliminated: true } });
    expect(nextSeatAfter(engine.seats, 0)).toBe(2);
    expect(nextSeatAfter(engine.seats, 3)).toBe(0);
  });

  it("focuses the opponent a prompt targets, else the player on turn, never the Tag partner", () => {
    const ffa = makeEngine("ffa4", 4, { turnSeat: 3 });
    expect(focusOpponentSeat({ engine: ffa, mySeat: 0, legalKeys: new Set() })).toBe(3);
    expect(focusOpponentSeat({ engine: ffa, mySeat: 0, legalKeys: new Set([`2:${LOCATION_MZONE}:0`]) })).toBe(2);
    expect(focusOpponentSeat({ engine: ffa, mySeat: 0, legalKeys: new Set(), pinned: 1 })).toBe(1);
    const tag = makeEngine("tag", 4, { turnSeat: 2 });
    expect(focusOpponentSeat({ engine: tag, mySeat: 0, legalKeys: new Set() })).toBe(1);
    expect(compactSeats(tag, 0, 1).map((view) => view.seat)).toEqual([2, 3]);
  });

  it("names the winning team in Tag", () => {
    const tag = makeEngine("tag", 4, { result: { winnerSeat: 0, winnerTeam: 0, reason: "LP reached 0" } });
    expect(winnerLabel(tag, (seat) => NAMES[seat])).toBe("Ada and Cy");
    const ffa = makeEngine("ffa3", 3, { result: { winnerSeat: 2, reason: "LP reached 0" } });
    expect(winnerLabel(ffa, (seat) => NAMES[seat])).toBe("Cy");
  });
});

describe("MultiSeatStage 3-seat FFA", () => {
  it("shows the other seat as a compact board and marks turn, next and eliminated", () => {
    const engine = makeEngine("ffa3", 3, { turnSeat: 1 }, { 2: { eliminated: true } });
    stage(engine, 0, { promptSeat: 1 });
    const order = screen.getByRole("list", { name: "Turn order" });
    const items = within(order).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[1].getAttribute("data-turn")).toBe("true");
    expect(items[2].getAttribute("data-eliminated")).toBe("true");
    expect(within(items[2]).getByText("Eliminated")).toBeTruthy();
    expect(within(items[0]).getByText("Next")).toBeTruthy();
    expect(within(items[1]).getByText("Choosing")).toBeTruthy();
    const out = screen.getByRole("region", { name: "Cy board" });
    expect(out.getAttribute("data-eliminated")).toBe("true");
    expect(within(out).getByRole("status").textContent).toBe("Eliminated");
    expect(within(out).queryAllByRole("button", { name: /zone/i })).toHaveLength(0);
    expect(document.querySelector('[data-duel-field="true"]')).toBeTruthy();
  });
});

describe("MultiSeatStage 4-seat FFA", () => {
  it("shows two compact boards beside the focused opponent and highlights turn and answering seats", () => {
    const engine = makeEngine("ffa4", 4, { turnSeat: 2 });
    stage(engine, 1, { promptSeat: 2 });
    const boards = screen.getAllByRole("region").filter((node) => node.hasAttribute("data-seat"));
    expect(boards).toHaveLength(2);
    const turn = boards.find((node) => node.getAttribute("data-seat") === "2");
    // Seat 2 has the turn, so it is the focused opponent and is drawn large instead.
    expect(turn).toBeUndefined();
    const active = screen.getByRole("listitem", { current: "step" });
    expect(active.getAttribute("data-seat")).toBe("2");
    expect(active.getAttribute("data-answering")).toBe("true");
  });

  it("highlights the active compact board", () => {
    const engine = makeEngine("ffa4", 4, { turnSeat: 3 });
    stage(engine, 0, { focusSeat: 1, promptSeat: 3 });
    const board = screen.getByRole("region", { name: "Di board" });
    expect(board.getAttribute("data-active")).toBe("true");
    expect(board.getAttribute("data-answering")).toBe("true");
    expect(screen.queryByRole("region", { name: "Bo board" })).toBeNull();
  });
});

describe("MultiSeatStage Tag", () => {
  it("marks the partner board and keeps opponents separate", () => {
    const engine = makeEngine("tag", 4);
    stage(engine, 0);
    const partner = screen.getByRole("region", { name: "Cy board" });
    expect(partner.getAttribute("data-relation")).toBe("partner");
    expect(within(partner).getByText("Partner")).toBeTruthy();
    const foe = screen.getByRole("region", { name: "Di board" });
    expect(foe.getAttribute("data-relation")).toBe("opponent");
    expect(within(foe).getByText("Opponent")).toBeTruthy();
  });
});

describe("MultiSeatStage spectator", () => {
  it("shows every seat as a compact board and no own field", () => {
    const engine = makeEngine("ffa4", 4);
    stage(engine, null);
    expect(screen.getAllByRole("region").filter((node) => node.hasAttribute("data-seat"))).toHaveLength(4);
    expect(document.querySelector('[data-duel-field="true"]')).toBeNull();
    expect(screen.getByTestId("multi-seat-stage").getAttribute("data-spectator")).toBe("true");
  });
});

describe("clicking an opponent board answers the prompt", () => {
  it("submits the option of the card clicked on a compact board", () => {
    const engine = makeEngine("ffa4", 4, {}, { 2: { monsters: [null, monster(2, 1, 111), null, null, null] } });
    const prompt: DuelPrompt = {
      id: "p1",
      seat: 0,
      kind: "cards",
      title: "Choose a target",
      min: 1,
      max: 1,
      options: [{ id: "t1", label: "Card 111", controller: 2, location: LOCATION_MZONE, sequence: 1 }],
    };
    engine.prompt = prompt;
    const submit = vi.fn();
    const setSelected = vi.fn();
    const draft = { setSelected } as never;
    const legal = promptLegalKeys(prompt);
    stage(engine, 0, {
      legal,
      focusSeat: 1,
      promptSeat: 0,
      onActivate: (keys, card) => { activatePromptFromField(prompt, true, keys as string[], card as DuelCard, draft, submit); },
    });
    const board = screen.getByRole("region", { name: "Cy board" });
    const cell = within(board).getByRole("button", { name: "Cy monster zone 2" });
    expect(cell.closest("[data-legal]")?.getAttribute("data-legal")).toBe("true");
    fireEvent.click(cell);
    expect(submit).toHaveBeenCalledWith({ selected: ["t1"] });
  });

  it("answers an empty zone pick on another seat", () => {
    const engine = makeEngine("ffa3", 3);
    const prompt: DuelPrompt = {
      id: "p2", seat: 0, kind: "places", title: "Choose a zone", min: 1, max: 1,
      options: [{ id: "z3", label: "Zone 4", controller: 2, location: LOCATION_MZONE, sequence: 3 }],
    };
    engine.prompt = prompt;
    const submit = vi.fn();
    const legal = promptLegalKeys(prompt);
    stage(engine, 0, {
      legal,
      focusSeat: 1,
      onActivate: (keys, card) => { activatePromptFromField(prompt, true, keys as string[], card as DuelCard | null, { setSelected: vi.fn() } as never, submit); },
    });
    fireEvent.click(within(screen.getByRole("region", { name: "Cy board" })).getByRole("button", { name: "Cy monster zone 4" }));
    expect(submit).toHaveBeenCalledWith({ selected: ["z3"] });
  });
});
