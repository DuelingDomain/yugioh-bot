import type { DuelEngineView } from "@yugidraft/shared/duels";
import { engineFormat, placementOrder, seatRelation } from "../multi-seat";
import { tagSeatCode } from "../table-format";
import type { Arrangement, CameraState, Compass, FlyPose, PoseSlot, SeatPose, SeatSlot, SeatTone, TableFormat, TableLayout } from "./types";

/**
 * Seat geometry of the table, pure. The stage is 1100 by 860 stage px and is scaled to fit the board box.
 * The 3-way table has nine named places (`PoseSlot`): home, the two rival places, focus and its two docks, and
 * the three overview places. The 4-way table has eleven: it adds the far (north) place at home and in overview.
 * Look, focus, overview and fly pick the place of each seat from them. The Tag table draws its home pose in
 * every camera mode until its own step adds more.
 *
 * On a 3-way table the places follow the seats still in the duel (`aliveLayout`): 2 alive are a face to face pair
 * (`duo`: one near, one far, as in a 1v1). A 4-way table keeps its places.
 */

export const STAGE = { width: 1100, height: 860 } as const;
/** Centre of the plaza, in stage px. Turn ring, attack lines and tethers measure from here. */
export const ARENA_CENTER = { x: 550, y: 410 } as const;
/** Card unit (px) of a seat box at scale 1. A seat field is sized from this through `--sf-z`. */
export const SEAT_Z = 112;

const TONES: readonly SeatTone[] = ["violet", "ice", "verdant", "rose"];
/** Tag: you Violet, partner Ice, the rival who plays right after you Rose, the one right before you Verdant. */
const TAG_TONES: readonly SeatTone[] = ["violet", "ice", "rose", "verdant"];

interface HomeSlot {
  x: number;
  y: number;
  rotateDeg: number;
  scale: number;
  tiltDeg: number;
}

/** Home poses of a 3-way table by place: you, then the seat after you (left), then the one after that (right). */
const FFA3_HOME: readonly HomeSlot[] = [
  { x: 550, y: 582, rotateDeg: 0, scale: 1, tiltDeg: 0 },
  { x: 298, y: 222, rotateDeg: 158, scale: 0.66, tiltDeg: 12 },
  { x: 802, y: 222, rotateDeg: 202, scale: 0.66, tiltDeg: 12 },
];

/** Home poses of a 4-way table by place: you S, then the seat after you W, the one across N, the last E. */
const FFA4_HOME: readonly HomeSlot[] = [
  { x: 550, y: 610, rotateDeg: 0, scale: 1, tiltDeg: 0 },
  { x: 148, y: 223, rotateDeg: 90, scale: 0.6, tiltDeg: 0 },
  { x: 550, y: 150, rotateDeg: 180, scale: 0.6, tiltDeg: 16 },
  { x: 952, y: 223, rotateDeg: 270, scale: 0.6, tiltDeg: 0 },
];

/** Placeholder 2 by 2 for Tag. The real Tag geometry is `tag/roof-camera.ts`. */
const TAG_HOME: readonly HomeSlot[] = [
  { x: 300, y: 600, rotateDeg: 0, scale: 0.8, tiltDeg: 0 },
  { x: 800, y: 600, rotateDeg: 0, scale: 0.8, tiltDeg: 0 },
  { x: 300, y: 220, rotateDeg: 180, scale: 0.66, tiltDeg: 10 },
  { x: 800, y: 220, rotateDeg: 180, scale: 0.66, tiltDeg: 10 },
];

