// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

import { ChainFx } from "@/components/duel/chain-fx";
import { cardFrame, frameOfQuad, labelAnchor } from "@/components/duel/chain-frame";
import type { Quad } from "@/components/duel/quad";

const SZONE = 0x08;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const info = (code: number): DuelCardInfo => ({
  code, name: `Card ${code}`, description: "", type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "Warrior",
});
const EVENTS: DuelEvent[] = [{ id: 900, kind: "activate", text: "a", seat: 0, card: info(11), chainIndex: 1, zone: z(0, SZONE, 0) }];
const CHAIN: DuelChainLink[] = [{ index: 1, seat: 0, code: 11 }];
const names = (seat: number) => `Player ${seat + 1}`;

/** The board box the chain layers sit on (left, top, width, height). */
const BOARD = [120, 60, 900, 600];
/** A 60 x 80 card, turned `deg` about its centre (300, 300) on the screen. */
const CENTER = { x: 300, y: 300 };
const SIZE = { w: 60, h: 80 };
/** A zone is a square cell with the card's own frame inside it (the real table's shape); a bare zone is the card. */
const CELL = { w: 80, h: 80 };
const matrix = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  return `matrix(${Math.cos(a)}, ${Math.sin(a)}, ${-Math.sin(a)}, ${Math.cos(a)}, 0, 0)`;
};
function cornersOf(deg: number, size = SIZE): Quad {
  const a = (deg * Math.PI) / 180;
  return ([[-size.w / 2, -size.h / 2], [size.w / 2, -size.h / 2], [size.w / 2, size.h / 2], [-size.w / 2, size.h / 2]] as const)
    .map(([x, y]) => ({ x: CENTER.x + x * Math.cos(a) - y * Math.sin(a), y: CENTER.y + x * Math.sin(a) + y * Math.cos(a) })) as Quad;
}
const boundsOf = (deg: number, size = SIZE) => {
  const q = cornersOf(deg, size);
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

let TURN = 0;
let zone: HTMLElement;
/** Set when the zone holds a card frame: the zone is the square cell and the frame is the card. */
let cell: boolean;
/** A hand container: wider than any one card in it. */
const HAND = { w: 240, h: 80 };
const sizeOf = (el: HTMLElement) =>
  el.hasAttribute("data-card-frame") ? SIZE : el.hasAttribute("data-hand-seat") ? HAND : el.dataset.zones ? (cell ? CELL : SIZE) : null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    let box = [0, 0, 0, 0];
    const size = sizeOf(this);
    if (size) {
      const b = boundsOf(TURN, size);
      box = [b.left, b.top, b.width, b.height];
    } else if (this.hasAttribute("data-duel-fx-speed-root") || this.hasAttribute("data-chain-fx") || this.hasAttribute("data-board")) box = BOARD;
    const [left, top, width, height] = box;
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return sizeOf(this)?.w ?? 0; });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return sizeOf(this)?.h ?? 0; });
  zone = document.createElement("div");
  zone.dataset.zones = "0:8:0";
  cell = false;
  document.body.appendChild(zone);
});
afterEach(() => {
  cleanup();
  zone.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** The field of a seat is turned by CSS: the zone's computed transform carries the seat angle. */
function turnField(deg: number) {
  TURN = deg;
  zone.style.transform = deg === 0 ? "none" : matrix(deg);
}

function mount(table = "ffa3") {
  const view = render(
    <div data-duel-fx-speed-root data-testid="root">
      <div data-board data-format={table}>
        <ChainFx events={EVENTS} chain={CHAIN} duelKey="t" reducedMotion mySeat={0} playerName={names} table={table} />
      </div>
    </div>,
  );
  act(() => { vi.advanceTimersByTime(60); });
  const back = view.container.querySelector("[data-chain-card='1']") as HTMLElement;
  const front = view.container.ownerDocument.querySelector("[data-chain-link='1']") as HTMLElement;
  return { back, front };
}

describe("chain ring on a turned field", () => {
  it.each([30, -45, 120, -150])("draws the ring on the card and turns it with a field at %i degrees", (deg) => {
    turnField(deg);
    const { back } = mount();
    expect(back.dataset.placed).toBe("true");
    expect(back.dataset.turned).toBe("true");
    // The same angle as the card and the zone.
    expect(parseFloat(back.style.rotate)).toBeCloseTo(deg, 3);
    // The card's own size, not the straight box around it.
    expect(parseFloat(back.style.width)).toBeCloseTo(SIZE.w, 3);
    expect(parseFloat(back.style.height)).toBeCloseTo(SIZE.h, 3);
    // Centred on the card (board pixels: the board starts at 120, 60).
    const [x, y] = back.style.translate.split(" ").map(parseFloat);
    expect(x + SIZE.w / 2).toBeCloseTo(CENTER.x - BOARD[0], 3);
    expect(y + SIZE.h / 2).toBeCloseTo(CENTER.y - BOARD[1], 3);
  });

  it("turns the card's own frame, not the square cell around it", () => {
    cell = true;
    const frame = document.createElement("div");
    frame.setAttribute("data-card-frame", "");
    zone.appendChild(frame);
    turnField(-60);
    const { back } = mount();
    expect(parseFloat(back.style.rotate)).toBeCloseTo(-60, 3);
    expect(parseFloat(back.style.width)).toBeCloseTo(SIZE.w, 3);
    expect(parseFloat(back.style.height)).toBeCloseTo(SIZE.h, 3);
  });

  it("keeps the badge upright on the card corner nearest the top right of the screen", () => {
    turnField(30);
    const { front } = mount();
    expect(front.dataset.turned).toBe("true");
    expect(front.style.rotate).toBe("");
    // The slot is the straight bounds of the card, so the callout tag stays upright and centred on it.
    const bounds = boundsOf(30);
    expect(parseFloat(front.style.width)).toBeCloseTo(bounds.width, 3);
    expect(parseFloat(front.style.height)).toBeCloseTo(bounds.height, 3);
    // The badge sits by the corner with the greatest x - y.
    const corner = cornersOf(30).reduce((best, p) => (p.x - p.y > best.x - best.y ? p : best));
    const bx = parseFloat(front.style.getPropertyValue("--bx")) + bounds.left - BOARD[0];
    const by = parseFloat(front.style.getPropertyValue("--by")) + bounds.top - BOARD[1];
    expect(Math.hypot(bx - (corner.x - BOARD[0]), by - (corner.y - BOARD[1]))).toBeLessThan(40);
  });

  it("leaves a card that is not turned as it was: the straight box and no turn", () => {
    turnField(0);
    const { back, front } = mount("1v1");
    expect(back.dataset.turned).toBe("false");
    expect(back.style.rotate).toBe("");
    expect(front.dataset.turned).toBe("false");
    expect(front.style.getPropertyValue("--bx")).toBe("");
    expect(parseFloat(back.style.width)).toBeCloseTo(SIZE.w, 3);
    expect(parseFloat(back.style.height)).toBeCloseTo(SIZE.h, 3);
  });
});

describe("target mark on a turned field", () => {
  it("turns the target ring with the card, and keeps its words upright", () => {
    const targeted = document.createElement("div");
    targeted.dataset.zones = "1:8:0";
    document.body.appendChild(targeted);
    turnField(40);
    targeted.style.transform = matrix(40);
    const events: DuelEvent[] = [...EVENTS, { id: 901, kind: "target", chainIndex: 1, seat: 0, text: "Chain Link 1 targets 1 card", targets: [z(1, SZONE, 0)] }];
    const view = render(
      <div data-duel-fx-speed-root>
        <div data-board><ChainFx events={events} chain={CHAIN} duelKey="t" reducedMotion={false} mySeat={0} playerName={names} table="ffa3" /></div>
      </div>,
    );
    act(() => { vi.advanceTimersByTime(60); });
    const mark = view.container.ownerDocument.querySelector("[data-chain-target='1']") as HTMLElement;
    targeted.remove();
    expect(mark.dataset.placed).toBe("true");
    expect(mark.dataset.turned).toBe("true");
    expect(parseFloat(mark.style.rotate)).toBeCloseTo(40, 3);
    expect(mark.style.getPropertyValue("--turn")).toMatch(/^40(\.0+)?deg$/);
    expect(parseFloat(mark.style.width)).toBeCloseTo(SIZE.w, 3);
    expect(parseFloat(mark.style.height)).toBeCloseTo(SIZE.h, 3);
  });
});

describe("chain highlight styles", () => {
  const css = readFileSync(join(__dirname, "../../src/components/duel/chain-fx.module.css"), "utf8");
  it("keeps the badge and the target words upright on a turned card", () => {
    expect(css).toMatch(/\.slot\[data-turned="true"\] \.badge \{[^}]*left: var\(--bx[^}]*top: var\(--by[^}]*translate: -50% -50%/);
    expect(css).toMatch(/\.target\[data-turned="true"\] \.targetTag \{[^}]*rotate: calc\(var\(--turn[^}]*\* -1\)/);
  });
});

describe("frameOfQuad", () => {
  it("returns the card's own box and angle for a turned quad, and the bounds as the straight box", () => {
    const frame = frameOfQuad(cornersOf(60), { left: 0, top: 0 }, false)!;
    expect(frame.turn).toBeCloseTo(60, 3);
    expect(frame.ring.width).toBeCloseTo(SIZE.w, 3);
    expect(frame.ring.height).toBeCloseTo(SIZE.h, 3);
    const bounds = boundsOf(60);
    expect(frame.box.left).toBeCloseTo(bounds.left, 3);
    expect(frame.box.width).toBeCloseTo(bounds.width, 3);
    expect(frame.corner).not.toBeNull();
  });

  it("turns a Defense Position card a quarter inside its zone, at the angle of the field", () => {
    const frame = frameOfQuad(cornersOf(30), { left: 0, top: 0 }, true)!;
    expect(frame.turn).toBeCloseTo(30, 3);
    expect(frame.ring.width).toBeCloseTo(SIZE.h, 3);
    expect(frame.ring.height).toBeCloseTo(SIZE.w, 3);
  });

  it("keeps an upright zone and its half turn straight, as before", () => {
    for (const deg of [0, 180]) {
      const frame = frameOfQuad(cornersOf(deg), { left: 10, top: 20 }, false)!;
      expect(frame.turn).toBe(0);
      expect(frame.corner).toBeNull();
      expect(frame.ring).toEqual(frame.box);
      const bounds = boundsOf(deg);
      expect(frame.box.width).toBeCloseTo(bounds.width, 3);
      expect(frame.box.left).toBeCloseTo(bounds.left - 10, 3);
    }
  });

  it("covers the same screen box for a quarter turn as the straight bounds do", () => {
    const frame = frameOfQuad(cornersOf(90), { left: 0, top: 0 }, false)!;
    const bounds = boundsOf(90);
    expect(frame.turn).toBeCloseTo(90, 3);
    expect(frame.box.left).toBeCloseTo(bounds.left, 3);
    expect(frame.box.width).toBeCloseTo(bounds.width, 3);
    expect(frame.box.height).toBeCloseTo(bounds.height, 3);
  });

  it("gives nothing for a zone with no size", () => {
    expect(cardFrame({ left: 0, top: 0, width: 900 } as DOMRect, Object.assign(document.createElement("div"), {}))).toBeNull();
  });

  it("keeps the whole hand as the frame of a hand fallback, not its first card", () => {
    const hand = document.createElement("div");
    hand.dataset.handSeat = "1";
    for (let i = 0; i < 2; i++) {
      const card = document.createElement("div");
      card.setAttribute("data-card-frame", "");
      hand.appendChild(card);
    }
    document.body.appendChild(hand);
    TURN = 150;
    hand.style.transform = matrix(150);
    const frame = cardFrame({ left: 0, top: 0, width: 900 } as DOMRect, hand)!;
    hand.remove();
    // The hand's own outline: its width and the angle of its seat, not the 60 x 80 of one card.
    expect(frame.ring.width).toBeCloseTo(HAND.w, 3);
    expect(frame.ring.height).toBeCloseTo(HAND.h, 3);
    expect(frame.turn).toBeCloseTo(150, 3);
  });

  it("reads only the bounding rect when the board never turns", () => {
    turnField(30);
    const styles = vi.spyOn(window, "getComputedStyle");
    const frame = cardFrame({ left: 0, top: 0, width: 900 } as DOMRect, zone, false)!;
    expect(styles).not.toHaveBeenCalled();
    expect(frame.turn).toBe(0);
    expect(frame.corner).toBeNull();
    expect(frame.box.width).toBeCloseTo(boundsOf(30).width, 3);
  });

  it("picks the same badge corner while a seat glides through -45 and 135 degrees", () => {
    for (const mid of [-45, 135]) {
      const corners = [-0.2, -0.0005, 0, 0.0004, 0.2].map((d) => frameOfQuad(cornersOf(mid + d), { left: 0, top: 0 }, false)!.corner!);
      for (const c of corners) expect(c.x).toBeCloseTo(corners[0].x, 0);
      // Of the two tied corners, the higher one on the screen.
      const tied = cornersOf(mid).map((p) => p).sort((a, b) => b.x - b.y - (a.x - a.y)).slice(0, 2);
      expect(corners[2].y).toBeCloseTo(Math.min(tied[0].y, tied[1].y), 3);
    }
  });
});

describe("labelAnchor", () => {
  it("hangs from the bottom-left corner of the card as it is turned, and lifts along its left edge", () => {
    for (const deg of [0, 40, 150, -90]) {
      const frame = frameOfQuad(cornersOf(deg), { left: 0, top: 0 }, false)!;
      const [p0, , , p3] = cornersOf(deg);
      const base = labelAnchor(frame, 0);
      expect(base.x).toBeCloseTo(p3.x, 2);
      expect(base.y).toBeCloseTo(p3.y, 2);
      const lifted = labelAnchor(frame, 16);
      const up = { x: (p0.x - p3.x) / SIZE.h, y: (p0.y - p3.y) / SIZE.h };
      expect(lifted.x).toBeCloseTo(p3.x + up.x * 16, 2);
      expect(lifted.y).toBeCloseTo(p3.y + up.y * 16, 2);
    }
  });
});
