// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelFormat, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { MultiSeatStage } from "@/components/duel/multi-seat-stage";
import { LOCATION_DECK, LOCATION_MZONE, LOCATION_PZONE, LOCATION_SZONE } from "@/components/duel/constants";
import {
  compactSeats,
  disabledZoneNames,
  disabledZones,
  placementOrder,
  railGroups,
  withoutSeatExtraKeys,
} from "@/components/duel/multi-seat";

afterEach(cleanup);

const NAMES = ["Ada", "Bo", "Cy", "Di"];

function monster(seat: number, sequence: number, code: number): DuelCard {
  return { controller: seat, location: LOCATION_MZONE, sequence, position: 1, code, name: `Card ${code}` };
}

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null], spells: [null, null, null, null, null, null],
    graveyard: [], banished: [], ...extra,
  };
}

function fixture(format: DuelFormat, count: number, seatExtra: Record<number, Partial<DuelSeatView>> = {}, extra: Partial<DuelEngineView> = {}): DuelEngineView {
  return {
    revision: 1, format, turn: 1, turnSeat: 0, phase: "main1",
    seats: Array.from({ length: count }, (_, seat) => seatView(seat, { team: format === "tag" ? seat % 2 : seat, ...seatExtra[seat] })),
    prompt: null, chain: [], events: [], log: [], result: null, ...extra,
  };
}

function show(engine: DuelEngineView, mySeat: number | null, focusSeat: number | null, masterRule: 3 | 4 | 5 = 4) {
  return render(
    <MultiSeatStage engine={engine} mySeat={mySeat} masterRule={masterRule as never} reducedMotion
      legalKeys={new Set()} selectedKeys={new Set()} onActivate={vi.fn() as never} onInspect={vi.fn()}
      nameOf={(seat) => NAMES[seat]} promptSeat={null} focusSeat={focusSeat} onFocusSeat={vi.fn()} />,
  );
}

function boardSeats(): number[] {
  return screen.queryAllByTestId(/^seat-board-\d$/).map((node) => Number(node.getAttribute("data-seat")));
}

const master = { card: { code: 46986414, name: "Dark Magician" } as never, inZone: true, returns: 0, nextCost: 0 };

describe("placement order", () => {
  it("places FFA seats clockwise from the seat after the viewer", () => {
    const four = fixture("ffa4", 4);
    expect(placementOrder(four, 0)).toEqual([1, 2, 3]);
    expect(placementOrder(four, 2)).toEqual([3, 0, 1]);
    expect(placementOrder(fixture("ffa3", 3), 1)).toEqual([2, 0]);
    expect(compactSeats(four, 2, 0).map((view) => view.seat)).toEqual([3, 1]);
  });

  it("groups the Tag partner with the viewer and the opposing team together", () => {
    const tag = fixture("tag", 4);
    expect(placementOrder(tag, 1)).toEqual([3, 2, 0]);
    const groups = railGroups(tag, 0, null);
    expect(groups.map((group) => [group.id, group.seats.map((view) => view.seat)])).toEqual([["opponents", [1, 3]], ["partner", [2]]]);
  });

  it("anchors a spectator on seat 0 and keeps Tag teams together", () => {
    expect(placementOrder(fixture("ffa4", 4), null)).toEqual([0, 1, 2, 3]);
    expect(placementOrder(fixture("tag", 4), null)).toEqual([0, 2, 1, 3]);
    expect(railGroups(fixture("tag", 4), null, null).map((group) => group.seats.map((view) => view.seat))).toEqual([[0, 2], [1, 3]]);
  });
});

