// @vitest-environment jsdom
// A light smoke test of the three places that mount the pile viewer: the n-seat table shell, the Tag Rooftop and the
// 1v1 room (room.tsx also serves replay and spectators). The full behaviour is in duel-pile-chain-marks.test.tsx.
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelChainLink, DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { LOCATION_GRAVE, TYPE_EFFECT, TYPE_MONSTER } from "@/components/duel/constants";
import { useDuelPreferences } from "@/components/duel/preferences";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import { useTableUi } from "@/components/duel/table/use-table-ui";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { TagPileViewer, TagSide } from "@/components/duel/tag/tag-side";

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

const MAIDEN = 9002;
const gyCard = (sequence: number, code: number, name: string): DuelCard => ({
  controller: 0, location: LOCATION_GRAVE, sequence, position: 1, code, name, description: `Text of ${name}.`,
  type: TYPE_MONSTER | TYPE_EFFECT, attack: 0, defense: 0, level: 1, attribute: 16, race: "Spellcaster",
});

/** The fixture with seat 0's Graveyard replaced and a live chain: link 1 activated from the Maiden at sequence 2, after a lower card left. */
function withChain(base: TableFixtureState): TableFixtureState {
  const engine = base.room.engine!;
  const chain: DuelChainLink[] = [{ index: 1, seat: 0, code: MAIDEN, name: "Maiden of White", zone: { controller: 0, location: LOCATION_GRAVE, sequence: 2 } }];
  const events = [
    { id: 1, kind: "activate", seat: 0, chainIndex: 1, zone: { controller: 0, location: LOCATION_GRAVE, sequence: 2 } },
    { id: 2, kind: "move", seat: 0, text: "moved", from: { controller: 0, location: LOCATION_GRAVE, sequence: 0 }, zone: { controller: 0, location: 0x20, sequence: 0 } },
  ] as unknown as DuelEvent[];
  // The pile as it is now: the Magician (sequence 0) left, so the activator slid from 2 to 1 and the copy below it is at 0.
  const now = [gyCard(0, MAIDEN, "Maiden of White"), gyCard(1, MAIDEN, "Maiden of White"), gyCard(2, 9004, "Wishes for Eyes of Blue")];
  const seats = engine.seats.map((seat) => (seat.seat === 0 ? { ...seat, graveyard: now } : seat));
  return { ...base, room: { ...base.room, engine: { ...engine, seats, chain, events, result: null } } } as TableFixtureState;
}

function chainButton() {
  return screen.getByRole("button", { name: /Chain link 1 activating/ });
}

describe("pile chain marks at the mount sites", () => {
  it("n-seat table shell: the opened Graveyard marks the chain card that activated, after a lower card left", () => {
    const state = withChain(FFA3_FIXTURES.states.main);
    function Shell() {
      const controller = useFixtureController(state, { reducedMotion: true });
      return <TableShell controller={controller} />;
    }
    const { container } = render(<Shell />);
    const pile = container.querySelector("button[aria-label*='Your Graveyard' i]") as HTMLElement | null;
    expect(pile).not.toBeNull();
    act(() => void fireEvent.click(pile as HTMLElement));
    // The activator slid from 2 to 1 when the Magician left; newest first it reads "2 of 3". The copy at 0 is not marked.
    expect(chainButton()).toHaveAccessibleName(/^Maiden of White, 2 of 3, Chain link 1 activating/);
    expect(screen.getByRole("button", { name: /^Maiden of White, 3 of 3$/ })).toBeTruthy();
    expect(screen.getByTestId("pile-chain-line")).toHaveTextContent("Chain 1 · activating");
  });

  it("Tag Rooftop: the opened pile marks the chain card", () => {
    const state = withChain({ ...TAG_FIXTURES.states.main, room: { ...TAG_FIXTURES.states.main.room, viewerSeat: 0 } } as TableFixtureState);
    function Harness() {
      const base = useFixtureController(state, { reducedMotion: true });
      const ui = useTableUi(base);
      const preferences = useDuelPreferences();
      return (
        <div>
          <TagSide controller={ui.controller} ui={ui} preferences={preferences} />
          <button type="button" onClick={() => ui.inspectCard({ type: "pile", title: "Graveyard", cards: [gyCard(0, MAIDEN, "Maiden of White")] })}>open pile</button>
          <TagPileViewer controller={ui.controller} ui={ui} />
        </div>
      );
    }
    render(<Harness />);
    act(() => void fireEvent.click(screen.getByRole("button", { name: "open pile" })));
    expect(chainButton()).toHaveAccessibleName(/^Maiden of White, 2 of 3, Chain link 1 activating/);
    expect(screen.getByTestId("pile-chain-line")).toHaveAttribute("aria-live", "polite");
  });

  it("1v1 room (also replay and spectator): feeds the viewer with the live chain, cleared when the duel is over", () => {
    const source = readFileSync(resolve(__dirname, "../../src/components/duel/room.tsx"), "utf8");
    expect(source).toMatch(/useLiveChainLinks\(data\?\.engine\?\.events \?\? NO_CHAIN_EVENTS, data\?\.engine\?\.chain \?\? NO_CHAIN_LINKS, duelOver\)/);
    expect(source).toMatch(/<PileViewer[\s\S]{0,700}?chainLinks=\{pileChainLinks\}/);
  });
});
