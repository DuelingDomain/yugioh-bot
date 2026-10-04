import type { DuelEngineView } from "@yugidraft/shared/duels";
import { engineFormat, placementOrder, seatRelation } from "../multi-seat";
import { tagSeatCode } from "../table-format";
import type { CameraState, Compass, FlyPose, PoseSlot, SeatPose, SeatSlot, SeatTone, TableFormat, TableLayout } from "./types";

/**
 * Seat geometry of the table, pure. The stage is 1100 by 860 stage px and is scaled to fit the board box.
 * The 3-way table has nine named places (`PoseSlot`): home, the two rival places, focus and its two docks, and
 * the three overview places. The 4-way table has eleven: it adds the far (north) place at home and in overview.
 * Look, focus, overview and fly pick the place of each seat from them. The Tag table draws its home pose in
 * every camera mode until its own step adds more.
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

function slotTable(format: TableFormat): Readonly<Record<PoseSlot, HomeSlot>> {
  return format === "ffa4" ? FFA4_SLOTS : FFA3_SLOTS;
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
  if (!((layout.format === "ffa3" && count === 3) || (layout.format === "ffa4" && count === 4))) return null;
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
  const table = slotTable(layout.format);
  const fit = viewport ? stageFit(viewport) : 0;
  const screenWidth = viewport?.screenWidth ?? viewport?.width ?? 0;
  const wide = viewport ? wideHomeSlots(layout.format, stageSpread(viewport)) : null;
  const poses = new Map<number, SeatPose>();
  layout.slots.forEach((slot, place) => {
    const name = plan?.[place];
    const at = name ? (wide?.[name] ?? table[name]) : home[Math.min(place, home.length - 1)];
    // Compact chips are a 4-way table feature: in the fly-in view the camera zooms in, so fields stay whole.
    const compact = layout.format === "ffa4" && camera.mode !== "fly" && name != null && fit > 0
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

/* ---------- The wide plaza ----------
 * The stage coordinate system stays 1100 wide and centred on x = 550, so the canvas, the world, the fly-in camera and every
 * effect that measures the canvas keep working. A box wider than the stage shows more of the plaza at both sides:
 * `stageSpread` is how many stage px are visible beyond x = 0 and x = 1100 on each side, and the home places use that
 * room (the side rivals grow and move to the outer edges). With no spread every pose is exactly today's. */

/** Size of a seat box at scale 1 and --sf-z 112, in px (measured on the 4-way preview: 653 by 380). */
export const SEAT_BOX = { width: 653, height: 380 } as const;
/** Most spread (stage px at each side) the plaza uses. A wider box keeps the extra room as empty floor. */
export const MAX_SPREAD = 450;
/** How far a rival's hand fan reaches beyond the outer edge of its board, at scale 1 (measured: about 76 px). */
const HAND_OUT = 76;
const HOME_PLACES = new Set<PoseSlot>(["home", "vL", "vN", "vR"]);

