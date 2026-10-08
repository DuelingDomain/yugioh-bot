// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

import { ChainFx } from "@/components/duel/chain-fx";
import { CHAIN_TIMING } from "@/components/duel/duel-timing";

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
const hero = (c: HTMLElement) => c.querySelector("[data-chain-hero]") as HTMLElement | null;
const openSheet = (c: HTMLElement) => {
  act(() => { fireEvent.click(c.querySelector("[data-chain-strip]") as HTMLElement); });
  return c.querySelector("[data-chain-sheet]") as HTMLElement;
};
const slot = (c: HTMLElement, n: number) => c.querySelector(`[data-chain-link="${n}"]`) as HTMLElement | null;

/** Puts a card on the board: a zone element jsdom can measure. */
const BOXES: Record<string, [number, number, number, number]> = {
  "0:8:0": [340, 400, 60, 80],
  "1:8:0": [340, 100, 60, 80],
  "1:8:1": [460, 100, 60, 80],
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
  it("keeps table responder order visible when every chain link is on the board", () => {
    placeZones("0:8:0", "1:8:0");
    const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))];
    const chain: DuelChainLink[] = [{ index: 1, seat: 0, code: 11 }, { index: 2, seat: 1, code: 22 }];
    const priority = [{ seat: 0, choosing: true }, { seat: 1, choosing: false }, { seat: 2, choosing: false }];
    const { container } = render(<ChainFx events={events} chain={chain} duelKey="t" reducedMotion mySeat={0} playerName={names} priority={priority} />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(rows(container).map((r) => (r as HTMLElement).dataset.chainRow)).toEqual(["2", "1"]);
    const chips = [...container.querySelectorAll("[data-chain-panel] [data-testid='priority-chips'] [data-seat]")];
    expect(chips.map((chip) => chip.getAttribute("data-seat"))).toEqual(["0", "1", "2"]);
    expect(chips[0].getAttribute("data-now")).toBe("true");
  });

  it("clears the chain when the duel ends in the middle of it", () => {
    placeZones("0:8:0");
    const events = [activate(1, 0, 11, z(0, SZONE, 0))];
    const chain: DuelChainLink[] = [{ index: 1, seat: 0, code: 11 }];
    const { container, rerender } = render(<ChainFx events={events} chain={chain} duelKey="t" reducedMotion mySeat={0} playerName={names} />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(hero(container)).not.toBeNull();
    // No "chain-end" arrives: the result alone clears the panel (no recap), the badges and the rings.
    rerender(<ChainFx events={events} chain={chain} duelKey="t" reducedMotion mySeat={0} playerName={names} ended />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(hero(container)).toBeNull();
    expect(container.querySelector("[data-chain-link]")).toBeNull();
    expect(container.querySelector("[data-chain-card]")).toBeNull();
    expect(container.querySelector("[data-chain-panel]")).toBeNull();
  });

  it("renders nothing for an empty chain", () => {
    const { container } = render(view([]));
    expect(container.querySelector("[data-chain-link]")).toBeNull();
    expect(container.querySelector("[data-chain-panel]")).toBeNull();
  });

  it("starts from the live chain on first paint: a badge, and the panel", () => {
    const events = [activate(1, 1, 11, z(1, SZONE, 2))];
    const { container } = render(view(events, [{ index: 1, seat: 1, code: 11, name: "Card 11" }]));
    expect(slot(container, 1)?.querySelector("[data-chain-num]")?.textContent).toBe("1");
    expect(slot(container, 1)?.dataset.status).toBe("pending");
    // A chain of one has a hero and no stack.
    expect(rows(container)).toHaveLength(0);
    expect(hero(container)?.textContent).toContain("Card 11");
    expect(hero(container)?.textContent).toContain("Opponent");
  });

  it("names the owner of each link and tones its row when the table gives seat tones", () => {
    const events = [activate(1, 1, 11, z(1, SZONE, 2)), activate(2, 2, 12, z(2, SZONE, 0))];
    const chain: DuelChainLink[] = [{ index: 1, seat: 1, code: 11, name: "Card 11" }, { index: 2, seat: 2, code: 12, name: "Card 12" }];
    const tones = new Map([[0, { main: "#9b7eff", ink: "#c6b6ff" }], [1, { main: "#5cb8f5", ink: "#a9dcfb" }], [2, { main: "#8fd36b", ink: "#c4ecad" }]]);
    const { container } = render(<ChainFx events={events} chain={chain} duelKey="t" reducedMotion mySeat={0} playerName={names} seatTones={tones} />);
    const panel = container.querySelector("[data-chain-panel]") as HTMLElement;
    // The hero is the newest link (seat 2) and names its owner; no row says "Opponent" at a table.
    expect(hero(container)?.textContent).toContain("Player 3");
    expect(panel.textContent).not.toContain("Opponent");
    const row = container.querySelector('[data-chain-row="2"]') as HTMLElement;
    expect(row.style.getPropertyValue("--seat-main")).toBe("#8fd36b");
    expect(row.getAttribute("data-toned")).toBe("true");
  });

  it("lists the off-board rows top of the chain first and labels you / opponent", () => {
    const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, HAND, 1))];
    const { container } = render(view(events));
    expect(rows(container).map((r) => (r as HTMLElement).dataset.chainRow)).toEqual(["2", "1"]);
    expect(rows(container)[0].textContent).toContain("Card 22");
    expect(rows(container)[1].textContent).toContain("Card 11");
    // The hero is the newest link, owned by the opponent.
    expect(hero(container)?.textContent).toContain("Opponent");
    expect(hero(container)?.textContent).toContain("Card 22");
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
    act(() => { vi.advanceTimersByTime(CHAIN_TIMING.activateMs); });
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
    // The badges are gone with the chain; the panel stays for its recap, then leaves.
    expect(container.querySelector("[data-chain-panel]")).not.toBeNull();
    expect(container.querySelector("[data-chain-front]")?.getAttribute("data-recap")).toBe("true");
    act(() => { vi.advanceTimersByTime(3300); });
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

    it("shows a link whose card is on the board as a badge and as a stack row, the top of the chain first", () => {
      placeZones("0:8:0", "1:8:0");
      const { container } = render(view(stack()));
      expect(slot(container, 1)?.dataset.placed).toBe("true");
      expect(slot(container, 2)?.dataset.placed).toBe("true");
      expect(container.querySelector("[data-chain-panel]")).not.toBeNull();
      expect(rows(container).map((r) => (r as HTMLElement).dataset.chainRow)).toEqual(["2", "1"]);
    });

    it("keeps the stack row of a link the board cannot place, and hides that link's badge", () => {
      placeZones("1:8:0");
      const { container } = render(view(stack()));
      expect(slot(container, 2)?.dataset.placed).toBe("true");
      expect(slot(container, 1)?.dataset.placed).toBe("false");
      expect(rows(container).map((r) => (r as HTMLElement).dataset.chainRow)).toEqual(["2", "1"]);
    });

    it("shows a lone link as one badge and a hero with no stack", () => {
      placeZones("0:8:0");
      const { container } = render(view([stack()[0]]));
      expect(container.querySelectorAll("[data-chain-link]")).toHaveLength(1);
      expect(slot(container, 1)?.querySelector("[data-chain-num]")?.textContent).toBe("1");
      expect(rows(container)).toHaveLength(0);
      expect(hero(container)).not.toBeNull();
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
      expect(rows(container).map((r) => (r as HTMLElement).dataset.chainRow)).toEqual(["3", "2", "1"]);
    });

    it("no longer renders the old chain list in the room", () => {
      const room = readFileSync(join(import.meta.dirname, "../../src/components/duel/room.tsx"), "utf8");
      expect(room).not.toMatch(/ChainBlock/);
      expect(room).not.toMatch(/aria-label="Current chain"/);
      expect(room.match(/<ChainFx\b/g)).toHaveLength(1);
    });
  });

  describe("stack and callout", () => {
    const dust = (): DuelEvent => ({
      id: id++, kind: "activate", text: "a", seat: 0, chainIndex: 1, zone: z(0, 0x04, 2),
      card: { ...info(89111398), name: "Dark Dust Spirit" }, description: "Destroy all other face-up monsters",
    });
    const shield = (): DuelEvent => ({
      id: id++, kind: "activate", text: "a", seat: 1, chainIndex: 2, zone: z(1, SZONE, 0),
      card: { ...info(69279219), name: "My Body as a Shield" },
    });

    it("puts the badges and the stack in the front layer and the ring and glow in the back one", () => {
      placeZones("0:8:0", "1:8:0");
      const { container } = render(view([activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))]));
      const back = container.querySelector("[data-chain-fx]") as HTMLElement;
      const front = container.querySelector("[data-chain-front]") as HTMLElement;
      expect(front).not.toBeNull();
      expect(front.contains(container.querySelector("[data-chain-panel]"))).toBe(true);
      expect(front.querySelectorAll("[data-chain-link]")).toHaveLength(2);
      expect(back.querySelectorAll("[data-chain-link]")).toHaveLength(0);
      expect(back.querySelectorAll("[data-chain-card]")).toHaveLength(2);
      expect(back.contains(container.querySelector("[data-chain-panel]"))).toBe(false);
    });

    it("shows the callout for the newest activation, with the owner, the card and the effect text", () => {
      placeZones("0:4:2");
      const { container } = render(view([dust()]));
      const callout = container.querySelector('[data-chain-callout="1"]') as HTMLElement;
      expect(callout.textContent).toBe("Chain 1Dark Dust Spiritactivates its effect");
      const panel = hero(container) as HTMLElement;
      expect(panel.textContent).toContain("Dark Dust Spirit");
      expect(panel.textContent).toContain("You");
      // The engine's own string for the activation, captioned Effect.
      expect(panel.querySelector("[data-chain-effect]")?.textContent).toBe("EffectDestroy all other face-up monsters");
      expect(panel.querySelector("[data-chain-effect]")?.getAttribute("data-chain-effect")).toBe("string");
    });

    it("moves the callout to the response and lists both links, top first", () => {
      placeZones("0:4:2", "1:8:0");
      const { container } = render(view([dust(), shield()]));
      expect(container.querySelector('[data-chain-callout="1"]')).toBeNull();
      expect((container.querySelector('[data-chain-callout="2"]') as HTMLElement).textContent).toContain("My Body as a Shield");
      const text = rows(container).map((r) => r.textContent ?? "");
      expect(text[0]).toContain("My Body as a Shield");
      expect(text[1]).toContain("Dark Dust Spirit");
      // The hero is the newest link and says who owns it; a waiting link below it keeps its effect on its row.
      expect(hero(container)?.textContent).toContain("Opponent");
      expect(text[1]).toContain("Destroy all other face-up monsters");
      expect(text[0]).not.toContain("Destroy");
    });

    it("shows the public targets of a link in the hero, from coordinates when no name is public", () => {
      placeZones("0:4:2", "1:8:0");
      const first = dust();
      const withTarget = { ...shield(), targets: [z(0, SZONE, 5)] } as DuelEvent;
      const { container } = render(view([first, withTarget]));
      expect(container.querySelector("[data-chain-hero-targets]")?.textContent).toContain("your Field Zone");
      // The rows carry no targets, and no card is named when the board shows none.
      expect(rows(container)[1].textContent).not.toContain("Field Zone");
      expect(container.querySelector("[data-chain-hero-targets] b")?.textContent).toBe("your Field Zone");
    });

    it("names a target place by its owner: a rival by name at a table, the partner as partner's on Tag", () => {
      placeZones("0:4:2", "1:8:0");
      const first = dust();
      const withTarget = { ...shield(), targets: [z(2, SZONE, 5), z(1, SZONE, 5)] } as DuelEvent;
      const tones = new Map([0, 1, 2, 3].map((seat) => [seat, { main: "#fff", ink: "#000" }] as const));
      const ffa = render(<ChainFx events={[first, withTarget]} chain={[]} duelKey="t" reducedMotion={false} mySeat={0} playerName={names} seatTones={tones} table="ffa4" />);
      // A table always uses the strip: the panel opens as a sheet.
      expect(ffa.container.querySelector("[data-chain-hero]")).toBeNull();
      expect(openSheet(ffa.container).querySelector("[data-chain-hero-targets]")?.textContent).toContain("Player 3's Field Zone");
      expect(ffa.container.querySelector("[data-chain-hero-targets]")?.textContent).toContain("Player 2's Field Zone");
      ffa.unmount();
      const tag = render(<ChainFx events={[first, withTarget]} chain={[]} duelKey="t2" reducedMotion={false} mySeat={0} playerName={names} seatTones={tones} table="tag" />);
      expect(openSheet(tag.container).querySelector("[data-chain-hero-targets]")?.textContent).toContain("partner's Field Zone");
      expect(tag.container.querySelector("[data-chain-hero-targets]")?.textContent).toContain("Player 2's Field Zone");
    });

    it("closes the sheet on Esc and marks the key as used, so the camera does not also act on it", () => {
      const { container } = render(<ChainFx events={[dust(), shield()]} chain={[]} duelKey="t" reducedMotion={false} mySeat={0} playerName={names} table="tag" />);
      expect(openSheet(container)).not.toBeNull();
      const key = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
      act(() => { document.dispatchEvent(key); });
      expect(key.defaultPrevented).toBe(true);
      expect(container.querySelector("[data-chain-sheet]")).toBeNull();
    });

    it("highlights each row as it resolves, then clears the panel after its recap", () => {
      placeZones("0:4:2", "1:8:0");
      const first = [dust(), shield()];
      const { container, rerender } = render(view(first));
      rerender(view([...first, ev("chain-resolving", 2), ev("chain-resolved", 2), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")]));
      // Play the chain out in small steps and write down which row is highlighted at each step.
      const seen: string[] = [];
      for (let t = 0; t < 8000; t += 100) {
        act(() => { vi.advanceTimersByTime(100); });
        const now = rows(container).filter((r) => (r as HTMLElement).dataset.status === "resolving").map((r) => (r as HTMLElement).dataset.chainRow);
        const head = now.length > 0 ? now[0]! : "-";
        if (seen[seen.length - 1] !== head) seen.push(head);
        if (container.querySelector("[data-chain-panel]") == null) break;
        if (head === "2") expect((container.querySelector('[data-chain-row="2"]') as HTMLElement).dataset.focus).toBe("true");
      }
      // Link 2 resolves first, then link 1, and only one row is highlighted at a time.
      expect(seen.filter((x) => x !== "-")).toEqual(["2", "1"]);
      act(() => { vi.advanceTimersByTime(8000); });
      expect(container.querySelector("[data-chain-panel]")).toBeNull();
      expect(rows(container)).toHaveLength(0);
      expect(container.querySelector("[data-chain-callout]")).toBeNull();
    });

    it("shows a link whose card the engine did not name as A card, with no art and no text", () => {
      const { container } = render(view([], [{ index: 1, seat: 1 }]));
      expect(hero(container)?.textContent).toContain("A card");
      expect(hero(container)?.textContent).toContain("Opponent");
      expect(hero(container)?.querySelector("[data-chain-art]")).toBeNull();
      expect(hero(container)?.querySelector("[data-chain-effect]")).toBeNull();
    });

    it("still shows the panel on reduced motion", () => {
      placeZones("0:4:2");
      const { container } = render(view([dust()], [], 0, true));
      expect(hero(container)).not.toBeNull();
      expect(container.querySelector("[data-chain-front]")?.getAttribute("data-reduced")).toBe("true");
    });

    it("names the owner by player name in a table, never 'Opponent'", () => {
      const tones = new Map([[0, { main: "#9b7eff", ink: "#c6b6ff" }], [1, { main: "#5cb8f5", ink: "#a9dcfb" }]]);
      const { container } = render(<ChainFx events={[dust(), shield()]} chain={[]} duelKey="t" reducedMotion mySeat={0} playerName={names} seatTones={tones} />);
      expect(hero(container)?.textContent).toContain("Player 2");
      expect(hero(container)?.textContent).not.toContain("Opponent");
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

  describe("layout reads", () => {
    it("reads the layout first and writes after, in every frame, without a selector lookup", () => {
      placeZones("0:8:0", "1:8:0");
      const events = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))];
      const log: string[] = [];
      const frame = window.requestAnimationFrame;
      window.requestAnimationFrame = (cb) => frame((t) => { log.push("frame"); cb(t); });
      const rect = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) { log.push("read"); return rect.call(this); };
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { log.push("read"); return 120; } });
      const setProperty = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, ...args: Parameters<typeof setProperty>) { log.push("write"); return setProperty.apply(this, args); };
      const lookup = vi.spyOn(HTMLElement.prototype, "querySelector");
      try {
        const { container } = render(<ChainFx events={events} chain={[]} duelKey="t" reducedMotion mySeat={0} playerName={names} />);
        log.length = 0;
        lookup.mockClear();
        // Move a card between frames so the second frame has writes too.
        act(() => { vi.advanceTimersByTime(40); });
        BOXES["0:8:0"] = [120, 410, 60, 80];
        act(() => { vi.advanceTimersByTime(40); });
        expect(log.filter((entry) => entry === "frame").length).toBeGreaterThan(2);
        expect(log).toContain("write");
        let wrote = false;
        for (const entry of log) {
          if (entry === "frame") wrote = false;
          else if (entry === "write") wrote = true;
          else expect(wrote, "a layout read came after a style write in the same frame").toBe(false);
        }
        expect(lookup.mock.calls.filter(([selector]) => String(selector).includes("data-chain"))).toEqual([]);
        expect(container.querySelector("[data-chain-link]")).not.toBeNull();
      } finally {
        window.requestAnimationFrame = frame;
        HTMLElement.prototype.getBoundingClientRect = rect;
        CSSStyleDeclaration.prototype.setProperty = setProperty;
        delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
        BOXES["0:8:0"] = [340, 400, 60, 80];
      }
    });
  });

  describe("screen reader", () => {
    const stack = () => [activate(1, 0, 11, z(0, SZONE, 0)), { ...activate(2, 1, 22, z(1, SZONE, 0)), description: "Negate it" }];
    const srItems = (c: HTMLElement) => [...c.querySelectorAll("[data-chain-sr-link]")].map((el) => el.textContent);

    it("keeps a hidden list of every link, in chain order, outside the aria-hidden layer, while the strip shows", () => {
      placeZones("0:8:0", "1:8:0");
      const { container } = render(<ChainFx events={stack()} chain={[]} duelKey="t" reducedMotion={false} mySeat={0} playerName={names} table="ffa4" />);
      expect(srItems(container)).toEqual(["Chain Link 1: Card 11, You", "Chain Link 2: Card 22, Opponent. Negate it"]);
      const list = container.querySelector("[data-chain-sr-list]") as HTMLElement;
      expect(list.getAttribute("aria-label")).toBe("Current chain");
      expect(list.closest('[aria-hidden="true"]')).toBeNull();
    });

    it("drops the list while a column shows (its rows are buttons), but keeps the live region", () => {
      placeZones("0:8:0", "1:8:0");
      const { container } = render(view(stack()));
      expect(container.querySelector("[data-chain-panel]")?.closest('[aria-hidden="true"]')).toBeNull();
      expect(container.querySelector("[data-chain-sr-list]")).toBeNull();
      expect(container.querySelector("[data-chain-live]")).not.toBeNull();
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
      act(() => { vi.advanceTimersByTime(CHAIN_TIMING.activateMs); });
      expect(live(container).textContent).toBe("Chain Link 2 resolving: Card 22, Opponent");
      act(() => { vi.advanceTimersByTime(5000); });
      expect(live(container).textContent).toBe("Chain ended");
      expect(container.querySelector("[data-chain-sr-list]")).toBeNull();
    });
  });
});
