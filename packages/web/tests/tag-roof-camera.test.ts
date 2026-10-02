import { describe, expect, it } from "vitest";
import {
  ROOF_LIMITS,
  ROOF_PRESETS,
  cameraLabel,
  clampCenter,
  easeCam,
  easeFly,
  initialRoofCamera,
  poseAt,
  roofFit,
  roofKeyAction,
  roofReducer,
  roofSlots,
  roofTransform,
  seatPose,
  tweenProgress,
  type RoofCameraState,
} from "@/components/duel/tag/roof-camera";
import type { CameraAction } from "@/components/duel/table/types";

function run(state: RoofCameraState, ...actions: CameraAction[]): RoofCameraState {
  return actions.reduce((s, a) => roofReducer(s, a), state);
}

describe("roofSlots", () => {
  it("puts the viewer and partner near, the two rivals far, in turn order", () => {
    const slots = roofSlots(0);
    expect(slots[0]).toMatchObject({ near: true, x: -357 });
    expect(slots[2]).toMatchObject({ near: true, x: 357 });
    expect(slots[1]).toMatchObject({ near: false, x: -357 });
    expect(slots[3]).toMatchObject({ near: false, x: 357 });
    expect(slots[0].y).toBeGreaterThan(0);
    expect(slots[1].y).toBeLessThan(0);
  });

  it("keeps the viewer at near left for every anchor seat", () => {
    for (const anchor of [0, 1, 2, 3]) {
      const slots = roofSlots(anchor);
      expect(slots[anchor]).toMatchObject({ near: true, x: -357 });
      expect(slots[(anchor + 2) % 4]).toMatchObject({ near: true, x: 357 });
      expect(slots[(anchor + 1) % 4]).toMatchObject({ near: false, x: -357 });
      expect(slots[(anchor + 3) % 4]).toMatchObject({ near: false, x: 357 });
    }
  });
});

describe("initial state", () => {
  it("starts at home with the home pose and no lock", () => {
    const s = initialRoofCamera({ anchorSeat: 0 });
    expect(s.mode).toBe("home");
    expect(s.pose).toEqual(ROOF_PRESETS.home);
    expect(s.lock).toBeNull();
    expect(s.auto).toBe(true);
    expect(s.pinned).toBe(false);
  });

  it("builds the overview, focus, look and fly modes from a partial state", () => {
    expect(initialRoofCamera({ anchorSeat: 0, camera: { mode: "overview" } }).pose).toEqual(ROOF_PRESETS.overview);
    const focus = initialRoofCamera({ anchorSeat: 0, camera: { mode: "focus", focusSeat: 3 } });
    expect(focus.focusSeat).toBe(3);
    expect(focus.pose).toEqual(seatPose(0, 3));
    const look = initialRoofCamera({ anchorSeat: 0, camera: { mode: "look", lookSeat: 1 } });
    expect(look.pose).toEqual(ROOF_PRESETS.rival);
    expect(initialRoofCamera({ anchorSeat: 0, camera: { mode: "fly" } }).mode).toBe("fly");
  });
});

describe("presets and seat poses", () => {
  it("turns the view 180 degrees for a far seat and zooms in", () => {
    expect(seatPose(0, 0).yaw).toBe(0);
    expect(seatPose(0, 2).yaw).toBe(0);
    expect(seatPose(0, 1).yaw).toBe(180);
    expect(seatPose(0, 3).yaw).toBe(180);
    expect(seatPose(0, 0).zoom).toBeCloseTo(1.76);
    expect(seatPose(0, 0).fx).toBe(-357);
    expect(seatPose(0, 2).fx).toBe(357);
  });
});

