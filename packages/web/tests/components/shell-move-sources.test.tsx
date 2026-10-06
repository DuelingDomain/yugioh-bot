// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { LOCATION_HAND, LOCATION_MZONE } from "@/components/duel/constants";
import { captureZoneSnapshots, getZoneSnapshot, resetMoveSchedule, resolveSource } from "@/components/duel/move-plan";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import { TAG_FIXTURES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { TagShell } from "@/components/duel/tag/tag-shell";

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
});

beforeAll(() => {
  class RO {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The viewer's first two hand cards leave for the monster zones in one batch; the hand closes up behind them. */
function twoLeave(state: TableFixtureState): { state: TableFixtureState; events: DuelEvent[]; seat: number } {
  const engine = state.room.engine!;
  const seat = state.room.mySeat!;
  const seats = engine.seats.map((view) => (view.seat === seat ? { ...view, hand: view.hand.slice(2) } : view));
  const move = (id: number, sequence: number): DuelEvent => ({
    id, kind: "move", text: "Summon", card: { code: 1000 + id } as never,
    from: { controller: seat, location: LOCATION_HAND, sequence: 0 },
    zone: { controller: seat, location: LOCATION_MZONE, sequence },
  });
  const events = [move(901, 0), move(902, 1)];
  return { state: { ...state, room: { ...state.room, engine: { ...engine, seats, events } } }, events, seat };
}

function Table({ state }: { state: TableFixtureState }) {
  const controller = useFixtureController(state, { reducedMotion: false });
  return <TableShell controller={controller} />;
}
function Tag({ state }: { state: TableFixtureState }) {
  const controller = useFixtureController(state, { reducedMotion: false });
  return <TagShell controller={controller} teamNames={[...TAG_TEAM_NAMES] as [string, string]} />;
}

describe("the shells freeze flight sources before a batch commits", () => {
  it.each([["TableShell", Table, FFA3_FIXTURES.states.main], ["TagShell", Tag, TAG_FIXTURES.states.main]] as const)(
    "%s: two hand cards leaving in one batch fly from their own slots",
    (_name, Shell, base) => {
      resetMoveSchedule("shell-sources");
      let left = 100;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const [seat, location, sequence] = (this.dataset.zones ?? "").split(" ")[0].split(":").map(Number);
        if (location === LOCATION_HAND && seat === base.room.mySeat) return rect(left + sequence * 100, 500, 70, 100);
        return rect(0, 0, 200, 150);
      });
      const { state, events, seat } = twoLeave(base);
      const view = render(<Shell state={base} />);
      // The 160 ms sampler last saw the hand at 100; since then the layout moved (a camera move, a resize).
      left = 500;
      view.rerender(<Shell state={state} />);
      const from = (sequence: number) => ({ controller: seat, location: LOCATION_HAND, sequence });
      expect(resolveSource(from(0), events[0].id)?.rect.left).toBe(500);
      // The second card left slot 1 of the old hand, not slot 0 of the compacted one.
      expect(resolveSource({ ...from(0) }, events[1].id)?.rect.left).toBe(600);
    },
  );
});