describe("board fixtures", () => {
  it("3 FFA: shows the two other seats in turn order", () => {
    show(fixture("ffa3", 3), 1, null);
    expect(screen.getByTestId("multi-seat-stage").getAttribute("data-format")).toBe("ffa3");
    expect(boardSeats()).toEqual([2, 0]);
    expect(screen.getByTestId("seat-rail-seats")).toBeTruthy();
    expect(screen.getByTestId("seat-strip-2").getAttribute("data-relation")).toBe("opponent");
  });

  it("4 FFA: the focused opponent leaves the rail, the rest keep clockwise order", () => {
    show(fixture("ffa4", 4), 1, 3);
    expect(boardSeats()).toEqual([2, 0]);
    expect(screen.getByTestId("seat-strip-3").getAttribute("data-focus")).toBe("true");
    expect(screen.getByTestId("seat-field")).toBeTruthy();
  });

  it("Tag: opponents and partner sit in their own rails with labels and data-relation", () => {
    show(fixture("tag", 4), 0, 1);
    expect(screen.getByTestId("seat-rail-opponents")).toBeTruthy();
    const partner = within(screen.getByTestId("seat-rail-partner")).getByTestId("seat-board-2");
    expect(partner.getAttribute("data-relation")).toBe("partner");
    expect(within(partner).getByText("Partner")).toBeTruthy();
    expect(within(screen.getByTestId("seat-rail-opponents")).getByTestId("seat-board-3").getAttribute("data-relation")).toBe("opponent");
  });

  it("Tag: both partners show the same team LP with a team label", () => {
    const tag = fixture("tag", 4, { 0: { lp: 12000 }, 2: { lp: 12000 }, 1: { lp: 16000 }, 3: { lp: 16000 } });
    show(tag, 0, 1);
    const partner = screen.getByTestId("seat-lp-2");
    expect(partner.textContent).toContain("Team LP");
    expect(partner.getAttribute("aria-label")).toBe("Cy team life points");
    expect(screen.getByTestId("seat-lp-3").textContent).toContain("Team LP");
  });

  it("spectator: all four seats, no own field, seat 0 first", () => {
    show(fixture("ffa4", 4), null, null);
    expect(boardSeats()).toEqual([0, 1, 2, 3]);
    expect(screen.queryByTestId("seat-field")).toBeNull();
    expect(screen.getByTestId("multi-seat-stage").getAttribute("data-spectator")).toBe("true");
  });

  it("eliminated seat: dimmed board, label, final LP, no zones, no turn or answer mark", () => {
    const engine = fixture("ffa4", 4, { 2: { eliminated: true, lp: 0 } }, { turnSeat: 2 });
    show(engine, 0, 1);
    const board = screen.getByTestId("seat-board-2");
    expect(board.getAttribute("data-eliminated")).toBe("true");
    expect(board.getAttribute("data-active")).toBe("false");
    expect(within(board).getByTestId("seat-eliminated-2").textContent).toBe("Eliminated");
    expect(within(board).getByTestId("seat-out-2").textContent).toBe("Eliminated");
    expect(within(board).getByTestId("seat-lp-2").textContent).toContain("Final LP");
    expect(within(board).queryByTestId("seat-mz-2-1")).toBeNull();
    expect(within(board).queryByText("To play")).toBeNull();
    expect(screen.getByTestId("seat-strip-2").getAttribute("data-turn")).toBe("false");
  });

  it("pending elimination: Leaving tag on the board and the strip, board stays live", () => {
    const engine = fixture("ffa3", 3, { 1: { pendingElimination: true } });
    show(engine, 0, 2);
    const board = screen.getByTestId("seat-board-1");
    expect(within(board).getByTestId("seat-leaving-1").textContent).toBe("Leaving");
    expect(board.getAttribute("data-leaving")).toBe("true");
    expect(board.getAttribute("data-eliminated")).toBe("false");
    expect(within(board).queryByTestId("seat-out-1")).toBeNull();
    expect(within(screen.getByTestId("seat-strip-1")).getByTestId("seat-strip-leaving-1").textContent).toBe("Leaving");
    expect(screen.queryByTestId("seat-leaving-2")).toBeNull();
    expect(screen.getByTestId("seat-strip-2").getAttribute("data-leaving")).toBe("false");
  });

  it("the viewer eliminated: notice and the duel stays visible", () => {
    show(fixture("ffa3", 3, { 0: { eliminated: true, lp: 0 } }), 0, 1);
    expect(screen.getByTestId("self-eliminated").textContent).toContain("eliminated");
    expect(screen.getByTestId("multi-seat-stage").getAttribute("data-self-eliminated")).toBe("true");
  });
});

