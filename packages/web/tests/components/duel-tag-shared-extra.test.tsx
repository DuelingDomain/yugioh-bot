// @vitest-environment jsdom
import React, { useReducer } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { LOCATION_MZONE, zoneKey } from "@/components/duel/constants";
import { SeatField } from "@/components/duel/field";
import { sharedExtraPairs } from "@/components/duel/multi-seat";
import { activatePromptFromField } from "@/components/duel/prompts";
import { TAG_FIXTURES, TAG_NAMES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { initialRoofCamera, roofReducer } from "@/components/duel/tag/roof-camera";
import { TagStage } from "@/components/duel/tag/tag-stage";
import { tableLayout } from "@/components/duel/table/geometry";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { DuelActivateHandler } from "@/components/duel/field";

afterEach(cleanup);

const mz = (seat: number, sequence: number) => zoneKey(seat, LOCATION_MZONE, sequence);

type Edit = (engine: DuelEngineView) => void;

/** A Tag fixture state, with the viewer and the engine edited by the caller (the engine is cloned first). */
function variant(base: TableFixtureState, viewer: number | null | undefined, edit?: Edit): TableFixtureState {
  const engine = structuredClone(base.room.engine!);
  edit?.(engine);
  return { ...base, room: { ...base.room, mySeat: viewer === undefined ? base.room.mySeat : viewer, engine } };
}

function Stage({ state, onActivate }: { state: TableFixtureState; onActivate?: DuelActivateHandler }) {
  const base = useFixtureController(state, { reducedMotion: true });
  const controller = onActivate ? { ...base, onActivate } : base;
  const layout = tableLayout("tag", controller.engine, controller.viewerSeat);
  const [camera, dispatch] = useReducer(roofReducer, undefined, () => initialRoofCamera({ anchorSeat: layout.anchorSeat }));
  return (
    <div style={{ width: 1000, height: 800 }}>
      <TagStage
        controller={controller}
        layout={layout}
        camera={camera}
        dispatchCamera={dispatch}
        renderSeatField={(props) => <SeatField {...props} />}
        teamNames={TAG_TEAM_NAMES}
      />
    </div>
  );
}

const main = TAG_FIXTURES.states.main;
const band = (a: number, b: number) => screen.getByTestId(`shared-emz-pair-${a}-${b}`);
const cellsOf = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-kind="emz"]')];
const cellWith = (el: HTMLElement, key: string) => cellsOf(el).find((cell) => cell.dataset.zones!.split(" ").includes(key))!;

