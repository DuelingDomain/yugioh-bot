import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelFormat, DuelSeatView } from "@yugidraft/shared/duels";
import {
  cameraActionForKey,
  cameraReducer,
  effectiveCamera,
  effectiveFly,
  effectiveMode,
  FLY_HOME,
  initialCamera,
  isFaceOff,
  isLocked,
} from "@/components/duel/table/camera-model";
import { tableLayout } from "@/components/duel/table/geometry";
import type { CameraAction, CameraState, TableLayout } from "@/components/duel/table/types";

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
    seats: Array.from({ length: count }, (_, seat) => seatView(seat)),
    prompt: null, chain: [], events: [], log: [], result: null,
  };
}

// Viewer is seat 0. Slots: 0 (you), 1 (Ryo, left), 2 (Mika, right).
const L3: TableLayout = tableLayout("ffa3", engine("ffa3", 3), 0);
const L4: TableLayout = tableLayout("ffa4", engine("ffa4", 4), 0);
const run = (state: CameraState, action: CameraAction, layout: TableLayout = L3, out?: number[]) =>
  cameraReducer(state, action, layout, out ? { out } : undefined);
const HOME = initialCamera(L3);
const locked = (state: CameraState = HOME, ms = 1000): CameraState => run(state, { type: "lock", reason: "battle", nowMs: 1000, ms });

describe("initialCamera", () => {
  it("starts at home with fly-in preferred", () => {
    expect(HOME).toMatchObject({
      mode: "home", focusSeat: null, lookSeat: null, lock: null, upright: false, compact: "auto",
    });
    expect(HOME.flyIn).not.toBe(false);
    expect(HOME.fly).toEqual(FLY_HOME);
  });

  it("takes the camera a preview link asks for and fills the fly preset", () => {
    expect(initialCamera(L3, { mode: "focus", focusSeat: 1 })).toMatchObject({ mode: "focus", focusSeat: 1 });
    expect(initialCamera(L3, { mode: "fly" })).toMatchObject({ mode: "fly", fly: FLY_HOME });
    expect(initialCamera(L3, { mode: "look", lookSeat: 2 })).toMatchObject({ lookSeat: 2 });
  });
});

