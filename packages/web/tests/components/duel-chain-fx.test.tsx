// @vitest-environment jsdom
import React from "react";
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
const view = (events: DuelEvent[], chain: DuelChainLink[] = [], mySeat: number | null = 0) => (
  <ChainFx events={events} chain={chain} duelKey="t" reducedMotion={false} mySeat={mySeat} playerName={names} />
);

const rows = (c: HTMLElement) => [...c.querySelectorAll("[data-chain-row]")];
const slot = (c: HTMLElement, n: number) => c.querySelector(`[data-chain-link="${n}"]`) as HTMLElement | null;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChainFx", () => {
  it("renders nothing for an empty chain", () => {
    const { container } = render(view([]));
    expect(container.querySelector("[data-chain-link]")).toBeNull();
    expect(container.querySelector("[data-chain-panel]")).toBeNull();
  });

  it("starts from the live chain on first paint: badges, and a panel for a lone pending link", () => {
    const events = [activate(1, 1, 11, z(1, SZONE, 2))];
    const { container } = render(view(events, [{ index: 1, seat: 1, code: 11, name: "Card 11" }]));
    expect(slot(container, 1)?.textContent).toBe("1");
    expect(slot(container, 1)?.dataset.status).toBe("pending");
    expect(rows(container)).toHaveLength(1);
    expect(rows(container)[0].textContent).toContain("Card 11");
    expect(rows(container)[0].textContent).toContain("Opponent");
  });

  it("lists the panel bottom-up and labels you / opponent", () => {
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
    act(() => { vi.advanceTimersByTime(800); });
    expect(slot(container, 2)?.dataset.status).toBe("resolving");
    expect(slot(container, 1)?.dataset.status).toBe("pending");
    expect(container.querySelector('[data-chain-row="2"]')?.getAttribute("data-status")).toBe("resolving");

    act(() => { vi.advanceTimersByTime(800); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(slot(container, 1)?.dataset.status).toBe("resolving");
    expect(slot(container, 2)?.dataset.status).toBe("resolved");

    act(() => { vi.advanceTimersByTime(5000); });
    expect(container.querySelector("[data-chain-link]")).toBeNull();
    expect(container.querySelector("[data-chain-panel]")).toBeNull();
  });

  it("marks a negated link and strikes it in the panel", () => {
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
});