/** The named places of a 3-way table. `vN` and `oN` do not exist there (they fall back to the far rival place). */
const FFA3_SLOTS: Readonly<Record<PoseSlot, HomeSlot>> = {
  home: FFA3_HOME[0],
  vL: FFA3_HOME[1],
  vN: FFA3_HOME[1],
  vR: FFA3_HOME[2],
  focus: { x: 550, y: 206, rotateDeg: 180, scale: 0.9, tiltDeg: 9 },
  dockL: { x: 110, y: 272, rotateDeg: 90, scale: 0.46, tiltDeg: 0 },
  dockR: { x: 990, y: 272, rotateDeg: -90, scale: 0.46, tiltDeg: 0 },
  oHome: { x: 550, y: 652, rotateDeg: 0, scale: 0.58, tiltDeg: 0 },
  oL: { x: 327, y: 301, rotateDeg: 120, scale: 0.58, tiltDeg: 0 },
  oN: { x: 327, y: 301, rotateDeg: 120, scale: 0.58, tiltDeg: 0 },
  oR: { x: 773, y: 301, rotateDeg: 240, scale: 0.58, tiltDeg: 0 },
};
/** The eleven named places of a 4-way table (the prototype's `4ffa-b` geometry at a 860 px stage). */
const FFA4_SLOTS: Readonly<Record<PoseSlot, HomeSlot>> = {
  home: FFA4_HOME[0],
  vL: FFA4_HOME[1],
  vN: FFA4_HOME[2],
  vR: FFA4_HOME[3],
  focus: { x: 550, y: 228, rotateDeg: 180, scale: 0.92, tiltDeg: 9 },
  dockL: { x: 124, y: 289, rotateDeg: 90, scale: 0.5, tiltDeg: 0 },
  dockR: { x: 976, y: 289, rotateDeg: -90, scale: 0.5, tiltDeg: 0 },
  oHome: { x: 550, y: 660, rotateDeg: 0, scale: 0.52, tiltDeg: 0 },
  oL: { x: 129, y: 395, rotateDeg: 90, scale: 0.52, tiltDeg: 0 },
  oN: { x: 550, y: 131, rotateDeg: 180, scale: 0.52, tiltDeg: 0 },
  oR: { x: 971, y: 395, rotateDeg: 270, scale: 0.52, tiltDeg: 0 },
};
const SLOT_ZINDEX: Readonly<Record<PoseSlot, number>> = { home: 5, vL: 3, vN: 3, vR: 3, focus: 4, dockL: 2, dockR: 2, oHome: 3, oL: 3, oN: 3, oR: 3 };
/** Angle of a place on the turn ring, in screen degrees (0 = right, 90 = down). */
const FFA3_RING_ANGLE: Readonly<Record<PoseSlot, number>> = { home: 90, oHome: 90, vL: 210, oL: 210, vN: 210, oN: 210, dockL: 180, vR: 330, oR: 330, dockR: 0, focus: 270 };
const FFA4_RING_ANGLE: Readonly<Record<PoseSlot, number>> = { home: 90, oHome: 90, vL: 180, oL: 180, dockL: 180, vN: 270, oN: 270, focus: 270, vR: 0, oR: 0, dockR: 0 };

/**
 * How the seats of a layout are placed. A layout made by `tableLayout` has no `arrangement`: it follows its format.
 * `aliveLayout` sets one when seats are out. Tag has none.
 */
export function arrangementOf(layout: Pick<TableLayout, "format" | "arrangement">): Arrangement | null {
  if (layout.arrangement) return layout.arrangement;
  return layout.format === "ffa4" ? "ffa4" : layout.format === "ffa3" ? "ffa3" : null;
}

function slotTable(layout: Pick<TableLayout, "format" | "arrangement">): Readonly<Record<PoseSlot, HomeSlot>> {
  return arrangementOf(layout) === "ffa4" ? FFA4_SLOTS : FFA3_SLOTS;
}

/**
 * The layout of the seats that are still in the duel. Only a 3-way table regroups: when one seat leaves, the two that
 * stay face each other (`duo`) and keep their order and tones. A 4-way table keeps its places for the whole duel (the
 * place of a seat that left stays empty), and Tag is never respaced: both give the same layout back.
 */
export function aliveLayout(layout: TableLayout, out: ReadonlySet<number> | readonly number[]): TableLayout {
  if (layout.format !== "ffa3") return layout;
  const gone = out instanceof Set ? out : new Set(out);
  const slots = layout.slots.filter((slot) => !gone.has(slot.seat));
  if (slots.length === layout.slots.length || slots.length >= 3) return layout;
  return { ...layout, slots, arrangement: "duo" };
}