describe("cameraReducer: home, overview, focus, look", () => {
  it("home clears focus and look", () => {
    const from = run(run(HOME, { type: "focus", seat: 1 }), { type: "home" });
    expect(from).toMatchObject({ mode: "home", focusSeat: null, lookSeat: null });
    expect(run(run(HOME, { type: "look", seat: 2 }), { type: "home" })).toMatchObject({ mode: "home", lookSeat: null });
  });

  it("overview goes to the fly-in plaza and pins; with fly-in off it is the flat overview", () => {
    expect(run(HOME, { type: "overview" })).toMatchObject({ mode: "fly", focusSeat: null, fly: FLY_HOME });
    const flat = run(HOME, { type: "toggleFly" }); // fly-in on -> off from home: stays home
    expect(flat.flyIn).toBe(false);
    expect(run(flat, { type: "overview" })).toMatchObject({ mode: "overview" });
  });

  it("overview from a seat fly-in returns to the plaza pose and stays in fly mode", () => {
    const seat = run(HOME, { type: "flyTo", seat: 1 });
    expect(seat.fly.targetSeat).toBe(1);
    expect(run(seat, { type: "overview" })).toMatchObject({ mode: "fly", fly: FLY_HOME });
  });

  it("focus swings to a rival and pins it", () => {
    expect(run(HOME, { type: "focus", seat: 2 })).toMatchObject({ mode: "focus", focusSeat: 2, lookSeat: null });
  });

  it("focus on yourself is home; an unknown seat or an eliminated one is ignored", () => {
    const moved = run(HOME, { type: "focus", seat: 1 });
    expect(run(moved, { type: "focus", seat: 0 })).toMatchObject({ mode: "home", focusSeat: null });
    expect(run(HOME, { type: "focus", seat: 9 })).toBe(HOME);
    expect(run(HOME, { type: "focus", seat: 1 }, L3, [1])).toBe(HOME);
    // On a 4-way table the out check itself (not the face-off) refuses the seat.
    const home4 = initialCamera(L4);
    expect(run(home4, { type: "focus", seat: 1 }, L4, [1])).toBe(home4);
  });

  it("focusStep walks home, Ryo, Mika, home in both directions", () => {
    const f1 = run(HOME, { type: "focusStep", dir: 1 });
    expect(f1).toMatchObject({ mode: "focus", focusSeat: 1 });
    const f2 = run(f1, { type: "focusStep", dir: 1 });
    expect(f2).toMatchObject({ mode: "focus", focusSeat: 2 });
    expect(run(f2, { type: "focusStep", dir: 1 })).toMatchObject({ mode: "home", focusSeat: null });
    expect(run(HOME, { type: "focusStep", dir: -1 })).toMatchObject({ mode: "focus", focusSeat: 2 });
    expect(run(f1, { type: "focusStep", dir: -1 })).toMatchObject({ mode: "home" });
  });

  it("focusStep skips eliminated seats and does nothing when no rival is left", () => {
    const home4 = initialCamera(L4);
    expect(run(home4, { type: "focusStep", dir: 1 }, L4, [1])).toMatchObject({ mode: "focus", focusSeat: 2 });
    expect(run(home4, { type: "focusStep", dir: 1 }, L4, [1, 2, 3])).toBe(home4);
  });

  it("focusStep from look or overview starts at home", () => {
    const look = run(HOME, { type: "look", seat: 2 });
    expect(run(look, { type: "focusStep", dir: 1 })).toMatchObject({ mode: "focus", focusSeat: 1, lookSeat: null });
  });

  it("look turns the table to a rival's seat; null or your own seat is home", () => {
    expect(run(HOME, { type: "look", seat: 1 })).toMatchObject({ mode: "look", lookSeat: 1, focusSeat: null });
    const look = run(HOME, { type: "look", seat: 1 });
    expect(run(look, { type: "look", seat: null })).toMatchObject({ mode: "home", lookSeat: null });
    expect(run(look, { type: "look", seat: 0 })).toMatchObject({ mode: "home" });
    expect(run(HOME, { type: "look", seat: 9 })).toBe(HOME);
  });
});

