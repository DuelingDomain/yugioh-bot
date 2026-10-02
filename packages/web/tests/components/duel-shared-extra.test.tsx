// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seatCountFor, type DuelCard, type DuelEngineView, type DuelFormat, type DuelPrompt, type DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { MultiSeatStage } from "@/components/duel/multi-seat-stage";
import { LOCATION_MZONE, zoneKey } from "@/components/duel/constants";
import { sharedExtraPairs } from "@/components/duel/multi-seat";
import type { DuelActivateHandler, DuelHoverHandler } from "@/components/duel/field";
import { activatePromptFromField, promptLegalKeys } from "@/components/duel/prompts";

afterEach(cleanup);
const NAMES = ["Ada", "Bo", "Cy", "Di"];

function monster(controller: number, sequence: number): DuelCard {
  return { controller, location: LOCATION_MZONE, sequence, position: 1, code: 1000 + controller * 10 + sequence, name: `Seat ${controller} EMZ ${sequence}` };
}

function fixture(format: DuelFormat = "ffa4", extra: Record<number, Partial<DuelSeatView>> = {}): DuelEngineView {
  return {
    revision: 1, format, turn: 1, turnSeat: 0, phase: "main1", prompt: null, chain: [], events: [], log: [], result: null,
    seats: Array.from({ length: seatCountFor(format) }, (_, seat) => ({
      seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
      monsters: Array(7).fill(null), spells: Array(8).fill(null), graveyard: [], banished: [],
      sharedExtraWith: format === "ffa4" ? (seat + 2) % 4 : null, ...extra[seat],
    })),
  };
}

function stage(engine: DuelEngineView, mySeat: number | null = 0, focusSeat: number | null = 1, opts: {
  legal?: Set<string>; selected?: Set<string>; onActivate?: DuelActivateHandler; onHoverCard?: DuelHoverHandler; masterRule?: 3 | 4 | 5;
} = {}) {
  return <MultiSeatStage engine={engine} mySeat={mySeat} focusSeat={focusSeat} masterRule={opts.masterRule ?? 5} reducedMotion
    legalKeys={opts.legal ?? new Set()} selectedKeys={opts.selected ?? new Set()} onActivate={opts.onActivate ?? vi.fn()}
    onHoverCard={opts.onHoverCard} onInspect={vi.fn()} nameOf={(seat) => NAMES[seat]!} promptSeat={null} onFocusSeat={vi.fn()} />;
}