type CompassSlot = { compass: Compass; baseAngleDeg: number };
const FFA3_COMPASS: readonly CompassSlot[] = [{ compass: "S", baseAngleDeg: 0 }, { compass: "W", baseAngleDeg: 120 }, { compass: "E", baseAngleDeg: 240 }];
const FFA4_COMPASS: readonly CompassSlot[] = [{ compass: "S", baseAngleDeg: 0 }, { compass: "W", baseAngleDeg: 90 }, { compass: "N", baseAngleDeg: 180 }, { compass: "E", baseAngleDeg: 270 }];

function compassAndAngle(format: TableFormat, place: number): CompassSlot {
  if (format === "ffa3") return FFA3_COMPASS[Math.min(place, 2)];
  if (format === "ffa4") return FFA4_COMPASS[Math.min(place, 3)];
  // Tag: two teams, the near side (viewer and partner) at S and the far side at N.
  return place < 2 ? { compass: "S", baseAngleDeg: 0 } : { compass: "N", baseAngleDeg: 180 };
}

/**
 * Seats of a table in drawing order: the viewer (or seat 0 for a spectator) first, then the others in
 * `placementOrder`. Colours are relative to the viewer, so the viewer is always Violet.
 */
export function tableLayout(format: TableFormat, engine: Pick<DuelEngineView, "format" | "seats">, viewerSeat: number | null): TableLayout {
  const order = placementOrder({ format: engineFormat({ format, seats: engine.seats }), seats: engine.seats }, viewerSeat);
  const seatNumbers = engine.seats.map((view) => view.seat).sort((a, b) => a - b);
  const anchorSeat = viewerSeat ?? order[0] ?? 0;
  // A viewer is always first. For a spectator, placementOrder already starts at the anchor seat.
  const seats = viewerSeat == null ? order : [viewerSeat, ...order];
  const slots: SeatSlot[] = seats.map((seat, place) => {
    const { compass, baseAngleDeg } = compassAndAngle(format, place);
    return {
      seat,
      relation: seatRelation(format, viewerSeat, seat),
      tone: (format === "tag" ? TAG_TONES : TONES)[Math.min(place, 3)],
      compass,
      baseAngleDeg,
      team: format === "tag" ? seat % 2 : null,
      code: tagSeatCode(format, seat),
      turnOrder: seatNumbers.indexOf(seat),
    };
  });
  return { format, viewerSeat, anchorSeat, slots, stage: { width: 1100, height: 860 } };
}

function homeTable(format: TableFormat): readonly HomeSlot[] {
  return format === "ffa3" ? FFA3_HOME : format === "ffa4" ? FFA4_HOME : TAG_HOME;
}

type CameraView = Pick<CameraState, "mode"> & Partial<Pick<CameraState, "focusSeat" | "lookSeat" | "compact">>;

/**
 * The place of every seat of a 3 or 4 seat table, by drawing order (viewer first). Null for Tag, which has no
 * named places yet. Home: you at the bottom, the next seat after you up-left (3-way) or west (4-way), and so on
 * round the table. Focus: the focused rival goes across, the others dock at the sides (in seat order). Look: the
 * seat you look from takes the home place and the table turns with it. Overview and fly: equal places on the
 * compass (120 degrees apart for 3 seats, 90 for 4).
 */
export function slotPlan(layout: TableLayout, camera: CameraView): PoseSlot[] | null {
  const count = layout.slots.length;
  const arrangement = arrangementOf(layout);
  if (arrangement === "duo") {
    if (count < 1 || count > 2) return null;
    // Face to face whatever the camera does. A viewer who is out watches: the first living seat goes far, the next near.
    const spectating = layout.viewerSeat != null && layout.slots[0]?.seat !== layout.viewerSeat;
    return count === 1 ? ["home"] : spectating ? ["focus", "home"] : ["home", "focus"];
  }
  if (!((arrangement === "ffa3" && count === 3) || (arrangement === "ffa4" && count === 4))) return null;
  const four = count === 4;
  const home: PoseSlot[] = four ? ["home", "vL", "vN", "vR"] : ["home", "vL", "vR"];
  const seatAt = (seat: number | null | undefined) => layout.slots.findIndex((slot) => slot.seat === seat);
  if (camera.mode === "overview" || camera.mode === "fly") return four ? ["oHome", "oL", "oN", "oR"] : ["oHome", "oL", "oR"];
  if (camera.mode === "focus") {
    const place = seatAt(camera.focusSeat);
    if (place > 0) {
      const plan: PoseSlot[] = ["home"];
      const docks: PoseSlot[] = ["dockL", "dockR"];
      // 3-way: the other rival docks on its own side. 4-way: the two others take left then right, in seat order.
      for (let index = 1; index < count; index += 1) {
        plan.push(index === place ? "focus" : four ? (docks.shift() ?? "dockR") : index === 1 ? "dockL" : "dockR");
      }
      return plan;
    }
  }
  if (camera.mode === "look") {
    const place = seatAt(camera.lookSeat);
    if (place > 0) {
      const plan: PoseSlot[] = home.map(() => "home");
      // The seat that looks takes the home place; the seats after it, in order, take the next places round the table.
      for (let step = 1; step < count; step += 1) plan[(place + step) % count] = home[step];
      return plan;
    }
  }
  return home;
}

