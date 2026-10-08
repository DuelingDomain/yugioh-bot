import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hits, overlap, type Rect } from "../src/components/duel/table/rect-util";
import { handKeepOut, planStripRoom, STRIP_ROOM, stripRoomSize, type StripRoomInput } from "../src/components/duel/table/strip-room";
import cases from "./fixtures/strip-room-rects.json";

/**
 * The rects in strip-room-rects.json were measured on the real tables (board px): the FFA3 fixtures at 2560x1440, 1920x1080, 1366x768 and 1280x720,
 * home and own-field zoom, and the FFA4 fixture in zoom at 1366x768 (its corner buttons are the `controls`).
 */
type Case = Required<Pick<StripRoomInput, "box" | "count" | "anchor" | "hud" | "soft" | "zones" | "source">> & Pick<StripRoomInput, "hand" | "controls" | "chrome">;
const REAL = cases as unknown as Record<string, Case>;
const real = (name: string) => REAL[name];
const plan = (name: string, extra: Partial<StripRoomInput> = {}) => {
  const input = { ...real(name), ...extra };
  return { input, room: planStripRoom(input)! };
};
const inside = (r: Rect, box: { width: number; height: number }) => r.x >= 0 && r.y >= 0 && r.x + r.width <= box.width && r.y + r.height <= box.height;
const touched = (r: Rect, blocks: readonly Rect[] = []) => blocks.filter((b) => overlap(r, b) > STRIP_ROOM.sliver).length;

describe("stripRoomSize: the cards are about twice as large", () => {
  const box = { width: 1892, height: 995 };

  it("wants 130 px tiles, twice the 65 px tiles of the pair box, and up to six in a row", () => {
    expect(STRIP_ROOM.card).toBeGreaterThanOrEqual(2 * 65);
    expect(stripRoomSize(2, box)).toMatchObject({ card: STRIP_ROOM.card, cols: 2 });
    expect(stripRoomSize(10, box)).toMatchObject({ card: STRIP_ROOM.card, cols: 6 });
    expect(stripRoomSize(14, box).height).toBeGreaterThan(stripRoomSize(2, box).height);
  });

  it("gives six columns their tiles, gaps and side padding with the slack kept", () => {
    const six = stripRoomSize(10, box);
    expect(six.width).toBe(6 * STRIP_ROOM.card + 5 * STRIP_ROOM.gap + STRIP_ROOM.side);
    // 2 x 28 px of strip padding plus 10 px of slack for a border or a scrollbar.
    expect(STRIP_ROOM.side).toBeGreaterThanOrEqual(66);
  });

  it("never asks for more than the box", () => {
    for (const size of [{ width: 1252, height: 635 }, { width: 300, height: 400 }]) {
      for (const count of [1, 2, 10, 40]) {
        const found = stripRoomSize(count, size);
        expect(found.width).toBeLessThanOrEqual(size.width - 2 * STRIP_ROOM.edge);
        expect(found.height).toBeLessThanOrEqual(size.height - 2 * STRIP_ROOM.edge);
      }
    }
  });
});