describe("cameraReducer: fly-in", () => {
  it("toggleFly turns the fly-in preference on and goes to the plaza", () => {
    const off = run(HOME, { type: "toggleFly" });
    expect(off.flyIn).toBe(false);
    const on = run(off, { type: "toggleFly" });
    expect(on).toMatchObject({ flyIn: true, mode: "fly", fly: FLY_HOME });
  });

  it("toggleFly off from the plaza drops to the flat overview and keeps the pin", () => {
    const fly = run(HOME, { type: "overview" });
    expect(run(fly, { type: "toggleFly" })).toMatchObject({ flyIn: false, mode: "overview" });
  });

  it("flyTo from any mode enters the plaza at that seat, turned so the seat reads upright", () => {
    const s = run(HOME, { type: "flyTo", seat: 1 });
    expect(s).toMatchObject({ mode: "fly", flyIn: true });
    expect(s.fly).toMatchObject({ targetSeat: 1, tiltDeg: 30, zoom: 1.8, free: false });
    expect(s.fly.yawDeg).toBeCloseTo(-120, 5);
    expect(run(HOME, { type: "flyTo", seat: 2 }).fly.yawDeg).toBeCloseTo(120, 5);
    expect(run(HOME, { type: "flyTo", seat: 0 }).fly.yawDeg).toBeCloseTo(0, 5);
  });

  it("flyTo the same seat flies back out; another seat flies there; a free orbit flies back in", () => {
    const s = run(HOME, { type: "flyTo", seat: 1 });
    expect(run(s, { type: "flyTo", seat: 1 }).fly).toEqual(FLY_HOME);
    expect(run(s, { type: "flyTo", seat: 2 }).fly.targetSeat).toBe(2);
    const free = run(s, { type: "orbit", dYawDeg: 10, dTiltDeg: 0 });
    expect(free.fly.free).toBe(true);
    const back = run(free, { type: "flyTo", seat: 1 });
    expect(back.fly).toMatchObject({ targetSeat: 1, free: false });
  });

  it("orbit turns the plaza and clamps the tilt to 8 through 68 degrees", () => {
    const fly = run(HOME, { type: "overview" });
    const a = run(fly, { type: "orbit", dYawDeg: 30, dTiltDeg: 10 });
    expect(a.fly).toMatchObject({ yawDeg: 30, tiltDeg: 50, free: true });
    expect(run(a, { type: "orbit", dYawDeg: 0, dTiltDeg: 99 }).fly.tiltDeg).toBe(68);
    expect(run(a, { type: "orbit", dYawDeg: 0, dTiltDeg: -99 }).fly.tiltDeg).toBe(8);
  });

  it("orbit keeps the yaw in -180 to 180", () => {
    const fly = run(HOME, { type: "overview" });
    const a = run(run(fly, { type: "orbit", dYawDeg: 170, dTiltDeg: 0 }), { type: "orbit", dYawDeg: 30, dTiltDeg: 0 });
    expect(a.fly.yawDeg).toBeCloseTo(-160, 5);
  });

  it("zoom multiplies and clamps to 0.32 through 1.9, and frees the camera", () => {
    const fly = run(HOME, { type: "overview" });
    const a = run(fly, { type: "zoom", factor: 1.5 });
    expect(a.fly.zoom).toBeCloseTo(1.35, 5);
    expect(a.fly.free).toBe(true);
    expect(run(a, { type: "zoom", factor: 10 }).fly.zoom).toBe(1.9);
    expect(run(a, { type: "zoom", factor: 0.001 }).fly.zoom).toBe(0.32);
  });

  it("orbit and zoom do nothing outside the plaza", () => {
    expect(run(HOME, { type: "orbit", dYawDeg: 20, dTiltDeg: 5 })).toBe(HOME);
    expect(run(HOME, { type: "zoom", factor: 1.2 })).toBe(HOME);
    const focus = run(HOME, { type: "focus", seat: 1 });
    expect(run(focus, { type: "orbit", dYawDeg: 20, dTiltDeg: 5 })).toBe(focus);
  });

  it("leaving the plaza resets its pose", () => {
    const free = run(run(HOME, { type: "overview" }), { type: "orbit", dYawDeg: 50, dTiltDeg: 5 });
    expect(run(free, { type: "home" }).fly).toEqual(FLY_HOME);
    expect(run(free, { type: "focus", seat: 1 }).fly).toEqual(FLY_HOME);
  });
});

describe("cameraReducer: toggles", () => {
  it("toggleUpright flips upright", () => {
    expect(run(HOME, { type: "toggleUpright" }).upright).toBe(true);
    expect(run(run(HOME, { type: "toggleUpright" }), { type: "toggleUpright" }).upright).toBe(false);
  });

  it("toggleCompact cycles auto, on, off", () => {
    const a = run(HOME, { type: "toggleCompact" });
    const b = run(a, { type: "toggleCompact" });
    const c = run(b, { type: "toggleCompact" });
    expect([a.compact, b.compact, c.compact]).toEqual(["on", "off", "auto"]);
  });
});

describe("the duel never moves the camera", () => {
  it("has no action that follows a seat, pins a view or holds it for an aim", () => {
    for (const type of ["autoFollow", "pin", "aiming", "toggleAuto"]) {
      const state = run(run(HOME, { type: "focus", seat: 2 }), { type } as unknown as CameraAction);
      expect(state).toMatchObject({ mode: "focus", focusSeat: 2 });
    }
  });

  it("keys A and K are not camera keys", () => {
    expect(cameraActionForKey({ key: "a" }, L3, HOME)).toBeNull();
    expect(cameraActionForKey({ key: "k" }, L3, HOME)).toBeNull();
  });
});

