import type { CameraAction as TableCameraAction, CameraLockReason, CameraState as TableCameraState } from "../table/types";

/** The Rooftop adds one flag to the shared camera state. The duel never moves the camera in: only the viewer zooms in. */
export type CameraState = TableCameraState & { aiming: boolean };
export type CameraAction =
  | TableCameraAction
  /** A prompt needs these field seats on screen: a focus on any other field goes back to the overview. */
  | { type: "needSeats"; seats: readonly number[] }
  | { type: "aiming"; on: boolean };

/**
 * Pure camera of the 2v2 Rooftop. It uses the shared table types (same reducer contract as the
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

export const ROOF_LIMITS = { zoomMin: 0.3, zoomMax: 3.4, tiltMin: 6, tiltMax: 66 } as const;

/**
 * Zoom 1 is the overview: the stage fits all four fields (ROOF_WORLD) into the free box, so every other zoom is relative
 * to that. The overview is the default view and the one every "back" returns to.
 */
export const ROOF_PRESETS: Readonly<Record<"home" | "overview" | "rival" | "intro", RoofPose>> = {
  home: { yaw: 0, tilt: 36, zoom: 1.3, fx: 0, fy: -30, oy: 64 },
  overview: { yaw: 0, tilt: 8, zoom: 1, fx: 0, fy: 0, oy: 0 },
  rival: { yaw: 180, tilt: 36, zoom: 1.3, fx: 0, fy: 30, oy: 64 },
  intro: { yaw: -150, tilt: 74, zoom: 0.25, fx: 0, fy: -500, oy: -150 },
};

/** How long a zoom into a field, a step to another field and the way back to the overview take: one quick ease-out. */
export const ROOF_ZOOM_MS = 360;
/** How long the camera takes to ease to the play view when an FX lock starts. The FX speed does not scale it. */
export const ROOF_LOCK_IN_MS = 700;
/**
 * Field plane size (the SeatField box at z = 112 px) and strip offset in world units. Fields sit 61 units apart.
 * The two strips are 160 units apart (offsetY 80 each side of the helipad): 1A stands straight across from 2A and 1B
 * across from 2B, in the same columns, with room between each facing pair for one shared Extra Monster row.
 */
export const ROOF_FIELD = { width: 653, height: 380, offsetY: 80, centerX: 357 } as const;

export interface RoofSlot {
  seat: number;
  near: boolean; // on the viewer's team strip
  x: number; // field centre in world units
  y: number;
}

/** World slot of every seat for an anchor seat: anchor near left, partner near right, each rival far across from the teammate it faces. */
export function roofSlots(anchorSeat: number): Record<number, RoofSlot> {
  const { centerX, offsetY, height } = ROOF_FIELD;
  const nearY = offsetY + height / 2;
  const farY = -offsetY - height / 2;
  const a = ((anchorSeat % 4) + 4) % 4;
  const make = (seat: number, near: boolean, x: number): RoofSlot => ({ seat, near, x, y: near ? nearY : farY });
  // Seats run 1A, 2A, 1B, 2B, so the facing seat of any seat is seat ^ 1 (1A-2A, 1B-2B) for every viewer.
  const partner = (a + 2) % 4;
  return {
    [a]: make(a, true, -centerX),
    [partner]: make(partner, true, centerX),
    [a ^ 1]: make(a ^ 1, false, -centerX),
    [partner ^ 1]: make(partner ^ 1, false, centerX),
  };
}

/** Free width of the middle band between the two seat labels, in world units (the gap row between the strips). */
const GAP_FREE_WIDTH = 900;
/**
 * The same with the shared Extra Monster Zones drawn in the gap: the two inner cells (column 4 of the left pair, column 2 of
 * the right pair) stand 233 units either side of the helipad, 466 apart. A cell is about 61 units wide, so the free width
 * between the inner edges is about 405. The scale this is multiplied by (fit x zoom) reads about 13% under what the tilted
 * gap really measures (326px between the inner cell edges at 1920, where 405 x 0.8 = 324), so the hub keeps a margin.
 */
