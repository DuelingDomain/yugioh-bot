import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelFormat, DuelSeatView } from "@yugidraft/shared/duels";
import {
  ARENA_CENTER,
  boardBounds,
  compactFor,
  flyWorld,
  flyYawFor,
  holoAnchor,
  holoObstacle,
  ARENA_SIGN,
  HUB_STRIP,
  hubPose,
  ringAngles,
  ringPose,
  seatNormal,
  seatObstacles,
  seatPoses,
  stageFit,
  stageSpread,
  slotPlan,
  slotZIndex,
  tableLayout,
  wideHoloAnchors,
  wideHomeSlots,
} from "@/components/duel/table/geometry";
import type { CameraState } from "@/components/duel/table/types";

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null], spells: [null, null, null, null, null, null],
    graveyard: [], banished: [], ...extra,
  };
}
function engine(format: DuelFormat, count: number): DuelEngineView {
  return {
    revision: 1, format, turn: 1, turnSeat: 0, phase: "main1",
    seats: Array.from({ length: count }, (_, seat) => seatView(seat, { team: format === "tag" ? seat % 2 : seat })),
    prompt: null, chain: [], events: [], log: [], result: null,
  };
}
function camera(over: Partial<CameraState> = {}): CameraState {
  return {
    mode: "home", focusSeat: null, lookSeat: null, upright: false, compact: "auto", auto: true, pinned: false, aiming: false,
    fly: { yawDeg: 0, tiltDeg: 40, zoom: 1, targetSeat: null }, lock: null, ...over,
  };
}
// A box exactly the stage's shape: no room beyond the stage, so every pose is the classic one.
const VIEW = { width: 1100, height: 860 };
// A box wider than the stage (a 1920 by 1080 screen under the 72px rail and the top and bottom bars).
const WIDE = { width: 1848, height: 950 };

describe("tableLayout", () => {
  it("places a 3-way table clockwise from the viewer with viewer-relative tones", () => {
    const layout = tableLayout("ffa3", engine("ffa3", 3), 1);
    expect(layout.format).toBe("ffa3");
    expect(layout.viewerSeat).toBe(1);
    expect(layout.anchorSeat).toBe(1);
    expect(layout.stage).toEqual({ width: 1100, height: 860 });
    expect(layout.slots.map((s) => s.seat)).toEqual([1, 2, 0]);
    expect(layout.slots.map((s) => s.tone)).toEqual(["violet", "ice", "verdant"]);
    expect(layout.slots.map((s) => s.compass)).toEqual(["S", "W", "E"]);
    expect(layout.slots.map((s) => s.baseAngleDeg)).toEqual([0, 120, 240]);
    expect(layout.slots.map((s) => s.relation)).toEqual(["self", "opponent", "opponent"]);
    expect(layout.slots.every((s) => s.team === null && s.code === null)).toBe(true);
    expect(layout.slots.map((s) => s.turnOrder)).toEqual([1, 2, 0]);
  });

  it("anchors a spectator on seat 0 with every seat as other", () => {
    const layout = tableLayout("ffa3", engine("ffa3", 3), null);
    expect(layout.viewerSeat).toBeNull();
    expect(layout.anchorSeat).toBe(0);
    expect(layout.slots.map((s) => s.seat)).toEqual([0, 1, 2]);
    expect(layout.slots.every((s) => s.relation === "other")).toBe(true);
    expect(layout.slots.map((s) => s.tone)).toEqual(["violet", "ice", "verdant"]);
  });

  it("places a 4-way table at 90 degrees with Rose last", () => {
    const layout = tableLayout("ffa4", engine("ffa4", 4), 0);
    expect(layout.slots.map((s) => s.compass)).toEqual(["S", "W", "N", "E"]);
    expect(layout.slots.map((s) => s.baseAngleDeg)).toEqual([0, 90, 180, 270]);
    expect(layout.slots.map((s) => s.tone)).toEqual(["violet", "ice", "verdant", "rose"]);
  });

  it("puts the Tag partner next to the viewer with team glyph data and order codes", () => {
    const layout = tableLayout("tag", engine("tag", 4), 0);
    expect(layout.slots.map((s) => s.seat)).toEqual([0, 2, 1, 3]);
    expect(layout.slots.map((s) => s.relation)).toEqual(["self", "partner", "opponent", "opponent"]);
    expect(layout.slots.map((s) => s.tone)).toEqual(["violet", "ice", "rose", "verdant"]);
    expect(layout.slots.map((s) => s.team)).toEqual([0, 0, 1, 1]);
    expect(layout.slots.map((s) => s.code)).toEqual(["1A", "1B", "2A", "2B"]);
    expect(layout.slots.map((s) => s.baseAngleDeg)).toEqual([0, 0, 180, 180]);
  });

  it("gives a Tag spectator the colours of seat 0 and its partner", () => {
    const layout = tableLayout("tag", engine("tag", 4), null);
    expect(layout.slots.map((s) => s.seat)).toEqual([0, 2, 1, 3]);
    expect(layout.slots.map((s) => s.tone)).toEqual(["violet", "ice", "rose", "verdant"]);
    expect(layout.slots.every((s) => s.relation === "other")).toBe(true);
  });
});

