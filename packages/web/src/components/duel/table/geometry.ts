import type { DuelEngineView } from "@yugidraft/shared/duels";
import { engineFormat, placementOrder, seatRelation } from "../multi-seat";
import { tagSeatCode } from "../table-format";
import type { CameraState, Compass, FlyPose, PoseSlot, SeatPose, SeatSlot, SeatTone, TableFormat, TableLayout } from "./types";

/**
 * Seat geometry of the table, pure. The stage is 1100 by 860 stage px and is scaled to fit the board box.
 * The 3-way table has nine named places (`PoseSlot`): home, the two rival places, focus and its two docks, and
 * the three overview places. Look, focus, overview and fly pick the place of each seat from them. The 4-way
 * and Tag tables draw their home pose in every camera mode until their own steps add more.
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

/** First ring for a 4-way table (the 4-way step tunes it): you S, then W, N, E. */
const FFA4_HOME: readonly HomeSlot[] = [
  { x: 550, y: 612, rotateDeg: 0, scale: 1, tiltDeg: 0 },
  { x: 168, y: 400, rotateDeg: 90, scale: 0.56, tiltDeg: 0 },
  { x: 550, y: 168, rotateDeg: 180, scale: 0.56, tiltDeg: 8 },
  { x: 932, y: 400, rotateDeg: 270, scale: 0.56, tiltDeg: 0 },
];

/** Placeholder 2 by 2 for Tag. The real Tag geometry is `tag/roof-camera.ts`. */
const TAG_HOME: readonly HomeSlot[] = [
  { x: 300, y: 600, rotateDeg: 0, scale: 0.8, tiltDeg: 0 },
  { x: 800, y: 600, rotateDeg: 0, scale: 0.8, tiltDeg: 0 },
  { x: 300, y: 220, rotateDeg: 180, scale: 0.66, tiltDeg: 10 },
  { x: 800, y: 220, rotateDeg: 180, scale: 0.66, tiltDeg: 10 },
];

/** The nine named places of a 3-way table. `z` is the card unit the seat box is drawn at. */
const FFA3_SLOTS: Readonly<Record<PoseSlot, HomeSlot>> = {
  home: FFA3_HOME[0],
  vL: FFA3_HOME[1],
  vR: FFA3_HOME[2],
  focus: { x: 550, y: 206, rotateDeg: 180, scale: 0.9, tiltDeg: 9 },
  dockL: { x: 110, y: 272, rotateDeg: 90, scale: 0.46, tiltDeg: 0 },
  dockR: { x: 990, y: 272, rotateDeg: -90, scale: 0.46, tiltDeg: 0 },
  oHome: { x: 550, y: 652, rotateDeg: 0, scale: 0.58, tiltDeg: 0 },
  oL: { x: 327, y: 301, rotateDeg: 120, scale: 0.58, tiltDeg: 0 },
  oR: { x: 773, y: 301, rotateDeg: 240, scale: 0.58, tiltDeg: 0 },
};
const SLOT_ZINDEX: Readonly<Record<PoseSlot, number>> = { home: 5, vL: 3, vR: 3, focus: 4, dockL: 2, dockR: 2, oHome: 3, oL: 3, oR: 3 };
/** Angle of a place on the turn ring, in screen degrees (0 = right, 90 = down). */
const SLOT_RING_ANGLE: Readonly<Record<PoseSlot, number>> = { home: 90, oHome: 90, vL: 210, oL: 210, dockL: 180, vR: 330, oR: 330, dockR: 0, focus: 270 };

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

type CameraView = Pick<CameraState, "mode"> & Partial<Pick<CameraState, "focusSeat" | "lookSeat">>;

/**
 * The place of every seat of a 3-way table, by drawing order (viewer first). Null for any other format.
 * Home: you at the bottom, the next seat up-left, the one after up-right. Focus: the focused rival goes across,
 * the other one docks at the side. Look: the seat you look from takes the home place and the table turns with it.
 * Overview and fly: three equal places at 120 degrees.
 */
export function slotPlan(layout: TableLayout, camera: CameraView): PoseSlot[] | null {
  if (layout.format !== "ffa3" || layout.slots.length !== 3) return null;
  const seatAt = (seat: number | null | undefined) => layout.slots.findIndex((slot) => slot.seat === seat);
  if (camera.mode === "overview" || camera.mode === "fly") return ["oHome", "oL", "oR"];
  if (camera.mode === "focus") {
    const place = seatAt(camera.focusSeat);
    if (place > 0) {
      const plan: PoseSlot[] = ["home", "dockL", "dockR"];
      const other = place === 1 ? 2 : 1;
      plan[place] = "focus";
      plan[other] = other === 1 ? "dockL" : "dockR";
      return plan;
    }
  }
  if (camera.mode === "look") {
    const place = seatAt(camera.lookSeat);
    if (place > 0) {
      const plan: PoseSlot[] = ["home", "home", "home"];
      plan[(place + 1) % 3] = "vL";
      plan[(place + 2) % 3] = "vR";
      return plan;
    }
  }
  return ["home", "vL", "vR"];
}

/**
 * Where every seat stands for a camera state. Upright only turns text, so it never moves a field. A lock is
 * not read here: the caller passes the effective camera (see `effectiveCamera`).
 */
export function seatPoses(layout: TableLayout, camera: CameraView, _viewport?: { width: number; height: number }): Map<number, SeatPose> {
  const plan = slotPlan(layout, camera);
  const home = homeTable(layout.format);
  const poses = new Map<number, SeatPose>();
  layout.slots.forEach((slot, place) => {
    const name = plan?.[place];
    const at = name ? FFA3_SLOTS[name] : home[Math.min(place, home.length - 1)];
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
      compact: false,
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
    case "vR": return { x: 896, y: 8, beam: "down" };
    case "focus": return focusPlace === 1 ? { x: 8, y: 10, beam: "down" } : { x: 896, y: 10, beam: "down" };
    case "dockL": return { x: 8, y: 8, beam: "none" };
    case "dockR": return { x: 896, y: 8, beam: "none" };
    case "oHome": return { x: 764, y: 690, beam: "none" };
    case "oL": return { x: 14, y: 548, beam: "up" };
    case "oR": return { x: 896, y: 548, beam: "up" };
  }
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
    const at = ffa3Anchor(plan[place], focusPlace);
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
      angles.set(slot.seat, SLOT_RING_ANGLE[plan[place]]);
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
  const at = FFA3_SLOTS[plan[place]];
  return { yawDeg: fly.yawDeg, tiltDeg: fly.tiltDeg, zoom: fly.zoom, fx: at.x - ARENA_CENTER.x, fy: at.y - ARENA_CENTER.y, oy: 36 };
}

/** The turn of the world that puts a seat's field upright on screen: the opposite of its overview angle. */
export function flyYawFor(layout: TableLayout, seat: number): number {
  const plan = slotPlan(layout, { mode: "fly" });
  const place = layout.slots.findIndex((slot) => slot.seat === seat);
  if (!plan || place < 0) return 0;
  return normalizeAngle(-FFA3_SLOTS[plan[place]].rotateDeg);
}

/** An angle in the range -180 to 180 (180 maps to -180). */
export function normalizeAngle(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}
