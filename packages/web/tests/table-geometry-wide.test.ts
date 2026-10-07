import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelFormat, DuelSeatView } from "@yugidraft/shared/duels";
import {
  boardBounds,
  chainStripInset,
  PLAZA_HUD_KEEP,
  SEAT_BOX_FULL_DEF,
  plazaView,
  polygonGap,
  seatQuad,
  chainBandRooms,
  holoAnchor,
  promptRoom,
  promptRooms,
  seatPoses,
  stageFit,
  stageSpread,
  tableLayout,
  wideHoloAnchors,
  wideHomeSlots,
} from "@/components/duel/table/geometry";
import type { CameraState } from "@/components/duel/table/types";

function seatView(seat: number): DuelSeatView {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null], spells: [null, null, null, null, null, null],
    graveyard: [], banished: [],
  };
}
function engine(format: DuelFormat, count: number): DuelEngineView {
  return {
    revision: 1, format, turn: 1, turnSeat: 0, phase: "main1",
    seats: Array.from({ length: count }, (_, seat) => seatView(seat)),
    prompt: null, chain: [], events: [], log: [], result: null,
  };
}
function camera(over: Partial<CameraState> = {}): CameraState {
  return {
    mode: "home", focusSeat: null, lookSeat: null, upright: false, compact: "auto",
    fly: { yawDeg: 0, tiltDeg: 40, zoom: 1, targetSeat: null }, lock: null, ...over,
  };
}

// The stage's own shape: nothing is visible beyond it.
const CLASSIC = { width: 1100, height: 860 };
// A 1920 by 1080 screen under the 72px rail and the top and bottom bars.
const WIDE = { width: 1848, height: 950 };
// The tightest case: 1366 by 768 with the drawer closed.
const TIGHT = { width: 1294, height: 649 };

