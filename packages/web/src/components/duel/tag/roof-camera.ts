import type { CameraAction, CameraLockReason, CameraState } from "../table/types";

/**
 * Pure camera of the 2v2 Rooftop. It uses the shared CameraState and CameraAction types (same reducer contract as the
 * table camera) and adds a few extra fields on top of CameraState: the target pose, a tween revision, and the pose to
 * restore after an FX lock. The "rival end" view rides on `look`; the fly-in intro rides on `toggleFly`.
 *
 * World units are the prototype's: a field is the SeatField box, 653 x 380, the near team strip sits at +y, the rival strip at -y.
 */

export interface RoofPose {
  yaw: number; // degrees, rotateZ of the world
  tilt: number; // degrees, rotateX of the world
  zoom: number;
  fx: number; // world point at the screen centre
  fy: number;
  oy: number; // screen offset (world units, scaled by fit)
}

export const ROOF_LIMITS = { zoomMin: 0.3, zoomMax: 2.4, tiltMin: 6, tiltMax: 66 } as const;

export const ROOF_PRESETS: Readonly<Record<"home" | "overview" | "rival" | "intro", RoofPose>> = {
  home: { yaw: 0, tilt: 36, zoom: 0.9, fx: 0, fy: 80, oy: 64 },
  overview: { yaw: 0, tilt: 14, zoom: 0.6, fx: 0, fy: 0, oy: 0 },
  rival: { yaw: 180, tilt: 36, zoom: 0.9, fx: 0, fy: -80, oy: 64 },
  intro: { yaw: -150, tilt: 74, zoom: 0.17, fx: 0, fy: -500, oy: -150 },
};

/** How long the camera takes to ease to the play view when an FX lock starts. The FX speed does not scale it. */
export const ROOF_LOCK_IN_MS = 700;
/** Field plane size (the SeatField box at z = 112 px) and strip offset in world units. Fields sit 61 units apart. */
export const ROOF_FIELD = { width: 653, height: 380, offsetY: 190, centerX: 357 } as const;

export interface RoofSlot {
  seat: number;
  near: boolean; // on the viewer's team strip
  x: number; // field centre in world units
  y: number;
}

/** World slot of every seat for an anchor seat: anchor near left, partner near right, rivals far in turn order. */
export function roofSlots(anchorSeat: number): Record<number, RoofSlot> {
  const { centerX, offsetY, height } = ROOF_FIELD;
  const nearY = offsetY + height / 2;
  const farY = -offsetY - height / 2;
  const a = ((anchorSeat % 4) + 4) % 4;
  const make = (seat: number, near: boolean, x: number): RoofSlot => ({ seat, near, x, y: near ? nearY : farY });
  return {
    [a]: make(a, true, -centerX),
    [(a + 2) % 4]: make((a + 2) % 4, true, centerX),
    [(a + 1) % 4]: make((a + 1) % 4, false, -centerX),
    [(a + 3) % 4]: make((a + 3) % 4, false, centerX),
  };
}

/** Close pose on one field: the near strip is seen upright, the far strip from the rival end. */
export function seatPose(anchorSeat: number, seat: number): RoofPose {
  const slot = roofSlots(anchorSeat)[seat];
  if (!slot) return { ...ROOF_PRESETS.home };
  return { yaw: slot.near ? 0 : 180, tilt: 30, zoom: 1.76, fx: slot.x, fy: slot.y + (slot.near ? 30 : -30), oy: -10 };
}

export type RoofCamName = "home" | "overview" | "rival" | "seat" | "free";

export interface RoofResume {
  mode: CameraState["mode"];
  focusSeat: number | null;
  lookSeat: number | null;
  pose: RoofPose;
  fly: CameraState["fly"];
}

export interface RoofCameraState extends CameraState {
  anchor: number; // the seat that sits at the near left (viewer, or 0 for a spectator)
  pose: RoofPose; // the pose the world eases to
  from: RoofPose | null; // start pose of the next tween (fly-in); null = start from the pose on screen
  dur: number; // tween length in ms; 0 = jump
  intro: boolean; // the pending tween is the fly-in
  rev: number; // +1 each time a new tween must start
  resume: RoofResume | null; // pose to return to after an FX lock
}

const DEFAULT_FLY = { yawDeg: 35, tiltDeg: 44, zoom: 0.8, targetSeat: null } as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function nearTeam(anchor: number, seat: number): boolean {
  return seat % 2 === anchor % 2;
}

