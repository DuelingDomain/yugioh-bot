// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

import { ChainFx } from "@/components/duel/chain-fx";

const SZONE = 0x08;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const info = (code: number): DuelCardInfo => ({
  code, name: `Card ${code}`, description: "", type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "Warrior",
});
let id = 500;
const activate = (chainIndex: number, seat: number, code: number, zone: DuelZoneRef): DuelEvent => ({
  id: id++, kind: "activate", text: "a", seat, card: info(code), chainIndex, zone,
});
const names = (seat: number) => `Player ${seat + 1}`;
const css = (file: string) => readFileSync(join(__dirname, "../../src/components/duel", file), "utf8");

const EVENTS = [activate(1, 0, 11, z(0, SZONE, 0)), activate(2, 1, 22, z(1, SZONE, 0))];
const CHAIN: DuelChainLink[] = [{ index: 1, seat: 0, code: 11 }, { index: 2, seat: 1, code: 22 }];

/**
 * A multi-seat table in miniature: the duel root holds a board, the board holds the fx slot (ChainFx) and a
 * prompt slot after it. Each slot is its own stacking context in the real table, so the chain's front layer must
 * not live in either.
 */
function Table({ withRoot = true, table }: { withRoot?: boolean; table?: string }) {
  const board = (
    <div data-board data-format={table}>
      <div data-slot="fx">
        <ChainFx events={EVENTS} chain={CHAIN} duelKey="t" reducedMotion mySeat={0} playerName={names} table={table} />
      </div>
      <div data-slot="prompt"><div data-prompt-panel>Activate its effect?</div></div>
    </div>
  );
  return withRoot ? <div data-duel-fx-speed-root data-testid="root">{board}</div> : board;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    let box = [0, 0, 0, 0];
    if (this.dataset.zones === "0:8:0") box = [100, 400, 60, 80];
    else if (this.dataset.zones === "1:8:0") box = [100, 100, 60, 80];
    else if (this.hasAttribute("data-duel-fx-speed-root")) box = [20, 10, 1000, 700];
    else if (this.hasAttribute("data-chain-fx") || this.hasAttribute("data-board")) box = [120, 60, 900, 600];
    const [left, top, width, height] = box;
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
  for (const key of ["0:8:0", "1:8:0"]) {
    const el = document.createElement("div");
    el.dataset.zones = key;
    document.body.appendChild(el);
  }
});
afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-zones]").forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("chain front layer stacking", () => {
  it("renders the front layer in the duel root, after the prompt slot, outside every stacking slot", () => {
    const { container, getByTestId } = render(<Table table="ffa3" />);
    const root = getByTestId("root");
    const front = container.ownerDocument.querySelector("[data-chain-front]") as HTMLElement;
    const back = root.querySelector("[data-slot='fx'] [data-chain-fx='true']") as HTMLElement;
    const prompt = root.querySelector("[data-slot='prompt']") as HTMLElement;
    expect(front).not.toBeNull();
    expect(back).not.toBeNull();
    // The front layer is a child of the root: no slot (a stacking context at z 50) holds it.
    expect(front.parentElement).toBe(root);
    expect(front.closest("[data-slot]")).toBeNull();
    // The slot of the prompt comes first in the tree, then the chain layer.
    expect(prompt.compareDocumentPosition(front) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The rings, glow and wires stay in the fx slot, under the prompt.
    expect(back.querySelector("[data-chain-card]")).not.toBeNull();
    expect(back.querySelector("[data-chain-link]")).toBeNull();
    expect(front.querySelector("[data-chain-link]")).not.toBeNull();
    expect(front.querySelector("[data-chain-panel]")).not.toBeNull();
  });

  it("keeps the chain chips findable under [data-chain-fx], as the Tag contract needs", () => {
    const priority = [{ seat: 0, choosing: true }, { seat: 1, choosing: false }];
    const { getByTestId } = render(
      <div data-duel-fx-speed-root data-testid="root">
        <ChainFx events={EVENTS} chain={CHAIN} duelKey="t" reducedMotion mySeat={0} playerName={names} priority={priority} table="tag" />
      </div>,
    );
    const chips = getByTestId("root").querySelectorAll("[data-chain-fx] [data-testid='priority-chips'] [data-seat]");
    expect(chips).toHaveLength(2);
  });

  it("puts the layer over the board box, wherever the board sits in the root", () => {
    const { getByTestId } = render(<Table table="ffa4" />);
    act(() => { vi.advanceTimersByTime(60); });
    const front = getByTestId("root").querySelector("[data-chain-front]") as HTMLElement;
    // Board at (120, 60) 900x600, root at (20, 10): the layer sits at (100, 50).
    expect(front.style.translate).toBe("100px 50px");
    expect(front.style.width).toBe("900px");
    expect(front.style.height).toBe("600px");
    expect(front.dataset.portal).toBe("true");
    expect(front.dataset.table).toBe("ffa4");
  });

  it("stays in place when there is no duel root (a bare mount)", () => {
    const { container } = render(<Table withRoot={false} />);
    const front = container.querySelector("[data-chain-front]") as HTMLElement;
    expect(front.closest("[data-slot='fx']")).not.toBeNull();
    expect(front.dataset.portal).toBeUndefined();
  });

  it("removes the portaled layer when the chain component goes away", () => {
    const { unmount } = render(<Table />);
    expect(document.querySelector("[data-chain-front]")).not.toBeNull();
    unmount();
    expect(document.querySelector("[data-chain-front]")).toBeNull();
  });

  it("paints the layer above the prompt in the style sheets", () => {
    const sheet = css("chain-fx.module.css");
    expect(sheet).toMatch(/\.front\s*\{[^}]*z-index:\s*var\(--duel-z-chain\)/);
    expect(sheet).toMatch(/\.layer\[data-portal="true"\]\s*\{[^}]*left:\s*0/);
    const globals = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
    const num = (token: string) => Number(globals.match(new RegExp(`--duel-z-${token}:\\s*(\\d+)`))?.[1]);
    expect(num("chain")).toBeGreaterThan(num("prompt"));
  });
});