describe("seatPoses", () => {
  const layout = tableLayout("ffa3", engine("ffa3", 3), 0);

  it("home pose of a 3-way table: you full size at the bottom, rivals small and turned", () => {
    const poses = seatPoses(layout, camera(), VIEW);
    expect(poses.size).toBe(3);
    expect(poses.get(0)).toMatchObject({ x: 550, y: 582, scale: 1, rotateDeg: 0, docked: false, compact: false, hidden: false });
    expect(poses.get(1)).toMatchObject({ x: 298, y: 222, scale: 0.66, rotateDeg: 158, tiltDeg: 12 });
    expect(poses.get(2)).toMatchObject({ x: 802, y: 222, scale: 0.66, rotateDeg: 202, tiltDeg: 12 });
  });

  it("follows the viewer: the seat after the viewer sits left", () => {
    const poses = seatPoses(tableLayout("ffa3", engine("ffa3", 3), 2), camera(), VIEW);
    expect(poses.get(2)?.x).toBe(550);
    expect(poses.get(0)?.x).toBe(298);
    expect(poses.get(1)?.x).toBe(802);
  });

  it("keeps the same poses when upright is on (only text turns)", () => {
    const home = seatPoses(layout, camera(), VIEW);
    const up = seatPoses(layout, camera({ upright: true }), VIEW);
    for (const seat of [0, 1, 2]) expect(up.get(seat)).toEqual(home.get(seat));
  });

  it("gives every pose of a 4-way table a place inside the stage", () => {
    const four = tableLayout("ffa4", engine("ffa4", 4), 0);
    const poses = seatPoses(four, camera(), VIEW);
    expect(poses.size).toBe(4);
    for (const pose of poses.values()) {
      expect(pose.x).toBeGreaterThan(0);
      expect(pose.x).toBeLessThan(1100);
      expect(pose.y).toBeGreaterThan(0);
      expect(pose.y).toBeLessThan(860);
    }
    expect(poses.get(0)).toMatchObject({ x: 550, rotateDeg: 0, scale: 1 });
  });
});

describe("stageFit", () => {
  it("scales the 1100 by 860 stage to fit the box", () => {
    expect(stageFit({ width: 1100, height: 860 })).toBe(1);
    expect(stageFit({ width: 2200, height: 900 })).toBeCloseTo(900 / 860, 6);
    expect(stageFit({ width: 550, height: 2000 })).toBeCloseTo(0.5, 6);
  });
  it("returns 0 for an empty box", () => {
    expect(stageFit({ width: 0, height: 500 })).toBe(0);
    expect(stageFit({ width: -4, height: 500 })).toBe(0);
  });
});

describe("seatNormal", () => {
  const base = { seat: 0, x: 0, y: 0, scale: 1, z: 112, docked: false, compact: false, hidden: false };
  it("points from the field to the table centre", () => {
    const south = seatNormal({ ...base, rotateDeg: 0 });
    expect(south.x).toBeCloseTo(0, 6);
    expect(south.y).toBeCloseTo(-1, 6);
    const north = seatNormal({ ...base, rotateDeg: 180 });
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.y).toBeCloseTo(1, 6);
    const west = seatNormal({ ...base, rotateDeg: 90 });
    expect(west.x).toBeCloseTo(1, 6);
    expect(west.y).toBeCloseTo(0, 6);
  });
});

