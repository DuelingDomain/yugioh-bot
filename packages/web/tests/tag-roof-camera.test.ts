import { describe, expect, it } from "vitest";
import {
  ROOF_LIMITS,
  ROOF_FIELD,
  ROOF_PRESETS,
  ROOF_WORLD,
  cameraLabel,
  clampCenter,
  easeCam,
  easeFly,
  fitSeatPose,
  initialRoofCamera,
  phaseHubSizes,
  poseAt,
  projectRoof,
  ROOF_FIELD_Z,
  roofFit,
  roofGap,
  roofKeyAction,
  roofReducer,
  roofSlots,
  roofTransform,
  seatPose,
  tweenProgress,
  type CameraAction,
  type RoofCameraState,
} from "@/components/duel/tag/roof-camera";

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
      expect(slots[anchor ^ 1]).toMatchObject({ near: false, x: -357 });
      expect(slots[((anchor + 2) % 4) ^ 1]).toMatchObject({ near: false, x: 357 });
    }
  });
});

describe("initial state", () => {
  it("starts at the overview, with all four fields in view, and no lock", () => {
    const s = initialRoofCamera({ anchorSeat: 0 });
    expect(s.mode).toBe("overview");
    expect(s.pose).toEqual(ROOF_PRESETS.overview);
    expect(s.pose.zoom).toBe(1);
    expect(s.lock).toBeNull();
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

describe("fitSeatPose", () => {
  // The free boxes of the sizes the stage is checked at (the box ends above the hands), width x height after the HUD.
  const boxes = [
    { name: "1920x1080", left: 8, right: 1904, top: 76, bottom: 770 },
    { name: "2560x1440", left: 8, right: 2544, top: 90, bottom: 1030 },
    { name: "1366x768", left: 8, right: 1352, top: 62, bottom: 470 },
    { name: "1617x933", left: 8, right: 1601, top: 70, bottom: 640 },
    { name: "390x844", left: 8, right: 382, top: 170, bottom: 420 },
  ];
  const corners = (seat: number) => {
    const slot = roofSlots(0)[seat]!;
    const sign = Math.sign(slot.y);
    return [-1, 1].flatMap((sx) => [slot.y + (sign * ROOF_FIELD.height) / 2, sign * 10].map((y) => ({ x: slot.x + (sx * ROOF_FIELD.width) / 2, y, z: ROOF_FIELD_Z })));
  };

  it("keeps the whole field, with its shared Extra Monster row, inside the free box at every size and for every seat", () => {
    for (const box of boxes) {
      const fit = roofFit(box);
      const cx = (box.left + box.right) / 2;
      const cy = (box.top + box.bottom) / 2;
      for (const seat of [0, 1, 2, 3]) {
        const pose = fitSeatPose(0, seat, fit, box);
        for (const corner of corners(seat)) {
          const at = projectRoof(pose, fit, corner);
          expect(at.x + cx, `${box.name} seat ${seat} x`).toBeGreaterThanOrEqual(box.left);
          expect(at.x + cx, `${box.name} seat ${seat} x`).toBeLessThanOrEqual(box.right);
          expect(at.y + cy, `${box.name} seat ${seat} y`).toBeGreaterThanOrEqual(box.top);
          expect(at.y + cy, `${box.name} seat ${seat} y`).toBeLessThanOrEqual(box.bottom);
        }
      }
    }
  });

  it("zooms in on every seat as far as the box allows, never past the limit, and keeps the viewer's side up", () => {
    for (const box of boxes) {
      const pose = fitSeatPose(0, 0, roofFit(box), box);
      expect(pose.yaw).toBe(0);
      expect(pose.zoom).toBeGreaterThan(ROOF_PRESETS.overview.zoom);
      expect(pose.zoom).toBeLessThanOrEqual(ROOF_LIMITS.zoomMax);
    }
  });

  it("falls back to the plain close-up for an empty box", () => {
    expect(fitSeatPose(0, 0, 0, boxes[0]!)).toEqual(seatPose(0, 0));
    expect(fitSeatPose(0, 0, 1, { left: 0, right: 10, top: 0, bottom: 10 })).toEqual(seatPose(0, 0));
  });
});

describe("presets and seat poses", () => {
  it("zooms in on a seat from the viewer's side, so a far field keeps its readable text", () => {
    for (const seat of [0, 1, 2, 3]) {
      expect(seatPose(0, seat).yaw).toBe(0);
      expect(seatPose(0, seat).zoom).toBeGreaterThan(ROOF_PRESETS.overview.zoom);
    }
    expect(seatPose(0, 0).fx).toBe(-357);
    expect(seatPose(0, 2).fx).toBe(357);
    expect(seatPose(0, 0).fy).toBeGreaterThan(0);
    expect(seatPose(0, 1).fy).toBeLessThan(0);
  });

  it("aims a close-up toward the gap, where the shared Extra Monster Zones sit, and leaves the hub less room beside them", () => {
    const view = { left: 8, right: 1600, top: 150, bottom: 640 };
    expect(Math.abs(fitSeatPose(0, 0, roofFit(view), view).fy)).toBeLessThan(270);
    expect(Math.abs(fitSeatPose(0, 1, roofFit(view), view).fy)).toBeLessThan(270);
    const plain = roofGap(ROOF_PRESETS.overview, 1);
    const shared = roofGap(ROOF_PRESETS.overview, 1, true);
    expect(shared.gapPx).toBe(plain.gapPx);
    expect(shared.freePx).toBeLessThan(plain.freePx);
  });

  it("puts 1A across from 2A and 1B across from 2B (seats 0-1 and 2-3) for every viewer", () => {
    for (const anchor of [0, 1, 2, 3]) {
      const slots = roofSlots(anchor);
      expect(Object.keys(slots).sort()).toEqual(["0", "1", "2", "3"]);
      for (const [a, b] of [[0, 1], [2, 3]]) {
        expect(slots[a].near).not.toBe(slots[b].near);
        expect(slots[a].x).toBe(slots[b].x);
      }
      // The viewer is near left and the partner near right.
      expect(slots[anchor]).toMatchObject({ near: true, x: -ROOF_FIELD.centerX });
      expect(slots[(anchor + 2) % 4]).toMatchObject({ near: true, x: ROOF_FIELD.centerX });
    }
    expect(roofSlots(1)[0]).toMatchObject({ near: false, x: -ROOF_FIELD.centerX });
    expect(roofSlots(1)[2]).toMatchObject({ near: false, x: ROOF_FIELD.centerX });
    expect(roofSlots(3)[2]).toMatchObject({ near: false, x: -ROOF_FIELD.centerX });
    expect(roofSlots(3)[0]).toMatchObject({ near: false, x: ROOF_FIELD.centerX });
  });

  it("keeps facing fields in the same columns, with a gap between the strips", () => {
    const slots = roofSlots(0);
    expect(slots[0].x).toBe(slots[1].x);
    expect(slots[2].x).toBe(slots[3].x);
    // Room for one shared Extra Monster row between the two facing fields (a later engine change).
    expect(slots[0].y - slots[1].y - ROOF_FIELD.height).toBeGreaterThanOrEqual(100);
  });
});

describe("actions", () => {
  const base = initialRoofCamera({ anchorSeat: 0, camera: { mode: "home" } });

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

  it("zoom multiplies and clamps between its limits", () => {
    expect(run(base, { type: "zoom", factor: 1.18 }).pose.zoom).toBeCloseTo(base.pose.zoom * 1.18);
    expect(run(base, { type: "zoom", factor: 100 }).pose.zoom).toBe(ROOF_LIMITS.zoomMax);
    expect(run(base, { type: "zoom", factor: 0.001 }).pose.zoom).toBe(ROOF_LIMITS.zoomMin);
    expect(run(base, { type: "zoom", factor: 1.18 }).mode).toBe("fly");
  });

  it("toggles flip upright and compact", () => {
    expect(run(base, { type: "toggleUpright" }).upright).toBe(!base.upright);
    expect(run(base, { type: "toggleCompact" }).compact).not.toBe(base.compact);
  });
});

describe("aim", () => {
  const base = initialRoofCamera({ anchorSeat: 0, camera: { mode: "home" } });

  it("aiming on and off only flips the flag", () => {
    const a = run(base, { type: "aiming", on: true });
    expect(a.aiming).toBe(true);
    expect(a.pose).toEqual(base.pose);
    expect(run(a, { type: "aiming", on: false }).aiming).toBe(false);
  });
});

describe("FX lock", () => {
  const focus = initialRoofCamera({ anchorSeat: 0, camera: { mode: "focus", focusSeat: 3 } });

  it("eases to the overview and sets the lock until the end time", () => {
    const l = run(focus, { type: "lock", reason: "chain", nowMs: 1000, ms: 2500 });
    expect(l.lock).toEqual({ reason: "chain", untilMs: 3500 });
    expect(l.mode).toBe("overview");
    expect(l.pose).toEqual(ROOF_PRESETS.overview);
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
    ];
    for (const a of inputs) expect(roofReducer(l, a)).toBe(l);
  });

  it("keeps toggles and aiming working during a lock", () => {
    const l = run(focus, { type: "lock", reason: "battle", nowMs: 0, ms: 2000 });
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

  it("works on top of an aim", () => {
    const s = run(focus, { type: "lock", reason: "destroy", nowMs: 0, ms: 1000 }, { type: "aiming", on: true });
    expect(s.lock?.reason).toBe("destroy");
    const r = roofReducer(s, { type: "tick", nowMs: 1000 });
    expect(r.aiming).toBe(true);
    // The aim needs the rival fields, so the close-up does not come back after the lock.
    expect(r.mode).toBe("overview");
    expect(r.pose).toEqual(ROOF_PRESETS.overview);
  });

  it("an aim under a lock keeps the overview, and an aim that ends changes nothing more", () => {
    const s = run(focus, { type: "lock", reason: "chain", nowMs: 0, ms: 1000 }, { type: "aiming", on: true }, { type: "aiming", on: false });
    const r = roofReducer(s, { type: "tick", nowMs: 1000 });
    expect(r.mode).toBe("overview");
    expect(r.aiming).toBe(false);
  });

  it("starts a locked state from a preview lock", () => {
    const s = initialRoofCamera({ anchorSeat: 0, camera: { mode: "overview", lock: { reason: "chain", untilMs: Number.MAX_SAFE_INTEGER } } });
    expect(s.lock?.reason).toBe("chain");
    expect(s.mode).toBe("overview");
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
    expect(t).toContain("scale3d(1.3000");
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
    // Auto follow and pin are gone: the duel never moves the camera in, so A and K are no camera keys.
    expect(roofKeyAction("a", ctx)).toBeNull();
    expect(roofKeyAction("k", ctx)).toBeNull();
  });

  it("maps 1 to 4 to the seats by turn order", () => {
    expect(roofKeyAction("1", ctx)).toEqual({ type: "focus", seat: 0 });
    expect(roofKeyAction("2", ctx)).toEqual({ type: "focus", seat: 1 });
    expect(roofKeyAction("3", ctx)).toEqual({ type: "focus", seat: 2 });
    expect(roofKeyAction("4", ctx)).toEqual({ type: "focus", seat: 3 });
    expect(roofKeyAction("5", ctx)).toBeNull();
  });

  it("does not map Tab or Shift+Tab: Tab never moves the camera", () => {
    expect(roofKeyAction("Tab", ctx)).toBeNull();
    expect(roofKeyAction("Tab", ctx, { shift: true })).toBeNull();
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
    expect(cameraLabel(initialRoofCamera({ anchorSeat: 0 }), nameOf)).toBe("Overview");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "home" }), nameOf)).toBe("Home");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "overview" }), nameOf)).toBe("Overview");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "look", seat: 1 }), nameOf)).toBe("Rival end");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "focus", seat: 2 }), nameOf)).toBe("Corvin · partner");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "focus", seat: 0 }), nameOf)).toBe("Aster · you");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "focus", seat: 3 }), nameOf)).toBe("Juniper's chair");
    expect(cameraLabel(run(initialRoofCamera({ anchorSeat: 0 }), { type: "zoom", factor: 1.2 }), nameOf)).toBe("Free");
  });
});

