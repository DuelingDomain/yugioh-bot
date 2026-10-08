import { aliveLayout, flyYawFor, normalizeAngle } from "./geometry";
import type { CameraAction, CameraMode, CameraState, FlyPose, TableLayout } from "./types";

/**
 * The camera of the multiplayer table as a pure model. The reducer takes a layout (who sits where) and an optional
 * context (the seats that are out of the duel). The view changes ONLY on an action of the viewer (a click or a key):
 * a remote move, a chain, an attack, a prompt or a new turn never dispatches one. (A face-off, with two seats left,
 * has one view, so it is home. A rival that leaves is no view any more.) The `lock` of the state is a preview
 * switch (`?lock=`): the duel itself never sets it.
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
    fly: FLY_HOME,
    lock: null,
    flyIn: true,
  };
  return { ...base, ...partial, fly: partial.fly ?? FLY_HOME };
}

function seatsOf(layout: TableLayout, ctx?: CameraContext) {
  const out = new Set(ctx?.out ?? []);
  const anchor = layout.anchorSeat;
  const known = new Set(layout.slots.map((slot) => slot.seat));
  const rivals = layout.slots.map((slot) => slot.seat).filter((seat) => seat !== anchor && !out.has(seat));
  return { anchor, known, out, rivals };
}

const HOME_VIEW = { mode: "home" as CameraMode, focusSeat: null, lookSeat: null, fly: FLY_HOME };

/** A move of the viewer: the one way the view changes (a click, a key). Nothing in the duel moves it. */
function move(state: CameraState, patch: Partial<CameraState> & { mode: CameraMode }): CameraState {
  return {
    ...state,
    focusSeat: null,
    lookSeat: null,
    fly: FLY_HOME,
    ...patch,
  };
}

/**
 * A 3-way table with two seats or fewer left is a face-off: the two boards face each other and there is one view.
 * Overview, Focus, Look and the fly-in have nothing to show there.
 */
export function isFaceOff(layout: TableLayout, out: readonly number[] | ReadonlySet<number>): boolean {
  if (layout.format !== "ffa3") return false;
  const gone = out instanceof Set ? out : new Set(out);
  return layout.slots.filter((slot) => !gone.has(slot.seat)).length <= 2;
}

/**
 * Your own field enlarged on a 3-way table that is down to a face-off: the zoom stays (the camera never zooms by itself, and an
 * elimination is not the player's move). Needs the viewer's seat alive; the player leaves it with Home, E, Esc or Back.
 */
export function holdsOwnFocus(layout: TableLayout, camera: Pick<CameraState, "mode" | "focusSeat">, out: readonly number[] | ReadonlySet<number>): boolean {
  if (layout.format !== "ffa3" || camera.mode !== "focus" || camera.focusSeat !== layout.anchorSeat) return false;
  return !(out instanceof Set ? out.has(layout.anchorSeat) : (out as readonly number[]).includes(layout.anchorSeat));
}

const FACE_OFF_VIEWS = new Set<CameraAction["type"]>(["overview", "focus", "enlarge", "focusStep", "look", "toggleFly", "flyTo"]);

const MOVES = new Set<CameraAction["type"]>(["home", "overview", "focus", "enlarge", "focusStep", "look", "toggleFly", "flyTo", "orbit", "zoom"]);

