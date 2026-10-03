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
function Table({ withRoot = true, table, panels = [], cue, plate, surface }: { withRoot?: boolean; table?: string; panels?: string[]; cue?: string; plate?: string; surface?: string }) {
  const board = (
    <div data-board data-format={table}>
      <div data-slot="fx">
        <ChainFx events={EVENTS} chain={CHAIN} duelKey="t" reducedMotion mySeat={0} playerName={names} table={table} />
      </div>
      <div data-slot="prompt">
        <div data-prompt-panel>Activate its effect?</div>
        {panels.map((box) => <div key={box} data-prompt-panel data-box={box}>choices</div>)}
        {plate ? <div data-lp-seat="1" data-box={plate}>5,400</div> : null}
        {surface ? <div data-prompt-surface data-box={surface}>Select 1 card</div> : null}
        {cue ? <div data-feedback-cue data-box={cue}>My Body as a Shield is activating</div> : null}
      </div>
    </div>
  );
  return withRoot ? <div data-duel-fx-speed-root data-testid="root">{board}</div> : board;
}

/** Client boxes of the two zones (left, top, width, height); a test may move them. */
let ZONES: Record<string, number[]> = {};

beforeEach(() => {
  ZONES = { "0:8:0": [100, 400, 60, 80], "1:8:0": [320, 160, 60, 80] };
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    let box = [0, 0, 0, 0];
    if (this.dataset.zones && ZONES[this.dataset.zones]) box = ZONES[this.dataset.zones];
    else if (this.hasAttribute("data-chain-panel")) box = [0, 0, 240, 30];
    else if (this.hasAttribute("data-prompt-panel") || this.hasAttribute("data-prompt-surface") || this.hasAttribute("data-feedback-cue") || this.hasAttribute("data-lp-seat")) box = (this.dataset.box ?? "0,0,0,0").split(",").map(Number);
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

  describe("callout tag and an open prompt", () => {
    // Board at client (120, 60). The focus card (link 2) is at board (200, 100), 60x80, in the upper half.
    // Its tag (200x30 here) opens below it: board y 188..218, x 130..330 (client x 250..450, y 248..278).
    const tagOf = (root: HTMLElement) => root.querySelector("[data-chain-callout]") as HTMLElement;
    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return this.hasAttribute("data-chain-callout") ? 200 : 0; } });
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return this.hasAttribute("data-chain-callout") ? 30 : 0; } });
    });
    afterEach(() => {
      delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
      delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    });

    it("opens on its default side when no prompt panel is near", () => {
      const { getByTestId } = render(<Table table="ffa3" />);
      act(() => { vi.advanceTimersByTime(60); });
      expect(tagOf(getByTestId("root")).dataset.side).toBe("near");
    });

    it("moves to the other side when the Yes/No bar sits under it, and never overlaps the bar", () => {
      // The bar, in client pixels: over the default side of the tag.
      const { getByTestId } = render(<Table table="ffa3" panels={["240,240,300,70"]} />);
      act(() => { vi.advanceTimersByTime(60); });
      expect(tagOf(getByTestId("root")).dataset.side).toBe("far");
    });

    it("keeps clear of the activation banner as well, so its text stays readable", () => {
      const { getByTestId } = render(<Table table="ffa3" cue="240,240,300,70" />);
      act(() => { vi.advanceTimersByTime(60); });
      expect(tagOf(getByTestId("root")).dataset.side).toBe("far");
    });

    it("keeps clear of the select bar, the Response needed pill and the phone prompt dock", () => {
      // Any element with data-prompt-surface counts, not only a prompt panel (the hover tooltip reads that one).
      const { getByTestId } = render(<Table table="ffa3" surface="240,240,300,70" />);
      act(() => { vi.advanceTimersByTime(60); });
      expect(tagOf(getByTestId("root")).dataset.side).toBe("far");
    });

    it("hides the tag, and leaves the words to the stack, when both sides are covered", () => {
      const { getByTestId } = render(<Table table="ffa3" panels={["240,240,300,70", "240,100,300,60"]} />);
      act(() => { vi.advanceTimersByTime(60); });
      const root = getByTestId("root");
      expect(tagOf(root).dataset.side).toBe("hidden");
      // The stack still names the card and what it does.
      expect(root.querySelector('[data-chain-row="2"]')?.textContent).toContain("activates its effect");
    });

    it("styles a hidden tag as invisible but keeps its place", () => {
      const sheet = css("chain-fx.module.css");
      expect(sheet).toMatch(/\.tag\[data-side="hidden"\]\s*\{[^}]*visibility:\s*hidden/);
      expect(sheet).toMatch(/\.tag\[data-side="far"\]/);
    });
  });

  describe("chips in a crowded corner", () => {
    it("sit in the top left corner when nothing is there", () => {
      const { getByTestId } = render(<Table table="ffa3" />);
      act(() => { vi.advanceTimersByTime(60); });
      const front = getByTestId("root").querySelector("[data-chain-front]") as HTMLElement;
      expect(front.dataset.size).toBe("compact");
      expect(front.style.getPropertyValue("--chain-dock-left")).toBe("4px");
      expect(front.style.getPropertyValue("--chain-dock-top")).toBe("4px");
    });

    it("slide right past a life-point plate in that corner", () => {
      // The plate, in client pixels: board 120,60 -> the plate covers board x 10..170, y 10..90.
      const { getByTestId } = render(<Table table="ffa3" plate="130,70,160,80" />);
      act(() => { vi.advanceTimersByTime(60); });
      const front = getByTestId("root").querySelector("[data-chain-front]") as HTMLElement;
      // Plate right edge 170 + a 6 px gap.
      expect(front.style.getPropertyValue("--chain-dock-left")).toBe("176px");
      expect(front.style.getPropertyValue("--chain-dock-top")).toBe("4px");
    });
  });

  describe("free gutter and target marks", () => {
    const withTarget = (box: string | null) => {
      const events: DuelEvent[] = [
        activate(1, 0, 11, z(0, SZONE, 0)),
        { ...activate(2, 1, 22, z(1, SZONE, 0)), targets: [z(0, SZONE, 0)] },
      ];
      return (
        <div data-duel-fx-speed-root data-testid="root">
          <div data-board>
            <div data-slot="fx"><ChainFx events={events} chain={CHAIN} duelKey="g" reducedMotion mySeat={0} playerName={names} /></div>
            {box ? <div data-prompt-panel data-box={box}>choices</div> : null}
          </div>
        </div>
      );
    };

    it("uses the chips form when the field leaves no room on the left", () => {
      // The card at client x 100 is left of the board edge (120): the gutter is 0.
      const { getByTestId } = render(withTarget(null));
      act(() => { vi.advanceTimersByTime(60); });
      const front = getByTestId("root").querySelector("[data-chain-front]") as HTMLElement;
      expect(front.dataset.size).toBe("compact");
      expect(front.dataset.gutter).toBe("0");
    });

    it("uses the full stack, sized by the gutter, when the field starts well to the right", () => {
      // Both cards 300px in from the board edge (client 120 + 300).
      ZONES = { "0:8:0": [420, 400, 60, 80], "1:8:0": [440, 160, 60, 80] };
      const { getByTestId } = render(withTarget(null));
      act(() => { vi.advanceTimersByTime(60); });
      const front = getByTestId("root").querySelector("[data-chain-front]") as HTMLElement;
      expect(front.dataset.size).toBe("full");
      expect(front.dataset.gutter).toBe("300");
      expect(front.style.getPropertyValue("--chain-gutter")).toBe("300px");
    });

    it("steps a badge back while an open prompt sits under it, and shows it again after", () => {
      const { getByTestId, rerender } = render(withTarget(null));
      act(() => { vi.advanceTimersByTime(60); });
      const badge = () => getByTestId("root").querySelector("[data-chain-link='1']") as HTMLElement;
      expect(badge().dataset.covered).toBe("false");
      // Link 1 stands on the card at client (100, 400, 60, 80): its badge is at that card's top right corner.
      rerender(withTarget("120,370,120,50"));
      act(() => { vi.advanceTimersByTime(60); });
      expect(badge().dataset.covered).toBe("true");
      rerender(withTarget(null));
      act(() => { vi.advanceTimersByTime(60); });
      expect(badge().dataset.covered).toBe("false");
    });

    it("turns the full stack into chips when a prompt meets it, and back when the prompt goes", () => {
      ZONES = { "0:8:0": [420, 400, 60, 80], "1:8:0": [440, 160, 60, 80] };
      const { getByTestId, rerender } = render(withTarget(null));
      act(() => { vi.advanceTimersByTime(60); });
      const front = () => getByTestId("root").querySelector("[data-chain-front]") as HTMLElement;
      expect(front().dataset.size).toBe("full");
      // The stack column is at client (0, 0, 240, 30) in this mock. A prompt over it makes the chips.
      rerender(withTarget("0,0,60,60"));
      act(() => { vi.advanceTimersByTime(60); });
      expect(front().dataset.size).toBe("compact");
      // It stays chips while the prompt stays, and does not flip every frame.
      act(() => { vi.advanceTimersByTime(200); });
      expect(front().dataset.size).toBe("compact");
      rerender(withTarget(null));
      act(() => { vi.advanceTimersByTime(60); });
      expect(front().dataset.size).toBe("full");
    });

    it("draws the target mark in the front layer, above the prompt, and hides it under a panel", () => {
      const open = render(withTarget(null));
      act(() => { vi.advanceTimersByTime(60); });
      const front = open.getByTestId("root").querySelector("[data-chain-front]") as HTMLElement;
      const mark = front.querySelector("[data-chain-target='2']") as HTMLElement;
      expect(mark).not.toBeNull();
      expect(mark.dataset.covered).toBe("false");
      open.unmount();
      // A panel over the target card (client 100,400 60x80).
      const covered = render(withTarget("90,390,100,100"));
      act(() => { vi.advanceTimersByTime(60); });
      const hidden = covered.getByTestId("root").querySelector("[data-chain-target='2']") as HTMLElement;
      expect(hidden.dataset.covered).toBe("true");
    });
  });

  describe("pile viewer", () => {
    it("hides the front layer while a pile viewer is open, and shows it again when it closes", () => {
      const { getByTestId } = render(<Table table="ffa3" />);
      act(() => { vi.advanceTimersByTime(60); });
      const front = getByTestId("root").querySelector("[data-chain-front]") as HTMLElement;
      expect(front.dataset.suspended).toBe("false");
      // The viewer mounts inside the board box, under the front layer's z-index: the layer has to yield.
      const viewer = document.createElement("aside");
      viewer.setAttribute("data-pile-viewer", "");
      getByTestId("root").querySelector("[data-board]")!.appendChild(viewer);
      act(() => { vi.advanceTimersByTime(60); });
      expect(front.dataset.suspended).toBe("true");
      viewer.remove();
      act(() => { vi.advanceTimersByTime(60); });
      expect(front.dataset.suspended).toBe("false");
    });

    it("hides the layer in the style sheet too, without waiting for a frame", () => {
      const sheet = css("chain-fx.module.css");
      expect(sheet).toMatch(/\.front\[data-suspended="true"\][^{]*\{[^}]*visibility:\s*hidden/);
      expect(sheet).toMatch(/:global\(\[data-duel-fx-speed-root\]\):has\(:global\(\[data-pile-viewer\]\)\)\s+\.front/);
    });
  });

  it("paints the layer above the prompt in the style sheets", () => {
    const sheet = css("chain-fx.module.css");
    expect(sheet).toMatch(/\.slot\[data-covered="true"\]\s+\.badge\s*\{[^}]*visibility:\s*hidden/);
    expect(sheet).toMatch(/\.front\s*\{[^}]*z-index:\s*var\(--duel-z-chain\)/);
    expect(sheet).toMatch(/\.layer\[data-portal="true"\]\s*\{[^}]*left:\s*0/);
    const globals = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
    const num = (token: string) => Number(globals.match(new RegExp(`--duel-z-${token}:\\s*(\\d+)`))?.[1]);
    expect(num("chain")).toBeGreaterThan(num("prompt"));
  });
});