describe("preview lock", () => {
  it("lock sets the reason and the end time; the longer lock wins", () => {
    const a = run(HOME, { type: "lock", reason: "chain", nowMs: 1000, ms: 900 });
    expect(a.lock).toEqual({ reason: "chain", untilMs: 1900 });
    const b = run(a, { type: "lock", reason: "destroy", nowMs: 1100, ms: 1300 });
    expect(b.lock).toEqual({ reason: "destroy", untilMs: 2400 });
    const c = run(b, { type: "lock", reason: "chain", nowMs: 1200, ms: 300 });
    expect(c.lock).toEqual({ reason: "destroy", untilMs: 2400 });
  });

  it("tick clears an ended lock and keeps a running one", () => {
    const l = locked();
    expect(run(l, { type: "tick", nowMs: 1999 }).lock).not.toBeNull();
    expect(run(l, { type: "tick", nowMs: 2000 }).lock).toBeNull();
    expect(run(HOME, { type: "tick", nowMs: 5 })).toBe(HOME);
  });

  const MOVES: CameraAction[] = [
    { type: "home" }, { type: "overview" }, { type: "focus", seat: 1 }, { type: "focusStep", dir: 1 },
    { type: "look", seat: 1 }, { type: "toggleFly" }, { type: "flyTo", seat: 1 },
    { type: "orbit", dYawDeg: 10, dTiltDeg: 3 }, { type: "zoom", factor: 1.2 },
  ];
  it.each(MOVES.map((action) => [action.type, action] as const))("ignores %s while locked", (_name, action) => {
    const fromFocus = locked(run(HOME, { type: "focus", seat: 2 }));
    expect(run(fromFocus, action)).toBe(fromFocus);
    const fromFly = locked(run(HOME, { type: "overview" }));
    expect(run(fromFly, action)).toBe(fromFly);
  });

  it("still takes toggles and more locks while locked", () => {
    const l = locked();
    expect(run(l, { type: "toggleUpright" }).upright).toBe(true);
    expect(run(l, { type: "toggleCompact" }).compact).toBe("on");
    expect(run(l, { type: "lock", reason: "direct", nowMs: 1000, ms: 4000 }).lock?.untilMs).toBe(5000);
  });

  it("shows the play view while locked and the previous pose after", () => {
    const focus = run(HOME, { type: "focus", seat: 2 });
    const l = locked(focus);
    expect(l.mode).toBe("focus"); // the stored pose is kept
    expect(effectiveMode(l, 1500)).toBe("home");
    expect(effectiveMode(l, 2000)).toBe("focus"); // lock ended by time, even before the tick
    const after = run(l, { type: "tick", nowMs: 2000 });
    expect(effectiveMode(after, 2000)).toBe("focus");
    expect(after.focusSeat).toBe(2);
  });

  it("eases the plaza back to the plaza pose while locked, and restores the orbit after", () => {
    const orbit = run(run(HOME, { type: "flyTo", seat: 1 }), { type: "orbit", dYawDeg: 25, dTiltDeg: 8 });
    const l = locked(orbit);
    expect(effectiveMode(l, 1200)).toBe("fly");
    expect(effectiveFly(l, 1200)).toEqual(FLY_HOME);
    expect(effectiveFly(l, 2500)).toEqual(orbit.fly);
    expect(isLocked(l, 1200)).toBe(true);
    expect(isLocked(l, 2000)).toBe(false);
  });

  it("effectiveCamera swaps the pose and keeps the rest", () => {
    const focus = run(HOME, { type: "focus", seat: 2 });
    const l = locked(focus);
    expect(effectiveCamera(l, 1200)).toMatchObject({ mode: "home", focusSeat: null, upright: false, lock: l.lock });
    expect(effectiveCamera(l, 3000)).toBe(l);
    const orbit = locked(run(run(HOME, { type: "overview" }), { type: "orbit", dYawDeg: 25, dTiltDeg: 0 }));
    expect(effectiveCamera(orbit, 1100)).toMatchObject({ mode: "fly", fly: FLY_HOME });
  });
});

