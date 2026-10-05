// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import { isCoinTossActive, resetCoinTossState } from "@/components/duel/coin-toss-lock";

const src = (file: string) => readFileSync(join(__dirname, "../../src/components/duel", file), "utf8");

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
afterEach(() => {
  cleanup();
  resetCoinTossState();
  vi.useRealTimers();
});

// The coin is one screen-level layer: every duel shell mounts it, none of them places it in a seat or board.
describe("coin toss mounts", () => {
  it.each([
    ["room.tsx", "1v1 room, 3D Solid Vision (renderBoard)"],
    ["table/table-shell.tsx", "3-way and 4-way table"],
    ["tag/tag-fx.tsx", "Tag 2v2"],
    ["replay.tsx", "replay viewer"],
  ])("%s mounts CoinTossFx (%s)", (file) => {
    expect(src(file)).toMatch(/<CoinTossFx\b/);
  });

  // Every layer that reads the chain plan or lays out a move must run after the coin: it comes first.
  it.each([
    ["room.tsx", "<DuelFeedback"],
    ["table/table-shell.tsx", "<DuelFeedback"],
    ["tag/tag-fx.tsx", "<DuelFeedback"],
  ])("%s mounts the coin before MoveFx and SummonFx (the first layer of the group)", (file, first) => {
    const code = src(file);
    const coin = code.indexOf("<CoinTossFx");
    expect(coin).toBeGreaterThan(-1);
    for (const layer of [first, "<SummonFx", "<MoveFx", "<ChainFx"]) expect(coin).toBeLessThan(code.indexOf(layer));
  });

  it("the 3-way and 4-way table: a toss shows the cover on the page, blocks input, and gives it back", () => {
    vi.useFakeTimers();
    const base = FFA3_FIXTURES.states.main;
    const withEvents = (events: DuelEvent[]) => ({ ...base, room: { ...base.room, engine: { ...base.room.engine!, events } } });
    const clicks = vi.fn();
    function Shell({ events }: { events: DuelEvent[] }) {
      const controller = useFixtureController(withEvents(events), { reducedMotion: true });
      return <div onClick={clicks}><TableShell controller={controller} /></div>;
    }
    const { rerender, container } = render(<Shell events={[]} />);
    const toss = { id: 900, kind: "toss", text: "Coin toss", seat: 0, toss: { type: "coin", results: ["heads"] }, card: { code: 10, name: "Barrel Dragon" } } as unknown as DuelEvent;
    act(() => { rerender(<Shell events={[toss]} />); });
    act(() => { vi.advanceTimersByTime(300); });
    const cover = document.body.querySelector('[data-testid="coin-toss"]');
    expect(cover).not.toBeNull();
    expect(cover?.parentElement).toBe(document.body);
    expect(container.contains(cover)).toBe(false);
    expect(isCoinTossActive()).toBe(true);
    fireEvent.click(container.firstElementChild!);
    expect(clicks).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(isCoinTossActive()).toBe(false);
    expect(document.body.querySelector('[data-testid="coin-toss"]')).toBeNull();
    fireEvent.click(container.firstElementChild!);
    expect(clicks).toHaveBeenCalledTimes(1);
  });

  it("the replay mount is passive (no input lock)", () => {
    expect(src("replay.tsx")).toMatch(/<CoinTossFx[^>]*\bpassive\b/);
  });

  it("the overlay covers the whole screen and centres the coin, in a portal above every layer", () => {
    const css = src("coin-toss-fx.module.css");
    const root = /\.root\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(root).toMatch(/position:\s*fixed/);
    expect(root).toMatch(/inset:\s*0/);
    expect(root).toMatch(/z-index:\s*var\(--duel-z-coin\)/);
    // The cover is nearly black and blurred on its own layer; .root itself has no filter (it would flatten the 3D coin).
    expect(/\.root::before\s*\{[^}]*\}/.exec(css)?.[0]).toMatch(/backdrop-filter:\s*blur\(6px\)/);
    expect(css).toMatch(/rgb\(3 5 12 \/ 0\.9\)/);
    expect(root).not.toMatch(/filter|opacity/);
    // The fade animation must not reach the verdict and the summary: it would pin their opacity at 1 (a dark box in the middle).
    expect(css).not.toMatch(/\.root\s*>\s*\*/);
    // The stage fills the cover and the coin hangs at its horizontal centre, whatever sits under it.
    expect(/\.stage\s*\{[^}]*\}/.exec(css)?.[0]).toMatch(/inset:\s*0/);
    expect(/\.lift\s*\{[^}]*\}/.exec(css)?.[0]).toMatch(/left:\s*50%/);
    expect(src("coin-toss-fx.tsx")).toMatch(/createPortal\([\s\S]*document\.body/);
  });

  it("the room guards every send path with the lock", () => {
    const room = src("room.tsx");
    expect(room).toMatch(/const run = useCallback\(\s*async \(work[^\n]*\n\s*\/\/[^\n]*\n\s*if \(isCoinTossActive\(\)\) return;/);
    expect(room).toMatch(/\(answer: DuelAnswer\) => \{\s*if \(isCoinTossActive\(\)\) return;/);
    expect(room).toMatch(/if \(!canSurrender \|\| isCoinTossActive\(\)\) return;/);
  });
});