describe("planStripRoom on the measured tables", () => {
  it("is wholly inside the box and never over the chain's cards where a place exists", () => {
    for (const name of Object.keys(REAL).filter((n) => n.startsWith("ffa3"))) {
      const { input, room } = plan(name);
      expect(inside(room, input.box), name).toBe(true);
      expect(touched(room, input.source), name).toBe(0);
    }
  });

  it("2560 home: the large tiles in full width, clear of the HUD, the hand and every card zone", () => {
    const { input, room } = plan("ffa3-respond-2-2560x1440-home");
    expect(room).toMatchObject({ card: STRIP_ROOM.card, cols: 2 });
    expect(room.width).toBeGreaterThanOrEqual(STRIP_ROOM.minWidth);
    for (const block of [...input.hud, ...input.soft, ...input.zones, handKeepOut(input.hand!)]) expect(hits(room, block)).toBe(false);
  });

  it("1920 home: the soft HUD and the lower hand stay free; 10 cards keep the large tiles, 2 cards at least 1.5x the pair tile", () => {
    for (const name of ["ffa3-respond-2-1920x1080-home", "ffa3-respond-10-1920x1080-home"]) {
      const { input, room } = plan(name);
      expect(touched(room, input.soft), name).toBe(0);
      expect(touched(room, input.hud), name).toBeLessThanOrEqual(1);
      expect(hits(room, handKeepOut(input.hand!)), name).toBe(false);
    }
    // The 2-card room has no clear place for 130 px tiles under the turn ring: it steps down to 96 px before it covers the ring.
    expect(plan("ffa3-respond-2-1920x1080-home").room.card).toBeGreaterThanOrEqual(STRIP_ROOM.smaller[STRIP_ROOM.smaller.length - 1]);
    expect(plan("ffa3-respond-10-1920x1080-home").room).toMatchObject({ card: STRIP_ROOM.card });
    expect(plan("ffa3-respond-10-1920x1080-zoom").room).toMatchObject({ card: STRIP_ROOM.card, cols: 6 });
  });

  it("1366 and 1280: the room covers at most the turn ring (one key piece), never the soft HUD or the deep hand", () => {
    for (const name of Object.keys(REAL).filter((n) => /ffa3.*(1366|1280)/.test(n))) {
      const { input, room } = plan(name);
      expect(touched(room, input.hud), name).toBeLessThanOrEqual(2);
      expect(touched(room, input.soft), name).toBe(0);
      expect(hits(room, handKeepOut(input.hand!)), name).toBe(false);
      expect(room.width, name).toBeGreaterThanOrEqual(STRIP_ROOM.narrowest);
    }
  });

  it("FFA4 zoom: the corner buttons, the soft HUD and the lower hand stay free", () => {
    const { input, room } = plan("ffa4-respond-10-1366x768-focus2");
    expect(touched(room, input.controls)).toBe(0);
    expect(touched(room, input.soft)).toBe(0);
    expect(hits(room, handKeepOut(input.hand!))).toBe(false);
    expect(inside(room, input.box)).toBe(true);
  });

  it("keeps Back and Pass on screen when the header wraps taller than the estimate", () => {
    const base = real("ffa3-respond-10-1366x768-home");
    for (const chrome of [STRIP_ROOM.chrome, 296, 360]) {
      const { room } = plan("ffa3-respond-10-1366x768-home", { chrome });
      expect(inside(room, base.box), `chrome ${chrome}`).toBe(true);
      // The room is tall enough for the chrome and one whole row (the footer is part of the chrome).
      expect(room.height, `chrome ${chrome}`).toBeGreaterThanOrEqual(Math.min(chrome + 200, base.box.height - 2 * STRIP_ROOM.edge));
    }
  });
});

describe("planStripRoom: what it gives up first", () => {
  it("covers the field rather than your own actions, and your own actions rather than the deep hand", () => {
    const input = real("ffa4-respond-10-1366x768-focus2");
    expect(touched(planStripRoom({ ...input })!, input.controls)).toBe(0);
    // Without the controls rank the room sits on them: the rank is what keeps them free.
    const without = planStripRoom({ ...input, controls: [] })!;
    expect(touched(without, input.controls)).toBeGreaterThan(0);
  });

  it("takes a card of the chain last: the hand and the actions rank above it", () => {
    const box = { width: 900, height: 600 };
    const hand = { x: 300, y: 500, width: 300, height: 80 };
    const source = [{ x: 400, y: 60, width: 80, height: 80 }];
    // Every place is covered by key HUD, so the fallback ranks; the card in the chain is the cheaper loss next to your hand.
    const room = planStripRoom({ box, count: 2, hud: [{ x: 0, y: 0, width: 900, height: 600 }], hand, source })!;
    expect(hits(room, handKeepOut(hand))).toBe(false);
  });

  it("returns nothing for an empty box or no cards", () => {
    expect(planStripRoom({ box: { width: 0, height: 500 }, count: 2 })).toBeUndefined();
    expect(planStripRoom({ box: { width: 1892, height: 995 }, count: 0 })).toBeUndefined();
  });

  it("plans in a few ms on the measured tables and in under 50 ms when nothing is clear", () => {
    const started = performance.now();
    for (const name of Object.keys(REAL)) planStripRoom(REAL[name]);
    expect((performance.now() - started) / Object.keys(REAL).length).toBeLessThan(25);
    const box = { width: 2532, height: 1355 };
    const all = [{ x: 0, y: 0, width: box.width, height: box.height }];
    const begun = performance.now();
    expect(planStripRoom({ box, count: 14, hud: all, soft: all, hand: { x: 1000, y: 1200, width: 500, height: 120 } })).toBeDefined();
    expect(performance.now() - begun).toBeLessThan(50);
  });
});

describe("the stage css gives the response panel its room", () => {
  const read = (path: string) => readFileSync(join(__dirname, "../src/components/duel", path), "utf8");

  it("places the panel in the --sr-* room on the FFA3, FFA4 and Tag stages and hides it until the room is known", () => {
    for (const file of ["table/table-stage.module.css", "table/grid-stage.module.css", "tag/tag-stage.module.css"]) {
      const css = read(file);
      expect(css, file).toContain("[data-strip-room]");
      expect(css, file).toContain("var(--sr-w)");
      expect(css, file).toContain("[data-strip-pending]");
    }
  });

  it("sizes the tiles from --sr-card", () => {
    expect(read("card-strip.module.css")).toContain("--cs-w: var(--sr-card, 130px)");
  });
});