describe("cameraActionForKey", () => {
  const key = (k: string, shiftKey = false, camera: CameraState = HOME, layout: TableLayout = L3) =>
    cameraActionForKey({ key: k, shiftKey }, layout, camera);

  it("Tab and Shift+Tab step the focus", () => {
    expect(key("Tab")).toEqual({ type: "focusStep", dir: 1 });
    expect(key("Tab", true)).toEqual({ type: "focusStep", dir: -1 });
  });

  it("maps H, O, 0, F, S in both cases", () => {
    expect(key("h")).toEqual({ type: "home" });
    expect(key("H")).toEqual({ type: "home" });
    expect(key("o")).toEqual({ type: "overview" });
    expect(key("O")).toEqual({ type: "overview" });
    expect(key("0")).toEqual({ type: "overview" });
    expect(key("f")).toEqual({ type: "toggleFly" });
    expect(key("s")).toEqual({ type: "toggleUpright" });
    expect(key("S")).toEqual({ type: "toggleUpright" });
  });

  it("P looks from the next rival's seat, then back home", () => {
    expect(key("p")).toEqual({ type: "look", seat: 1 });
    const l1 = run(HOME, { type: "look", seat: 1 });
    expect(key("p", false, l1)).toEqual({ type: "look", seat: 2 });
    const l2 = run(HOME, { type: "look", seat: 2 });
    expect(key("P", false, l2)).toEqual({ type: "look", seat: null });
  });

  it("P skips eliminated seats", () => {
    expect(cameraActionForKey({ key: "p", shiftKey: false }, L4, HOME, { out: [1] })).toEqual({ type: "look", seat: 2 });
    expect(cameraActionForKey({ key: "p", shiftKey: false }, L4, HOME, { out: [1, 2, 3] })).toBeNull();
  });

  it("digits fly to a seat in the plaza and focus a seat elsewhere", () => {
    const fly = run(HOME, { type: "overview" });
    expect(key("1", false, fly)).toEqual({ type: "flyTo", seat: 0 });
    expect(key("2", false, fly)).toEqual({ type: "flyTo", seat: 1 });
    expect(key("3", false, fly)).toEqual({ type: "flyTo", seat: 2 });
    expect(key("2")).toEqual({ type: "focus", seat: 1 });
    expect(key("1")).toEqual({ type: "home" });
    expect(key("4")).toBeNull();
    expect(key("4", false, HOME, L4)).toEqual({ type: "focus", seat: L4.slots[3].seat });
  });

  it("Escape flies back out of a seat or a free orbit, and is otherwise unused", () => {
    expect(key("Escape")).toBeNull();
    expect(key("Escape", false, run(HOME, { type: "overview" }))).toBeNull();
    expect(key("Escape", false, run(HOME, { type: "flyTo", seat: 1 }))).toEqual({ type: "overview" });
    const free = run(run(HOME, { type: "overview" }), { type: "orbit", dYawDeg: 5, dTiltDeg: 0 });
    expect(key("Escape", false, free)).toEqual({ type: "overview" });
  });

  it("C is not a camera key (the compact chips are gone)", () => {
    expect(key("c")).toBeNull();
    expect(key("c", false, initialCamera(L4), L4)).toBeNull();
  });

  it("ignores other keys", () => {
    expect(key("x")).toBeNull();
    expect(key("Enter")).toBeNull();
    expect(key(" ")).toBeNull();
  });
});

describe("4-way camera", () => {
  const home4 = initialCamera(L4);
  const step = (state: CameraState, dir: 1 | -1) => run(state, { type: "focusStep", dir }, L4);

  it("Tab walks the three rivals and comes back home", () => {
    const first = step(home4, 1);
    expect([first.mode, first.focusSeat]).toEqual(["focus", 1]);
    const second = step(first, 1);
    expect(second.focusSeat).toBe(2);
    const third = step(second, 1);
    expect(third.focusSeat).toBe(3);
    expect(step(third, 1).mode).toBe("home");
    expect(step(home4, -1).focusSeat).toBe(3);
  });

  it("P looks from each rival in turn, then returns to your seat", () => {
    let camera = home4;
    const seen: Array<number | null> = [];
    for (let index = 0; index < 4; index += 1) {
      const action = cameraActionForKey({ key: "p" }, L4, camera);
      expect(action).not.toBeNull();
      camera = run(camera, action!, L4);
      seen.push(camera.mode === "look" ? camera.lookSeat : null);
    }
    expect(seen).toEqual([1, 2, 3, null]);
  });

  it("keys 1 to 4 focus a seat, 1 is home and 0 is the overview", () => {
    expect(cameraActionForKey({ key: "1" }, L4, home4)).toEqual({ type: "home" });
    expect(cameraActionForKey({ key: "3" }, L4, home4)).toEqual({ type: "focus", seat: 2 });
    expect(cameraActionForKey({ key: "0" }, L4, home4)).toEqual({ type: "overview" });
  });
});