describe("Extra Monster Zones and Deck Masters", () => {
  const engine = fixture("ffa4", 4, {
    1: { monsters: [null, null, null, null, null, monster(1, 5, 501), null] },
    2: { monsters: [null, null, null, null, null, null, monster(2, 6, 602)], deckMaster: master },
    3: { monsters: [null, null, null, null, null, monster(3, 5, 701), monster(3, 6, 702)] },
  });

  it("every compact board has its own two EMZ with its own cards", () => {
    show(engine, 0, 3);
    expect(within(screen.getByTestId("seat-emz-1-1")).getByRole("button").getAttribute("aria-label")).toBe("Bo extra monster zone 1");
    expect(screen.getByTestId("seat-emz-1-1").getAttribute("data-occupied")).toBe("true");
    expect(screen.getByTestId("seat-emz-1-2").getAttribute("data-occupied")).toBe("false");
    expect(screen.getByTestId("seat-emz-2-1").getAttribute("data-occupied")).toBe("false");
    expect(screen.getByTestId("seat-emz-2-2").getAttribute("data-occupied")).toBe("true");
    expect(screen.getByTestId("seat-emz-1-1").getAttribute("data-zones")).toContain(`1:${LOCATION_MZONE}:5`);
  });

  it("the focused opponent shows both its EMZ cards in its own row, not in the mirrored band", () => {
    show(engine, 0, 3);
    const extras = screen.getByTestId("seat-extras-3");
    expect(within(extras).getByTestId("seat-emz-3-1").getAttribute("data-occupied")).toBe("true");
    expect(within(extras).getByTestId("seat-emz-3-2").getAttribute("data-occupied")).toBe("true");
    const field = screen.getByTestId("seat-field");
    expect(field.innerHTML).not.toContain("/701");
    expect(field.innerHTML).not.toContain("/702");
    expect(extras.innerHTML).toContain("/701");
  });

  it("a seat with no EMZ row is not invented below master rule 4", () => {
    show(engine, 0, 3, 3);
    expect(screen.queryByTestId("seat-emz-1-1")).toBeNull();
  });

  it("Domain: a compact board shows its Deck Master", () => {
    show(engine, 0, 3);
    const cell = screen.getByTestId("seat-deckmaster-2");
    expect(cell.getAttribute("data-occupied")).toBe("true");
    expect(within(cell).getByRole("button").getAttribute("aria-label")).toContain("Dark Magician");
    expect(screen.queryByTestId("seat-deckmaster-1")).toBeNull();
  });

  it("filters the focused seat's EMZ keys out of the keys given to the shared field", () => {
    const keys = new Set([`3:${LOCATION_MZONE}:5`, `3:${LOCATION_MZONE}:2`, `0:${LOCATION_MZONE}:5`]);
    expect([...withoutSeatExtraKeys(keys, 3)].sort()).toEqual([`0:${LOCATION_MZONE}:5`, `3:${LOCATION_MZONE}:2`].sort());
  });
});

describe("disabled zones per seat", () => {
  // Monster zone 2 (bit 1), EMZ 2 (bit 6), spell and trap zone 3 (bit 10), field zone (bit 13).
  const mask = (1 << 1) | (1 << 6) | (1 << 10) | (1 << 13);

  it("decodes the mask", () => {
    const zones = disabledZones({ disabledZones: mask });
    expect(zones.monsters[1] && zones.monsters[6] && zones.spells[2] && zones.field).toBe(true);
    expect(disabledZones({}).any).toBe(false);
    expect(disabledZoneNames({ disabledZones: mask })).toEqual(["Monster zone 2", "Extra monster zone 2", "Spell and trap zone 3", "Field zone"]);
  });

  it("Master Rule 3: a disabled Pendulum Zone (bit 14) is marked and named", () => {
    const pz = 1 << 14;
    const zones = disabledZones({ disabledZones: pz });
    expect(zones.pendulum).toEqual([true, false]);
    expect(zones.any).toBe(true);
    expect(disabledZoneNames({ disabledZones: pz })).toEqual(["Left pendulum zone"]);
    expect(disabledZoneNames({ disabledZones: 1 << 15 })).toEqual(["Right pendulum zone"]);
    show(fixture("ffa4", 4, { 3: { disabledZones: pz } }), 0, 1, 3);
    const left = screen.getByTestId("seat-pz-3-1");
    expect(left.getAttribute("data-disabled")).toBe("true");
    expect(screen.getByTestId("seat-pz-3-2").getAttribute("data-disabled")).toBe("false");
    expect(within(left).getByRole("button").getAttribute("aria-label")).toContain("disabled");
  });

  it("marks the disabled zones of a compact board and leaves other seats alone", () => {
    show(fixture("ffa3", 3, { 2: { disabledZones: mask } }), 1, 0);
    expect(screen.getByTestId("seat-mz-2-2").getAttribute("data-disabled")).toBe("true");
    expect(screen.getByTestId("seat-mz-2-1").getAttribute("data-disabled")).toBe("false");
    expect(screen.getByTestId("seat-emz-2-2").getAttribute("data-disabled")).toBe("true");
    expect(screen.getByTestId("seat-st-2-3").getAttribute("data-disabled")).toBe("true");
    expect(screen.getByTestId("seat-fz-2").getAttribute("data-disabled")).toBe("true");
    expect(screen.getByTestId("seat-disabled-2").getAttribute("data-count")).toBe("4");
    expect(within(screen.getByTestId("seat-mz-2-2")).getByRole("button").getAttribute("aria-label")).toBe("Cy monster zone 2, disabled");
  });

  it("lists the disabled zones of the focused opponent and of the viewer", () => {
    show(fixture("ffa3", 3, { 0: { disabledZones: 1 << 2 }, 1: { disabledZones: 1 << 8 } }), 0, 1);
    expect(screen.getByTestId("seat-disabled-1").textContent).toContain("Spell and trap zone 1");
    expect(screen.getByTestId("seat-disabled-0").textContent).toContain("Monster zone 3");
  });
});

