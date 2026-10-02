// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

import { ChainFx } from "@/components/duel/chain-fx";

const SZONE = 0x08;
const HAND = 0x02;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const info = (code: number): DuelCardInfo => ({
  code, name: `Card ${code}`, description: "", type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "Warrior",
});

let id = 100;
const activate = (chainIndex: number, seat: number, code: number, zone: DuelZoneRef): DuelEvent => ({
  id: id++, kind: "activate", text: "a", seat, card: info(code), chainIndex, zone,
});
const ev = (kind: DuelEvent["kind"], chainIndex?: number): DuelEvent => ({
  id: id++, kind, text: kind, ...(chainIndex != null ? { chainIndex } : {}),
});

const names = (seat: number) => `Player ${seat + 1}`;
const view = (events: DuelEvent[], chain: DuelChainLink[] = [], mySeat: number | null = 0, reducedMotion = false) => (
  <ChainFx events={events} chain={chain} duelKey="t" reducedMotion={reducedMotion} mySeat={mySeat} playerName={names} />
);

const rows = (c: HTMLElement) => [...c.querySelectorAll("[data-chain-row]")];
const slot = (c: HTMLElement, n: number) => c.querySelector(`[data-chain-link="${n}"]`) as HTMLElement | null;

/** Puts a card on the board: a zone element jsdom can measure. */
const BOXES: Record<string, [number, number, number, number]> = {
  "0:8:0": [100, 400, 60, 80],
  "1:8:0": [100, 100, 60, 80],
  "1:8:1": [220, 100, 60, 80],
};
function placeZones(...keys: string[]) {
  for (const key of keys) {
    const el = document.createElement("div");
    el.dataset.zones = key;
    document.body.appendChild(el);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const box = this.dataset.zones ? BOXES[this.dataset.zones.split(" ")[0]] : [0, 0, 900, 600];
    const [left, top, width, height] = box ?? [0, 0, 0, 0];
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-zones]").forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ChainFx", () => {
  it("renders nothing for an empty chain", () => {
    const { container } = render(view([]));
    expect(container.querySelector("[data-chain-link]")).toBeNull();
    expect(container.querySelector("[data-chain-panel]")).toBeNull();
  });

  it("starts from the live chain on first paint: a badge, and an off-board row when the card has no place on the board", () => {
    const events = [activate(1, 1, 11, z(1, SZONE, 2))];
    const { container } = render(view(events, [{ index: 1, seat: 1, code: 11, name: "Card 11" }]));
    expect(slot(container, 1)?.textContent).toBe("1");
    expect(slot(container, 1)?.dataset.status).toBe("pending");
    expect(rows(container)).toHaveLength(1);
    expect(rows(container)[0].textContent).toContain("Card 11");
    expect(rows(container)[0].textContent).toContain("Opponent");
  });

  it("names the owner of each link and tones its row when the table gives seat tones", () => {
    const events = [activate(1, 1, 11, z(1, SZONE, 2)), activate(2, 2, 12, z(2, SZONE, 0))];
    const chain: DuelChainLink[] = [{ index: 1, seat: 1, code: 11, name: "Card 11" }, { index: 2, seat: 2, code: 12, name: "Card 12" }];
    const tones = new Map([[0, { main: "#9b7eff", ink: "#c6b6ff" }], [1, { main: "#5cb8f5", ink: "#a9dcfb" }], [2, { main: "#8fd36b", ink: "#c4ecad" }]]);
    const { container } = render(<ChainFx events={events} chain={chain} duelKey="t" reducedMotion mySeat={0} playerName={names} seatTones={tones} />);
    const text = rows(container).map((row) => row.textContent ?? "");
    expect(text.some((t) => t.includes("Player 2"))).toBe(true);
    expect(text.some((t) => t.includes("Player 3"))).toBe(true);
    expect(text.some((t) => t.includes("Opponent"))).toBe(false);
    const row = rows(container).find((r) => r.textContent?.includes("Player 3")) as HTMLElement;
    expect(row.style.getPropertyValue("--seat-main")).toBe("#8fd36b");
    expect(row.getAttribute("data-toned")).toBe("true");
  });

  it("lists the off-board rows top of the chain first and labels you / opponent", () => {
    const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, HAND, 1))];
    const { container } = render(view(events));
    expect(rows(container).map((r) => (r as HTMLElement).dataset.chainRow)).toEqual(["2", "1"]);
    expect(rows(container)[0].textContent).toContain("Opponent");
    expect(rows(container)[1].textContent).toContain("You");
  });

  it("plays a new response in as it arrives, then resolves highest first and clears at the end", () => {
    const first = [activate(1, 0, 11, z(0, SZONE, 0))];
    const { container, rerender } = render(view(first));
    expect(slot(container, 2)).toBeNull();

    const second = [...first, activate(2, 1, 22, z(1, SZONE, 0))];
    rerender(view(second));
    expect(slot(container, 2)?.dataset.status).toBe("pending");

    const resolution = [...second, ev("chain-resolving", 2), ev("chain-resolved", 2), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")];
    rerender(view(resolution));
    // The response beat holds first, then link 2 resolves while link 1 still waits.
    expect(slot(container, 2)?.dataset.status).toBe("pending");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(slot(container, 2)?.dataset.status).toBe("resolving");
    expect(slot(container, 1)?.dataset.status).toBe("pending");
    expect(container.querySelector('[data-chain-row="2"]')?.getAttribute("data-status")).toBe("resolving");

    // Link 2 holds for its own resolve beat and its tick before link 1 starts: each step is readable.
    act(() => { vi.advanceTimersByTime(1200); });
    expect(slot(container, 2)?.dataset.status).toBe("resolved");
    expect(slot(container, 1)?.dataset.status).toBe("pending");
    act(() => { vi.advanceTimersByTime(700); });
    expect(slot(container, 1)?.dataset.status).toBe("resolving");
    expect(slot(container, 2)?.dataset.status).toBe("resolved");

    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.querySelector("[data-chain-link]")).toBeNull();
    expect(container.querySelector("[data-chain-panel]")).toBeNull();
  });

  // The chain starts from the live state here (every activate is already on the board), so the first
  // resolving beat plays at once and each beat holds for chainStepDelay: 1150 ms resolving, 720 ms
  // resolved, 950 ms negated (reduced motion: 920, 576).
  it("marks the next link to resolve as up next, and moves the mark down as links resolve", () => {
    const first = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0)), activate(3, 0, 33, z(0, SZONE, 0))];
    const { container, rerender } = render(view(first));
    const next = () => [...container.querySelectorAll("[data-chain-link]")].filter((el) => (el as HTMLElement).dataset.next === "true").map((el) => (el as HTMLElement).dataset.chainLink);
    // Nothing is up next while the chain is still being built.
    expect(next()).toEqual([]);

    rerender(view([...first, ev("chain-resolving", 3), ev("chain-resolved", 3), ev("chain-resolving", 2), ev("chain-resolved", 2), ev("chain-end")]));
    act(() => { vi.advanceTimersByTime(100); });
    expect(slot(container, 3)?.dataset.status).toBe("resolving");
    expect(next()).toEqual(["2"]);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(slot(container, 3)?.dataset.status).toBe("resolved");
    expect(slot(container, 2)?.dataset.status).toBe("pending");
    expect(next()).toEqual(["2"]);
    act(() => { vi.advanceTimersByTime(700); });
    expect(slot(container, 2)?.dataset.status).toBe("resolving");
    expect(next()).toEqual(["1"]);
  });

  it("keeps a negated link marked while it resolves, and clears it only with the chain", () => {
    const first = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))];
    const { container, rerender } = render(view(first));
    rerender(view([...first, ev("chain-resolving", 2), ev("chain-negated", 2), ev("chain-resolved", 2), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")]));
    act(() => { vi.advanceTimersByTime(100); });
    expect(slot(container, 2)?.dataset.status).toBe("resolving");
    expect(slot(container, 2)?.dataset.negated).toBe("false");
    // The slash is drawn on the badge in its own beat, before the link is resolved.
    act(() => { vi.advanceTimersByTime(1100); });
    expect(slot(container, 2)?.dataset.status).toBe("resolving");
    expect(slot(container, 2)?.dataset.negated).toBe("true");
    expect(slot(container, 1)?.dataset.negated).toBe("false");
    act(() => { vi.advanceTimersByTime(1000); });
    // Still struck through when it is resolved; the badge only leaves with the end of the chain.
    expect(slot(container, 2)?.dataset.status).toBe("resolved");
    expect(slot(container, 2)?.dataset.negated).toBe("true");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.querySelector("[data-chain-link]")).toBeNull();
  });

  it("holds each link for a readable beat on reduced motion, with no wire", () => {
    const first = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))];
    const { container, rerender } = render(view(first, [], 0, true));
    rerender(view([...first, ev("chain-resolving", 2), ev("chain-resolved", 2), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")], [], 0, true));
    expect(container.querySelector("[data-chain-fx]")?.getAttribute("data-reduced")).toBe("true");
    expect(container.querySelector("svg[data-chain-wires]")).toBeNull();
    act(() => { vi.advanceTimersByTime(400); });
    expect(slot(container, 2)?.dataset.status).toBe("resolving");
    // Link 2 stays marked for its hold, and link 1 waits for its turn.
    act(() => { vi.advanceTimersByTime(400); });
    expect(slot(container, 2)?.dataset.status).toBe("resolving");
    act(() => { vi.advanceTimersByTime(400); });
    expect(slot(container, 2)?.dataset.status).toBe("resolved");
    expect(slot(container, 1)?.dataset.status).toBe("pending");
    act(() => { vi.advanceTimersByTime(400); });
    expect(slot(container, 1)?.dataset.status).toBe("resolving");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.querySelector("[data-chain-link]")).toBeNull();
  });

  it("marks a negated link, on its badge and on its off-board row", () => {
    const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0)), ev("chain-negated", 1)];
    const { container } = render(view(events));
    expect(slot(container, 1)?.dataset.negated).toBe("true");
    expect(container.querySelector('[data-chain-row="1"]')?.getAttribute("data-negated")).toBe("true");
    expect(slot(container, 2)?.dataset.negated).toBe("false");
  });

  it("restarts from the live state when the room changes", () => {
    const events = [activate(1, 0, 11, z(0, SZONE, 0))];
    const { container, rerender } = render(view(events));
    expect(slot(container, 1)).not.toBeNull();
    rerender(<ChainFx events={[]} chain={[]} duelKey="other" reducedMotion={false} mySeat={0} playerName={names} />);
    expect(container.querySelector("[data-chain-link]")).toBeNull();
  });

  it("keeps clicks free: the layer has no pointer handlers and is hidden from assistive tech", () => {
    const events = [activate(1, 0, 11, z(0, SZONE, 0))];
    const { container } = render(view(events));
    const layer = container.querySelector("[data-chain-fx]") as HTMLElement;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
  });

  describe("one view", () => {
    const stack = () => [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))];

    it("shows a link whose card is on the board as a badge only, with no strip", () => {
      placeZones("0:8:0", "1:8:0");
      const { container } = render(view(stack()));
      expect(slot(container, 1)?.dataset.placed).toBe("true");
      expect(slot(container, 2)?.dataset.placed).toBe("true");
      expect(container.querySelector("[data-chain-panel]")).toBeNull();
      expect(rows(container)).toHaveLength(0);
    });

    it("lists only the link the board cannot place, and hides that link's badge", () => {
      placeZones("1:8:0");
      const { container } = render(view(stack()));
      expect(slot(container, 2)?.dataset.placed).toBe("true");
      expect(slot(container, 1)?.dataset.placed).toBe("false");
      expect(rows(container).map((r) => (r as HTMLElement).dataset.chainRow)).toEqual(["1"]);
    });

    it("shows a lone link as one badge, no strip", () => {
      placeZones("0:8:0");
      const { container } = render(view([stack()[0]]));
      expect(container.querySelectorAll("[data-chain-link]")).toHaveLength(1);
      expect(slot(container, 1)?.textContent).toContain("1");
      expect(container.querySelector("[data-chain-panel]")).toBeNull();
    });

    it("draws one badge per link number, even when the same card chains twice and the snapshot repeats a link", () => {
      placeZones("0:8:0", "1:8:0");
      const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0)), activate(3, 0, 11, z(0, SZONE, 0))];
      const chain: DuelChainLink[] = [
        { index: 1, seat: 0, code: 11, name: "Card 11" },
        { index: 2, seat: 1, code: 22, name: "Card 22" },
        { index: 2, seat: 1, code: 22, name: "Card 22" },
        { index: 3, seat: 0, code: 11, name: "Card 11" },
      ];
      const { container } = render(view(events, chain));
      const numbers = [...container.querySelectorAll("[data-chain-link]")].map((el) => (el as HTMLElement).dataset.chainLink);
      expect(numbers).toEqual(["1", "2", "3"]);
      expect(rows(container)).toHaveLength(0);
    });

    it("no longer renders the old chain list in the room", () => {
      const room = readFileSync(join(import.meta.dirname, "../../src/components/duel/room.tsx"), "utf8");
      expect(room).not.toMatch(/ChainBlock/);
      expect(room).not.toMatch(/aria-label="Current chain"/);
      expect(room.match(/<ChainFx\b/g)).toHaveLength(1);
    });
  });

  describe("badge", () => {
    it("is a numbered medallion with a chain glyph, and the highest link is the top one", () => {
      placeZones("0:8:0", "1:8:0");
      const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))];
      const { container } = render(view(events));
      for (const n of [1, 2]) {
        const el = slot(container, n)!;
        expect(el.querySelector("svg")).not.toBeNull();
        expect(el.querySelector("[data-chain-num]")?.textContent).toBe(String(n));
        expect(el.style.zIndex).toBe(String(n));
      }
      expect(slot(container, 1)?.dataset.top).toBe("false");
      expect(slot(container, 2)?.dataset.top).toBe("true");
    });

    it("moves the top mark up when a response comes in", () => {
      placeZones("0:8:0", "1:8:0");
      const first = [activate(1, 0, 11, z(0, SZONE, 0))];
      const { container, rerender } = render(view(first));
      expect(slot(container, 1)?.dataset.top).toBe("true");
      rerender(view([...first, activate(2, 1, 22, z(1, SZONE, 0))]));
      act(() => { vi.advanceTimersByTime(0); });
      expect(slot(container, 1)?.dataset.top).toBe("false");
      expect(slot(container, 2)?.dataset.top).toBe("true");
    });
  });

  describe("chain wire", () => {
    const stack = () => [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))];
    const wires = (c: HTMLElement) => [...c.querySelectorAll("[data-chain-wire]")] as SVGPathElement[];

    it("joins badge N to badge N-1 and starts at link 2", () => {
      placeZones("0:8:0", "1:8:0");
      const { container } = render(view(stack()));
      expect(wires(container).map((w) => w.dataset.chainWire)).toEqual(["2"]);
      expect(wires(container)[0].getAttribute("d")).toMatch(/^M[-\d. ]+Q[-\d. ]+$/);
    });

    it("draws no line when a badge has no place on the board", () => {
      placeZones("1:8:0");
      const { container } = render(view(stack()));
      expect(wires(container)[0]?.getAttribute("d") ?? null).toBeNull();
    });

    it("is left out on reduced motion", () => {
      placeZones("0:8:0", "1:8:0");
      const { container } = render(view(stack(), [], 0, true));
      expect(wires(container)).toHaveLength(0);
    });

    it("never takes pointer input", () => {
      placeZones("0:8:0", "1:8:0");
      const { container } = render(view(stack()));
      expect((container.querySelector("[data-chain-fx]") as HTMLElement).getAttribute("aria-hidden")).toBe("true");
      expect(container.querySelector("svg[data-chain-wires]")?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("screen reader", () => {
    const stack = () => [activate(1, 0, 11, z(0, SZONE, 0)), { ...activate(2, 1, 22, z(1, SZONE, 0)), description: "Negate it" }];
    const srItems = (c: HTMLElement) => [...c.querySelectorAll("[data-chain-sr-link]")].map((el) => el.textContent);

    it("keeps a hidden list of every link, in chain order, outside the aria-hidden layer", () => {
      placeZones("0:8:0", "1:8:0");
      const { container } = render(view(stack()));
      expect(srItems(container)).toEqual(["Chain Link 1: Card 11, You", "Chain Link 2: Card 22, Opponent. Negate it"]);
      const list = container.querySelector("[data-chain-sr-list]") as HTMLElement;
      expect(list.getAttribute("aria-label")).toBe("Current chain");
      expect(list.closest('[aria-hidden="true"]')).toBeNull();
    });

    it("announces a new link, a resolving link and the end of the chain", () => {
      placeZones("0:8:0", "1:8:0");
      const live = (c: HTMLElement) => c.querySelector("[data-chain-live]") as HTMLElement;
      const first = [activate(1, 0, 11, z(0, SZONE, 0))];
      const { container, rerender } = render(view(first));
      expect(live(container).getAttribute("aria-live")).toBe("polite");
      const second = [...first, activate(2, 1, 22, z(1, SZONE, 0))];
      rerender(view(second));
      act(() => { vi.advanceTimersByTime(0); });
      expect(live(container).textContent).toBe("Chain Link 2: Card 22, Opponent");
      const resolution = [...second, ev("chain-resolving", 2), ev("chain-resolved", 2), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")];
      rerender(view(resolution));
      act(() => { vi.advanceTimersByTime(1000); });
      expect(live(container).textContent).toBe("Chain Link 2 resolving: Card 22, Opponent");
      act(() => { vi.advanceTimersByTime(5000); });
      expect(live(container).textContent).toBe("Chain ended");
      expect(container.querySelector("[data-chain-sr-list]")).toBeNull();
    });
  });
});