describe("the 3-way face-off has one view", () => {
  const OUT = [2];
  const key = (k: string) => cameraActionForKey({ key: k }, L3, HOME, { out: OUT });

  it("detects the face-off on a 3-way table only", () => {
    expect(isFaceOff(L3, [])).toBe(false);
    expect(isFaceOff(L3, [2])).toBe(true);
    expect(isFaceOff(L4, [3])).toBe(false);
    expect(isFaceOff(L4, [2, 3])).toBe(false);
  });

  it("turns the camera keys off, and keeps the others", () => {
    for (const k of ["0", "o", "Tab", "p", "f", "Escape", "2", "3"]) expect(key(k)).toBeNull();
    expect(key("1")).toEqual({ type: "home" });
    expect(key("h")).toEqual({ type: "home" });
    expect(key("s")).toEqual({ type: "toggleUpright" });
  });

  it("does nothing when the camera is home, and sends it home when it is not", () => {
    for (const action of [{ type: "overview" }, { type: "focus", seat: 1 }, { type: "focusStep", dir: 1 }, { type: "look", seat: 1 }, { type: "toggleFly" }, { type: "flyTo", seat: 1 }] as CameraAction[]) {
      expect(run(HOME, action, L3, OUT)).toBe(HOME);
      expect(run(initialCamera(L3, { mode: "fly" }), action, L3, OUT).mode).toBe("home");
    }
  });

  it("goes home at once from fly mode under an FX lock, and keeps the lock", () => {
    const fly = locked(initialCamera(L3, { mode: "fly" }));
    expect(fly.mode).toBe("fly");
    const home = run(fly, { type: "home" }, L3, OUT);
    expect(home).toMatchObject({ mode: "home" });
    expect(home.lock).toEqual(fly.lock);
    expect(effectiveCamera(home, 1500).mode).toBe("home");
  });

  it("goes home in the update that ends the lock", () => {
    const fly = locked(initialCamera(L3, { mode: "fly" }), 1000);
    expect(run(fly, { type: "tick", nowMs: 2500 }, L3, OUT)).toMatchObject({ mode: "home", lock: null });
    expect(run(fly, { type: "tick", nowMs: 2500 }, L3).mode).toBe("fly");
  });

  it("still allows the views with three seats alive", () => {
    expect(run(HOME, { type: "overview" }).mode).toBe("fly");
  });
});

describe("3-way enlarge: the viewer's click on a field", () => {
  it("enlarges the field, and the same field again goes home", () => {
    const rival = run(HOME, { type: "enlarge", seat: 1 });
    expect(rival).toMatchObject({ mode: "focus", focusSeat: 1 });
    expect(run(rival, { type: "enlarge", seat: 2 })).toMatchObject({ mode: "focus", focusSeat: 2 });
    expect(run(rival, { type: "enlarge", seat: 1 })).toMatchObject({ mode: "home", focusSeat: null });
    const own = run(HOME, { type: "enlarge", seat: 0 });
    expect(own).toMatchObject({ mode: "focus", focusSeat: 0 });
    expect(run(own, { type: "enlarge", seat: 0 })).toMatchObject({ mode: "home" });
  });

  it("ignores a seat that is out, an unknown seat, and any table that is not a 3-way", () => {
    expect(run(HOME, { type: "enlarge", seat: 1 }, L3, [1])).toBe(HOME);
    expect(run(HOME, { type: "enlarge", seat: 9 })).toBe(HOME);
    expect(run(initialCamera(L4), { type: "enlarge", seat: 1 }, L4)).toMatchObject({ mode: "home" });
  });

  it("E toggles your own field and Esc goes back from an enlarged field", () => {
    expect(cameraActionForKey({ key: "e", shiftKey: false }, L3, HOME)).toEqual({ type: "enlarge", seat: 0 });
    expect(cameraActionForKey({ key: "Escape", shiftKey: false }, L3, run(HOME, { type: "enlarge", seat: 1 }))).toEqual({ type: "home" });
    expect(cameraActionForKey({ key: "Escape", shiftKey: false }, L3, HOME)).toBeNull();
    expect(cameraActionForKey({ key: "e", shiftKey: false }, L4, initialCamera(L4))).toBeNull();
  });
});