describe("holoAnchor", () => {
  it("anchors the holo LP panels of a 3-way table", () => {
    const layout = tableLayout("ffa3", engine("ffa3", 3), 0);
    expect(holoAnchor(layout, 0)).toMatchObject({ x: 882, y: 686, me: true });
    expect(holoAnchor(layout, 1)).toMatchObject({ x: 8, y: 8, me: false });
    expect(holoAnchor(layout, 2)).toMatchObject({ x: 896, y: 8, me: false });
  });
  it("exports the arena centre", () => {
    expect(ARENA_CENTER).toEqual({ x: 550, y: 410 });
  });
});

describe("3-way camera places", () => {
  const layout = tableLayout("ffa3", engine("ffa3", 3), 0); // places: 0 you, 1 Ryo (left), 2 Mika (right)
  const slots = (cam: Parameters<typeof camera>[0]) => [...seatPoses(layout, camera(cam)).values()].map((pose) => pose.slot);

  it("home keeps you at the bottom and the rivals up in the corners", () => {
    expect(slots({})).toEqual(["home", "vL", "vR"]);
    const poses = seatPoses(layout, camera());
    expect(poses.get(1)).toMatchObject({ x: 298, y: 222, scale: 0.66, rotateDeg: 158, tiltDeg: 12 });
    expect(poses.get(0)).toMatchObject({ x: 550, y: 582, scale: 1, rotateDeg: 0, tiltDeg: 0 });
  });

  it("focus puts the rival across and docks the other one at its side", () => {
    expect(slots({ mode: "focus", focusSeat: 1 })).toEqual(["home", "focus", "dockR"]);
    expect(slots({ mode: "focus", focusSeat: 2 })).toEqual(["home", "dockL", "focus"]);
    const poses = seatPoses(layout, camera({ mode: "focus", focusSeat: 2 }));
    expect(poses.get(2)).toMatchObject({ x: 550, y: 206, scale: 0.9, rotateDeg: 180, docked: false });
    expect(poses.get(1)).toMatchObject({ x: 110, y: 272, scale: 0.46, rotateDeg: 90, docked: true });
    expect(poses.get(0)?.slot).toBe("home");
  });

  it("focus with no seat, or on you, stays at home", () => {
    expect(slots({ mode: "focus", focusSeat: null })).toEqual(["home", "vL", "vR"]);
    expect(slots({ mode: "focus", focusSeat: 0 })).toEqual(["home", "vL", "vR"]);
  });

  it("look turns the table so the rival you look from takes the home place", () => {
    expect(slots({ mode: "look", lookSeat: 1 })).toEqual(["vR", "home", "vL"]);
    expect(slots({ mode: "look", lookSeat: 2 })).toEqual(["vL", "vR", "home"]);
    expect(seatPoses(layout, camera({ mode: "look", lookSeat: 1 })).get(1)).toMatchObject({ x: 550, y: 582, rotateDeg: 0 });
  });

  it("overview and fly place the three fields evenly, 120 degrees apart", () => {
    for (const mode of ["overview", "fly"] as const) {
      expect(slots({ mode })).toEqual(["oHome", "oL", "oR"]);
    }
    const poses = seatPoses(layout, camera({ mode: "overview" }));
    expect([0, 1, 2].map((seat) => poses.get(seat)?.rotateDeg)).toEqual([0, 120, 240]);
    expect(poses.get(1)).toMatchObject({ x: 327, y: 301, scale: 0.58 });
  });

  it("the plan is null for tag, which keeps its home poses in every mode", () => {
    const tag = tableLayout("tag", engine("tag", 4), 0);
    expect(slotPlan(tag, { mode: "focus", focusSeat: 1 })).toBeNull();
    const home = seatPoses(tag, camera());
    const focus = seatPoses(tag, camera({ mode: "focus", focusSeat: 1 }));
    expect([...focus.values()].map((p) => [p.x, p.y])).toEqual([...home.values()].map((p) => [p.x, p.y]));
  });

  it("slotZIndex ranks home above the rest and falls back to scale", () => {
    expect(slotZIndex("home", 1)).toBeGreaterThan(slotZIndex("focus", 0.9));
    expect(slotZIndex("focus", 0.9)).toBeGreaterThan(slotZIndex("dockL", 0.46));
    expect(slotZIndex(undefined, 1)).toBe(5);
  });

  it("holo panels follow their seat to the corner of its place", () => {
    const at = (seat: number, cam: Parameters<typeof camera>[0]) => holoAnchor(layout, seat, camera(cam));
    expect(at(0, {})).toMatchObject({ x: 882, y: 686, me: true, beam: "none" });
    expect(at(1, {})).toMatchObject({ x: 8, y: 8, me: false, beam: "down" });
    expect(at(1, { mode: "focus", focusSeat: 1 })).toMatchObject({ x: 8, y: 10 });
    expect(at(2, { mode: "focus", focusSeat: 2 })).toMatchObject({ x: 896, y: 10 });
    expect(at(2, { mode: "focus", focusSeat: 1 })).toMatchObject({ x: 896, y: 8, beam: "none" });
    expect(at(0, { mode: "overview" })).toMatchObject({ x: 764, y: 690 });
    expect(at(1, { mode: "overview" })).toMatchObject({ x: 14, y: 548, beam: "up" });
    expect(at(2, { mode: "overview" })).toMatchObject({ x: 896, y: 548, beam: "up" });
  });

  it("the panel of the viewer is not 'me' while looking from a rival's seat", () => {
    expect(holoAnchor(layout, 0, camera({ mode: "look", lookSeat: 1 })).me).toBe(false);
    expect(holoAnchor(layout, 1, camera({ mode: "look", lookSeat: 1 })).me).toBe(false);
  });

  it("without a camera the holo anchors are the home ones", () => {
    expect(holoAnchor(layout, 0)).toMatchObject({ x: 882, y: 686, me: true });
    expect(holoAnchor(layout, 2)).toMatchObject({ x: 896, y: 8 });
  });

  it("ringPose keeps the turn ring clear of the fields in each mode", () => {
    expect(ringPose(layout, camera())).toEqual({ x: 550, y: 322, scale: 1 });
    expect(ringPose(layout, camera({ mode: "focus", focusSeat: 1 }))).toEqual({ x: 150, y: 404, scale: 0.62 });
    expect(ringPose(layout, camera({ mode: "focus", focusSeat: 2 }))).toEqual({ x: 950, y: 404, scale: 0.62 });
    expect(ringPose(layout, camera({ mode: "overview" }))).toEqual({ x: 550, y: 98, scale: 0.9 });
    expect(ringPose(layout, camera({ mode: "fly" }))).toEqual({ x: 550, y: 430, scale: 1 });
  });

  it("ringAngles puts every seat on the ring where its place is", () => {
    const angles = (cam: Parameters<typeof camera>[0]) => Object.fromEntries(ringAngles(layout, camera(cam)));
    expect(angles({})).toEqual({ 0: 90, 1: 210, 2: 330 });
    expect(angles({ mode: "focus", focusSeat: 1 })).toEqual({ 0: 90, 1: 270, 2: 0 });
    expect(angles({ mode: "look", lookSeat: 1 })).toEqual({ 0: 330, 1: 90, 2: 210 });
    expect(angles({ mode: "overview" })).toEqual({ 0: 90, 1: 210, 2: 330 });
  });

  it("flyYawFor turns the plaza so that a seat's field reads upright", () => {
    expect(flyYawFor(layout, 0)).toBeCloseTo(0, 5);
    expect(flyYawFor(layout, 1)).toBeCloseTo(-120, 5);
    expect(flyYawFor(layout, 2)).toBeCloseTo(120, 5);
    expect(flyYawFor(tableLayout("tag", engine("tag", 4), 0), 1)).toBe(0);
  });

  it("flyWorld looks at the arena with no target and at the seat's place with one", () => {
    const fly = { yawDeg: 12, tiltDeg: 40, zoom: 0.9, targetSeat: null };
    expect(flyWorld(layout, fly)).toEqual({ yawDeg: 12, tiltDeg: 40, zoom: 0.9, fx: 0, fy: 6, oy: -6 });
    const target = flyWorld(layout, { ...fly, targetSeat: 1, zoom: 1.8 });
    expect(target).toMatchObject({ zoom: 1.8, fx: 327 - ARENA_CENTER.x, fy: 301 - ARENA_CENTER.y, oy: 36 });
  });
});

