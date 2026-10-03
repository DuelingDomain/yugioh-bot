import type { DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";
import { flyYawFor, normalizeAngle } from "./geometry";
import type { CameraAction, CameraLockReason, CameraMode, CameraState, FlyPose, TableLayout } from "./types";

/**
 * The camera of the multiplayer table as a pure model. The reducer takes a layout (who sits where) and an optional
 * context (the seats that are out of the duel). The FX lock holds the camera at the play view while an effect
 * plays: movement is ignored, and the stored pose comes back when the lock ends.
 */

/** The plaza pose: no turn, tilted 40 degrees, a little zoomed out, looking at the arena. */
export const FLY_HOME: FlyPose = { yawDeg: 0, tiltDeg: 40, zoom: 0.9, targetSeat: null, free: false };

const SEAT_TILT = 30;
const SEAT_ZOOM = 1.8;
const TILT_MIN = 8;
const TILT_MAX = 68;
const ZOOM_MIN = 0.32;
const ZOOM_MAX = 1.9;

export interface CameraContext {
  /** Seats that are out of the duel. The camera never goes to them. */
  out?: readonly number[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function initialCamera(layout: TableLayout, partial: Partial<CameraState> = {}): CameraState {
  void layout;
  const base: CameraState = {
    mode: "home",
    focusSeat: null,
    lookSeat: null,
    upright: false,
    compact: "auto",
    auto: true,
    pinned: false,
    aiming: false,
    fly: FLY_HOME,
    lock: null,
    autoMoved: false,
    flyIn: true,
  };
  const merged: CameraState = { ...base, ...partial, fly: partial.fly ?? FLY_HOME };
  return { ...merged, pinned: partial.pinned ?? merged.mode !== "home" };
}

function seatsOf(layout: TableLayout, ctx?: CameraContext) {
  const out = new Set(ctx?.out ?? []);
  const anchor = layout.anchorSeat;
  const known = new Set(layout.slots.map((slot) => slot.seat));
  const rivals = layout.slots.map((slot) => slot.seat).filter((seat) => seat !== anchor && !out.has(seat));
  return { anchor, known, out, rivals };
}

const HOME_VIEW = { mode: "home" as CameraMode, focusSeat: null, lookSeat: null, fly: FLY_HOME };

/** A manual move: it pins the camera unless it goes home. */
function move(state: CameraState, patch: Partial<CameraState> & { mode: CameraMode }): CameraState {
  return {
    ...state,
    focusSeat: null,
    lookSeat: null,
    fly: FLY_HOME,
    ...patch,
    pinned: patch.mode !== "home",
    autoMoved: false,
  };
}

const MOVES = new Set<CameraAction["type"]>(["home", "overview", "focus", "focusStep", "look", "toggleFly", "flyTo", "orbit", "zoom"]);

export function cameraReducer(state: CameraState, action: CameraAction, layout: TableLayout, ctx?: CameraContext): CameraState {
  if (state.lock != null && MOVES.has(action.type)) return state;
  const { anchor, known, out, rivals } = seatsOf(layout, ctx);
  switch (action.type) {
    case "home":
      return move(state, HOME_VIEW);
    case "overview": {
      if (state.flyIn === false) return move(state, { mode: "overview" });
      if (state.mode === "fly") return { ...state, fly: FLY_HOME, pinned: true, autoMoved: false };
      return move(state, { mode: "fly" });
    }
    case "focus": {
      if (action.seat === anchor) return move(state, HOME_VIEW);
      if (!known.has(action.seat) || out.has(action.seat)) return state;
      return move(state, { mode: "focus", focusSeat: action.seat });
    }
    case "focusStep": {
      if (rivals.length === 0) return state;
      const ring = [anchor, ...rivals];
      const current = state.mode === "focus" && state.focusSeat != null ? ring.indexOf(state.focusSeat) : 0;
      const next = ring[(Math.max(current, 0) + action.dir + ring.length) % ring.length];
      return next === anchor ? move(state, HOME_VIEW) : move(state, { mode: "focus", focusSeat: next });
    }
    case "look": {
      if (action.seat == null || action.seat === anchor) return move(state, HOME_VIEW);
      if (!known.has(action.seat) || out.has(action.seat)) return state;
      return move(state, { mode: "look", lookSeat: action.seat });
    }
    case "toggleFly": {
      if (state.flyIn === false) return move({ ...state, flyIn: true }, { mode: "fly" });
      const next = { ...state, flyIn: false };
      return state.mode === "fly" ? { ...next, mode: "overview", fly: FLY_HOME, pinned: true, autoMoved: false } : next;
    }
    case "flyTo": {
      if (!known.has(action.seat)) return state;
      if (state.mode === "fly" && state.fly.targetSeat === action.seat && !state.fly.free) {
        return { ...state, fly: FLY_HOME, pinned: true, autoMoved: false };
      }
      const fly: FlyPose = { yawDeg: flyYawFor(layout, action.seat), tiltDeg: SEAT_TILT, zoom: SEAT_ZOOM, targetSeat: action.seat, free: false };
      if (state.mode === "fly") return { ...state, fly, pinned: true, autoMoved: false };
      return move({ ...state, flyIn: true }, { mode: "fly", fly });
    }
    case "orbit": {
      if (state.mode !== "fly") return state;
      const fly: FlyPose = {
        ...state.fly,
        yawDeg: normalizeAngle(state.fly.yawDeg + action.dYawDeg),
        tiltDeg: clamp(state.fly.tiltDeg + action.dTiltDeg, TILT_MIN, TILT_MAX),
        free: true,
      };
      return { ...state, fly };
    }
    case "zoom": {
      if (state.mode !== "fly") return state;
      return { ...state, fly: { ...state.fly, zoom: clamp(state.fly.zoom * action.factor, ZOOM_MIN, ZOOM_MAX), free: true } };
    }
    case "toggleUpright":
      return { ...state, upright: !state.upright };
    case "toggleCompact":
      return { ...state, compact: state.compact === "auto" ? "on" : state.compact === "on" ? "off" : "auto" };
    case "toggleAuto":
      return { ...state, auto: !state.auto };
    case "pin":
      return { ...state, pinned: action.on, autoMoved: false };
    case "aiming":
      return state.aiming === action.on ? state : { ...state, aiming: action.on };
    case "autoFollow": {
      if (!state.auto || state.aiming || state.pinned) return state;
      if (action.seat == null || action.seat === anchor) {
        return state.mode === "home" ? state : { ...state, ...HOME_VIEW, pinned: false, autoMoved: false };
      }
      if (!known.has(action.seat) || out.has(action.seat)) return state;
      if (state.mode === "focus" && state.focusSeat === action.seat && state.autoMoved) return state;
      return { ...state, mode: "focus", focusSeat: action.seat, lookSeat: null, fly: FLY_HOME, pinned: false, autoMoved: true };
    }
    case "lock": {
      const untilMs = action.nowMs + action.ms;
      if (state.lock && state.lock.untilMs > action.nowMs && state.lock.untilMs >= untilMs) return state;
      return { ...state, lock: { reason: action.reason, untilMs } };
    }
    case "tick":
      return state.lock && state.lock.untilMs <= action.nowMs ? { ...state, lock: null } : state;
  }
}

/** The lock is on until its end time. The stored pose is not touched, so it comes back when the lock ends. */
export function isLocked(state: Pick<CameraState, "lock">, nowMs: number): boolean {
  return state.lock != null && state.lock.untilMs > nowMs;
}

/** The mode on screen: the play view (home) under a lock, except the plaza, which eases back to its preset. */
export function effectiveMode(state: CameraState, nowMs: number): CameraMode {
  if (!isLocked(state, nowMs)) return state.mode;
  return state.mode === "fly" ? "fly" : "home";
}

export function effectiveFly(state: CameraState, nowMs: number): FlyPose {
  return isLocked(state, nowMs) ? FLY_HOME : state.fly;
}

/**
 * The camera the stage draws. The very same object when nothing is locked. Under a lock the rival fields are never
 * compact chips: the FX (battle, destroy, move plans) play on the real zones, and a hidden chip board would give
 * them a second, disagreeing anchor.
 */
export function effectiveCamera(state: CameraState, nowMs: number): CameraState {
  if (!isLocked(state, nowMs)) return state;
  const full = state.compact === "off" ? state : { ...state, compact: "off" as const };
  if (state.mode === "fly") return full.fly === FLY_HOME ? full : { ...full, fly: FLY_HOME };
  if (state.mode === "home") return full;
  return { ...full, mode: "home", focusSeat: null, lookSeat: null, fly: FLY_HOME };
}

export interface CameraKeyEvent {
  key: string;
  shiftKey?: boolean;
}

/** The camera action of a key press, or null when the key is not a camera key. */
export function cameraActionForKey(
  event: CameraKeyEvent,
  layout: TableLayout,
  camera: Pick<CameraState, "mode" | "lookSeat" | "pinned" | "fly">,
  ctx?: CameraContext,
): CameraAction | null {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  switch (key) {
    case "Tab":
      return { type: "focusStep", dir: event.shiftKey ? -1 : 1 };
    case "h":
      return { type: "home" };
    case "o":
    case "0":
      return { type: "overview" };
    case "f":
      return { type: "toggleFly" };
    case "s":
      return { type: "toggleUpright" };
    case "a":
      return { type: "toggleAuto" };
    case "k":
      return { type: "pin", on: !camera.pinned };
    case "c":
      return layout.format === "ffa4" ? { type: "toggleCompact" } : null;
    case "p": {
      const { rivals } = seatsOf(layout, ctx);
      if (rivals.length === 0) return null;
      const at = camera.mode === "look" && camera.lookSeat != null ? rivals.indexOf(camera.lookSeat) : -1;
      if (at < 0) return { type: "look", seat: rivals[0] };
      return { type: "look", seat: at + 1 < rivals.length ? rivals[at + 1] : null };
    }
    case "Escape":
      return camera.mode === "fly" && (camera.fly.targetSeat != null || camera.fly.free === true) ? { type: "overview" } : null;
    default:
  }
  if (/^[1-9]$/.test(key)) {
    const slot = layout.slots[Number(key) - 1];
    if (!slot) return null;
    if (camera.mode === "fly") return { type: "flyTo", seat: slot.seat };
    return slot.seat === layout.anchorSeat ? { type: "home" } : { type: "focus", seat: slot.seat };
  }
  return null;
}

/** An FX lock: why, for how long, and the last event id the lock has read. */
export interface FxLock {
  reason: CameraLockReason;
  ms: number;
  lastId?: number;
}

const LOCK_PRIORITY: Record<CameraLockReason, number> = { destroy: 1, chain: 2, battle: 3, direct: 4, elimination: 5 };
const LOCK_MS: Record<CameraLockReason, number> = { chain: 900, destroy: 1300, battle: 1500, direct: 1900, elimination: 2400 };
const DAMAGE_LOCK_MS = 1100;

/** Real milliseconds a lock of `ms` FX milliseconds lasts at the viewer's pace (`duelFxClock.factor()`). */
export function scaleLockMs(ms: number, speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? Math.round(ms / speed) : ms;
}

/** The lock one event asks for. An attack with a target is a battle; with none it is a direct attack. */
export function fxLockFor(event: DuelEvent): FxLock | null {
  switch (event.kind) {
    case "attack":
      return event.target ? { reason: "battle", ms: LOCK_MS.battle } : { reason: "direct", ms: LOCK_MS.direct };
    case "chain-resolving":
      return { reason: "chain", ms: LOCK_MS.chain };
    case "destroy":
      return { reason: "destroy", ms: LOCK_MS.destroy };
    case "damage":
      return event.cause !== "battle" ? { reason: "direct", ms: DAMAGE_LOCK_MS } : null;
    default:
      return null;
  }
}

/** The lock of the events with an id above `afterId`: the strongest reason and the longest time. `speed` is the viewer's FX rate. */
export function lockForEvents(events: readonly DuelEvent[], afterId: number, speed = 1): FxLock | null {
  let reason: CameraLockReason | null = null;
  let ms = 0;
  let lastId = afterId;
  for (const event of events) {
    if (event.id <= afterId) continue;
    lastId = Math.max(lastId, event.id);
    const next = fxLockFor(event);
    if (!next) continue;
    if (reason === null || LOCK_PRIORITY[next.reason] > LOCK_PRIORITY[reason]) reason = next.reason;
    ms = Math.max(ms, next.ms);
  }
  return reason === null ? null : { reason, ms: scaleLockMs(ms, speed), lastId };
}

/** A seat that starts to leave or is newly out locks the camera for the elimination. */
export function lockForSeats(previous: readonly DuelSeatView[], next: readonly DuelSeatView[], speed = 1): FxLock | null {
  const gone = (view: DuelSeatView | undefined) => view != null && (view.eliminated === true || view.pendingElimination === true);
  for (const view of next) {
    if (gone(view) && !gone(previous.find((entry) => entry.seat === view.seat))) return { reason: "elimination", ms: scaleLockMs(LOCK_MS.elimination, speed) };
  }
  return null;
}