describe("Tag shared Extra Monster Zones", () => {
  it("accepts Tag facing pairs 1A-2A and 1B-2B", () => {
    const engine = main.room.engine!;
    expect(engine.seats.map((view) => view.sharedExtraWith)).toEqual([1, 0, 3, 2]);
    expect(sharedExtraPairs(engine).map((pair) => pair.map((view) => view.seat))).toEqual([[0, 1], [2, 3]]);
  });

  it.each([0, 1, 2, 3, null])("draws one band per facing pair and no per-field EMZ row for viewer %s", (viewer) => {
    render(<Stage state={variant(main, viewer)} />);
    expect(screen.getAllByTestId(/^shared-emz-pair-/)).toHaveLength(2);
    // Four physical cells in all, two per band; the fields keep none of their own.
    expect(document.querySelectorAll('[data-kind="emz"]')).toHaveLength(4);
    for (const [a, b] of [[0, 1], [2, 3]] as const) {
      const cells = cellsOf(band(a, b));
      expect(cells).toHaveLength(2);
      const zones = cells.map((cell) => cell.dataset.zones!.split(" ").sort());
      // Each cell names both seats, the exact key of each: seq and 11 - seq.
      expect(zones).toContainEqual([mz(a, 5), mz(b, 6)].sort());
      expect(zones).toContainEqual([mz(a, 6), mz(b, 5)].sort());
    }
  });

  it.each([0, 1, 2, 3, null])("shows each card in its controller's cell from either facing seat (viewer %s)", (viewer) => {
    render(<Stage state={variant(main, viewer)} />);
    // 1A and 2A: Aster holds her sequence 5, Mirelle her sequence 5 (the other cell). 1B and 2B: Corvin 6, Juniper 6.
    const holders: [number, number, number, string][] = [
      [0, 1, 0, mz(0, 5)],
      [0, 1, 1, mz(1, 5)],
      [2, 3, 2, mz(2, 6)],
      [2, 3, 3, mz(3, 6)],
    ];
    for (const [a, b, owner, key] of holders) {
      const cell = cellWith(band(a, b), key);
      expect(cell.dataset.occupied).toBe("true");
      expect(cell.querySelector("button")!.getAttribute("aria-label")).toContain(`controlled by ${TAG_NAMES[owner]}`);
    }
  });

  it.each([0, 1, 2, 3, null])("keeps the near seat's cell first in the DOM and turns the far card (viewer %s)", (viewer) => {
    render(<Stage state={variant(main, viewer)} />);
    // The near seat of a pair is the one on the viewer's team; a spectator sees from seat 0 (1A and 1B near).
    const nearOf = (pair: readonly [number, number]) => (viewer != null && viewer % 2 === 1 ? pair[1] : pair[0]);
    for (const pair of [[0, 1], [2, 3]] as const) {
      const near = nearOf(pair);
      const cells = cellsOf(band(pair[0], pair[1]));
      // No sorting: the first cell is the near seat's zone 5, the second its zone 6.
      expect(cells[0]!.dataset.zones!.split(" ")).toContain(mz(near, 5));
      expect(cells[1]!.dataset.zones!.split(" ")).toContain(mz(near, 6));
      // A far card faces the far side (data-side "opp") while the camera is not upright; a near card reads straight.
      for (const cell of cells) {
        if (cell.dataset.occupied !== "true") continue;
        const controller = Number(cell.dataset.zones!.split(" ")[0]!.split(":")[0]); // the card's exact key comes first
        expect(cell.dataset.side).toBe(controller === near ? "you" : "opp");
      }
    }
  });

  it("gives each cell the owner look of its card's controller: self, partner, opponent", () => {
    render(<Stage state={variant(main, 0)} />);
    const wrap = (el: HTMLElement) => el.closest<HTMLElement>("[data-band-cell]")!;
    // Viewer 0 (Aster): her own card, her partner Corvin's card (2), the rival Mirelle's card (1) and Juniper's card (3).
    const own = wrap(cellWith(band(0, 1), mz(0, 5)));
    expect(own.dataset.relation).toBe("self");
    expect(own.dataset.usable).toBe("true");
    const rival = wrap(cellWith(band(0, 1), mz(1, 5)));
    expect(rival.dataset.relation).toBe("opponent");
    expect(rival.dataset.usable).toBe("false");
    const partner = wrap(cellWith(band(2, 3), mz(2, 6)));
    expect(partner.dataset.relation).toBe("partner");
    expect(partner.dataset.usable).toBe("false");
    expect(wrap(cellWith(band(2, 3), mz(3, 6))).dataset.relation).toBe("opponent");
    expect(own.dataset.out).toBeUndefined();
  });

  it("gives an empty legal cell the look of the seat of its legal address", () => {
    render(<Stage state={variant(TAG_FIXTURES.extra!["emz-place"]!, 0)} />);
    const empty = cellWith(band(0, 1), mz(0, 5)).closest<HTMLElement>("[data-band-cell]")!;
    expect(empty.dataset.relation).toBe("self");
    expect(empty.dataset.usable).toBe("true");
  });

  it("shows every cell as a spectator's other view and greys the cell of a lost team", () => {
    render(<Stage state={variant(main, null)} />);
    for (const cell of document.querySelectorAll<HTMLElement>("[data-band-cell]")) expect(cell.dataset.relation).toBe("other");
    cleanup();
    render(<Stage state={variant(TAG_FIXTURES.states.elimination, 0)} />);
    const lost = cellWith(band(0, 1), mz(1, 5)).closest<HTMLElement>("[data-band-cell]")!;
    expect(lost.dataset.out).toBe("true");
    expect(cellWith(band(0, 1), mz(0, 5)).closest<HTMLElement>("[data-band-cell]")!.dataset.out).toBeUndefined();
  });

  it("picks the deciding seat's own address when a cell offers two", () => {
    const prompt = {
      id: "two-addresses", seat: 0, kind: "places", title: "Pick a zone", min: 1, max: 1,
      options: [
        { id: "place:5", label: "near", controller: 0, location: LOCATION_MZONE, sequence: 5 },
        { id: "place:6", label: "far", controller: 1, location: LOCATION_MZONE, sequence: 6 },
      ],
    } as never;
    const submit = vi.fn();
    const draft = { selected: [], setSelected: vi.fn() } as never;
    expect(activatePromptFromField(prompt, true, [mz(0, 5), mz(1, 6)], null, draft, submit)).toBe(true);
    expect(submit).toHaveBeenCalledWith({ selected: ["place:5"] });
  });

  it("does not guess when two addresses belong to neither or both of the deciding seat", () => {
    const prompt = {
      id: "two-far", seat: 2, kind: "places", title: "Pick a zone", min: 1, max: 1,
      options: [
        { id: "place:5", label: "a", controller: 0, location: LOCATION_MZONE, sequence: 5 },
        { id: "place:6", label: "b", controller: 1, location: LOCATION_MZONE, sequence: 6 },
      ],
    } as never;
    const draft = { selected: [], setSelected: vi.fn() } as never;
    expect(activatePromptFromField(prompt, true, [mz(0, 5), mz(1, 6)], null, draft, vi.fn())).toBe(false);
  });

  it("drops the pairing for an eliminated seat in the fixtures and in the pairing check", () => {
    const result = TAG_FIXTURES.states.result.room.engine!;
    expect(result.seats.map((view) => view.sharedExtraWith)).toEqual([null, null, null, null]);
    const engine = structuredClone(main.room.engine!);
    engine.seats[3]!.eliminated = true;
    // Seat 3 is out: seat 2 keeps its own EMZ row (no pair), the pair 0-1 stays.
    expect(sharedExtraPairs(engine).map((pair) => pair.map((view) => view.seat))).toEqual([[0, 1]]);
  });

  it("occupancy from the far seat alone fills the same cell", () => {
    const state = variant(main, 0, (engine) => {
      engine.seats[0]!.monsters[5] = null;
      engine.seats[1]!.monsters[5] = null;
      engine.seats[1]!.monsters[6] = main.room.engine!.seats[0]!.monsters[5]; // keep a card, now held by 2A in its sequence 6
      engine.seats[1]!.monsters[6] = { ...engine.seats[1]!.monsters[6]!, controller: 1, sequence: 6 };
    });
    render(<Stage state={state} />);
    const cell = cellWith(band(0, 1), mz(0, 5));
    expect(cell.dataset.occupied).toBe("true");
    expect(cell.querySelector("button")!.getAttribute("aria-label")).toContain(`controlled by ${TAG_NAMES[1]}`);
    expect(cellWith(band(0, 1), mz(0, 6)).dataset.occupied).toBe("false");
  });

  it("keeps the exact card keys and the card identity for inspection", () => {
    const onActivate = vi.fn();
    render(<Stage state={variant(main, 0)} onActivate={onActivate} />);
    const cell = cellWith(band(0, 1), mz(1, 5));
    const card = main.room.engine!.seats[1]!.monsters[5]!;
    fireEvent.click(cell.querySelector("button")!);
    const [keys, clicked] = onActivate.mock.calls[0]!;
    expect(keys[0]).toBe(mz(1, 5)); // the card's own key first
    expect(keys).toContain(mz(0, 6));
    expect(clicked).toMatchObject({ code: card.code, controller: 1, sequence: 5 });
  });

  it("marks the place-in-EMZ option legal on the cell that holds the chosen zone and resolves it by controller and sequence", () => {
    const state = variant(TAG_FIXTURES.extra!["emz-place"]!, 0);
    const onActivate = vi.fn();
    render(<Stage state={state} onActivate={onActivate} />);
    const left = cellWith(band(0, 1), mz(0, 5));
    const right = cellWith(band(0, 1), mz(0, 6));
    expect(left.dataset.legal).toBe("true");
    expect(right.dataset.legal).toBe("false");
    fireEvent.click(left.querySelector("button")!);
    const [keys, card] = onActivate.mock.calls[0]!;
    const submit = vi.fn();
    const draft = { selected: [], setSelected: vi.fn() } as never;
    expect(activatePromptFromField(state.room.engine!.prompt, true, keys, card, draft, submit)).toBe(true);
    expect(submit).toHaveBeenCalledWith({ selected: ["place:5"] });
    // The mirrored key alone (the far seat's own number for the same cell) does not pick another zone.
    expect(activatePromptFromField(state.room.engine!.prompt, true, [mz(1, 6)], null, draft, vi.fn())).toBe(false);
  });

  it("marks a card in a shared cell as a legal target by its exact key", () => {
    const state = variant(TAG_FIXTURES.states["target-pick"], 0);
    render(<Stage state={state} />);
    const target = cellWith(band(0, 1), mz(1, 5));
    expect(target.dataset.legal).toBe("true");
    expect(cellWith(band(0, 1), mz(0, 5)).dataset.legal).toBe("false");
    expect(cellWith(band(2, 3), mz(3, 6)).dataset.legal).toBe("true");
  });

  it.each([
    ["near seat", 0, 5],
    ["far seat", 1, 6],
  ])("shows a cell disabled when only the %s mask has the bit", (_name, seat, sequence) => {
    const state = variant(main, 0, (engine) => {
      engine.seats[0]!.monsters[5] = null;
      engine.seats[1]!.monsters[6] = null;
      engine.seats[seat]!.disabledZones = 1 << sequence;
    });
    render(<Stage state={state} />);
    // Both keys name the same physical cell (0:5 is 1:6), so either seat's bit disables it, once.
    expect(screen.getAllByTestId(/^zone-disabled-/).map((el) => el.getAttribute("data-testid"))).toEqual([`zone-disabled-${seat}-m-${sequence}`]);
    expect(cellWith(band(0, 1), mz(0, 5)).dataset.disabled).toBe("true");
    expect(cellWith(band(0, 1), mz(0, 6)).dataset.disabled).toBeUndefined();
  });

  it("falls back to each field's own EMZ row for an old core (null pairing)", () => {
    const state = variant(main, 0, (engine) => {
      for (const view of engine.seats) view.sharedExtraWith = null;
    });
    render(<Stage state={state} />);
    expect(screen.queryAllByTestId(/^shared-emz-pair-/)).toHaveLength(0);
    expect(document.querySelectorAll('[data-kind="emz"]')).toHaveLength(8);
  });

  it("falls back for a view with no pairing field at all", () => {
    const state = variant(main, 0, (engine) => {
      for (const view of engine.seats) delete view.sharedExtraWith;
    });
    render(<Stage state={state} />);
    expect(screen.queryAllByTestId(/^shared-emz-pair-/)).toHaveLength(0);
    expect(document.querySelectorAll('[data-kind="emz"]')).toHaveLength(8);
  });

  it("keeps both cards when a mirrored cell is claimed from both seats", () => {
    const state = variant(main, 0, (engine) => {
      engine.seats[1]!.monsters[6] = { ...engine.seats[1]!.monsters[5]!, sequence: 6 };
    });
    render(<Stage state={state} />);
    // Conflicting occupancy: the pair keeps separate rows so neither card is hidden; the other pair still shares.
    expect(screen.queryByTestId("shared-emz-pair-0-1")).toBeNull();
    expect(screen.getByTestId("shared-emz-pair-2-3")).toBeTruthy();
  });

  it("hides the shared band below Master Rule 4", () => {
    const state = variant(main, 0);
    state.room = { ...state.room, session: { ...state.room.session, masterRule: 3 } };
    render(<Stage state={state} />);
    expect(screen.queryAllByTestId(/^shared-emz-pair-/)).toHaveLength(0);
    expect(document.querySelectorAll('[data-kind="emz"]')).toHaveLength(0);
  });

  it("labels the band for assistive tech", () => {
    render(<Stage state={variant(main, 0)} />);
    expect(band(0, 1).getAttribute("aria-label")).toBe(`${TAG_NAMES[0]} / ${TAG_NAMES[1]} shared extra monster zones`);
    expect(within(band(2, 3)).getAllByRole("button")).toHaveLength(2);
  });
});