/** Stage px visible beyond each side of the 1100 wide stage in a box. Zero for a box that is not wider than the stage. */
export function stageSpread(box: { width: number; height: number }): number {
  const k = stageFit(box);
  if (!(k > 0)) return 0;
  const spread = (box.width / k - STAGE.width) / 2;
  // Whole stage px in steps of two: a drag of the window edge does not move every seat on every pixel.
  return Math.min(MAX_SPREAD, Math.max(0, Math.floor(spread / 2) * 2));
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The home places of a table when the box is wider than the stage (null when it is not). Home and look read these.
 * 4-way: the side rivals grow up to .9 of your size and sit at the outer edges, the far one grows a little.
 * 3-way: the two rivals grow to about .78 and move apart so their boards stay clear of each other.
 */
export function wideHomeSlots(format: TableFormat, spread: number): Partial<Record<PoseSlot, HomeSlot>> | null {
  if (!(spread > 0) || (format !== "ffa3" && format !== "ffa4")) return null;
  const t = clamp01(spread / 250);
  if (format === "ffa4") {
    const home = FFA4_HOME[0];
    // Room beside your board: the side board (rotated, so it is SEAT_BOX.height wide) must end before yours starts.
    // The hand fan reaches past the outer edge of the board, so it needs room there as well.
    const sideScale = Math.min(0.9, Math.max(0.6, (spread + 191) / (SEAT_BOX.height + HAND_OUT)));
    const sideW = SEAT_BOX.height * sideScale;
    const sideH = SEAT_BOX.width * sideScale;
    const sideY = 18 + sideH / 2;
    const sideX = 10 + HAND_OUT * sideScale + sideW / 2;
    const farScale = 0.6 + 0.08 * t;
    // The far board is tilted: its top row is the narrow, short one. Keep its hand backs (above it) on screen.
    const farY = 52 + (SEAT_BOX.height * farScale * 0.96) / 2;
    const west = { x: -spread + sideX, y: sideY, rotateDeg: 90, scale: sideScale, tiltDeg: 0 };
    return {
      home,
      vL: west,
      vN: { x: 550, y: farY, rotateDeg: 180, scale: farScale, tiltDeg: 16 },
      vR: { ...west, x: 1100 + spread - sideX, rotateDeg: 270 },
    };
  }
  const home = FFA3_HOME[0];
  const rivalScale = 0.66 + 0.12 * t;
  const half = Math.max(252, (SEAT_BOX.width * rivalScale * 0.93) / 2 + 24);
  return {
    home,
    vL: { x: 550 - half, y: 222, rotateDeg: 158, scale: rivalScale, tiltDeg: 12 },
    vN: { x: 550 - half, y: 222, rotateDeg: 158, scale: rivalScale, tiltDeg: 12 },
    vR: { x: 550 + half, y: 222, rotateDeg: 202, scale: rivalScale, tiltDeg: 12 },
  };
}

export interface Bounds {
  l: number;
  r: number;
  t: number;
  b: number;
}

const PERSPECTIVE = 1700;

/**
 * The box a seat board covers on the stage, in stage px: its four corners put through the same transform the seat wrapper
 * gets (`seatTransform`: tilt with perspective, then turn, then scale about the centre). Pure, so a holo panel can dock to a
 * corner of a board that is still gliding to its place.
 */
export function boardBounds(pose: Pick<SeatPose, "x" | "y" | "rotateDeg" | "tiltDeg" | "scale">): Bounds {
  const rot = (pose.rotateDeg * Math.PI) / 180;
  const tilt = ((pose.tiltDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const px = (sx * SEAT_BOX.width * pose.scale) / 2;
      const py = (sy * SEAT_BOX.height * pose.scale) / 2;
      const x = px * cos - py * sin;
      const y = px * sin + py * cos;
      const depth = y * Math.sin(tilt);
      const w = 1 - depth / PERSPECTIVE;
      xs.push(pose.x + x / w);
      ys.push(pose.y + (y * Math.cos(tilt)) / w);
    }
  }
  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
}

const HOLO_RIVAL = { width: 196, height: 92 } as const;
const HOLO_ME = { width: 212, height: 113 } as const;
/** Room the Deck Master chip under your panel takes: its widest case, and its height with the gap above it. */
const HOLO_MASTER_CHIP = { width: 270, height: 58 } as const;

const overlaps = (a: Bounds, b: Bounds, gap = 0) => a.l < b.r + gap && b.l < a.r + gap && a.t < b.b + gap && b.t < a.b + gap;

/**
 * Where each holo LP panel docks at a wide table (home and look). A panel sits at a corner of its own board, off every other
 * board and panel: yours to the right of your board, a side rival's below its board at the corner nearer the middle,
 * the far rival's beside its front-left corner (tucked under it next to the ring when the west board is in the way).
 * Null when the camera is not at the home places or the box is not wider than the stage. Top-left of each panel, stage px.
 */
export function wideHoloAnchors(
  layout: TableLayout,
  camera: CameraView,
  poses: ReadonlyMap<number, SeatPose>,
  spread: number,
  /** A chip hangs under your panel (your Deck Master): its room is kept clear too. */
  meFooter = false,
): Map<number, HoloAnchor> | null {
  const plan = slotPlan(layout, camera);
  if (!(spread > 0) || !plan || !plan.every((name) => HOME_PLACES.has(name))) return null;
  const four = layout.slots.length === 4;
  const boards = new Map<number, Bounds>();
  for (const slot of layout.slots) {
    const pose = poses.get(slot.seat);
    if (pose) boards.set(slot.seat, boardBounds(pose));
  }
  const left = -spread + 6;
  const right = STAGE.width + spread - 6;
  // The turn ring in the middle is never covered.
  const taken: Bounds[] = [{ l: ARENA_CENTER.x - 62, r: ARENA_CENTER.x + 62, t: ARENA_CENTER.y - 62, b: ARENA_CENTER.y + 76 }];
  const anchors = new Map<number, HoloAnchor>();
  const rectAt = (x: number, y: number, size: { width: number; height: number }): Bounds => ({ l: x, r: x + size.width, t: y, b: y + size.height });
  const inside = (r: Bounds) => r.l >= left && r.r <= right && r.t >= 4 && r.b <= 952;
  const clear = (r: Bounds, own: number) =>
    inside(r) && !taken.some((t) => overlaps(t, r, 4)) && ![...boards].some(([seat, board]) => seat !== own && overlaps(board, r, 4));
  // The first candidate that is clear; else the first one, pushed down until it is.
  const settle = (cands: ReadonlyArray<readonly [number, number]>, size: { width: number; height: number }, own: number) => {
    const found = cands.find(([x, y]) => clear(rectAt(x, y, size), own));
    const [x, y0] = found ?? cands[0];
    let y = y0;
    if (!found) {
      let guard = 0;
      while (guard++ < 60 && !clear(rectAt(x, y, size), own) && y + size.height < 940) y += 6;
    }
    const x2 = Math.min(right - size.width, Math.max(left, x));
    taken.push(rectAt(x2, y, size));
    return { x: x2, y };
  };
  const mineSeat = camera.mode !== "look" && layout.viewerSeat != null ? layout.viewerSeat : null;
  const ordered = layout.slots.map((slot, place) => ({ slot, place, name: plan[place] }));
  // Yours first (the others settle around it), then the sides, then the far or second rival.
  // The far rival picks right after you: it has the fewest places to go, the sides can sit under their own boards.
  const order = (name: string) => (name === "home" ? 0 : name === "vN" ? 1 : 2);
  ordered.sort((a, b) => order(a.name) - order(b.name));
  const me = ordered[0].name === "home" ? boards.get(ordered[0].slot.seat) : undefined;
  const ringX = ARENA_CENTER.x;
  for (const { slot, name } of ordered) {
    const board = boards.get(slot.seat);
    if (!board) continue;
    const isMine = mineSeat === slot.seat;
    const plate = isMine ? HOLO_ME : HOLO_RIVAL;
    const size = isMine && meFooter ? { width: HOLO_MASTER_CHIP.width, height: plate.height + HOLO_MASTER_CHIP.height } : plate;
    let at: { x: number; y: number };
    if (name === "home") {
      // Beside your board, low enough that a rival's panel above it stays clear; the Deck Master chip hangs below.
      const y = board.b - plate.height;
      at = settle([[board.r + 14, y + 34], [board.r + 14, y + 22], [board.r + 14, y - 30], [board.r + 14, board.t + 20]], size, slot.seat);
    } else if (four && name === "vL") {
      at = settle([[board.r - size.width, board.b + 10], [board.r + 10, board.b - size.height], [board.l, board.b + 10]], size, slot.seat);
    } else if (four && name === "vR") {
      at = settle([[board.l, board.b + 10], [board.r - size.width, board.b + 10], [board.l - size.width - 10, board.b - size.height]], size, slot.seat);
    } else if (four) {
      // vN: beside the front-left corner; else under the board, left of the ring.
      at = settle([[board.l - 14 - size.width, board.b - size.height], [ringX - 64 - 12 - size.width, board.b + 4], [ringX + 64 + 12, board.b + 4], [board.r + 14, board.b - size.height]], size, slot.seat);
    } else {
      // 3-way: on the flank of its rival, below it and off your board.
      const west = name === "vL";
      const flank = west ? (me ? me.l - 18 - size.width : left) : (me ? me.r + 18 : right - size.width);
      const edge = west ? left : right - size.width;
      const ys = [board.b + 10, me ? me.t + (me.b - me.t) / 2 - size.height / 2 : board.b + 60, me ? me.b - size.height : board.b + 120];
      at = settle([...ys.map((y) => [flank, y] as const), ...ys.map((y) => [edge, y] as const)], size, slot.seat);
    }
    anchors.set(slot.seat, { x: at.x, y: at.y, me: isMine, beam: "none" });
  }
  return anchors;
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
    const at = (count === 4 ? ffa4Anchor : ffa3Anchor)(plan[place], focusPlace);
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
  if (layout.format === "ffa4") {
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
      angles.set(slot.seat, (layout.format === "ffa4" ? FFA4_RING_ANGLE : FFA3_RING_ANGLE)[plan[place]]);
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
  const at = slotTable(layout.format)[plan[place]];
  return { yawDeg: fly.yawDeg, tiltDeg: fly.tiltDeg, zoom: fly.zoom, fx: at.x - ARENA_CENTER.x, fy: at.y - ARENA_CENTER.y, oy: 36 };
}

/** The turn of the world that puts a seat's field upright on screen: the opposite of its overview angle. */
export function flyYawFor(layout: TableLayout, seat: number): number {
  const plan = slotPlan(layout, { mode: "fly" });
  const place = layout.slots.findIndex((slot) => slot.seat === seat);
  if (!plan || place < 0) return 0;
  return normalizeAngle(-slotTable(layout.format)[plan[place]].rotateDeg);
}

/** An angle in the range -180 to 180 (180 maps to -180). */
export function normalizeAngle(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}