export function cameraReducer(state: CameraState, action: CameraAction, layout: TableLayout, ctx?: CameraContext): CameraState {
  const { anchor, known, out, rivals } = seatsOf(layout, ctx);
  const faceOff = isFaceOff(layout, out);
  // Your own field enlarged through a face-off: only Home, Esc and a second E leave it. A click or a key about a rival changes nothing.
  if (faceOff && holdsOwnFocus(layout, state, out)) {
    const aboutRival = action.type === "focusStep" || action.type === "look" || ((action.type === "focus" || action.type === "enlarge") && action.seat !== anchor);
    if (aboutRival) return state;
  }
  // A face-off has one view, so a camera in another mode goes home at once, also under an FX lock (the lock stays).
  if (faceOff && state.mode !== "home" && (action.type === "home" || FACE_OFF_VIEWS.has(action.type))) return move(state, HOME_VIEW);
  if (state.lock != null && MOVES.has(action.type)) return state;
  // The viewer may enlarge their own field again in a face-off (the Zoom my field button, E): that view is the one the face-off keeps.
  const ownAgain = faceOff && action.type === "enlarge" && action.seat === anchor && !out.has(anchor);
  if (faceOff && !ownAgain) {
    // One view only: a request for another one sends the camera home.
    if (FACE_OFF_VIEWS.has(action.type)) return state.mode === "home" ? state : move(state, HOME_VIEW);
  }
  switch (action.type) {
    case "home":
      return move(state, HOME_VIEW);
    case "overview": {
      if (state.flyIn === false) return move(state, { mode: "overview" });
      if (state.mode === "fly") return { ...state, fly: FLY_HOME };
      return move(state, { mode: "fly" });
    }
    case "focus": {
      if (action.seat === anchor) return move(state, HOME_VIEW);
      if (!known.has(action.seat) || out.has(action.seat)) return state;
      return move(state, { mode: "focus", focusSeat: action.seat });
    }
    case "enlarge": {
      // The one viewer action of the 3-way plaza: a click or Enter on a field. The same field again goes home.
      if (layout.format !== "ffa3") return state;
      if (!known.has(action.seat) || out.has(action.seat)) return state;
      if (state.mode === "focus" && state.focusSeat === action.seat) return move(state, HOME_VIEW);
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
      return state.mode === "fly" ? { ...next, mode: "overview", fly: FLY_HOME } : next;
    }
    case "flyTo": {
      if (!known.has(action.seat)) return state;
      if (state.mode === "fly" && state.fly.targetSeat === action.seat && !state.fly.free) {
        return { ...state, fly: FLY_HOME };
      }
      const fly: FlyPose = { yawDeg: flyYawFor(aliveLayout(layout, out), action.seat), tiltDeg: SEAT_TILT, zoom: SEAT_ZOOM, targetSeat: action.seat, free: false };
      if (state.mode === "fly") return { ...state, fly };
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
    case "lock": {
      const untilMs = action.nowMs + action.ms;
      if (state.lock && state.lock.untilMs > action.nowMs && state.lock.untilMs >= untilMs) return state;
      return { ...state, lock: { reason: action.reason, untilMs } };
    }
    case "tick": {
      if (!state.lock || state.lock.untilMs > action.nowMs) return state;
      // The lock ends in a face-off: no view but home is left, so the camera goes home in the same update.
      return faceOff && state.mode !== "home" && !holdsOwnFocus(layout, state, out) ? move({ ...state, lock: null }, HOME_VIEW) : { ...state, lock: null };
    }
    default:
      // An action the table no longer has (the old auto camera, Keep, aim hold) changes nothing.
      return state;
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
 * The camera the stage draws. The very same object when nothing is locked.
 */
export function effectiveCamera(state: CameraState, nowMs: number): CameraState {
  if (!isLocked(state, nowMs)) return state;
  if (state.mode === "fly") return state.fly === FLY_HOME ? state : { ...state, fly: FLY_HOME };
  if (state.mode === "home") return state;
  return { ...state, mode: "home", focusSeat: null, lookSeat: null, fly: FLY_HOME };
}

export interface CameraKeyEvent {
  key: string;
  /** The physical key: the bracket keys step the focus on layouts where `[` and `]` are typed with AltGr or another key. */
  code?: string;
  shiftKey?: boolean;
}

/** The camera action of a key press, or null when the key is not a camera key. */
export function cameraActionForKey(
  event: CameraKeyEvent,
  layout: TableLayout,
  camera: Pick<CameraState, "mode" | "lookSeat" | "fly">,
  ctx?: CameraContext,
): CameraAction | null {
  const key = event.code === "BracketLeft" ? "[" : event.code === "BracketRight" ? "]" : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const faceOff = isFaceOff(layout, ctx?.out ?? []);
  // Esc still leaves your own field enlarged through a face-off (the one view that can be on).
  if (faceOff && (key === "]" || key === "[" || key === "o" || key === "0" || key === "f" || key === "p" || (key === "Escape" && camera.mode !== "focus"))) return null;
  switch (key) {
    // Tab is left to the browser: the seat boxes are keyboard stops. [ and ] walk the rivals.
    case "]":
      return { type: "focusStep", dir: 1 };
    case "[":
      return { type: "focusStep", dir: -1 };
    case "h":
      return { type: "home" };
    case "o":
    case "0":
      return { type: "overview" };
    case "f":
      return { type: "toggleFly" };
    case "s":
      return { type: "toggleUpright" };
    case "e":
      // 3-way: enlarge your own field, or go back from it. The reducer ignores it on any other table.
      return layout.format === "ffa3" ? { type: "enlarge", seat: layout.anchorSeat } : null;
    case "p": {
      const { rivals } = seatsOf(layout, ctx);
      if (rivals.length === 0) return null;
      const at = camera.mode === "look" && camera.lookSeat != null ? rivals.indexOf(camera.lookSeat) : -1;
      if (at < 0) return { type: "look", seat: rivals[0] };
      return { type: "look", seat: at + 1 < rivals.length ? rivals[at + 1] : null };
    }
    case "Escape":
      if (camera.mode === "focus") return { type: "home" };
      return camera.mode === "fly" && (camera.fly.targetSeat != null || camera.fly.free === true) ? { type: "overview" } : null;
    default:
  }
  if (/^[1-9]$/.test(key)) {
    const slot = layout.slots[Number(key) - 1];
    if (!slot) return null;
    if (faceOff && slot.seat !== layout.anchorSeat) return null;
    if (camera.mode === "fly") return { type: "flyTo", seat: slot.seat };
    return slot.seat === layout.anchorSeat ? { type: "home" } : { type: "focus", seat: slot.seat };
  }
  return null;
}

/**
 * The longest home move of the table camera: the fly tween (`DURATION_MS` in use-fly-world.ts). The rival fields ease
 * for 0.76 s (rival-field.module.css). Neither is scaled by the FX speed.
 */
export const CAMERA_HOME_MS = 950;
