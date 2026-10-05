import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelFormat, DuelSeatView } from "@yugidraft/shared/duels";
import {
  ARENA_CENTER,
  flyWorld,
  flyYawFor,
  holoAnchor,
  ringAngles,
  ringPose,
  seatNormal,
  seatPoses,
  stageFit,
  slotPlan,
  slotZIndex,
  tableLayout,
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
    const poses = seatPoses(layout, camera());
    expect(poses.size).toBe(3);
    expect(poses.get(0)).toMatchObject({ x: 550, y: 582, scale: 1, rotateDeg: 0, docked: false, compact: false, hidden: false });
    expect(poses.get(1)).toMatchObject({ x: 298, y: 222, scale: 0.66, rotateDeg: 158, tiltDeg: 12 });
    expect(poses.get(2)).toMatchObject({ x: 802, y: 222, scale: 0.66, rotateDeg: 202, tiltDeg: 12 });
  });

  it("follows the viewer: the seat after the viewer sits left", () => {
    const poses = seatPoses(tableLayout("ffa3", engine("ffa3", 3), 2), camera());
    expect(poses.get(2)?.x).toBe(550);
    expect(poses.get(0)?.x).toBe(298);
    expect(poses.get(1)?.x).toBe(802);
  });

  it("keeps the same poses when upright is on (only text turns)", () => {
    const home = seatPoses(layout, camera());
    const up = seatPoses(layout, camera({ upright: true }));
    for (const seat of [0, 1, 2]) expect(up.get(seat)).toEqual(home.get(seat));
  });

  it("gives every pose of a 4-way table a place inside the stage", () => {
    const four = tableLayout("ffa4", engine("ffa4", 4), 0);
    const poses = seatPoses(four, camera());
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