/** Card height (px on screen) under which a rival field turns into compact chips: 44, or 40 in a window under 1440 wide. */
export function compactThreshold(screenWidth: number): number {
  return screenWidth < 1440 ? 40 : 44;
}

/**
 * True when a field is drawn as compact chips (4-way table). Your own place never is. `auto` goes compact when
 * a rival card is under the threshold on screen (`112 * scale * stageScale`), `on` for every rival place, `off`
 * for none. The pose needs a `scale` and a named `slot`.
 */
export function compactFor(
  pose: Pick<SeatPose, "scale" | "slot">,
  stageScale: number,
  screenWidth: number,
  mode: "auto" | "on" | "off" = "auto",
): boolean {
  if (pose.slot === "home" || pose.slot === "oHome" || mode === "off") return false;
  if (mode === "on") return true;
  return SEAT_Z * pose.scale * stageScale < compactThreshold(screenWidth);
}

/**
 * Where every seat stands for a camera state. Upright only turns text, so it never moves a field. A lock is
 * not read here: the caller passes the effective camera (see `effectiveCamera`).
 */
export function seatPoses(
  layout: TableLayout,
  camera: CameraView,
  viewport?: { width: number; height: number; screenWidth?: number },
): Map<number, SeatPose> {
  const plan = slotPlan(layout, camera);
  const home = homeTable(layout.format);
  const table = slotTable(layout);
  const fit = viewport ? stageFit(viewport) : 0;
  const screenWidth = viewport?.screenWidth ?? viewport?.width ?? 0;
  const poses = new Map<number, SeatPose>();
  layout.slots.forEach((slot, place) => {
    const name = plan?.[place];
    const at = name ? table[name] : home[Math.min(place, home.length - 1)];
    // Compact chips are a 4-way table feature: in the fly-in view the camera zooms in, so fields stay whole.
    const compact = arrangementOf(layout) === "ffa4" && camera.mode !== "fly" && name != null && fit > 0
      ? compactFor({ scale: at.scale, slot: name }, fit, screenWidth, camera.compact ?? "auto")
      : false;
    poses.set(slot.seat, {
      seat: slot.seat,
      x: at.x,
      y: at.y,
      scale: at.scale,
      rotateDeg: at.rotateDeg,
      tiltDeg: at.tiltDeg,
      slot: name,
      z: SEAT_Z,
      docked: name === "dockL" || name === "dockR",
      compact,
      hidden: false,
    });
  });
  return poses;
}

/** Stack order of a place: the nearer and larger a field is drawn, the higher it sits. */
export function slotZIndex(slot: PoseSlot | undefined, scale: number): number {
  return slot ? SLOT_ZINDEX[slot] : Math.max(1, Math.round(scale * 5));
}

/** Scale that fits the whole stage into a box. 0 for an empty box. */
export function stageFit(box: { width: number; height: number }): number {
  if (!(box.width > 0) || !(box.height > 0)) return 0;
  return Math.min(box.width / STAGE.width, box.height / STAGE.height);
}