describe("the wide plaza", () => {
  const four = tableLayout("ffa4", engine("ffa4", 4), 0);
  const three = tableLayout("ffa3", engine("ffa3", 3), 0);

  it("counts the stage px visible beyond each side, in steps of two, none for a box no wider than the stage", () => {
    expect(stageSpread(CLASSIC)).toBe(0);
    expect(stageSpread({ width: 900, height: 860 })).toBe(0);
    expect(stageSpread({ width: 0, height: 0 })).toBe(0);
    const spread = stageSpread(WIDE);
    expect(spread).toBeGreaterThan(100);
    expect(spread % 2).toBe(0);
    expect(stageSpread({ width: 9000, height: 860 })).toBe(450);
  });

  it("gives every pose the classic place when there is no spread", () => {
    expect(wideHomeSlots("ffa4", 0)).toBeNull();
    expect(wideHomeSlots("ffa3", 0)).toBeNull();
    const poses = seatPoses(four, camera(), CLASSIC);
    expect(poses.get(1)).toMatchObject({ x: 148, y: 223, rotateDeg: 90, scale: 0.6 });
    expect(poses.get(3)).toMatchObject({ x: 952, y: 223, rotateDeg: 270, scale: 0.6 });
  });

  it("moves the 4-way side rivals out to the edges and makes them bigger, keeps them upright and the far rival central", () => {
    const classic = seatPoses(four, camera(), CLASSIC);
    const wide = seatPoses(four, camera(), WIDE);
    expect(wide.get(0)).toMatchObject({ x: 550, y: 610, scale: 1 });
    expect(wide.get(1)!.x).toBeLessThan(classic.get(1)!.x);
    expect(wide.get(3)!.x).toBeGreaterThan(classic.get(3)!.x);
    expect(wide.get(1)!.scale).toBeGreaterThan(0.6);
    expect(wide.get(1)!.scale).toBeLessThanOrEqual(0.9);
    expect(wide.get(2)!.x).toBe(550);
    expect(wide.get(1)!.rotateDeg).toBe(90);
    expect(wide.get(3)!.rotateDeg).toBe(270);
  });

  // The 3-way plaza in the floating HUD at the five checked screens: the table box is the screen less the 52px header,
  // 5px below and 14px at each side; the stage fits in it above the 96px hand row.
  const HUD_SCREENS = [[2000, 967], [1920, 1080], [1680, 1050], [1440, 900], [1280, 800]].map(([w, h]) => {
    const box = { width: w - 28, height: h - 57 };
    return { name: `${w}x${h}`, box, fit: { ...box, height: (box.height * 860) / 956 } };
  });

  it("keeps the 3-way rivals clear of each other, the ring, your field and the HUD column, in screen px", () => {
    for (const { name, fit } of HUD_SCREENS) {
      const { k, top } = plazaView(fit);
      const spread = stageSpread(fit);
      const poses = seatPoses(three, camera(), fit);
      // Every field is the wide one (full-size Defense cards): SEAT_BOX_FULL_DEF.
      for (const pose of poses.values()) expect(pose.width, `${name}: field width`).toBe(SEAT_BOX_FULL_DEF);
      const quad = (seat: number) => seatQuad(poses.get(seat)!, 0, 0, SEAT_BOX_FULL_DEF, 380);
      const hand = (seat: number) => seatQuad(poses.get(seat)!, 0, 225, SEAT_BOX_FULL_DEF, 70);
      const ring = [{ x: 486, y: 258 }, { x: 614, y: 258 }, { x: 614, y: 402 }, { x: 486, y: 402 }];
      expect(polygonGap(quad(1), quad(2)) * k, `${name}: rivals`).toBeGreaterThanOrEqual(32);
      for (const seat of [1, 2]) {
        expect(polygonGap(quad(seat), quad(0)) * k, `${name}: rival ${seat} on your field`).toBeGreaterThanOrEqual(23.9);
        expect(polygonGap(quad(seat), ring) * k, `${name}: rival ${seat} on the ring`).toBeGreaterThanOrEqual(11.9);
        expect(Math.min(...quad(seat).concat(hand(seat)).map((p) => p.y)), `${name}: rival ${seat} above the box`).toBeGreaterThanOrEqual(top);
        expect(poses.get(seat)!.scale, `${name}: rival ${seat} size`).toBeLessThanOrEqual(0.76);
        expect(poses.get(seat)!.scale, `${name}: rival ${seat} size`).toBeGreaterThanOrEqual(0.56 - 1e-9);
      }
      for (const r of PLAZA_HUD_KEEP) {
        const keep = [
          { x: -spread + r.x / k, y: top + r.y / k }, { x: -spread + (r.x + r.width) / k, y: top + r.y / k },
          { x: -spread + (r.x + r.width) / k, y: top + (r.y + r.height) / k }, { x: -spread + r.x / k, y: top + (r.y + r.height) / k },
        ];
        expect(polygonGap(keep, quad(1)) * k, `${name}: left rival on the HUD`).toBeGreaterThanOrEqual(11.9);
        expect(polygonGap(keep, hand(1)) * k, `${name}: left rival hand on the HUD`).toBeGreaterThanOrEqual(11.9);
      }
      // Mirror images: the right rival keeps the same air at the right.
      expect(poses.get(2)!.x).toBeCloseTo(1100 - poses.get(1)!.x, 6);
    }
  });

  it("keeps every board inside the visible stage", () => {
    for (const box of [WIDE, TIGHT]) {
      const spread = stageSpread(box);
      for (const layout of [four, three]) {
        for (const board of [...seatPoses(layout, camera(), box).values()].map(boardBounds)) {
          expect(board.l).toBeGreaterThanOrEqual(-spread);
          expect(board.r).toBeLessThanOrEqual(1100 + spread);
        }
      }
    }
  });

  it("docks every plate clear of every board and every other plate, inside the visible stage", () => {
    for (const box of [WIDE, TIGHT]) {
      for (const layout of [four, three]) {
        const poses = seatPoses(layout, camera(), box);
        const spread = stageSpread(box);
        const anchors = wideHoloAnchors(layout, camera(), poses, spread, true)!;
        expect(anchors).not.toBeNull();
        expect(anchors.size).toBe(layout.slots.length);
        const rects = [...anchors].map(([seat, a]) => ({
          seat,
          // Your plate with the Deck Master chip hung under it (270 wide at most), and a rival's plate.
          l: a.x, t: a.y, r: a.x + (a.me ? 270 : 196), b: a.y + (a.me ? 113 + 58 : 92),
        }));
        for (const rect of rects) {
          expect(rect.l).toBeGreaterThanOrEqual(-spread);
          expect(rect.r).toBeLessThanOrEqual(1100 + spread);
          for (const [seat, pose] of poses) {
            if (seat === rect.seat) continue;
            const board = boardBounds(pose);
            const apart = rect.r <= board.l || board.r <= rect.l || rect.b <= board.t || board.b <= rect.t;
            expect(apart, `${layout.format} ${box.width}: plate ${rect.seat} vs board ${seat}`).toBe(true);
          }
          for (const other of rects) {
            if (other.seat >= rect.seat) continue;
            const apart = rect.r <= other.l || other.r <= rect.l || rect.b <= other.t || other.b <= rect.t;
            expect(apart, `${layout.format} ${box.width}: plate ${rect.seat} vs plate ${other.seat}`).toBe(true);
          }
        }
      }
    }
  });

  // Table areas in screen px: 1920 closed, 1440 and 1366 with the drawer open, 1366 closed.
  const BOXES = [
    { name: "1920 closed", box: { width: 1848, height: 950 } },
    { name: "1440 open", box: { width: 988, height: 776 } },
    { name: "1366 open", box: { width: 914, height: 649 } },
    { name: "1366 closed", box: { width: 1294, height: 649 } },
  ].map(({ name, box }) => ({ name, box, fit: { width: box.width, height: (box.height * 860) / 956 } }));
  const gap = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }) =>
    Math.max(0, a.l - b.r, b.l - a.r, a.t - b.b, b.t - a.b);
  const overlap = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }) =>
    a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

  it("keeps every plate attached to its own board (within 16 stage px) and off the camera hint corner", () => {
    for (const { name, fit } of BOXES) {
      const k = stageFit(fit);
      const spread = stageSpread(fit);
      const hint = { width: 250 / k, height: 40 / k };
      for (const layout of [four, three]) {
        const poses = seatPoses(layout, camera(), fit);
        const anchors = wideHoloAnchors(layout, camera(), poses, spread, true, { hint })!;
        for (const [seat, a] of anchors) {
          const r = { l: a.x, t: a.y, r: a.x + (a.me ? 270 : 196), b: a.y + (a.me ? 171 : 92) };
          const own = boardBounds(poses.get(seat)!);
          expect(gap(r, own), `${layout.format} ${name}: plate ${seat} is ${gap(r, own).toFixed(0)} px from its board`).toBeLessThanOrEqual(16);
          const corner = { l: -spread, r: -spread + hint.width, t: 952 - hint.height, b: 952 };
          expect(overlap(r, corner), `${layout.format} ${name}: plate ${seat} vs the camera hint`).toBe(false);
        }
      }
    }
  });

  it("never settles a plate on a field when the search runs out (a tall, narrow home board, and a sweep of odd sizes)", () => {
    const sizes = [{ width: 914, height: 781 }, ...[640, 760, 914, 1100, 1400].flatMap((width) => [520, 650, 781, 900].map((height) => ({ width, height })))];
    for (const box of sizes) {
      const fit = { width: box.width, height: (box.height * 860) / 956 };
      const k = stageFit(fit);
      const spread = stageSpread(fit);
      const hint = { width: 250 / k, height: 40 / k };
      for (const layout of [four, three]) {
        const poses = seatPoses(layout, camera(), fit);
        const anchors = wideHoloAnchors(layout, camera(), poses, spread, true, { hint });
        if (!anchors) continue;
        for (const [seat, a] of anchors) {
          const rect = { l: a.x, t: a.y, r: a.x + (a.me ? (a.footerTight ? 212 : 270) : 196), b: a.y + (a.me ? 171 : 92) };
          for (const [other, pose] of poses) {
            expect(overlap(rect, boardBounds(pose)), `${layout.format} ${box.width}x${box.height}: plate ${seat} on board ${other}`).toBe(false);
          }
        }
      }
    }
  });

  it("finds the prompts a room clear of every board, plate, the ring, your hand and the hint", () => {
    for (const { name, box, fit } of BOXES) {
      const k = stageFit(fit);
      const spread = stageSpread(fit);
      for (const layout of [four, three]) {
        const poses = seatPoses(layout, camera(), fit);
        const wide = wideHoloAnchors(layout, camera(), poses, spread, true, { hint: { width: 250 / k, height: 40 / k } });
        const anchors = new Map(layout.slots.map((slot) => [slot.seat, wide?.get(slot.seat) ?? holoAnchor(layout, slot.seat, camera())] as const));
        const rooms = promptRooms({ layout, camera: camera(), poses, anchors, spread, meFooter: true, box, k });
        const hint = { l: -spread - 6, r: -spread + 6 + 250 / k, t: 952 - 40 / k, b: 952 };
        for (const kind of ["panel", "bar"] as const) {
          const room = rooms[kind];
          expect(room, `${layout.format} ${name}: a room for the ${kind}`).not.toBeNull();
          const r = { l: room!.x, r: room!.x + room!.width, t: room!.y, b: room!.y + room!.height };
          for (const [seat, pose] of poses) expect(overlap(r, boardBounds(pose)), `${layout.format} ${name}: ${kind} room vs board ${seat}`).toBe(false);
          for (const [seat, a] of anchors) {
            const p = { l: a.x, t: a.y, r: a.x + (a.me ? 270 : 196), b: a.y + (a.me ? 171 : 92) };
            expect(overlap(r, p), `${layout.format} ${name}: ${kind} room vs plate ${seat}`).toBe(false);
          }
          expect(overlap(r, { l: 488, r: 612, t: 348, b: 486 }), `${layout.format} ${name}: ${kind} room vs the ring`).toBe(false);
          expect(overlap(r, { l: 220, r: 880, t: 856, b: 960 }), `${layout.format} ${name}: ${kind} room vs your hand`).toBe(false);
          // The name plate under the board's left corner (REN ARATA), which a big text size widens.
          for (const [seat, pose] of poses) {
            if (pose.slot !== "home") continue;
            const board = boardBounds(pose);
            expect(overlap(r, { l: board.l, r: board.l + 230 * pose.scale, t: board.b - 6, b: board.b + 44 * pose.scale }), `${layout.format} ${name}: ${kind} room vs the name of seat ${seat}`).toBe(false);
          }
          expect(overlap(r, hint), `${layout.format} ${name}: ${kind} room vs the camera hint`).toBe(false);
        }
        // Tight rooms scroll the expanded choices while keeping the panel clear of the hand.
        expect(rooms.panel!.height * k, `${layout.format} ${name}: panel room height`).toBeGreaterThanOrEqual(159);
      }
    }
  });

  it("falls back to a room that covers your name plate when no other room is free (never a card)", () => {
    const fit = { width: TIGHT.width, height: (TIGHT.height * 860) / 956 };
    const k = stageFit(fit);
    const spread = stageSpread(fit);
    const poses = seatPoses(three, camera(), fit);
    const wide = wideHoloAnchors(three, camera(), poses, spread, true, { hint: { width: 250 / k, height: 40 / k } });
    const anchors = new Map(three.slots.map((slot) => [slot.seat, wide?.get(slot.seat) ?? holoAnchor(three, slot.seat, camera())] as const));
    const home = [...poses.values()].find((pose) => pose.slot === "home")!;
    const board = boardBounds(home);
    const plate = { l: board.l, r: board.l + 230 * home.scale, t: board.b - 6, b: board.b + 44 * home.scale };
    // The only free place: a small hole under the board's left corner, left of your hand. Strips fence it off, 5 px clear.
    const hole = { l: board.l + 5, r: board.l + 65, t: board.b + 9, b: board.b + 21 };
    const strip = (l: number, r: number, t: number, b: number) => ({ x: l, y: t, width: r - l, height: b - t });
    const reserved = [
      strip(-2000, hole.l - 5, -2000, 2000),
      strip(hole.r + 5, 2000, -2000, 2000),
      strip(hole.l - 5, hole.r + 5, -2000, hole.t - 5),
      strip(hole.l - 5, hole.r + 5, hole.b + 5, 2000),
    ];
    const room = promptRoom({
      layout: three, camera: camera(), poses, anchors, spread, meFooter: true, hint: { width: 250 / k, height: 40 / k },
      sizes: [{ width: 50, height: 10 }], reserved,
    });
    expect(room, "a room under the name plate").not.toBeNull();
    const r = { l: room!.x, r: room!.x + room!.width, t: room!.y, b: room!.y + room!.height };
    expect(overlap(r, plate), "the room covers the name plate").toBe(true);
    for (const [seat, pose] of poses) expect(overlap(r, boardBounds(pose)), `room vs board ${seat}`).toBe(false);
  });

  it("reserves the measured chain strip before allocating prompt rooms", () => {
    const extra = [{ name: "1920 open", box: { width: 1468, height: 950 } }, { name: "1440 closed", box: { width: 1368, height: 776 } }]
      .map(({ name, box }) => ({ name, box, fit: { width: box.width, height: box.height * 860 / 956 } }));
    for (const { name, box, fit } of [...BOXES, ...extra]) {
      const k = stageFit(fit);
      const spread = stageSpread(fit);
      for (const layout of [four, three]) {
        const poses = seatPoses(layout, camera(), fit);
        const anchors = wideHoloAnchors(layout, camera(), poses, spread, true)!;
        const rooms = promptRooms({ layout, camera: camera(), poses, anchors, spread, meFooter: true, box, k, chainSize: { width: 300, height: 88 } });
        const inset = chainStripInset({ layout, camera: camera(), box, meFooter: true, chainSize: { width: 300, height: 88 } });
        if (inset) {
          // The whole canvas, its hands and plates start below this dedicated room.
          expect(inset).toBeGreaterThanOrEqual(88 + 8);
          const band = chainBandRooms({ width: 300, height: 88 }, box);
          expect(band.panel.x).toBeGreaterThan(band.chain.x + band.chain.width);
          expect(band.panel.x + band.panel.width).toBeLessThanOrEqual(box.width);
          expect(band.panel.y + band.panel.height).toBeLessThan(inset);
          expect(band.chain.y + band.chain.height).toBeLessThan(inset);
          continue;
        }
        expect(rooms.chain, `${layout.format} ${name}: chain room`).not.toBeNull();
        const c = rooms.chain!;
        const rect = { l: c.x, t: c.y, r: c.x + c.width, b: c.y + c.height };
        expect(c.width * k).toBeGreaterThanOrEqual(300);
        expect(c.height * k).toBeGreaterThanOrEqual(88);
        for (const pose of poses.values()) {
          expect(overlap(rect, boardBounds(pose)), `${layout.format} ${name}: chain on board`).toBe(false);
          if (pose.slot === "home") {
            const board = boardBounds(pose);
            expect(overlap(rect, { l: pose.x - 330, r: pose.x + 330, t: board.b, b: board.b + 120 }), `${layout.format} ${name}: chain on hand`).toBe(false);
          }
        }
        for (const a of anchors.values()) {
          expect(overlap(rect, { l: a.x, t: a.y - 14, r: a.x + (a.me ? (a.footerTight ? 212 : 270) : 196), b: a.y + (a.me ? 171 : 122) }), `${layout.format} ${name}: chain on LP/master`).toBe(false);
        }
        for (const kind of ["panel", "bar"] as const) {
          const p = rooms[kind];
          expect(p, `${layout.format} ${name}: ${kind}`).not.toBeNull();
          expect(overlap(rect, { l: p!.x, t: p!.y, r: p!.x + p!.width, b: p!.y + p!.height }), `${layout.format} ${name}: chain on ${kind}`).toBe(false);
        }
      }
    }
  });

  it("leaves the plates to their classic anchors when there is no spread or the camera has left home", () => {
    expect(wideHoloAnchors(four, camera(), seatPoses(four, camera(), CLASSIC), 0)).toBeNull();
    const focus = camera({ mode: "focus", focusSeat: 1 });
    expect(wideHoloAnchors(four, focus, seatPoses(four, focus, WIDE), stageSpread(WIDE))).toBeNull();
  });
});