const GAP_FREE_WIDTH_SHARED = 405;

/** Width of the smallest phase hub strip, in px. */
export const XS_HUB_MIN = 170;

export type PhaseHubSize = "lg" | "sm" | "row" | "xs";

/**
 * The phase hub sizes that fit the width of the gap row, biggest first: "lg" is the full strip (about 390px wide), "sm"
 * the short strip with its caption and "row" the short strip alone and "xs" the strip with smaller chips, for the narrow gap of a small screen. The stage takes the first one whose real height fits
 * the gap between the strips; when none does, the hub stays hidden and the bottom bar keeps the turn buttons.
 */
export function phaseHubSizes(freePx: number): PhaseHubSize[] {
  const sizes: PhaseHubSize[] = [];
  if (freePx >= 410) sizes.push("lg");
  if (freePx >= 215) sizes.push("sm", "row");
  if (freePx >= XS_HUB_MIN) sizes.push("xs");
  return sizes;
}

/** Gap height and free width, in screen px, between the strips for a pose and the stage fit factor. */
export function roofGap(pose: RoofPose, fit: number, sharedExtra = false): { gapPx: number; freePx: number } {
  const scale = fit * pose.zoom;
  return {
    gapPx: 2 * ROOF_FIELD.offsetY * scale * Math.cos((pose.tilt * Math.PI) / 180),
    freePx: (sharedExtra ? GAP_FREE_WIDTH_SHARED : GAP_FREE_WIDTH) * scale,
  };
}

/** Close-up of one field: the whole field, with its shared Extra Monster Zones, fits the free box, whatever the screen shape. */
const SEAT_ZOOM = 2.05;
const SEAT_TILT = 22;

/**
 * Close pose on one field before the screen is known: the biggest close-up a roomy screen gives, aimed at the field.
 * The camera stays on the viewer's side for every field: a far field is drawn to read upright from there, so a zoom is
 * easier to read than the rival's end (which turns its text upside down). The stage swaps it for `fitSeatPose` once it
 * has measured the free box.
 */
export function seatPose(anchorSeat: number, seat: number): RoofPose {
  const slot = roofSlots(anchorSeat)[seat];
  if (!slot) return { ...ROOF_PRESETS.home };
  return { yaw: 0, tilt: SEAT_TILT, zoom: SEAT_ZOOM, fx: slot.x, fy: slot.y, oy: 0 };
}

/** Height of the field plane above the roof, in world units: the z of every field hold (tag-stage) and of the shared band. */
export const ROOF_FIELD_Z = 2;
/** The world's perspective distance at fit 1 (px). The stage scales it with the fit. */
export const ROOF_PERSP = 1400;
/** How far the close-up reaches into the gap (and a little past its middle) for the shared Extra Monster Zones, in world units. */
const FIT_EMZ_REACH = 125;
/** Extra world units beside the field that stay in the close-up (the pile on the left, the Field Zone label on the right). */
const FIT_SIDE = 14;
/** Air between the field and the edge of the free box, in px. */
const FIT_MARGIN = 10;
const FIT_ZOOM_MAX = 2.6;

/** Screen position of a world point (px from the centre of the free box) for a pose, the fit factor and the perspective. */
export function projectRoof(pose: RoofPose, fit: number, point: { x: number; y: number; z: number }): { x: number; y: number } {
  const s = pose.zoom * fit;
  const yaw = (pose.yaw * Math.PI) / 180;
  const tilt = (pose.tilt * Math.PI) / 180;
  const dx = point.x - pose.fx;
  const dy = point.y - pose.fy;
  const rx = dx * Math.cos(yaw) - dy * Math.sin(yaw);
  const ry = dx * Math.sin(yaw) + dy * Math.cos(yaw);
  const y1 = ry * Math.cos(tilt) - point.z * Math.sin(tilt);
  const z1 = ry * Math.sin(tilt) + point.z * Math.cos(tilt);
  const d = ROOF_PERSP * fit;
  const k = d / Math.max(d - z1 * s, 1);
  return { x: rx * s * k, y: (y1 * s + pose.oy * fit) * k };
}