describe("actions", () => {
  const base = initialRoofCamera({ anchorSeat: 0 });

  it("overview and home switch the mode and the pose", () => {
    const o = run(base, { type: "overview" });
    expect(o.mode).toBe("overview");
    expect(o.pose).toEqual(ROOF_PRESETS.overview);
    expect(o.rev).toBe(base.rev + 1);
    const h = run(o, { type: "home" });
    expect(h.mode).toBe("home");
    expect(h.pose).toEqual(ROOF_PRESETS.home);
  });

  it("focus and flyTo set the focus seat and its pose", () => {
    const s = run(base, { type: "focus", seat: 2 });
    expect(s).toMatchObject({ mode: "focus", focusSeat: 2 });
    expect(s.pose).toEqual(seatPose(0, 2));
    expect(run(base, { type: "flyTo", seat: 3 })).toMatchObject({ mode: "focus", focusSeat: 3 });
  });

  it("focusStep walks the turn order and wraps", () => {
    const a = run(base, { type: "focusStep", dir: 1 });
    expect(a.focusSeat).toBe(1);
    expect(run(a, { type: "focusStep", dir: 1 }).focusSeat).toBe(2);
    expect(run(base, { type: "focusStep", dir: -1 }).focusSeat).toBe(3);
    const at3 = run(base, { type: "focus", seat: 3 });
    expect(run(at3, { type: "focusStep", dir: 1 }).focusSeat).toBe(0);
  });

  it("look at a rival gives the rival end; look at your team or null returns home", () => {
    const r = run(base, { type: "look", seat: 1 });
    expect(r).toMatchObject({ mode: "look", lookSeat: 1 });
    expect(r.pose).toEqual(ROOF_PRESETS.rival);
    expect(run(r, { type: "look", seat: null }).mode).toBe("home");
    expect(run(base, { type: "look", seat: 2 }).mode).toBe("home");
  });

  it("toggleFly plays the fly-in from the sky, then a second toggle goes home", () => {
    const f = run(base, { type: "toggleFly" });
    expect(f.mode).toBe("fly");
    expect(f.intro).toBe(true);
    expect(f.from).toEqual(ROOF_PRESETS.intro);
    expect(f.pose).toEqual(ROOF_PRESETS.home);
    expect(f.dur).toBeGreaterThan(2000);
    const back = run(f, { type: "toggleFly" });
    expect(back.mode).toBe("home");
    expect(back.intro).toBe(false);
  });

  it("orbit turns the yaw, clamps the tilt and enters fly mode", () => {
    const o = run(base, { type: "orbit", dYawDeg: 30, dTiltDeg: 0 });
    expect(o.mode).toBe("fly");
    expect(o.pose.yaw).toBe(base.pose.yaw + 30);
    const hi = run(base, { type: "orbit", dYawDeg: 0, dTiltDeg: 500 });
    expect(hi.pose.tilt).toBe(ROOF_LIMITS.tiltMax);
    const lo = run(base, { type: "orbit", dYawDeg: 0, dTiltDeg: -500 });
    expect(lo.pose.tilt).toBe(ROOF_LIMITS.tiltMin);
  });

  it("a big orbit step tweens and a drag step is immediate", () => {
    expect(run(base, { type: "orbit", dYawDeg: 30, dTiltDeg: 0 }).dur).toBeGreaterThan(0);
    expect(run(base, { type: "orbit", dYawDeg: 2, dTiltDeg: 1 }).dur).toBe(0);
  });

  it("zoom multiplies and clamps between 0.3 and 2.4", () => {
    expect(run(base, { type: "zoom", factor: 1.18 }).pose.zoom).toBeCloseTo(base.pose.zoom * 1.18);
    expect(run(base, { type: "zoom", factor: 100 }).pose.zoom).toBe(ROOF_LIMITS.zoomMax);
    expect(run(base, { type: "zoom", factor: 0.001 }).pose.zoom).toBe(ROOF_LIMITS.zoomMin);
    expect(run(base, { type: "zoom", factor: 1.18 }).mode).toBe("fly");
  });

  it("toggles flip upright, compact, auto and pin", () => {
    expect(run(base, { type: "toggleUpright" }).upright).toBe(!base.upright);
    expect(run(base, { type: "toggleAuto" }).auto).toBe(!base.auto);
    expect(run(base, { type: "pin", on: true }).pinned).toBe(true);
    expect(run(base, { type: "toggleCompact" }).compact).not.toBe(base.compact);
  });
});

