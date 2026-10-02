import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelEvent, DuelFormat, DuelSeatView } from "@yugidraft/shared/duels";
import {
  cameraActionForKey,
  cameraReducer,
  effectiveCamera,
  effectiveFly,
  effectiveMode,
  FLY_HOME,
  fxLockFor,
  initialCamera,
  isLocked,
  lockForEvents,
  lockForSeats,
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
  it("starts at home, unpinned, auto on, fly-in preferred", () => {
    expect(HOME).toMatchObject({
      mode: "home", focusSeat: null, lookSeat: null, auto: true, pinned: false, aiming: false, lock: null, upright: false, compact: "auto",
    });
    expect(HOME.flyIn).not.toBe(false);
    expect(HOME.fly).toEqual(FLY_HOME);
  });

  it("pins a camera that does not start at home and fills the fly preset", () => {
    expect(initialCamera(L3, { mode: "focus", focusSeat: 1 })).toMatchObject({ mode: "focus", focusSeat: 1, pinned: true });
    expect(initialCamera(L3, { mode: "fly" })).toMatchObject({ mode: "fly", pinned: true, fly: FLY_HOME });
    expect(initialCamera(L3, { mode: "look", lookSeat: 2 })).toMatchObject({ lookSeat: 2, pinned: true });
    expect(initialCamera(L3, { mode: "focus", focusSeat: 1, pinned: false }).pinned).toBe(false);
  });
});

describe("cameraReducer: home, overview, focus, look", () => {
  it("home clears focus and look and drops the pin", () => {
    const from = run(run(HOME, { type: "focus", seat: 1 }), { type: "home" });
    expect(from).toMatchObject({ mode: "home", focusSeat: null, lookSeat: null, pinned: false, autoMoved: false });
    expect(run(run(HOME, { type: "look", seat: 2 }), { type: "home" })).toMatchObject({ mode: "home", lookSeat: null });
  });

  it("overview goes to the fly-in plaza and pins; with fly-in off it is the flat overview", () => {
    expect(run(HOME, { type: "overview" })).toMatchObject({ mode: "fly", pinned: true, focusSeat: null, fly: FLY_HOME });
    const flat = run(HOME, { type: "toggleFly" }); // fly-in on -> off from home: stays home
    expect(flat.flyIn).toBe(false);
    expect(run(flat, { type: "overview" })).toMatchObject({ mode: "overview", pinned: true });
  });

  it("overview from a seat fly-in returns to the plaza pose and stays in fly mode", () => {
    const seat = run(HOME, { type: "flyTo", seat: 1 });
    expect(seat.fly.targetSeat).toBe(1);
    expect(run(seat, { type: "overview" })).toMatchObject({ mode: "fly", fly: FLY_HOME });
  });

  it("focus swings to a rival and pins it", () => {
    expect(run(HOME, { type: "focus", seat: 2 })).toMatchObject({ mode: "focus", focusSeat: 2, lookSeat: null, pinned: true, autoMoved: false });
  });

  it("focus on yourself is home; an unknown seat or an eliminated one is ignored", () => {
    const moved = run(HOME, { type: "focus", seat: 1 });
    expect(run(moved, { type: "focus", seat: 0 })).toMatchObject({ mode: "home", focusSeat: null, pinned: false });
    expect(run(HOME, { type: "focus", seat: 9 })).toBe(HOME);
    expect(run(HOME, { type: "focus", seat: 1 }, L3, [1])).toBe(HOME);
  });

  it("focusStep walks home, Ryo, Mika, home in both directions", () => {
    const f1 = run(HOME, { type: "focusStep", dir: 1 });
    expect(f1).toMatchObject({ mode: "focus", focusSeat: 1 });
    const f2 = run(f1, { type: "focusStep", dir: 1 });
    expect(f2).toMatchObject({ mode: "focus", focusSeat: 2 });
    expect(run(f2, { type: "focusStep", dir: 1 })).toMatchObject({ mode: "home", focusSeat: null, pinned: false });
    expect(run(HOME, { type: "focusStep", dir: -1 })).toMatchObject({ mode: "focus", focusSeat: 2 });
    expect(run(f1, { type: "focusStep", dir: -1 })).toMatchObject({ mode: "home" });
  });

  it("focusStep skips eliminated seats and does nothing when no rival is left", () => {
    expect(run(HOME, { type: "focusStep", dir: 1 }, L3, [1])).toMatchObject({ mode: "focus", focusSeat: 2 });
    expect(run(HOME, { type: "focusStep", dir: 1 }, L3, [1, 2])).toBe(HOME);
  });

  it("focusStep from look or overview starts at home", () => {
    const look = run(HOME, { type: "look", seat: 2 });
    expect(run(look, { type: "focusStep", dir: 1 })).toMatchObject({ mode: "focus", focusSeat: 1, lookSeat: null });
  });

  it("look turns the table to a rival's seat; null or your own seat is home", () => {
    expect(run(HOME, { type: "look", seat: 1 })).toMatchObject({ mode: "look", lookSeat: 1, focusSeat: null, pinned: true });
    const look = run(HOME, { type: "look", seat: 1 });
    expect(run(look, { type: "look", seat: null })).toMatchObject({ mode: "home", lookSeat: null, pinned: false });
    expect(run(look, { type: "look", seat: 0 })).toMatchObject({ mode: "home" });
    expect(run(HOME, { type: "look", seat: 9 })).toBe(HOME);
  });
});