/**
 * The four corners (world units) the close-up keeps in view for one field: the monster and Spell/Trap rows on the
 * outer side, and the shared Extra Monster row on the inner side (`FIT_EMZ_REACH` into the gap, a little past its
 * middle). The inner edge is `sign * (offsetY - FIT_EMZ_REACH)` = -sign * 45, where sign is the side of the seat.
 */
export function roofFitCorners(anchorSeat: number, seat: number): { corners: { x: number; y: number; z: number }[]; inner: number; outer: number } {
  const slot = roofSlots(anchorSeat)[seat];
  if (!slot) return { corners: [], inner: 0, outer: 0 };
  const { width, height, offsetY } = ROOF_FIELD;
  const sign = Math.sign(slot.y) || 1;
  const inner = sign * (offsetY - FIT_EMZ_REACH);
  const outer = slot.y + (sign * height) / 2;
  const x0 = slot.x - width / 2 - FIT_SIDE;
  const x1 = slot.x + width / 2 + FIT_SIDE;
  const corners = [
    { x: x0, y: inner, z: ROOF_FIELD_Z },
    { x: x1, y: inner, z: ROOF_FIELD_Z },
    { x: x0, y: outer, z: ROOF_FIELD_Z },
    { x: x1, y: outer, z: ROOF_FIELD_Z },
  ];
  return { corners, inner, outer };
}

/**
 * Close pose on one field that shows the WHOLE field (the Extra Monster row between the strips, the monster and the
 * Spell/Trap rows, the piles) inside the free box: the biggest zoom whose projected field fits both the width and the
 * height with a small margin, centred in the box. The box already ends above the hands, so nothing here sits under them.
 */
export function fitSeatPose(anchorSeat: number, seat: number, fit: number, view: RoofView): RoofPose {
  const base = seatPose(anchorSeat, seat);
  const slot = roofSlots(anchorSeat)[seat];
  if (!slot || !(fit > 0)) return base;
  const { corners, inner, outer } = roofFitCorners(anchorSeat, seat);
  const availW = view.right - view.left - 2 * FIT_MARGIN;
  const availH = view.bottom - view.top - 2 * FIT_MARGIN;
  if (!(availW > 0) || !(availH > 0)) return base;
  const pose: RoofPose = { ...base, fy: (inner + outer) / 2 };
  const extent = (zoom: number) => {
    const shots = corners.map((corner) => projectRoof({ ...pose, zoom, oy: 0 }, fit, corner));
    const ys = shots.map((shot) => shot.y);
    const xs = shots.map((shot) => shot.x);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  let lo: number = ROOF_LIMITS.zoomMin;
  let hi: number = FIT_ZOOM_MAX;
  if (extent(hi).w <= availW && extent(hi).h <= availH) lo = hi;
  else {
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + hi) / 2;
      const e = extent(mid);
      if (e.w <= availW && e.h <= availH) lo = mid;
      else hi = mid;
    }
  }
  pose.zoom = lo;
  // Centre it in the box (the box centre is the origin of the projection, so 0 is the middle): slide the world on the screen.
  const e = extent(lo);
  const want = 0;
  pose.oy = (want - (e.minY + e.maxY) / 2) / fit;
  for (let i = 0; i < 3; i += 1) {
    const shots = corners.map((corner) => projectRoof(pose, fit, corner).y);
    pose.oy += (want - (Math.min(...shots) + Math.max(...shots)) / 2) / fit;
  }
  return pose;
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

const DEFAULT_FLY = { yawDeg: 35, tiltDeg: 44, zoom: 1.2, targetSeat: null } as const;

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
      return { yaw: fly.yawDeg, tilt: fly.tiltDeg, zoom: fly.zoom, fx: 0, fy: -30, oy: 64 };
    default:
      return { ...ROOF_PRESETS.home };
  }
}