describe("auto follow, pin and aim", () => {
  const base = initialRoofCamera({ anchorSeat: 0 });

  it("auto follow moves the focus to the turn seat", () => {
    const s = run(base, { type: "autoFollow", seat: 2 });
    expect(s).toMatchObject({ mode: "focus", focusSeat: 2 });
  });

  it("auto follow does nothing when auto is off, pinned, aiming or in overview", () => {
    expect(run(base, { type: "toggleAuto" }, { type: "autoFollow", seat: 2 }).mode).toBe("home");
    expect(run(base, { type: "pin", on: true }, { type: "autoFollow", seat: 2 }).mode).toBe("home");
    expect(run(base, { type: "aiming", on: true }, { type: "autoFollow", seat: 2 }).mode).toBe("home");
    expect(run(base, { type: "overview" }, { type: "autoFollow", seat: 2 }).mode).toBe("overview");
  });

  it("auto follow with null seat changes nothing", () => {
    expect(run(base, { type: "autoFollow", seat: null })).toBe(base);
  });

  it("aiming on and off only flips the flag", () => {
    const a = run(base, { type: "aiming", on: true });
    expect(a.aiming).toBe(true);
    expect(a.pose).toEqual(base.pose);
    expect(run(a, { type: "aiming", on: false }).aiming).toBe(false);
  });
});

describe("FX lock", () => {
  const focus = initialRoofCamera({ anchorSeat: 0, camera: { mode: "focus", focusSeat: 3 } });

  it("eases to home and sets the lock until the end time", () => {
    const l = run(focus, { type: "lock", reason: "chain", nowMs: 1000, ms: 2500 });
    expect(l.lock).toEqual({ reason: "chain", untilMs: 3500 });
    expect(l.mode).toBe("home");
    expect(l.pose).toEqual(ROOF_PRESETS.home);
    expect(l.rev).toBeGreaterThan(focus.rev);
  });

  it("ignores every camera input while locked", () => {
    const l = run(focus, { type: "lock", reason: "battle", nowMs: 0, ms: 2000 });
    const inputs: CameraAction[] = [
      { type: "home" },
      { type: "overview" },
      { type: "focus", seat: 1 },
      { type: "focusStep", dir: 1 },
      { type: "look", seat: 1 },
      { type: "toggleFly" },
      { type: "flyTo", seat: 2 },
      { type: "orbit", dYawDeg: 30, dTiltDeg: 10 },
      { type: "zoom", factor: 1.5 },
      { type: "autoFollow", seat: 2 },
    ];
    for (const a of inputs) expect(roofReducer(l, a)).toBe(l);
  });

  it("keeps toggles, pin and aiming working during a lock", () => {
    const l = run(focus, { type: "lock", reason: "battle", nowMs: 0, ms: 2000 });
    expect(roofReducer(l, { type: "pin", on: true }).pinned).toBe(true);
    expect(roofReducer(l, { type: "toggleUpright" }).upright).toBe(!l.upright);
  });

  it("a tick before the end keeps the lock", () => {
    const l = run(focus, { type: "lock", reason: "direct", nowMs: 0, ms: 2000 });
    expect(roofReducer(l, { type: "tick", nowMs: 1999 })).toBe(l);
  });

  it("a tick at the end clears the lock and restores the pose from before", () => {
    const l = run(focus, { type: "lock", reason: "direct", nowMs: 0, ms: 2000 });
    const r = roofReducer(l, { type: "tick", nowMs: 2000 });
    expect(r.lock).toBeNull();
    expect(r).toMatchObject({ mode: "focus", focusSeat: 3 });
    expect(r.pose).toEqual(seatPose(0, 3));
    expect(r.rev).toBeGreaterThan(l.rev);
    expect(r.resume).toBeNull();
  });

  it("a second lock extends the first and keeps the first restore point", () => {
    const a = run(focus, { type: "lock", reason: "chain", nowMs: 0, ms: 2000 });
    const b = run(a, { type: "lock", reason: "battle", nowMs: 500, ms: 3000 });
    expect(b.lock).toEqual({ reason: "battle", untilMs: 3500 });
    const r = roofReducer(b, { type: "tick", nowMs: 3500 });
    expect(r).toMatchObject({ mode: "focus", focusSeat: 3 });
  });

  it("a shorter second lock does not shorten the first", () => {
    const a = run(focus, { type: "lock", reason: "chain", nowMs: 0, ms: 5000 });
    const b = run(a, { type: "lock", reason: "battle", nowMs: 100, ms: 500 });
    expect(b.lock?.untilMs).toBe(5000);
  });

  it("works on top of a pin and an aim", () => {
    const s = run(focus, { type: "pin", on: true }, { type: "aiming", on: true }, { type: "lock", reason: "destroy", nowMs: 0, ms: 1000 });
    expect(s.lock?.reason).toBe("destroy");
    const r = roofReducer(s, { type: "tick", nowMs: 1000 });
    expect(r.pinned).toBe(true);
    expect(r.mode).toBe("focus");
  });

  it("starts a locked state from a preview lock", () => {
    const s = initialRoofCamera({ anchorSeat: 0, camera: { mode: "overview", lock: { reason: "chain", untilMs: Number.MAX_SAFE_INTEGER } } });
    expect(s.lock?.reason).toBe("chain");
    expect(s.mode).toBe("home");
    expect(s.resume?.mode).toBe("overview");
  });
});