function poseForMode(mode: CameraState["mode"], anchor: number, focusSeat: number | null, lookSeat: number | null, fly: CameraState["fly"]): RoofPose {
  switch (mode) {
    case "overview":
      return { ...ROOF_PRESETS.overview };
    case "focus":
      return focusSeat == null ? { ...ROOF_PRESETS.home } : seatPose(anchor, focusSeat);
    case "look":
      return lookSeat != null && !nearTeam(anchor, lookSeat) ? { ...ROOF_PRESETS.rival } : { ...ROOF_PRESETS.home };
    case "fly":
      return { yaw: fly.yawDeg, tilt: fly.tiltDeg, zoom: fly.zoom, fx: 0, fy: 80, oy: 64 };
    default:
      return { ...ROOF_PRESETS.home };
  }
}

export function initialRoofCamera(opts: { anchorSeat: number; camera?: Partial<CameraState> }): RoofCameraState {
  const anchor = opts.anchorSeat;
  const c = opts.camera ?? {};
  const fly = { ...DEFAULT_FLY, ...(c.fly ?? {}) };
  const mode = c.mode ?? "home";
  const focusSeat = mode === "focus" ? (c.focusSeat ?? anchor) : null;
  const lookSeat = mode === "look" ? (c.lookSeat ?? (anchor + 1) % 4) : null;
  const pose = poseForMode(mode, anchor, focusSeat, lookSeat, fly);
  const state: RoofCameraState = {
    mode,
    focusSeat,
    lookSeat,
    upright: c.upright ?? false,
    compact: c.compact ?? "auto",
    auto: c.auto ?? true,
    pinned: c.pinned ?? false,
    aiming: c.aiming ?? false,
    fly: mode === "fly" ? { yawDeg: pose.yaw, tiltDeg: pose.tilt, zoom: pose.zoom, targetSeat: fly.targetSeat } : fly,
    lock: null,
    anchor,
    pose,
    from: null,
    dur: 0,
    intro: false,
    rev: 0,
    resume: null,
  };
  if (c.lock) {
    // A preview lock: start already eased home, with the asked pose as the restore point.
    return {
      ...state,
      mode: "home",
      focusSeat: null,
      lookSeat: null,
      pose: { ...ROOF_PRESETS.home },
      lock: c.lock,
      resume: { mode, focusSeat, lookSeat, pose, fly: state.fly },
    };
  }
  return state;
}

const INPUT_ACTIONS: ReadonlySet<CameraAction["type"]> = new Set([
  "home",
  "overview",
  "focus",
  "focusStep",
  "look",
  "toggleFly",
  "flyTo",
  "orbit",
  "zoom",
  "autoFollow",
]);

function moved(state: RoofCameraState, patch: Partial<RoofCameraState>, dur: number): RoofCameraState {
  return { ...state, intro: false, from: null, ...patch, dur, rev: state.rev + 1 };
}

function freeFly(pose: RoofPose, fly: CameraState["fly"]): CameraState["fly"] {
  return { ...fly, yawDeg: pose.yaw, tiltDeg: pose.tilt, zoom: pose.zoom };
}

function goHome(state: RoofCameraState, dur = 950): RoofCameraState {
  return moved(state, { mode: "home", focusSeat: null, lookSeat: null, pose: { ...ROOF_PRESETS.home } }, dur);
}

function focusOn(state: RoofCameraState, seat: number): RoofCameraState {
  return moved(state, { mode: "focus", focusSeat: seat, lookSeat: null, pose: seatPose(state.anchor, seat) }, 950);
}