export function initialRoofCamera(opts: { anchorSeat: number; camera?: Partial<CameraState> }): RoofCameraState {
  const anchor = opts.anchorSeat;
  const c = opts.camera ?? {};
  const fly = { ...DEFAULT_FLY, ...(c.fly ?? {}) };
  const mode = c.mode ?? "overview";
  const focusSeat = mode === "focus" ? (c.focusSeat ?? anchor) : null;
  const lookSeat = mode === "look" ? (c.lookSeat ?? (anchor + 1) % 4) : null;
  const pose = poseForMode(mode, anchor, focusSeat, lookSeat, fly);
  const state: RoofCameraState = {
    mode,
    focusSeat,
    lookSeat,
    upright: c.upright ?? false,
    compact: c.compact ?? "auto",
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
    // A preview lock: start already eased to the overview (as an FX lock does), with the asked pose as the restore point.
    return {
      ...state,
      mode: "overview",
      focusSeat: null,
      lookSeat: null,
      pose: { ...ROOF_PRESETS.overview },
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

function goOverview(state: RoofCameraState, dur = ROOF_ZOOM_MS): RoofCameraState {
  return moved(state, { mode: "overview", focusSeat: null, lookSeat: null, pose: { ...ROOF_PRESETS.overview } }, dur);
}

/** The saved view after a lock, turned into the overview (the lock itself has already eased the camera there). */
function overviewResume(r: RoofResume): RoofResume {
  return { mode: "overview", focusSeat: null, lookSeat: null, pose: { ...ROOF_PRESETS.overview }, fly: r.fly };
}

function focusOn(state: RoofCameraState, seat: number): RoofCameraState {
  if (state.mode === "focus" && state.focusSeat === seat) return state;
  return moved(state, { mode: "focus", focusSeat: seat, lookSeat: null, pose: seatPose(state.anchor, seat) }, ROOF_ZOOM_MS);
}

export function roofReducer(state: RoofCameraState, action: CameraAction): RoofCameraState {
  if (state.lock && INPUT_ACTIONS.has(action.type)) return state;

  switch (action.type) {
    case "home":
      return goHome(state);
    case "overview":
      return goOverview(state);
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
    case "aiming": {
      // An aim needs the rival field in view: a close-up on one field goes back to the overview first.
      if (action.on && (state.mode === "focus" || state.mode === "look") && !state.lock) return { ...goOverview(state), aiming: true };
      // Under an FX lock the camera is already on the overview: make the saved close-up the overview too.
      if (action.on && state.lock && state.resume && (state.resume.mode === "focus" || state.resume.mode === "look")) {
        return { ...state, aiming: true, resume: overviewResume(state.resume) };
      }
      return { ...state, aiming: action.on };
    }
    case "needSeats": {
      if (state.lock) {
        // Same under a lock: the close-up that comes back after the lock must not hide the field a prompt needs.
        const r = state.resume;
        if (r?.mode !== "focus" || !action.seats.some((seat) => seat !== r.focusSeat)) return state;
        return { ...state, resume: overviewResume(r) };
      }
      if (state.mode !== "focus") return state;
      return action.seats.some((seat) => seat !== state.focusSeat) ? goOverview(state) : state;
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
      const eased = goOverview(state, ROOF_LOCK_IN_MS);
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
  /** The camera mode now: Esc goes back to the overview from any other. */
  mode?: CameraState["mode"];
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
  if (k === "Escape") return ctx.mode != null && ctx.mode !== "overview" ? { type: "overview" } : null;
  // Tab is never a camera key: it walks the page (the focus buttons are keyboard stops), and Enter or Space on one moves the camera.
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

/**
 * Width and depth of the roof world that must stay in view at zoom 1 (the overview): the four fields with their
 * name labels and the gap between the strips, plus a little air. The depth leaves room for the 8 degree tilt.
 */
export const ROOF_WORLD = { width: 1440, depth: 970 } as const;

/** Fit factor of the roof world: the four fields at zoom 1 fill the free box. 0 for an empty box. */
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
