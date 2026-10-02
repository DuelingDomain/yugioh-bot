import type { DuelEngineView } from "@yugidraft/shared/duels";
import { engineFormat, placementOrder, seatRelation } from "../multi-seat";
import { tagSeatCode } from "../table-format";
import type { CameraState, Compass, SeatPose, SeatSlot, SeatTone, TableFormat, TableLayout } from "./types";

/**
 * Seat geometry of the table, pure. The stage is 1100 by 860 stage px and is scaled to fit the board box.
 * 3w-1 owns the ffa3 home pose and the slots of every format. Focus, look, overview and fly poses belong to
 * the camera step: until then every camera mode draws the home pose. The 4-way poses are a first ring only.
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

/**
 * Where every seat stands for a camera state. Upright only turns text, so it never moves a field.
 * Focus, look, overview and fly are drawn as home until the camera step adds them.
 */
export function seatPoses(layout: TableLayout, _camera: CameraState, _viewport: { width: number; height: number }): Map<number, SeatPose> {
  const home = homeTable(layout.format);
  const poses = new Map<number, SeatPose>();
  layout.slots.forEach((slot, place) => {
    const at = home[Math.min(place, home.length - 1)];
    poses.set(slot.seat, {
      seat: slot.seat,
      x: at.x,
      y: at.y,
      scale: at.scale,
      rotateDeg: at.rotateDeg,
      tiltDeg: at.tiltDeg,
      z: SEAT_Z,
      docked: false,
      compact: false,
      hidden: false,
    });
  });
  return poses;
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
}

/** Home anchor of the holo LP panel of one seat: bottom right for you, top corners for rivals. */
export function holoAnchor(layout: TableLayout, seat: number): HoloAnchor {
  const place = layout.slots.findIndex((slot) => slot.seat === seat);
  const count = layout.slots.length;
  if (place <= 0 && layout.viewerSeat === seat) return { x: 882, y: 686, me: true };
  if (place <= 0) return { x: 882, y: 686, me: layout.viewerSeat != null };
  if (count <= 3) return place === 1 ? { x: 8, y: 8, me: false } : { x: 896, y: 8, me: false };
  // 4 seats: left, top and right edges.
  const edge = [{ x: 8, y: 372 }, { x: 448, y: 8 }, { x: 896, y: 372 }][Math.min(place, 3) - 1];
  return { ...edge, me: false };
}