describe("compact board accessibility and Pendulum zones", () => {
  function showLegal(engine: DuelEngineView, legal: string[], selected: string[] = [], masterRule: 3 | 4 | 5 = 4) {
    return render(
      <MultiSeatStage engine={engine} mySeat={0} masterRule={masterRule as never} reducedMotion
        legalKeys={new Set(legal)} selectedKeys={new Set(selected)} onActivate={vi.fn() as never} onInspect={vi.fn()}
        nameOf={(seat) => NAMES[seat]} promptSeat={0} focusSeat={1} onFocusSeat={vi.fn()} />,
    );
  }

  it("says in words which cells can be chosen and which are chosen", () => {
    const engine = fixture("ffa4", 4);
    showLegal(engine, [`3:${LOCATION_MZONE}:1`, `3:${LOCATION_MZONE}:2`], [`3:${LOCATION_MZONE}:2`]);
    const label = (id: string) => within(screen.getByTestId(id)).getByRole("button").getAttribute("aria-label");
    expect(label("seat-mz-3-2")).toBe("Di monster zone 2, selectable");
    expect(label("seat-mz-3-3")).toBe("Di monster zone 3, selectable, selected");
    // A cell that is not a target keeps its plain name.
    expect(label("seat-mz-3-4")).toBe("Di monster zone 4");
    expect(label("seat-mz-2-2")).toBe("Cy monster zone 2");
  });

  it("without a prompt no label gets a state", () => {
    show(fixture("ffa4", 4), 0, 1);
    expect(within(screen.getByTestId("seat-mz-3-1")).getByRole("button").getAttribute("aria-label")).toBe("Di monster zone 1");
    expect(screen.getAllByRole("button").some((button) => /selectable/.test(button.getAttribute("aria-label") ?? ""))).toBe(false);
  });

  it("the pile counters say when they are targets", () => {
    showLegal(fixture("ffa4", 4), [`3:${LOCATION_DECK}:0`]);
    expect(screen.getByRole("button", { name: "Di Deck (30), selectable" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Di Hand (0)" })).toBeTruthy();
  });

  it("the expand button is off while a target holds the board open, and works otherwise", () => {
    showLegal(fixture("ffa4", 4), [`3:${LOCATION_MZONE}:1`]);
    const held = within(screen.getByTestId("seat-board-3")).getByRole("button", { name: /Di stays open/ }) as HTMLButtonElement;
    expect(held.getAttribute("aria-disabled")).toBe("true");
    expect(held.disabled).toBe(false); // stays focusable
    expect(held.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(held);
    expect(within(screen.getByTestId("seat-board-3")).getByRole("button", { name: /Di stays open/ }).getAttribute("aria-expanded")).toBe("true");
    const free = within(screen.getByTestId("seat-board-2")).getByRole("button", { name: "Expand Cy" }) as HTMLButtonElement;
    expect(free.getAttribute("aria-disabled")).toBeNull();
    expect(free.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(free);
    expect(within(screen.getByTestId("seat-board-2")).getByRole("button", { name: "Collapse Cy" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("Master Rule 3: both Pendulum zones (Spell and Trap 6 and 7) show on a compact board and answer prompts", () => {
    const pendulum = (sequence: number): DuelCard => ({ controller: 3, location: LOCATION_SZONE, sequence, position: 1, code: 900 + sequence, name: `Scale ${sequence}` });
    const spells = [null, null, null, null, null, null, pendulum(6), null];
    showLegal(fixture("ffa4", 4, { 3: { spells } }), [`3:${LOCATION_SZONE}:7`], [], 3);
    const left = screen.getByTestId("seat-pz-3-1");
    const right = screen.getByTestId("seat-pz-3-2");
    expect(left.getAttribute("data-occupied")).toBe("true");
    expect(right.getAttribute("data-occupied")).toBe("false");
    expect(right.getAttribute("data-legal")).toBe("true");
    expect(left.getAttribute("data-legal")).toBe("false");
    expect(left.getAttribute("data-zones")).toContain(`3:${LOCATION_SZONE}:6`);
    expect(left.getAttribute("data-zones")).toContain(`3:${LOCATION_PZONE}:0`);
    expect(right.getAttribute("data-zones")).toContain(`3:${LOCATION_PZONE}:1`);
    expect(within(right).getByRole("button").getAttribute("aria-label")).toBe("Di right pendulum zone, selectable");
  });

  it("Master Rule 4 has no separate Pendulum cells; its outer zones answer to the Pendulum location", () => {
    showLegal(fixture("ffa4", 4), [`3:${LOCATION_PZONE}:1`]);
    expect(screen.queryByTestId("seat-pz-3-1")).toBeNull();
    expect(screen.getByTestId("seat-st-3-5").getAttribute("data-legal")).toBe("true");
    expect(screen.getByTestId("seat-st-3-1").getAttribute("data-legal")).toBe("false");
  });
});