describe("FFA4 shared Extra Monster Zones", () => {
  it.each([2, 3])("draws viewer %s's sequence 5 on the left and keeps physical cell ids", (viewer) => {
    const lower = viewer - 2;
    const ownKey = zoneKey(viewer, LOCATION_MZONE, 5);
    const onActivate = vi.fn();
    render(stage(fixture(), viewer, lower, { legal: new Set([ownKey]), onActivate }));
    const pair = screen.getByTestId(`shared-emz-pair-${lower}-${viewer}`);
    expect(pair.getAttribute("aria-label")).toBe(`${NAMES[viewer]} / ${NAMES[lower]} shared extra monster zones`);
    const cells = within(pair).getAllByTestId(/^shared-emz-\d-\d-\d$/);
    expect(cells.map((cell) => cell.getAttribute("data-testid")))
      .toEqual([`shared-emz-${lower}-${viewer}-2`, `shared-emz-${lower}-${viewer}-1`]);
    expect(cells[0]!.getAttribute("data-zones")).toBe(`${ownKey} ${zoneKey(lower, LOCATION_MZONE, 6)}`);
    expect(cells[1]!.getAttribute("data-zones"))
      .toBe(`${zoneKey(viewer, LOCATION_MZONE, 6)} ${zoneKey(lower, LOCATION_MZONE, 5)}`);
    const button = within(cells[0]!).getByRole("button");
    expect(button.getAttribute("aria-label")).toContain(`${NAMES[viewer]} extra monster zone 1 / ${NAMES[lower]} extra monster zone 2`);
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledWith([ownKey, zoneKey(lower, LOCATION_MZONE, 6)], null, button);
  });

  it.each([5, 6])("keeps both cards visible when mirrored sequence %s is also occupied", (sequence) => {
    const engine = fixture();
    const first = monster(0, sequence);
    const across = monster(2, 11 - sequence);
    engine.seats[0]!.monsters[sequence] = first;
    engine.seats[2]!.monsters[11 - sequence] = across;
    expect(sharedExtraPairs(engine).map((pair) => pair.map((seat) => seat.seat))).toEqual([[1, 3]]);
    render(stage(engine, null, null));
    expect(screen.queryByTestId("shared-emz-pair-0-2")).toBeNull();
    for (const card of [first, across]) {
      expect(document.querySelectorAll(`img[src*="/${card.code}"]`)).toHaveLength(1);
      expect(screen.getByTestId(`seat-emz-${card.controller}-${card.sequence - 4}`).getAttribute("data-occupied")).toBe("true");
    }
  });

  it("finds only reciprocal living across pairs, including seat zero", () => {
    const engine = fixture();
    expect(sharedExtraPairs(engine).map((pair) => pair.map((seat) => seat.seat))).toEqual([[0, 2], [1, 3]]);
    expect(sharedExtraPairs({ ...engine, seats: [...engine.seats].reverse() }).map((pair) => pair.map((seat) => seat.seat))).toEqual([[0, 2], [1, 3]]);
    expect(sharedExtraPairs(fixture("ffa4", { 2: { sharedExtraWith: null } })).map((pair) => pair.map((seat) => seat.seat))).toEqual([[1, 3]]);
    expect(sharedExtraPairs(fixture("ffa4", { 0: { sharedExtraWith: 1 }, 1: { sharedExtraWith: 0 } }))).toEqual([]);
    expect(sharedExtraPairs(fixture("ffa4", { 2: { eliminated: true } })).map((pair) => pair.map((seat) => seat.seat))).toEqual([[1, 3]]);
    expect(sharedExtraPairs({ ...engine, seats: engine.seats.slice(0, 2) })).toEqual([]);
  });

  it.each([0, 1, 2, 3, null])("shows exactly two shared pairs to viewer %s without duplicate cells", (viewer) => {
    const engine = fixture("ffa4", {
      0: { monsters: [...Array(5).fill(null), monster(0, 5), null] },
      2: { monsters: [...Array(5).fill(null), monster(2, 5), null] },
      3: { monsters: [...Array(5).fill(null), monster(3, 5), null] },
    });
    render(stage(engine, viewer, viewer == null ? null : (viewer + 1) % 4));
    expect(screen.getAllByTestId(/^shared-emz-pair-/)).toHaveLength(2);
    expect(document.querySelectorAll('[data-kind="emz"]')).toHaveLength(4);
    expect(screen.queryByTestId("seat-emz-2-1")).toBeNull();
    expect(screen.getByTestId("shared-emz-pair-0-2").textContent)
      .toContain(`${viewer === 2 ? "Cy / Ada" : "Ada / Cy"} shared extra monster zones`);
    for (const card of [engine.seats[0]!.monsters[5]!, engine.seats[2]!.monsters[5]!, engine.seats[3]!.monsters[5]!]) {
      expect(document.querySelectorAll(`img[src*="/${card.code}"]`)).toHaveLength(1);
    }
  });

  it("mirrors 5/6 to 6/5 and sends the actual card key first for selection and hover", () => {
    const card = monster(2, 6);
    const key = zoneKey(2, LOCATION_MZONE, 6);
    const onActivate = vi.fn();
    const onHoverCard = vi.fn();
    render(stage(fixture("ffa4", { 2: { monsters: [...Array(6).fill(null), card] } }), 0, 2,
      { legal: new Set([key]), selected: new Set([key]), onActivate, onHoverCard }));
    const cell = screen.getByTestId("shared-emz-0-2-1");
    expect(cell.getAttribute("data-zones")).toBe(`${key} ${zoneKey(0, LOCATION_MZONE, 5)}`);
    expect(cell.getAttribute("data-legal")).toBe("true");
    expect(cell.getAttribute("data-selected")).toBe("true");
    const button = within(cell).getByRole("button");
    expect(button.getAttribute("aria-label")).toContain("Cy extra monster zone 2");
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledWith([key, zoneKey(0, LOCATION_MZONE, 5)], card, button);
    fireEvent.focus(button);
    expect(onHoverCard).toHaveBeenCalledWith(card, button);
    expect(screen.getByTestId("shared-emz-0-2-2").getAttribute("data-zones"))
      .toBe(`${zoneKey(0, LOCATION_MZONE, 6)} ${zoneKey(2, LOCATION_MZONE, 5)}`);
  });

  it("lets either seat choose an empty shared zone", () => {
    const key = zoneKey(3, LOCATION_MZONE, 6);
    const onActivate = vi.fn();
    render(stage(fixture(), 3, 0, { legal: new Set([key]), onActivate }));
    const cell = screen.getByTestId("shared-emz-1-3-1");
    const button = within(cell).getByRole("button");
    expect(cell.getAttribute("data-legal")).toBe("true");
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledWith([key, zoneKey(1, LOCATION_MZONE, 5)], null, button);
  });

  it.each(["cards", "places"] as const)("submits a %s prompt for the across seat from the shared cell", (kind) => {
    const card = kind === "cards" ? monster(2, 6) : null;
    const engine = fixture("ffa4", { 2: { monsters: [...Array(6).fill(null), card] } });
    const prompt: DuelPrompt = {
      id: "shared-pick", seat: 0, kind, title: "Choose a shared zone", min: 1, max: 1,
      options: [{ id: "across-zone", label: "Cy extra monster zone 2", controller: 2, location: LOCATION_MZONE, sequence: 6 }],
    };
    engine.prompt = prompt;
    const submit = vi.fn();
    render(stage(engine, 0, 1, { legal: promptLegalKeys(prompt), onActivate: (keys, picked) => {
      activatePromptFromField(prompt, true, keys, picked, { setSelected: vi.fn() } as never, submit);
    } }));
    fireEvent.click(within(screen.getByTestId("shared-emz-0-2-1")).getByRole("button"));
    expect(submit).toHaveBeenCalledWith({ selected: ["across-zone"] });
  });

  it.each([0, 2])("blocks an empty shared cell when seat %s alone disables the zone", (seat) => {
    const onActivate = vi.fn();
    const key = zoneKey(2, LOCATION_MZONE, 6);
    render(stage(fixture("ffa4", { [seat]: { disabledZones: 1 << (seat === 0 ? 5 : 6) } }), 0, 1, { legal: new Set([key]), onActivate }));
    const button = within(screen.getByTestId("shared-emz-0-2-1")).getByRole("button");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-label")).toContain(`${NAMES[seat]} zone disabled`);
    fireEvent.click(button);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("blocks an empty pair cell disabled for both seats but still lets an occupied card be inspected", () => {
    const onActivate = vi.fn();
    const engine = fixture("ffa4", { 0: { disabledZones: 1 << 5 }, 2: { disabledZones: 1 << 6 } });
    const { rerender } = render(stage(engine, 0, 1, { onActivate }));
    let button = within(screen.getByTestId("shared-emz-0-2-1")).getByRole("button");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(onActivate).not.toHaveBeenCalled();
    const card = monster(2, 6);
    engine.seats[2]!.monsters[6] = card;
    rerender(stage(engine, 0, 1, { onActivate }));
    button = within(screen.getByTestId("shared-emz-0-2-1")).getByRole("button");
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledWith([zoneKey(2, LOCATION_MZONE, 6), zoneKey(0, LOCATION_MZONE, 5)], card, button);
  });

  it("keeps pairing and cards stable when focus changes", () => {
    const engine = fixture("ffa4", { 2: { monsters: [...Array(6).fill(null), monster(2, 6)] } });
    const { rerender } = render(stage(engine, 0, 1));
    for (const focus of [2, 3, null, 1]) {
      rerender(stage(engine, 0, focus));
      expect(screen.getAllByTestId(/^shared-emz-pair-/)).toHaveLength(2);
      expect(document.querySelectorAll('[data-kind="emz"]')).toHaveLength(4);
      expect(screen.getByTestId("shared-emz-0-2-1").getAttribute("data-occupied")).toBe("true");
    }
  });

  it.each([0, 1, 2, 3])("restores the surviving seat's own EMZ after seat %s is eliminated", (lost) => {
    const survivor = (lost + 2) % 4;
    const extra: Record<number, Partial<DuelSeatView>> = {
      [lost]: { eliminated: true, sharedExtraWith: null },
      [survivor]: { sharedExtraWith: null, monsters: [...Array(5).fill(null), monster(survivor, 5), null] },
    };
    render(stage(fixture("ffa4", extra), null, null));
    expect(screen.getAllByTestId(/^shared-emz-pair-/)).toHaveLength(1);
    expect(screen.getByTestId(`seat-emz-${survivor}-1`).getAttribute("data-occupied")).toBe("true");
    expect(screen.queryByTestId(`seat-emz-${lost}-1`)).toBeNull();
    expect(document.querySelectorAll('[data-kind="emz"]')).toHaveLength(4);
  });

  it("keeps pending losses paired and hides all EMZ below Master Rule 4", () => {
    const engine = fixture("ffa4", { 2: { pendingElimination: true } });
    const { rerender } = render(stage(engine));
    expect(screen.getAllByTestId(/^shared-emz-pair-/)).toHaveLength(2);
    rerender(stage(engine, 0, 1, { masterRule: 3 }));
    expect(screen.queryAllByTestId(/^shared-emz-pair-/)).toHaveLength(0);
    expect(document.querySelectorAll('[data-kind="emz"]')).toHaveLength(0);
  });

  it.each<DuelFormat>(["ffa3", "tag", "1v1"])("does not infer shared pairs in %s", (format) => {
    const engine = fixture(format);
    for (const view of engine.seats) view.sharedExtraWith = (view.seat + 2) % 4;
    expect(sharedExtraPairs(engine)).toEqual([]);
    render(stage(engine, null, null));
    expect(screen.queryAllByTestId(/^shared-emz-pair-/)).toHaveLength(0);
    expect(document.querySelectorAll('[data-kind="emz"]')).toHaveLength(seatCountFor(format) * 2);
  });

  it("keeps older FFA4 views with no pairing field on their separate EMZ layout", () => {
    const engine = fixture();
    for (const view of engine.seats) delete view.sharedExtraWith;
    expect(sharedExtraPairs(engine)).toEqual([]);
    render(stage(engine, null, null));
    expect(screen.queryAllByTestId(/^shared-emz-pair-/)).toHaveLength(0);
    expect(document.querySelectorAll('[data-kind="emz"]')).toHaveLength(8);
  });
});