describe("stage fit and hud placement", () => {
  it("fits the roof world (the four fields) into the free box", () => {
    const { width, depth } = ROOF_WORLD;
    expect(roofFit({ left: 0, right: width, top: 0, bottom: depth })).toBeCloseTo(1, 5);
    expect(roofFit({ left: 100, right: 100 + width / 2, top: 6, bottom: 6 + depth })).toBeCloseTo(0.5, 5);
    expect(roofFit({ left: 0, right: width * 2, top: 0, bottom: depth / 2 })).toBeCloseTo(0.5, 5);
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

describe("overview camera (default, focus, back)", () => {
  const overview = initialRoofCamera({ anchorSeat: 0 });

  it("Esc goes back to the overview from any other mode, and does nothing in the overview", () => {
    expect(roofKeyAction("Escape", { anchorSeat: 0, mode: "focus" })).toEqual({ type: "overview" });
    expect(roofKeyAction("Escape", { anchorSeat: 0, mode: "home" })).toEqual({ type: "overview" });
    expect(roofKeyAction("Escape", { anchorSeat: 0, mode: "fly" })).toEqual({ type: "overview" });
    expect(roofKeyAction("Escape", { anchorSeat: 0, mode: "overview" })).toBeNull();
    expect(roofKeyAction("Escape", { anchorSeat: 0 })).toBeNull();
  });

  it("a focus and the way back leave the overview pose unchanged", () => {
    const focused = run(overview, { type: "focus", seat: 3 });
    expect(focused).toMatchObject({ mode: "focus", focusSeat: 3 });
    const back = run(focused, { type: "overview" });
    expect(back).toMatchObject({ mode: "overview", focusSeat: null });
    expect(back.pose).toEqual(ROOF_PRESETS.overview);
  });

  it("a focus on the seat that is already focused starts no new tween", () => {
    const focused = run(overview, { type: "focus", seat: 1 });
    expect(run(focused, { type: "focus", seat: 1 })).toBe(focused);
  });

  it("an aim leaves a close-up for the overview, so every rival is in view", () => {
    const focused = run(overview, { type: "focus", seat: 0 });
    const aimed = run(focused, { type: "aiming", on: true });
    expect(aimed).toMatchObject({ mode: "overview", aiming: true });
    expect(aimed.pose).toEqual(ROOF_PRESETS.overview);
    // The overview stays when the aim ends: the camera never jumps back to the field on its own.
    expect(run(aimed, { type: "aiming", on: false }).mode).toBe("overview");
    // Already in the overview: the aim only sets the flag.
    expect(run(overview, { type: "aiming", on: true })).toMatchObject({ mode: "overview", aiming: true, rev: overview.rev });
  });

  it("a prompt that needs another field takes a close-up back to the overview", () => {
    const focused = run(overview, { type: "focus", seat: 1 });
    expect(run(focused, { type: "needSeats", seats: [3] })).toMatchObject({ mode: "overview", focusSeat: null });
    expect(run(focused, { type: "needSeats", seats: [1, 3] }).mode).toBe("overview");
  });

  it("a prompt that needs only the focused field, or none, keeps the close-up", () => {
    const focused = run(overview, { type: "focus", seat: 1 });
    expect(run(focused, { type: "needSeats", seats: [1] })).toBe(focused);
    expect(run(focused, { type: "needSeats", seats: [] })).toBe(focused);
    expect(run(overview, { type: "needSeats", seats: [2] })).toBe(overview);
  });

  it("a prompt need under an FX lock does not move the camera now, but the close-up does not come back after the lock", () => {
    const locked = run(run(overview, { type: "focus", seat: 1 }), { type: "lock", reason: "chain", nowMs: 0, ms: 1000 });
    const needed = roofReducer(locked, { type: "needSeats", seats: [2] });
    expect(needed.rev).toBe(locked.rev);
    expect(needed.mode).toBe("overview");
    const after = roofReducer(needed, { type: "tick", nowMs: 1000 });
    expect(after).toMatchObject({ mode: "overview", focusSeat: null, lock: null });
    expect(after.pose).toEqual(ROOF_PRESETS.overview);
  });

  it("a prompt under an FX lock that needs only the focused field brings the close-up back after the lock", () => {
    const locked = run(run(overview, { type: "focus", seat: 1 }), { type: "lock", reason: "chain", nowMs: 0, ms: 1000 });
    const same = roofReducer(locked, { type: "needSeats", seats: [1] });
    expect(same).toBe(locked);
    expect(roofReducer(same, { type: "tick", nowMs: 1000 })).toMatchObject({ mode: "focus", focusSeat: 1 });
  });
});

describe("phase hub sizing", () => {
  it("offers the full strip only when the gap row is wide enough, then the short strips, then none", () => {
    expect(phaseHubSizes(600)).toEqual(["lg", "sm", "row", "xs"]);
    expect(phaseHubSizes(300)).toEqual(["sm", "row", "xs"]);
    expect(phaseHubSizes(190)).toEqual(["xs"]);
    expect(phaseHubSizes(120)).toEqual([]);
  });

  it("takes the gap height and width from the pose scale (zoom 1 is the overview)", () => {
    const gap = roofGap(ROOF_PRESETS.overview, 0.5);
    expect(gap.freePx).toBeCloseTo(450, 5);
    expect(gap.gapPx).toBeGreaterThan(0);
    expect(gap.gapPx).toBeLessThanOrEqual(2 * ROOF_FIELD.offsetY * 0.5);
    expect(roofGap(ROOF_PRESETS.overview, 1).gapPx).toBeGreaterThan(gap.gapPx);
  });
});