describe("4-way camera places", () => {
  const layout = tableLayout("ffa4", engine("ffa4", 4), 0);
  const plan = (cam: Parameters<typeof camera>[0]) => slotPlan(layout, camera(cam));

  it("home puts you at the bottom, the next seat west, one across, the last east", () => {
    expect(plan({})).toEqual(["home", "vL", "vN", "vR"]);
    const poses = seatPoses(layout, camera(), VIEW);
    expect(poses.get(0)).toMatchObject({ x: 550, y: 610, rotateDeg: 0, scale: 1, slot: "home", compact: false });
    expect(poses.get(1)).toMatchObject({ x: 148, y: 223, rotateDeg: 90, scale: 0.6, slot: "vL" });
    expect(poses.get(2)).toMatchObject({ x: 550, y: 150, rotateDeg: 180, scale: 0.6, tiltDeg: 16, slot: "vN" });
    expect(poses.get(3)).toMatchObject({ x: 952, y: 223, rotateDeg: 270, scale: 0.6, slot: "vR" });
  });

  it("focus puts the focused rival across at 92 percent and docks the other two in seat order", () => {
    expect(plan({ mode: "focus", focusSeat: 1 })).toEqual(["home", "focus", "dockL", "dockR"]);
    expect(plan({ mode: "focus", focusSeat: 2 })).toEqual(["home", "dockL", "focus", "dockR"]);
    expect(plan({ mode: "focus", focusSeat: 3 })).toEqual(["home", "dockL", "dockR", "focus"]);
    const poses = seatPoses(layout, camera({ mode: "focus", focusSeat: 3 }), VIEW);
    expect(poses.get(3)).toMatchObject({ x: 550, y: 228, rotateDeg: 180, scale: 0.92, tiltDeg: 9 });
    expect(poses.get(1)).toMatchObject({ x: 124, y: 289, rotateDeg: 90, scale: 0.5, docked: true });
    expect(poses.get(2)).toMatchObject({ x: 976, y: 289, rotateDeg: -90, scale: 0.5, docked: true });
  });

  it("focus with no seat or on you stays at home", () => {
    expect(plan({ mode: "focus", focusSeat: null })).toEqual(["home", "vL", "vN", "vR"]);
    expect(plan({ mode: "focus", focusSeat: 0 })).toEqual(["home", "vL", "vN", "vR"]);
  });

  it("look turns the table by 90, 180 or 270 degrees", () => {
    expect(plan({ mode: "look", lookSeat: 1 })).toEqual(["vR", "home", "vL", "vN"]);
    expect(plan({ mode: "look", lookSeat: 2 })).toEqual(["vN", "vR", "home", "vL"]);
    expect(plan({ mode: "look", lookSeat: 3 })).toEqual(["vL", "vN", "vR", "home"]);
  });

  it("overview and fly place the four fields on the compass", () => {
    expect(plan({ mode: "overview" })).toEqual(["oHome", "oL", "oN", "oR"]);
    expect(plan({ mode: "fly" })).toEqual(["oHome", "oL", "oN", "oR"]);
    const poses = seatPoses(layout, camera({ mode: "overview" }), VIEW);
    expect(poses.get(0)).toMatchObject({ x: 550, y: 660, scale: 0.52 });
    expect(poses.get(2)).toMatchObject({ x: 550, y: 131, rotateDeg: 180 });
  });

  it("holo panels follow their place", () => {
    const at = (seat: number, cam: Parameters<typeof camera>[0]) => holoAnchor(layout, seat, camera(cam));
    expect(at(0, {})).toMatchObject({ x: 882, y: 686, me: true, beam: "none" });
    expect(at(1, {})).toMatchObject({ x: 8, y: 431, me: false, beam: "up" });
    expect(at(2, {})).toMatchObject({ x: 260, y: 290, beam: "none" });
    expect(at(3, {})).toMatchObject({ x: 896, y: 431, beam: "up" });
    expect(at(1, { mode: "focus", focusSeat: 1 })).toMatchObject({ x: 8, y: 8 });
    expect(at(2, { mode: "focus", focusSeat: 1 })).toMatchObject({ x: 8, y: 464, beam: "up" });
    expect(at(3, { mode: "focus", focusSeat: 1 })).toMatchObject({ x: 896, y: 464 });
    expect(at(0, { mode: "look", lookSeat: 2 }).me).toBe(false);
    // Overview: your own panel keeps the home x, so it stays inside the stage at 1280 wide.
    expect(at(0, { mode: "overview" })).toMatchObject({ x: 882, y: 740, me: true });
  });

  it("the turn ring keeps clear of the fields and each seat sits at its compass angle", () => {
    expect(ringPose(layout, camera())).toEqual({ x: 550, y: 342, scale: 1 });
    expect(ringPose(layout, camera({ mode: "focus", focusSeat: 2 }))).toEqual({ x: 1036, y: 60, scale: 0.72 });
    expect(ringPose(layout, camera({ mode: "overview" }))).toEqual({ x: 550, y: 395, scale: 0.9 });
    const angles = (cam: Parameters<typeof camera>[0]) => Object.fromEntries(ringAngles(layout, camera(cam)));
    expect(angles({})).toEqual({ 0: 90, 1: 180, 2: 270, 3: 0 });
    expect(angles({ mode: "focus", focusSeat: 3 })).toEqual({ 0: 90, 1: 180, 2: 0, 3: 270 });
    expect(angles({ mode: "look", lookSeat: 1 })).toEqual({ 0: 0, 1: 90, 2: 180, 3: 270 });
  });

  it("flyYawFor turns the plaza so a seat's field reads upright", () => {
    expect(flyYawFor(layout, 0)).toBeCloseTo(0, 5);
    expect(flyYawFor(layout, 1)).toBeCloseTo(-90, 5);
    expect(Math.abs(flyYawFor(layout, 2))).toBeCloseTo(180, 5);
    expect(flyYawFor(layout, 3)).toBeCloseTo(90, 5);
  });

  it("flyWorld looks at the overview place of the target seat", () => {
    const fly = { yawDeg: 0, tiltDeg: 30, zoom: 1.8, targetSeat: 1 };
    expect(flyWorld(layout, fly)).toMatchObject({ fx: 129 - ARENA_CENTER.x, fy: 395 - ARENA_CENTER.y, oy: 36 });
  });
});

