import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelFormat, DuelSeatView } from "@yugidraft/shared/duels";
import {
  boardBounds,
  promptLane,
  seatPoses,
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
    mode: "home", focusSeat: null, lookSeat: null, upright: false, compact: "auto", auto: true, pinned: false, aiming: false,
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

  it("keeps every plate off the camera hint corner, and off the prompt card corner whenever there is room for that", () => {
    for (const box of [WIDE, TIGHT]) {
      const k = Math.min(box.width / 1100, box.height / 956);
      const spread = stageSpread(box);
      const hint = { width: 250 / k, height: 40 / k };
      const dock = promptLane(box, k);
      for (const layout of [four, three]) {
        const poses = seatPoses(layout, camera(), box);
        const anchors = wideHoloAnchors(layout, camera(), poses, spread, true, { dock, hint })!;
        for (const [seat, a] of anchors) {
          const r = { l: a.x, t: a.y, r: a.x + (a.me ? 270 : 196), b: a.y + (a.me ? 171 : 92) };
          const corner = { l: -spread, r: -spread + hint.width, t: 952 - hint.height, b: 952 };
          const apart = r.r <= corner.l || corner.r <= r.l || r.b <= corner.t || corner.b <= r.t;
          expect(apart, `${layout.format} ${box.width}: plate ${seat} vs the camera hint`).toBe(true);
        }
      }
    }
    // With room (a big screen) no plate is under the prompt card either.
    const spread = stageSpread(WIDE);
    const k = WIDE.height / 956;
    const dock = promptLane(WIDE, k);
    const anchors = wideHoloAnchors(four, camera(), seatPoses(four, camera(), WIDE), spread, true, { dock, hint: { width: 250 / k, height: 40 / k } })!;
    for (const [seat, a] of anchors) {
      const r = { l: a.x, t: a.y, r: a.x + (a.me ? 270 : 196), b: a.y + (a.me ? 171 : 92) };
      const apart = r.r <= -spread || -spread + dock.width <= r.l || r.b <= dock.top || dock.bottom <= r.t;
      expect(apart, `plate ${seat} vs the prompt card corner`).toBe(true);
    }
  });

  it("leaves the plates to their classic anchors when there is no spread or the camera has left home", () => {
    expect(wideHoloAnchors(four, camera(), seatPoses(four, camera(), CLASSIC), 0)).toBeNull();
    const focus = camera({ mode: "focus", focusSeat: 1 });
    expect(wideHoloAnchors(four, focus, seatPoses(four, focus, WIDE), stageSpread(WIDE))).toBeNull();
  });
});