/** Unit vector from a field toward the table centre (the direction its cards face), in stage axes. */
export function seatNormal(pose: Pick<SeatPose, "rotateDeg">): { x: number; y: number } {
  const radians = (pose.rotateDeg * Math.PI) / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

export interface HoloAnchor {
  /** Top-left of the panel in stage px. */
  x: number;
  y: number;
  /** True for the viewer's own panel (no projector beam, larger). */
  me: boolean;
  /** Where the projector beam points: down from a top panel, up from a bottom one, none beside a field. */
  beam: "down" | "up" | "none";
}

/** Holo anchor of every named place of a 3-way table. Focus picks a side by the focused seat's place. */
function ffa3Anchor(slot: PoseSlot, focusPlace: number): Omit<HoloAnchor, "me"> {
  switch (slot) {
    case "home": return { x: 882, y: 686, beam: "none" };
    case "vL": return { x: 8, y: 8, beam: "down" };
    case "vN": return { x: 896, y: 8, beam: "down" };
    case "vR": return { x: 896, y: 8, beam: "down" };
    case "focus": return focusPlace === 1 ? { x: 8, y: 10, beam: "down" } : { x: 896, y: 10, beam: "down" };
    case "dockL": return { x: 8, y: 8, beam: "none" };
    case "dockR": return { x: 896, y: 8, beam: "none" };
    case "oHome": return { x: 764, y: 690, beam: "none" };
    case "oL": return { x: 14, y: 548, beam: "up" };
    case "oN": return { x: 14, y: 548, beam: "up" };
    case "oR": return { x: 896, y: 548, beam: "up" };
  }
}

/** Holo anchor of every named place of a 4-way table (the prototype's `4ffa-b` panels). */
function ffa4Anchor(slot: PoseSlot): Omit<HoloAnchor, "me"> {
  switch (slot) {
    case "home": return { x: 882, y: 686, beam: "none" };
    case "vL": return { x: 8, y: 431, beam: "up" };
    case "vN": return { x: 260, y: 290, beam: "none" };
    case "vR": return { x: 896, y: 431, beam: "up" };
    case "focus": return { x: 8, y: 8, beam: "none" };
    case "dockL": return { x: 8, y: 464, beam: "up" };
    case "dockR": return { x: 896, y: 464, beam: "up" };
    case "oHome": return { x: 882, y: 740, beam: "none" };
    case "oL": return { x: 242, y: 340, beam: "none" };
    case "oN": return { x: 734, y: 20, beam: "none" };
    case "oR": return { x: 662, y: 340, beam: "none" };
  }
}

/** Holo anchor of the two places of a face to face pair: the near panel bottom right, the far one top left (clear of the far hand). */
function duoAnchor(slot: PoseSlot): Omit<HoloAnchor, "me"> {
  return slot === "home" ? { x: 882, y: 686, beam: "none" } : { x: 8, y: 8, beam: "down" };
}

/**
 * Anchor of the holo LP panel of one seat. Home: bottom right for you, top corners for rivals. With a camera
 * the panel follows its seat to the corner of the place that seat now stands at.
 */
export function holoAnchor(layout: TableLayout, seat: number, camera?: CameraView): HoloAnchor {
  const place = layout.slots.findIndex((slot) => slot.seat === seat);
  const count = layout.slots.length;
  const plan = camera ? slotPlan(layout, camera) : null;
  if (plan && place >= 0) {
    const focusPlace = layout.slots.findIndex((slot) => slot.seat === camera?.focusSeat);
    const arrangement = arrangementOf(layout);
    const at = arrangement === "duo" ? duoAnchor(plan[place]) : (arrangement === "ffa4" ? ffa4Anchor(plan[place]) : ffa3Anchor(plan[place], focusPlace));
    const mine = place === 0 && layout.viewerSeat === seat && camera?.mode !== "look";
    return { ...at, me: mine };
  }
  if (place <= 0 && layout.viewerSeat === seat) return { x: 882, y: 686, me: true, beam: "none" };
  if (place <= 0) return { x: 882, y: 686, me: layout.viewerSeat != null, beam: "none" };
  if (count <= 3) return place === 1 ? { x: 8, y: 8, me: false, beam: "down" } : { x: 896, y: 8, me: false, beam: "down" };
  // 4 seats: left, top and right edges.
  const edge = [{ x: 8, y: 372 }, { x: 448, y: 8 }, { x: 896, y: 372 }][Math.min(place, 3) - 1];
  return { ...edge, me: false, beam: "down" };
}

/** Where the turn ring stands in a camera mode: it keeps clear of every field. */
export function ringPose(layout: TableLayout, camera: CameraView): { x: number; y: number; scale: number } {
  if (arrangementOf(layout) === "duo") return camera.mode === "fly" ? { x: 550, y: 430, scale: 1 } : { x: 550, y: 322, scale: 1 };
  if (arrangementOf(layout) === "ffa4") {
    if (camera.mode === "fly") return { x: 550, y: 410, scale: 1 };
    if (camera.mode === "overview") return { x: 550, y: 395, scale: 0.9 };
    // Between the far field and yours at home; in the top right corner while one rival is across.
    if (camera.mode === "focus") return { x: 1036, y: 60, scale: 0.72 };
    return { x: 550, y: 342, scale: 1 };
  }
  if (camera.mode === "fly") return { x: 550, y: 430, scale: 1 };
  if (camera.mode === "overview") return { x: 550, y: 98, scale: 0.9 };
  if (camera.mode === "focus") {
    // Beside the docked rival's far side, so it never covers that field.
    const place = layout.slots.findIndex((slot) => slot.seat === camera.focusSeat);
    return { x: place === 2 ? 950 : 150, y: 404, scale: 0.62 };
  }
  return { x: 550, y: 322, scale: 1 };
}

/** Screen angle of every seat on the turn ring (degrees, 0 = right, 90 = down), by seat number. */
export function ringAngles(layout: TableLayout, camera: CameraView): Map<number, number> {
  const plan = slotPlan(layout, camera);
  const angles = new Map<number, number>();
  const poses = plan ? null : seatPoses(layout, camera);
  layout.slots.forEach((slot, place) => {
    if (plan) {
      angles.set(slot.seat, (arrangementOf(layout) === "ffa4" ? FFA4_RING_ANGLE : FFA3_RING_ANGLE)[plan[place]]);
      return;
    }
    const pose = poses?.get(slot.seat);
    const deg = pose ? (Math.atan2(pose.y - ARENA_CENTER.y, pose.x - ARENA_CENTER.x) * 180) / Math.PI : 90;
    angles.set(slot.seat, ((deg % 360) + 360) % 360);
  });
  return angles;
}

/** World camera of the fly-in view: the plaza turned, tilted, zoomed and moved so a seat fills the view. */
export interface FlyWorld {
  yawDeg: number;
  tiltDeg: number;
  zoom: number;
  /** Stage px offset of the point the camera looks at, from the arena centre. */
  fx: number;
  fy: number;
  /** Vertical shift of the whole world in stage px. */
  oy: number;
}

/** The world pose of a fly pose. A seat target looks at that seat's overview place. */
export function flyWorld(layout: TableLayout, fly: FlyPose): FlyWorld {
  const plan = slotPlan(layout, { mode: "fly" });
  const place = fly.targetSeat == null ? -1 : layout.slots.findIndex((slot) => slot.seat === fly.targetSeat);
  if (place < 0 || !plan) return { yawDeg: fly.yawDeg, tiltDeg: fly.tiltDeg, zoom: fly.zoom, fx: 0, fy: 6, oy: -6 };
  const at = slotTable(layout)[plan[place]];
  return { yawDeg: fly.yawDeg, tiltDeg: fly.tiltDeg, zoom: fly.zoom, fx: at.x - ARENA_CENTER.x, fy: at.y - ARENA_CENTER.y, oy: 36 };
}

/** The turn of the world that puts a seat's field upright on screen: the opposite of its overview angle. */
export function flyYawFor(layout: TableLayout, seat: number): number {
  const plan = slotPlan(layout, { mode: "fly" });
  const place = layout.slots.findIndex((slot) => slot.seat === seat);
  if (!plan || place < 0) return 0;
  return normalizeAngle(-slotTable(layout)[plan[place]].rotateDeg);
}

/** An angle in the range -180 to 180 (180 maps to -180). */
export function normalizeAngle(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}