describe("cameraReducer: fly-in", () => {
  it("toggleFly turns the fly-in preference on and goes to the plaza", () => {
    const off = run(HOME, { type: "toggleFly" });
    expect(off.flyIn).toBe(false);
    const on = run(off, { type: "toggleFly" });
    expect(on).toMatchObject({ flyIn: true, mode: "fly", pinned: true, fly: FLY_HOME });
  });

  it("toggleFly off from the plaza drops to the flat overview and keeps the pin", () => {
    const fly = run(HOME, { type: "overview" });
    expect(run(fly, { type: "toggleFly" })).toMatchObject({ flyIn: false, mode: "overview", pinned: true });
  });

  it("flyTo from any mode enters the plaza at that seat, turned so the seat reads upright", () => {
    const s = run(HOME, { type: "flyTo", seat: 1 });
    expect(s).toMatchObject({ mode: "fly", flyIn: true, pinned: true });
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

describe("cameraReducer: toggles, pin, aiming", () => {
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

  it("toggleAuto flips auto", () => {
    expect(run(HOME, { type: "toggleAuto" }).auto).toBe(false);
  });

  it("pin sets and clears the pin and forgets that auto moved the camera", () => {
    const moved = run(HOME, { type: "autoFollow", seat: 1 });
    expect(moved.autoMoved).toBe(true);
    const kept = run(moved, { type: "pin", on: true });
    expect(kept).toMatchObject({ pinned: true, autoMoved: false, mode: "focus", focusSeat: 1 });
    expect(run(kept, { type: "pin", on: false }).pinned).toBe(false);
  });

  it("aiming sets the flag", () => {
    expect(run(HOME, { type: "aiming", on: true }).aiming).toBe(true);
    expect(run(run(HOME, { type: "aiming", on: true }), { type: "aiming", on: false }).aiming).toBe(false);
  });
});

describe("cameraReducer: auto camera", () => {
  it("follows a seat without pinning, and marks the move as automatic", () => {
    expect(run(HOME, { type: "autoFollow", seat: 2 })).toMatchObject({ mode: "focus", focusSeat: 2, pinned: false, autoMoved: true });
  });

  it("returns home when there is no seat to follow", () => {
    const moved = run(HOME, { type: "autoFollow", seat: 2 });
    expect(run(moved, { type: "autoFollow", seat: null })).toMatchObject({ mode: "home", focusSeat: null, autoMoved: false });
    expect(run(HOME, { type: "autoFollow", seat: null })).toBe(HOME);
  });

  it("following your own seat is home", () => {
    const moved = run(HOME, { type: "autoFollow", seat: 2 });
    expect(run(moved, { type: "autoFollow", seat: 0 })).toMatchObject({ mode: "home" });
  });

  it("never moves while you aim", () => {
    const aiming = run(HOME, { type: "aiming", on: true });
    expect(run(aiming, { type: "autoFollow", seat: 2 })).toBe(aiming);
    const moved = run(run(HOME, { type: "autoFollow", seat: 1 }), { type: "aiming", on: true });
    expect(run(moved, { type: "autoFollow", seat: null })).toBe(moved);
  });

  it("is ignored while the Keep pin is on, even at home", () => {
    const pinned = run(HOME, { type: "pin", on: true });
    expect(run(pinned, { type: "autoFollow", seat: 2 })).toBe(pinned);
    const focus = run(HOME, { type: "focus", seat: 1 });
    expect(run(focus, { type: "autoFollow", seat: null })).toBe(focus);
  });

  it("is ignored when auto is off", () => {
    const off = run(HOME, { type: "toggleAuto" });
    expect(run(off, { type: "autoFollow", seat: 2 })).toBe(off);
  });

  it("does not follow an eliminated or unknown seat", () => {
    expect(run(HOME, { type: "autoFollow", seat: 1 }, L3, [1])).toBe(HOME);
    expect(run(HOME, { type: "autoFollow", seat: 9 })).toBe(HOME);
  });

  it("a manual move after an auto move pins and clears the auto mark", () => {
    const auto = run(HOME, { type: "autoFollow", seat: 1 });
    expect(run(auto, { type: "focus", seat: 2 })).toMatchObject({ pinned: true, autoMoved: false, focusSeat: 2 });
  });

  it("an auto follow of the same seat keeps the state object", () => {
    const auto = run(HOME, { type: "autoFollow", seat: 1 });
    expect(run(auto, { type: "autoFollow", seat: 1 })).toBe(auto);
  });
});

describe("FX lock", () => {
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

  it("still takes toggles, pin, aiming, auto follow and more locks while locked", () => {
    const l = locked();
    expect(run(l, { type: "toggleUpright" }).upright).toBe(true);
    expect(run(l, { type: "toggleAuto" }).auto).toBe(false);
    expect(run(l, { type: "toggleCompact" }).compact).toBe("on");
    expect(run(l, { type: "pin", on: true }).pinned).toBe(true);
    expect(run(l, { type: "aiming", on: true }).aiming).toBe(true);
    expect(run(l, { type: "autoFollow", seat: 2 })).toMatchObject({ mode: "focus", focusSeat: 2 });
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

describe("fxLockFor and friends", () => {
  const event = (over: Partial<DuelEvent>): DuelEvent => ({ id: 1, kind: "summon", text: "", ...over });
  const zone = { controller: 1, location: 4, sequence: 0 };

  it("locks for an attack on a monster, a direct attack, a chain link, a destroy and non-battle damage", () => {
    expect(fxLockFor(event({ kind: "attack", target: zone }))?.reason).toBe("battle");
    expect(fxLockFor(event({ kind: "attack" }))?.reason).toBe("direct");
    expect(fxLockFor(event({ kind: "chain-resolving" }))?.reason).toBe("chain");
    expect(fxLockFor(event({ kind: "destroy" }))?.reason).toBe("destroy");
    expect(fxLockFor(event({ kind: "damage", amount: 800 }))?.reason).toBe("direct");
  });

  it("does not lock for battle damage, which the attack lock already covers", () => {
    expect(fxLockFor(event({ kind: "damage", amount: 800, cause: "battle" }))).toBeNull();
    expect(fxLockFor(event({ kind: "damage", amount: 800, cause: "effect" }))?.reason).toBe("direct");
  });

  it("does not lock for quiet events", () => {
    for (const kind of ["summon", "set", "activate", "phase", "move", "position", "equip", "chain-end"] as const) {
      expect(fxLockFor(event({ kind }))).toBeNull();
    }
  });

  it("gives every lock a positive time", () => {
    for (const kind of ["attack", "chain-resolving", "destroy", "damage"] as const) {
      expect(fxLockFor(event({ kind, amount: 100 }))!.ms).toBeGreaterThan(0);
    }
  });

  it("lockForEvents reads only events after the last seen id and picks the longest lock", () => {
    const events = [
      event({ id: 4, kind: "chain-resolving" }),
      event({ id: 5, kind: "attack" }),
      event({ id: 6, kind: "summon" }),
    ];
    expect(lockForEvents(events, 6)).toBeNull();
    expect(lockForEvents(events, 4)?.reason).toBe("direct");
    const long = lockForEvents(events, 3)!;
    expect(long.ms).toBe(Math.max(fxLockFor(events[0])!.ms, fxLockFor(events[1])!.ms));
  });

  it("lockForSeats locks when a seat newly leaves or is eliminated", () => {
    const calm = [seatView(0), seatView(1), seatView(2)];
    const leaving = [seatView(0), seatView(1, { pendingElimination: true }), seatView(2)];
    const out = [seatView(0), seatView(1, { eliminated: true }), seatView(2)];
    expect(lockForSeats(calm, leaving)?.reason).toBe("elimination");
    expect(lockForSeats(leaving, out)).toBeNull();
    expect(lockForSeats(calm, out)?.reason).toBe("elimination");
    expect(lockForSeats(calm, calm)).toBeNull();
  });
});

describe("cameraActionForKey", () => {
  const key = (k: string, shiftKey = false, camera: CameraState = HOME, layout: TableLayout = L3) =>
    cameraActionForKey({ key: k, shiftKey }, layout, camera);

  it("Tab and Shift+Tab step the focus", () => {
    expect(key("Tab")).toEqual({ type: "focusStep", dir: 1 });
    expect(key("Tab", true)).toEqual({ type: "focusStep", dir: -1 });
  });

  it("maps H, O, 0, F, S, A in both cases", () => {
    expect(key("h")).toEqual({ type: "home" });
    expect(key("H")).toEqual({ type: "home" });
    expect(key("o")).toEqual({ type: "overview" });
    expect(key("O")).toEqual({ type: "overview" });
    expect(key("0")).toEqual({ type: "overview" });
    expect(key("f")).toEqual({ type: "toggleFly" });
    expect(key("s")).toEqual({ type: "toggleUpright" });
    expect(key("S")).toEqual({ type: "toggleUpright" });
    expect(key("a")).toEqual({ type: "toggleAuto" });
  });

  it("K toggles the pin from the current state", () => {
    expect(key("k")).toEqual({ type: "pin", on: true });
    expect(key("K", false, run(HOME, { type: "pin", on: true }))).toEqual({ type: "pin", on: false });
  });

  it("P looks from the next rival's seat, then back home", () => {
    expect(key("p")).toEqual({ type: "look", seat: 1 });
    const l1 = run(HOME, { type: "look", seat: 1 });
    expect(key("p", false, l1)).toEqual({ type: "look", seat: 2 });
    const l2 = run(HOME, { type: "look", seat: 2 });
    expect(key("P", false, l2)).toEqual({ type: "look", seat: null });
  });

  it("P skips eliminated seats", () => {
    expect(cameraActionForKey({ key: "p", shiftKey: false }, L3, HOME, { out: [1] })).toEqual({ type: "look", seat: 2 });
    expect(cameraActionForKey({ key: "p", shiftKey: false }, L3, HOME, { out: [1, 2] })).toBeNull();
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

  it("C toggles compact on a 4-way table only", () => {
    expect(key("c")).toBeNull();
    expect(key("c", false, initialCamera(L4), L4)).toEqual({ type: "toggleCompact" });
  });

  it("ignores other keys", () => {
    expect(key("x")).toBeNull();
    expect(key("Enter")).toBeNull();
    expect(key(" ")).toBeNull();
  });
});