describe("compactFor", () => {
  const unit = (scale: number) => ({ scale, slot: "dockL" as const });
  it("goes compact below 44 px of rival card height, or 40 px under 1440 px of window", () => {
    // card height = 112 * scale * stage scale
    expect(compactFor(unit(0.5), 0.75, 1600)).toBe(true); // 42
    expect(compactFor(unit(0.5), 0.8, 1600)).toBe(false); // 44.8
    expect(compactFor(unit(0.5), 0.75, 1280)).toBe(false); // 42 >= 40
    expect(compactFor(unit(0.5), 0.7, 1280)).toBe(true); // 39.2
  });
  it("never compacts your own place; 'on' compacts every other place, 'off' none", () => {
    expect(compactFor({ scale: 1, slot: "home" }, 0.1, 1200)).toBe(false);
    expect(compactFor({ scale: 0.52, slot: "oHome" }, 0.1, 1200)).toBe(false);
    expect(compactFor(unit(0.92), 1, 1600, "on")).toBe(true);
    expect(compactFor(unit(0.5), 0.3, 1200, "off")).toBe(false);
  });
});

// ---- the phase hub card ----
type Pt = { x: number; y: number };
function box(cx: number, cy: number, w: number, h: number, deg = 0): Pt[] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}
function overlaps(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q.y - p.y;
      const ny = p.x - q.x;
      const range = (pts: Pt[]) => {
        const v = pts.map((t) => t.x * nx + t.y * ny);
        return [Math.min(...v), Math.max(...v)];
      };
      const [a0, a1] = range(a);
      const [b0, b1] = range(b);
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}

