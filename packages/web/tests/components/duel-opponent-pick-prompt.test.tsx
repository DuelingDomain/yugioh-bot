// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { TAG_FIXTURES, TAG_NAMES } from "@/components/duel/tag/fixtures";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import { opponentPickLabel } from "@/components/duel/multi-seat";

beforeAll(() => {
  class RO { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(cleanup);

function Shell({ room }: { room: DuelRoom }) {
  const controller = useFixtureController({ id: "main", label: "Live", room }, { reducedMotion: true });
  return <TableShell controller={controller} busy={false} fxActive={false} />;
}

// The engine still sends the ordinary "choose an opponent" prompt (context type "opponent") for cards that
// have nothing to do with columns (aux.MPChooseOpponent). Only the column pick is gone.
describe("a type:opponent prompt", () => {
  it("FFA3: each offered opponent has a Choose <name> as the opponent button", () => {
    const room = FFA3_FIXTURES.states["choose-opponent"].room;
    const prompt = room.engine!.prompt!;
    expect(prompt.context).toMatchObject({ type: "opponent" });
    expect(prompt.options.map((option) => option.controller)).toEqual([1, 2]);
    render(<Shell room={room} />);
    for (const name of ["Ryo Sato", "Mika Hana"]) {
      expect(screen.getAllByRole("button", { name: opponentPickLabel(name) }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("button", { name: opponentPickLabel("Ren Arata") })).toBeNull();
  });

  it("Tag: the opposing team can be chosen as the opponent", () => {
    const room = TAG_FIXTURES.states["choose-opponent"].room;
    const prompt = room.engine!.prompt!;
    expect(prompt.context).toMatchObject({ type: "opponent" });
    render(<Shell room={room} />);
    for (const seat of prompt.options.map((option) => option.controller!)) {
      expect(screen.getAllByRole("button", { name: opponentPickLabel(TAG_NAMES[seat]) }).length).toBeGreaterThan(0);
    }
    const offered = new Set(prompt.options.map((option) => option.controller));
    expect(offered.size).toBe(2);
    for (const seat of [0, 1, 2, 3].filter((seat) => !offered.has(seat))) {
      expect(screen.queryByRole("button", { name: opponentPickLabel(TAG_NAMES[seat]) })).toBeNull();
    }
  });
});