describe("tween helpers", () => {
  it("poseAt takes the shortest way round in yaw", () => {
    const from = { ...ROOF_PRESETS.home, yaw: 350 };
    const to = { ...ROOF_PRESETS.home, yaw: 10 };
    expect(poseAt(from, to, 0.5, (t) => t).yaw).toBeCloseTo(360);
    expect(poseAt(from, to, 1, (t) => t).yaw).toBeCloseTo(370);
    expect(poseAt(from, to, 0, (t) => t).yaw).toBe(350);
  });

  it("poseAt blends tilt, zoom and focus", () => {
    const p = poseAt(ROOF_PRESETS.home, ROOF_PRESETS.overview, 0.5, (t) => t);
    expect(p.tilt).toBeCloseTo((ROOF_PRESETS.home.tilt + ROOF_PRESETS.overview.tilt) / 2);
    expect(p.zoom).toBeCloseTo((ROOF_PRESETS.home.zoom + ROOF_PRESETS.overview.zoom) / 2);
  });

  it("easing curves run from 0 to 1", () => {
    for (const f of [easeCam, easeFly]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      expect(f(0.5)).toBeGreaterThan(0);
      expect(f(0.5)).toBeLessThan(1);
    }
  });

  it("roofTransform writes the 3D transform of the world", () => {
    const t = roofTransform(ROOF_PRESETS.home, 1);
    expect(t).toContain("rotateX(36.000deg)");
    expect(t).toContain("rotateZ(0.000deg)");
    expect(t).toContain("scale3d(0.9000");
    expect(t).toContain("translate3d(0px, 64.00px, 0px)");
  });
});

describe("key map", () => {
  const ctx = { anchorSeat: 0 };
  it("maps the camera keys", () => {
    expect(roofKeyAction("h", ctx)).toEqual({ type: "home" });
    expect(roofKeyAction("H", ctx)).toEqual({ type: "home" });
    expect(roofKeyAction("0", ctx)).toEqual({ type: "overview" });
    expect(roofKeyAction("o", ctx)).toEqual({ type: "overview" });
    expect(roofKeyAction("i", ctx)).toEqual({ type: "toggleFly" });
    expect(roofKeyAction("f", ctx)).toEqual({ type: "toggleFly" });
    expect(roofKeyAction("v", ctx)).toEqual({ type: "look", seat: 1 });
    expect(roofKeyAction("q", ctx)).toEqual({ type: "orbit", dYawDeg: -30, dTiltDeg: 0 });
    expect(roofKeyAction("e", ctx)).toEqual({ type: "orbit", dYawDeg: 30, dTiltDeg: 0 });
    expect(roofKeyAction("+", ctx)).toEqual({ type: "zoom", factor: 1.18 });
    expect(roofKeyAction("=", ctx)).toEqual({ type: "zoom", factor: 1.18 });
    expect(roofKeyAction("-", ctx)).toEqual({ type: "zoom", factor: 1 / 1.18 });
    expect(roofKeyAction("s", ctx)).toEqual({ type: "toggleUpright" });
    expect(roofKeyAction("a", ctx)).toEqual({ type: "toggleAuto" });
    expect(roofKeyAction("k", ctx)).toEqual({ type: "pin", on: true });
    expect(roofKeyAction("k", { anchorSeat: 0, pinned: true })).toEqual({ type: "pin", on: false });
  });

  it("maps 1 to 4 to the seats by turn order", () => {
    expect(roofKeyAction("1", ctx)).toEqual({ type: "focus", seat: 0 });
    expect(roofKeyAction("2", ctx)).toEqual({ type: "focus", seat: 1 });
    expect(roofKeyAction("3", ctx)).toEqual({ type: "focus", seat: 2 });
    expect(roofKeyAction("4", ctx)).toEqual({ type: "focus", seat: 3 });
    expect(roofKeyAction("5", ctx)).toBeNull();
  });

  it("maps Tab and Shift+Tab to focus steps", () => {
    expect(roofKeyAction("Tab", ctx)).toEqual({ type: "focusStep", dir: 1 });
    expect(roofKeyAction("Tab", ctx, { shift: true })).toEqual({ type: "focusStep", dir: -1 });
  });

  it("ignores keys with Ctrl, Meta or Alt held and unknown keys", () => {
    expect(roofKeyAction("h", ctx, { ctrl: true })).toBeNull();
    expect(roofKeyAction("h", ctx, { meta: true })).toBeNull();
    expect(roofKeyAction("h", ctx, { alt: true })).toBeNull();
    expect(roofKeyAction("z", ctx)).toBeNull();
  });

  it("the rival end key picks the first rival of the anchor seat", () => {
    expect(roofKeyAction("v", { anchorSeat: 1 })).toEqual({ type: "look", seat: 2 });
    expect(roofKeyAction("v", { anchorSeat: 3 })).toEqual({ type: "look", seat: 0 });
  });
});