describe("hubPose", () => {
  const cases: Array<[string, DuelFormat, number, Partial<CameraState>]> = [
    ["ffa3 home", "ffa3", 3, {}],
    ["ffa3 look", "ffa3", 3, { mode: "look", lookSeat: 1 }],
    ["ffa3 overview", "ffa3", 3, { mode: "overview" }],
    ["ffa3 focus on the left rival", "ffa3", 3, { mode: "focus", focusSeat: 1 }],
    ["ffa3 focus on the right rival", "ffa3", 3, { mode: "focus", focusSeat: 2 }],
    ["ffa4 home", "ffa4", 4, {}],
    ["ffa4 look", "ffa4", 4, { mode: "look", lookSeat: 1 }],
    ["ffa4 overview", "ffa4", 4, { mode: "overview" }],
    ["ffa4 focus on the far rival", "ffa4", 4, { mode: "focus", focusSeat: 2 }],
    ["ffa4 focus on the left rival", "ffa4", 4, { mode: "focus", focusSeat: 1 }],
    ["ffa4 focus on the right rival", "ffa4", 4, { mode: "focus", focusSeat: 3 }],
  ];

  // The table boxes the stage can have (screen px, before TableStage trims the hand row off the height): the shell at 1440 x 900 with the
  // drawer shut and open (the open drawer leaves a box no wider than the stage), 1366 x 768, 1920 x 1080 shut and open, 2560 x 1440.
  const boxes: Array<[string, { width: number; height: number } | undefined]> = [
    ["the classic stage", undefined],
    ["1440 x 900, drawer shut", { width: 1368, height: 740 }],
    ["1440 x 900, drawer open", { width: 988, height: 740 }],
    ["1366 x 768", { width: 1294, height: 649 }],
    ["1920 x 1080, drawer shut", { width: 1848, height: 950 }],
    ["1920 x 1080, drawer open", { width: 1500, height: 950 }],
    ["2560 x 1440", { width: 2488, height: 1290 }],
  ];
  const fitOf = (box: { width: number; height: number }) => ({ ...box, height: (box.height * 860) / 956 });

  describe.each(boxes)("%s", (_boxLabel, rawBox) => {
    const area = rawBox ? fitOf(rawBox) : undefined;
    it.each([...cases, ["ffa3 fly", "ffa3", 3, { mode: "fly" }] as (typeof cases)[number], ["ffa4 fly", "ffa4", 4, { mode: "fly" }] as (typeof cases)[number]])(
      "%s: the strip overlaps no seat field, hand, name label or LP panel, not the ARENA 07 sign, the ring, your hand's row or the camera hint",
      (_label, format, count, over) => {
        const layout = tableLayout(format as "ffa3", engine(format, count), 0);
        const view = camera(over);
        // The fly-in keeps the home place, so it is checked against the home boards and plates.
        const seen = view.mode === "fly" ? camera() : view;
        const poses = seatPoses(layout, seen, area);
        const at = hubPose(layout, view, area ? { box: area, meFooter: true } : undefined);
        const spread = area ? stageSpread(area) : 0;
        const anchors = new Map(
          layout.slots.map((slot) => [slot.seat, (area && wideHoloAnchors(layout, seen, poses, spread, true, { hint: { width: 250 / stageFit(area), height: 40 / stageFit(area) } })?.get(slot.seat)) || holoAnchor(layout, slot.seat, seen)] as const),
        );
        const card = box(at.x, at.y, at.width, at.height);
        expect(at.width).toBe(HUB_STRIP[at.size].width);
        expect(at.height).toBe(HUB_STRIP[at.size].height);
        // 5px of air around the whole of every seat (field, hand and name label), see seatObstacles.
        layout.slots.forEach((slot, place) => {
          const pose = poses.get(slot.seat)!;
          if (pose.hidden) return;
          for (const rect of seatObstacles(pose, place === 0)) {
            expect(overlaps(card, box(rect.x, rect.y, rect.width + 10, rect.height + 10, rect.rotateDeg))).toBe(false);
          }
        });
        // 8px of air around every LP plate as drawn (the wide docks, or the classic ones), and under yours the Deck Master chip.
        for (const slot of layout.slots) {
          const anchor = anchors.get(slot.seat)!;
          const plate = holoObstacle(anchor);
          expect(overlaps(card, box(plate.x, plate.y, plate.width + 16, plate.height + 16))).toBe(false);
          if (anchor.me && area && spread > 0) {
            expect(overlaps(card, box(anchor.x + 135, anchor.y + (113 + 58) / 2, 270 + 16, 113 + 58 + 16))).toBe(false);
          }
        }
        // The ARENA 07 sign on the plaza.
        expect(overlaps(card, box(ARENA_SIGN.x + ARENA_SIGN.width / 2, ARENA_SIGN.y + ARENA_SIGN.height / 2, ARENA_SIGN.width, ARENA_SIGN.height))).toBe(false);
        const ring = ringPose(layout, seen);
        const dx = Math.max(Math.abs(at.x - ring.x) - at.width / 2, 0);
        const dy = Math.max(Math.abs(at.y - ring.y) - at.height / 2, 0);
        expect(Math.hypot(dx, dy)).toBeGreaterThan(62 * ring.scale);
        if (area && spread > 0) {
          // A wide table: your hand's row under the stage and the camera hint pill in the bottom left corner stay clear too.
          expect(overlaps(card, box(550, (860 - 4 + 960) / 2, 660, 960 - 856))).toBe(false);
          const k = stageFit(area);
          const hintW = 250 / k;
          const hintH = 40 / k;
          expect(overlaps(card, box(-spread + 6 - 6 + hintW / 2, 952 - hintH / 2, hintW, hintH))).toBe(false);
        }
        // The card stays inside the visible stage: 1100 x 860 plus the spread at each side, and above the hand row.
        expect(at.x - at.width / 2).toBeGreaterThanOrEqual(-spread);
        expect(at.x + at.width / 2).toBeLessThanOrEqual(1100 + spread);
        expect(at.y - at.height / 2).toBeGreaterThanOrEqual(0);
        expect(at.y + at.height / 2).toBeLessThanOrEqual(area && spread > 0 ? 952 : 860);
      },
    );
  });

  it("uses the small strip at a 3-way table, the large one above a 4-way ring in the overview", () => {
    const three = tableLayout("ffa3", engine("ffa3", 3), 0);
    const four = tableLayout("ffa4", engine("ffa4", 4), 0);
    for (const over of [{}, { mode: "overview" as const }, { mode: "focus" as const, focusSeat: 1 }, { mode: "focus" as const, focusSeat: 2 }]) {
      expect(hubPose(three, camera(over)).size).toBe("sm");
    }
    expect(hubPose(four, camera()).size).toBe("sm");
    expect(hubPose(four, camera({ mode: "overview" })).size).toBe("lg");
    expect(hubPose(four, camera({ mode: "focus", focusSeat: 2 })).size).toBe("sm");
  });

  it("stands in the gap between the right-hand rival's plate and yours in the 4-way focus view", () => {
    const four = tableLayout("ffa4", engine("ffa4", 4), 0);
    const view = camera({ mode: "focus", focusSeat: 3 });
    const at = hubPose(four, view);
    const rival = holoObstacle(holoAnchor(four, 2, view));
    const mine = holoObstacle(holoAnchor(four, 0, view));
    expect(rival.x).toBeGreaterThan(900);
    expect(at.y - at.height / 2).toBeGreaterThanOrEqual(rival.y + rival.height / 2 + 8);
    expect(at.y + at.height / 2).toBeLessThanOrEqual(mine.y - mine.height / 2 - 8);
  });

  it("centres a 4-way overview strip on the ring, above it", () => {
    const four = tableLayout("ffa4", engine("ffa4", 4), 0);
    const view = camera({ mode: "overview" });
    const ring = ringPose(four, view);
    const above = hubPose(four, view);
    expect(above.x).toBe(ring.x);
    expect(above.y + above.height / 2).toBeLessThan(ring.y - 62 * ring.scale);
  });

  it("puts a 3-way home strip to the right of your own field, level with its top half, never over the hand", () => {
    const three = tableLayout("ffa3", engine("ffa3", 3), 0);
    const home = seatPoses(three, camera()).get(0)!;
    for (const over of [{}, { mode: "look" as const, lookSeat: 1 }, { mode: "fly" as const }]) {
      const at = hubPose(three, camera(over));
      expect(at.x - at.width / 2).toBeGreaterThan(home.x + 653 / 2);
      expect(at.y).toBeGreaterThan(home.y - 190);
      expect(at.y).toBeLessThan(home.y);
    }
  });

  it("keeps the home place in the fly-in view", () => {
    const three = tableLayout("ffa3", engine("ffa3", 3), 0);
    const fly = hubPose(three, camera({ mode: "fly" }));
    expect({ x: fly.x, y: fly.y }).toEqual({ x: hubPose(three, camera()).x, y: hubPose(three, camera()).y });
  });
});