export function roofReducer(state: RoofCameraState, action: CameraAction): RoofCameraState {
  if (state.lock && INPUT_ACTIONS.has(action.type)) return state;

  switch (action.type) {
    case "home":
      return goHome(state);
    case "overview":
      return moved(state, { mode: "overview", focusSeat: null, lookSeat: null, pose: { ...ROOF_PRESETS.overview } }, 950);
    case "focus":
    case "flyTo":
      return focusOn(state, action.seat);
    case "focusStep": {
      const from = state.focusSeat ?? state.anchor;
      return focusOn(state, (from + action.dir + 4) % 4);
    }
    case "look": {
      if (action.seat == null || nearTeam(state.anchor, action.seat)) return goHome(state);
      return moved(state, { mode: "look", focusSeat: null, lookSeat: action.seat, pose: { ...ROOF_PRESETS.rival } }, 950);
    }
    case "toggleFly": {
      if (state.mode === "fly") return goHome(state);
      return moved(
        state,
        { mode: "fly", focusSeat: null, lookSeat: null, pose: { ...ROOF_PRESETS.home }, from: { ...ROOF_PRESETS.intro }, intro: true },
        2800,
      );
    }
    case "orbit": {
      const pose: RoofPose = {
        ...state.pose,
        yaw: state.pose.yaw + action.dYawDeg,
        tilt: clamp(state.pose.tilt + action.dTiltDeg, ROOF_LIMITS.tiltMin, ROOF_LIMITS.tiltMax),
      };
      const dur = Math.abs(action.dYawDeg) + Math.abs(action.dTiltDeg) >= 15 ? 600 : 0;
      return moved(state, { mode: "fly", focusSeat: null, lookSeat: null, pose, fly: freeFly(pose, state.fly) }, dur);
    }
    case "zoom": {
      const pose: RoofPose = { ...state.pose, zoom: clamp(state.pose.zoom * action.factor, ROOF_LIMITS.zoomMin, ROOF_LIMITS.zoomMax) };
      const dur = Math.abs(Math.log(action.factor)) > 0.1 ? 300 : 0;
      return moved(state, { mode: "fly", focusSeat: null, lookSeat: null, pose, fly: freeFly(pose, state.fly) }, dur);
    }
    case "toggleUpright":
      return { ...state, upright: !state.upright };
    case "toggleCompact":
      return { ...state, compact: state.compact === "auto" ? "on" : state.compact === "on" ? "off" : "auto" };
    case "toggleAuto":
      return { ...state, auto: !state.auto };
    case "pin":
      return { ...state, pinned: action.on };
    case "aiming":
      return { ...state, aiming: action.on };
    case "autoFollow": {
      if (action.seat == null || !state.auto || state.pinned || state.aiming) return state;
      if (state.mode !== "home" && state.mode !== "focus") return state;
      if (state.mode === "focus" && state.focusSeat === action.seat) return state;
      return focusOn(state, action.seat);
    }
    case "lock": {
      const untilMs = action.nowMs + action.ms;
      if (state.lock) {
        return { ...state, lock: { reason: action.reason, untilMs: Math.max(state.lock.untilMs, untilMs) } };
      }
      const resume: RoofResume = {
        mode: state.mode,
        focusSeat: state.focusSeat,
        lookSeat: state.lookSeat,
        pose: state.pose,
        fly: state.fly,
      };
      const eased = goHome(state, ROOF_LOCK_IN_MS);
      return { ...eased, lock: { reason: action.reason, untilMs }, resume };
    }
    case "tick": {
      if (!state.lock || action.nowMs < state.lock.untilMs) return state;
      const r = state.resume;
      const restored: RoofCameraState = r
        ? moved(state, { mode: r.mode, focusSeat: r.focusSeat, lookSeat: r.lookSeat, pose: { ...r.pose }, fly: r.fly }, 900)
        : goHome(state, 900);
      return { ...restored, lock: null, resume: null };
    }
    default:
      return state;
  }
}

/** The reducer as `(state, action) => state` for `useReducer`. */
export const roofCameraReducer = roofReducer;

export type CameraEasing = (t: number) => number;
export const easeCam: CameraEasing = (t) => 1 - Math.pow(1 - t, 4);
export const easeFly: CameraEasing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The pose at tween progress `t` (0..1): the yaw takes the shortest way round. */
export function poseAt(from: RoofPose, to: RoofPose, t: number, ease: CameraEasing = easeCam): RoofPose {
  const e = ease(clamp(t, 0, 1));
  const dyaw = ((((to.yaw - from.yaw) % 360) + 540) % 360) - 180;
  const mix = (a: number, b: number) => a + (b - a) * e;
  return {
    yaw: from.yaw + dyaw * e,
    tilt: mix(from.tilt, to.tilt),
    zoom: mix(from.zoom, to.zoom),
    fx: mix(from.fx, to.fx),
    fy: mix(from.fy, to.fy),
    oy: mix(from.oy, to.oy),
  };
}

/** CSS transform of the 3D world for a pose and the stage fit factor. */
export function roofTransform(pose: RoofPose, fit: number): string {
  const s = pose.zoom * fit;
  return `translate3d(0px, ${(pose.oy * fit).toFixed(2)}px, 0px) scale3d(${s.toFixed(4)}, ${s.toFixed(4)}, ${s.toFixed(4)}) rotateX(${pose.tilt.toFixed(3)}deg) rotateZ(${pose.yaw.toFixed(3)}deg) translate3d(${(-pose.fx).toFixed(2)}px, ${(-pose.fy).toFixed(2)}px, 0px)`;
}

