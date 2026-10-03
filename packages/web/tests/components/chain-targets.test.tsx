// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelChainLink, DuelEvent } from "@yugidraft/shared/duels";
import { applyChainEvent, chainStateKey, deriveChainState } from "@/components/duel/chain-state";
import { ChainFx } from "@/components/duel/chain-fx";

const source = { controller: 0, location: 8, sequence: 0 };
const target = { controller: 1, location: 8, sequence: 0 };
const chain: DuelChainLink[] = [{ index: 1, seat: 0, code: 5318639, name: "MST", zone: source, targets: [target] }];
const activation: DuelEvent = { id: 1, kind: "activate", chainIndex: 1, seat: 0, text: "MST is activating", zone: source };
const targeting: DuelEvent = { id: 2, kind: "target", chainIndex: 1, seat: 0, text: "Chain Link 1 targets 1 card", targets: [target] };
const names = (seat: number) => `Player ${seat + 1}`;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("chain target state and markers", () => {
  it("retains the public target event without needing a snapshot", () => {
    const state = deriveChainState([activation, targeting]);
    expect(state.links[0].targets).toEqual([target]);
    const before = JSON.stringify(state);
    const cleared = applyChainEvent(state, { ...targeting, id: 3, targets: [] });
    expect(cleared.links[0].targets).toEqual([]);
    expect(chainStateKey(cleared)).not.toBe(chainStateKey(state));
    expect(JSON.stringify(state)).toBe(before);
  });

  it("reconciles changed and cleared snapshot targets even when the activation is already known", () => {
    const moved = { controller: 1, location: 16, sequence: 1 };
    expect(deriveChainState([activation, targeting], [{ ...chain[0], targets: [moved] }]).links[0].targets).toEqual([moved]);
    expect(deriveChainState([activation, targeting], [{ ...chain[0], targets: [] }]).links[0].targets).toEqual([]);
    expect(deriveChainState([], chain).links[0].zone).toEqual(source);
  });

  it.each([0, 1, null])("describes the target coordinates for viewer %s without inventing a card identity", (mySeat) => {
    const { container } = render(<ChainFx events={[activation, targeting]} chain={chain} duelKey="labels"
      reducedMotion mySeat={mySeat} playerName={names} />);
    const label = screen.getByRole("list", { name: "Current chain" }).textContent;
    expect(label).toContain(mySeat === 1 ? "your Spell & Trap Zone 1" : mySeat === 0 ? "opponent's Spell & Trap Zone 1" : "Player 2's Spell & Trap Zone 1");
    expect(label).not.toContain("Mirror Force");
    expect(container.querySelector('[data-chain-target="1"][data-target-zone="1:8:0"]')).toBeInTheDocument();
  });

  it("places a persistent target ring and link, updates during a response, then clears on chain end", () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const [left, top, width, height] = this.dataset.zones === "1:8:0" ? [200, 100, 60, 80]
        : this.dataset.zones === "0:8:0" ? [100, 400, 60, 80] : [0, 0, 900, 600];
      return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
    });
    const board = (events: DuelEvent[], snapshot: DuelChainLink[]) => <div>
      <div data-zones="0:8:0" /><div data-zones="1:8:0" />
      <ChainFx events={events} chain={snapshot} duelKey="markers" reducedMotion={false} mySeat={1} playerName={names} />
    </div>;
    const { container, rerender } = render(board([activation], [{ ...chain[0], targets: [] }]));
    rerender(board([activation, targeting], chain));
    const mark = () => container.querySelector('[data-chain-target="1"]') as HTMLElement | null;
    expect(mark()?.dataset.placed).toBe("true");
    expect(mark()?.style.translate).toBe("200px 100px");
    expect(container.querySelector('[data-chain-target-wire="1"]')?.getAttribute("d")).toMatch(/^M/);
    expect(screen.getByRole("status").textContent).toContain("targets your Spell & Trap Zone 1");
    act(() => { vi.advanceTimersByTime(10000); });
    expect(mark()?.dataset.placed).toBe("true");
    rerender(board([activation, targeting], [{ ...chain[0], targets: [] }]));
    expect(mark()).toBeNull();
    rerender(board([activation, targeting, { id: 3, kind: "chain-end", text: "Chain ended" }], []));
    act(() => { vi.advanceTimersByTime(10000); });
    expect(mark()).toBeNull();
  });

  it("clears live targets at chain end while the historical resolution badges are still playing", () => {
    vi.useFakeTimers();
    const view = (events: DuelEvent[], snapshot: DuelChainLink[]) => <ChainFx events={events} chain={snapshot}
      duelKey="live-targets" reducedMotion={false} mySeat={1} playerName={names} />;
    const { container, rerender } = render(view([activation, targeting], chain));
    expect(container.querySelector("[data-chain-target]")).toBeInTheDocument();
    rerender(view([activation, targeting,
      { id: 3, kind: "chain-resolving", chainIndex: 1, text: "Resolving" },
      { id: 4, kind: "chain-resolved", chainIndex: 1, text: "Resolved" },
      { id: 5, kind: "chain-end", text: "Chain ended" }], []));
    expect(container.querySelector("[data-chain-link]")).toBeInTheDocument();
    expect(container.querySelector("[data-chain-target]")).toBeNull();
  });
});