describe("camera label", () => {
  const names = ["Aster", "Mirelle", "Corvin", "Juniper"];
  const nameOf = (s: number) => names[s];
  it("names the mode", () => {
    expect(cameraLabel(initialRoofCamera({ anchorSeat: 0 }), nameOf)).toBe("Home");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "overview" }), nameOf)).toBe("Overview");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "look", seat: 1 }), nameOf)).toBe("Rival end");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "focus", seat: 2 }), nameOf)).toBe("Corvin · partner");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "focus", seat: 0 }), nameOf)).toBe("Aster · you");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "focus", seat: 3 }), nameOf)).toBe("Juniper's chair");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "zoom", factor: 1.2 }), nameOf)).toBe("Free");
  });
});

describe("stage fit and hud placement", () => {
  it("fits the 1560 by 700 roof world into the free box", () => {
    expect(roofFit({ left: 0, right: 1560, top: 0, bottom: 700 })).toBeCloseTo(1, 5);
    expect(roofFit({ left: 100, right: 1100, top: 6, bottom: 706 })).toBeCloseTo(1000 / 1560, 5);
    expect(roofFit({ left: 0, right: 3120, top: 0, bottom: 350 })).toBeCloseTo(0.5, 5);
  });

  it("gives 0 for an empty box", () => {
    expect(roofFit({ left: 10, right: 10, top: 0, bottom: 300 })).toBe(0);
    expect(roofFit({ left: 0, right: 300, top: 50, bottom: 40 })).toBe(0);
  });

  it("keeps a hud box inside the view and leaves a box that already fits", () => {
    const view = { left: 0, right: 1000, top: 0, bottom: 600 };
    expect(clampCenter({ x: 500, y: 300 }, { w: 200, h: 100 }, view)).toEqual({ x: 500, y: 300 });
    expect(clampCenter({ x: 20, y: 590 }, { w: 200, h: 100 }, view)).toEqual({ x: 100, y: 550 });
    expect(clampCenter({ x: 990, y: -40 }, { w: 200, h: 100 }, view)).toEqual({ x: 900, y: 50 });
  });

  it("centres a box that is wider than the view", () => {
    const view = { left: 0, right: 100, top: 0, bottom: 100 };
    expect(clampCenter({ x: 10, y: 10 }, { w: 300, h: 40 }, view).x).toBe(50);
  });

  it("reads tween progress from the clock", () => {
    expect(tweenProgress(1000, 1000, 500)).toBe(0);
    expect(tweenProgress(1250, 1000, 500)).toBeCloseTo(0.5, 5);
    expect(tweenProgress(9000, 1000, 500)).toBe(1);
    expect(tweenProgress(1000, 1000, 0)).toBe(1);
  });
});