export interface RoofKeyContext {
  anchorSeat: number;
  pinned?: boolean;
}
export interface RoofKeyMods {
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
}

/**
 * Keyboard map. Returns null for keys the roof camera does not use. It is pure: it does not know about open picks,
 * aims or dialogs. The live table binds it through `useRoofKeys` (use-roof-keys.ts), which gates it with `suspended` and `yields`.
 */
export function roofKeyAction(key: string, ctx: RoofKeyContext, mods: RoofKeyMods = {}): CameraAction | null {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === "Tab") return { type: "focusStep", dir: mods.shift ? -1 : 1 };
  if (k >= "1" && k <= "4") return { type: "focus", seat: Number(k) - 1 };
  switch (k) {
    case "h":
      return { type: "home" };
    case "0":
    case "o":
      return { type: "overview" };
    case "i":
    case "f":
      return { type: "toggleFly" };
    case "v":
      return { type: "look", seat: (ctx.anchorSeat + 1) % 4 };
    case "q":
      return { type: "orbit", dYawDeg: -30, dTiltDeg: 0 };
    case "e":
      return { type: "orbit", dYawDeg: 30, dTiltDeg: 0 };
    case "+":
    case "=":
      return { type: "zoom", factor: 1.18 };
    case "-":
    case "_":
      return { type: "zoom", factor: 1 / 1.18 };
    case "s":
      return { type: "toggleUpright" };
    case "a":
      return { type: "toggleAuto" };
    case "k":
      return { type: "pin", on: !ctx.pinned };
    default:
      return null;
  }
}

/** Name of the camera for the dock ("Home", "Corvin · partner", ...). */
export function cameraLabel(state: Pick<RoofCameraState, "mode" | "focusSeat" | "anchor">, nameOf: (seat: number) => string): string {
  switch (state.mode) {
    case "home":
      return "Home";
    case "overview":
      return "Overview";
    case "look":
      return "Rival end";
    case "focus": {
      const seat = state.focusSeat;
      if (seat == null) return "Home";
      if (seat === state.anchor) return `${nameOf(seat)} · you`;
      if (nearTeam(state.anchor, seat)) return `${nameOf(seat)} · partner`;
      return `${nameOf(seat)}'s chair`;
    }
    default:
      return "Free";
  }
}

/** Lock reason to the short text of the "Camera locked" chip. */
export function lockLabel(reason: CameraLockReason): string {
  switch (reason) {
    case "chain":
      return "chain";
    case "battle":
      return "battle";
    case "direct":
      return "direct attack";
    case "destroy":
      return "destroy";
    case "elimination":
      return "team out";
  }
}

/** The part of the stage box the roof world may use (stage px). Rails and HUD blocks are already cut off. */
export interface RoofView {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Width and depth of the roof world that must stay in view at zoom 1: both team strips and the gap between them. */
export const ROOF_WORLD = { width: 1560, depth: 700 } as const;

/** Fit factor of the roof world: the world at zoom 1 fills the free box. 0 for an empty box. */
export function roofFit(view: RoofView): number {
  const w = view.right - view.left;
  const h = view.bottom - view.top;
  if (!(w > 0) || !(h > 0)) return 0;
  return Math.min(w / ROOF_WORLD.width, h / ROOF_WORLD.depth);
}

/** Centre of a HUD box that is pushed back into the view. A box wider than the view is centred on it. */
export function clampCenter(
  at: { x: number; y: number },
  box: { w: number; h: number },
  view: RoofView,
): { x: number; y: number } {
  const axis = (v: number, size: number, lo: number, hi: number) => {
    if (hi - lo <= size) return (lo + hi) / 2;
    return Math.max(lo + size / 2, Math.min(hi - size / 2, v));
  };
  return { x: axis(at.x, box.w, view.left, view.right), y: axis(at.y, box.h, view.top, view.bottom) };
}

/** Progress of a tween, 0 to 1, from the clock. A tween with no length is done at once. */
export function tweenProgress(nowMs: number, startMs: number, durMs: number): number {
  if (!(durMs > 0)) return 1;
  return Math.max(0, Math.min(1, (nowMs - startMs) / durMs));
}
