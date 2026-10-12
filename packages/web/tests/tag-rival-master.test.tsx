// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import type { TableFixtureSet, TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TAG_FIXTURES, tagDomainVariant } from "@/components/duel/tag/fixtures";
import { TeamLpPlate, type PlateMember } from "@/components/duel/tag/team-lp-plate";
import { TagShell } from "@/components/duel/tag/tag-shell";

// Seats of the Tag fixtures: Aster (you, 0) and Corvin (2) are a team, Mirelle (1) and Juniper (3) the rivals.
// The Domain variant starts with every master in use; the test puts Juniper's back into her zone.
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
afterEach(cleanup);

function Shell({ set }: { set: TableFixtureSet }) {
  const controller = useFixtureController((set.states as Record<string, TableFixtureState>).main, { reducedMotion: true });
  return <TagShell controller={controller} />;
}

/** The Domain variant with the master of one seat in its zone. */
function withMasterInZone(seat: number): TableFixtureSet {
  const set = tagDomainVariant(TAG_FIXTURES);
  const states = Object.fromEntries(Object.entries(set.states).map(([id, state]) => {
    const engine = state.room.engine!;
    const seats = engine.seats.map((view) => (view.seat === seat && view.deckMaster ? { ...view, deckMaster: { ...view.deckMaster, inZone: true } } : view));
    return [id, { ...state, room: { ...state.room, engine: { ...engine, seats } } }];
  }));
  return { ...set, states } as unknown as TableFixtureSet;
}

const thumbs = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-team-plate] [data-master-thumb]")];

describe("rival Deck Masters on the Tag table", () => {
  it("a Domain table shows a thumb on each rival chip: in use reads as in use, in the zone shows the cost", () => {
    const { container } = render(<Shell set={withMasterInZone(3)} />);
    const found = thumbs(container);
    expect(found.map((node) => node.dataset.masterThumb)).toEqual(["1", "3"]);
    const [away, home] = found;
    expect(away.dataset.inUse).toBe("true");
    expect(away.getAttribute("aria-label")).toMatch(/\(in use\)$/);
    expect(away.querySelector("img")).toBeNull();
    expect(home.dataset.inUse).toBeUndefined();
    expect(home.getAttribute("aria-label")).toMatch(/Summon: costs 1,500 LP$/);
    expect(home.querySelector("img")).not.toBeNull();
    // The return flight finds its landing and its start on the thumb.
    expect(away.dataset.masterDock).toBe("1");
    expect(away.dataset.masterSource).toBe("1");
  });

  it("a Standard table shows no Deck Master on any chip", () => {
    const { container } = render(<Shell set={TAG_FIXTURES} />);
    expect(thumbs(container)).toEqual([]);
    expect(container.querySelector("[data-master-thumb]")).toBeNull();
  });
});

describe("a pickable rival chip and its Deck Master thumb", () => {
  const member: PlateMember = {
    seat: 3, name: "Juniper Rook", code: "2B", rgb: "120 200 90", ink: "#b8f08a", you: false, hand: 4, deck: 28, clockMs: null, clockRuns: false,
    now: false, response: null, pickable: true, hotkey: 1, locked: false,
    master: { card: { code: 1, name: "Gaia The Fierce Knight" } as never, inUse: false, summon: "Summon: free" },
  };
  const plate = (onPick: (seat: number) => void, onInspectMaster: (card: unknown) => void) =>
    render(<TeamLpPlate teamName="Thornveil" glyph="●" near={false} lp={8000} startLp={8000} state="waiting" cracked={false} members={[member]} reducedMotion onPick={onPick} onInspectMaster={onInspectMaster} />);

  it("the thumb is not inside the pickable chip, and Enter or a click on it inspects without picking the seat", () => {
    const onPick = vi.fn();
    const onInspect = vi.fn();
    const { container } = plate(onPick, onInspect);
    const thumb = container.querySelector<HTMLElement>("[data-master-thumb]")!;
    const chip = container.querySelector<HTMLElement>("[data-lp-seat]")!;
    expect(chip.contains(thumb)).toBe(false);
    thumb.focus();
    fireEvent.keyDown(thumb, { key: "Enter" });
    fireEvent.click(thumb);
    expect(onPick).not.toHaveBeenCalled();
    expect(onInspect).toHaveBeenCalledTimes(1);
    fireEvent.click(chip);
    expect(onPick).toHaveBeenCalledWith(3);
  });
});
