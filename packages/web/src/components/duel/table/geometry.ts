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
  /** Field box width at scale 1 when it is not SEAT_BOX.width (see SEAT_BOX_FULL_DEF). */
  width?: number;
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
  // Smaller and lower than the 4-way docks: a rival's plate sits above the thumbnail, and a big text size makes it about 130 stage px tall.
  dockL: { x: 110, y: 292, rotateDeg: 90, scale: 0.42, tiltDeg: 0 },
  dockR: { x: 990, y: 292, rotateDeg: -90, scale: 0.42, tiltDeg: 0 },
  oHome: { x: 550, y: 652, rotateDeg: 0, scale: 0.58, tiltDeg: 0 },
  oL: { x: 327, y: 301, rotateDeg: 120, scale: 0.58, tiltDeg: 0 },
  oN: { x: 327, y: 301, rotateDeg: 120, scale: 0.58, tiltDeg: 0 },
  oR: { x: 773, y: 301, rotateDeg: 240, scale: 0.58, tiltDeg: 0 },
};
/**
 * The places of a face-off (a 3-way table with two seats left). The far seat is a little smaller and lower than the 3-way
 * focus place, so its hand backs (about 288 stage px above the field centre at scale 1) stay inside the table box at the top.
 */
const DUO_SLOTS: Readonly<Record<PoseSlot, HomeSlot>> = {
  ...FFA3_SLOTS,
  focus: { x: 550, y: 234, rotateDeg: 180, scale: 0.78, tiltDeg: 9 },
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
  const arrangement = arrangementOf(layout);
  return arrangement === "ffa4" ? FFA4_SLOTS : arrangement === "duo" ? DUO_SLOTS : FFA3_SLOTS;
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

/** The viewer clicked their own field on a 3-way table (all three seats alive): it is shown larger, the rivals dock. */
export function isOwnFocus(layout: Pick<TableLayout, "format" | "arrangement" | "anchorSeat" | "slots">, camera: CameraView): boolean {
  return camera.mode === "focus" && camera.focusSeat != null && camera.focusSeat === layout.anchorSeat && arrangementOf(layout) === "ffa3" && layout.slots.length === 3;
}

/** Your own field enlarged (3-way): its size and place, and the place of the two docked rivals above it. */
const OWN_FOCUS = { scale: 1.2, y: 560, dockY: 200, ring: { x: 550, y: 150, scale: 0.9 }, hub: { x: 550, y: 288 } } as const;

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
    // 3-way: your own field enlarged. Both rivals dock at the sides and the stage above your field is free.
    if (place === 0 && isOwnFocus(layout, camera)) return ["home", "dockL", "dockR"];
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
  const duo = arrangementOf(layout) === "duo" && camera.mode !== "fly" && viewport ? duoFinaleSlots(stageSpread(viewport)) : null;
  const wide = duo ?? (viewport && arrangementOf(layout) !== "duo" ? wideHomeSlots(layout.format, stageSpread(viewport), plazaView(viewport)) : null);
  const poses = new Map<number, SeatPose>();
  const ownFocus = isOwnFocus(layout, camera);
  layout.slots.forEach((slot, place) => {
    const name = plan?.[place];
    let at = name ? (wide?.[name] ?? table[name]) : home[Math.min(place, home.length - 1)];
    if (ownFocus && name === "home") at = { ...at, scale: OWN_FOCUS.scale, y: OWN_FOCUS.y };
    else if (ownFocus && (name === "dockL" || name === "dockR")) at = { ...at, y: OWN_FOCUS.dockY };
    poses.set(slot.seat, {
      seat: slot.seat,
      x: at.x,
      y: at.y,
      scale: at.scale,
      rotateDeg: at.rotateDeg,
      tiltDeg: at.tiltDeg,
      ...(name && wide?.[name]?.width ? { width: wide[name]!.width } : {}),
      slot: name,
      z: SEAT_Z,
      docked: name === "dockL" || name === "dockR",
      compact: false,
      hidden: false,
    });
  });
  return poses;
}

/** Portrait reflow: two rival columns and a full-width home board, fitted between the phone controls. */
export function portraitTable(layout: TableLayout, camera: CameraView, screenWidth: number): {
  width: number; height: number; poses: Map<number, SeatPose>; anchors: Map<number, HoloAnchor>;
} | null {
  if (!(screenWidth > 0 && screenWidth <= 640) || camera.mode !== "home" ||
    !((layout.format === "ffa4" && layout.slots.length === 4) || (layout.format === "ffa3" && layout.slots.length === 3))) return null;
  const four = layout.format === "ffa4";
  const home: HomeSlot = { x: 550, y: four ? 860 : 680, scale: 1, rotateDeg: 0, tiltDeg: 0 };
  const left: HomeSlot = { x: 354, y: four ? 422 : 160, scale: 0.5, rotateDeg: 180, tiltDeg: 0 };
  const right: HomeSlot = { ...left, x: 746 };
  const north: HomeSlot = { x: 550, y: 145, scale: 0.48, rotateDeg: 180, tiltDeg: 0 };
  const places = four ? [home, left, north, right] : [home, left, right];
  const names: PoseSlot[] = four ? ["home", "vL", "vN", "vR"] : ["home", "vL", "vR"];
  const plates = four ? [[712, 80], [256, 536], [176, 90], [648, 536]] : [[444, 300], [190, 276], [714, 276]];
  return {
    width: 760,
    height: four ? 1180 : 1000,
    poses: new Map(layout.slots.map(({ seat }, i) => [seat, { ...places[i], seat, slot: names[i], z: SEAT_Z, docked: false, compact: false, hidden: false }])),
    anchors: new Map(layout.slots.map(({ seat }, i) => [seat, { x: plates[i][0], y: plates[i][1], me: seat === layout.viewerSeat, beam: "none", footerTight: true }])),
  };
}

/* ---------- The wide plaza ----------
 * The stage coordinate system stays 1100 wide and centred on x = 550, so the canvas, the world, the fly-in camera and every
 * effect that measures the canvas keep working. A box wider than the stage shows more of the plaza at both sides:
 * `stageSpread` is how many stage px are visible beyond x = 0 and x = 1100 on each side, and the home places use that
 * room (the side rivals grow and move to the outer edges). With no spread every pose is exactly today's. */

/** Size of a seat box at scale 1 and --sf-z 112, in px (measured on the 4-way preview: 653 by 380). */
export const SEAT_BOX = { width: 653, height: 380 } as const;
/**
 * Width of a 3-way field at a wide table: each of the five zone columns is a card height wide (1.571 zone units more, as
 * GRID_ZONE_WIDEN on the 4-way grid), so a Defense card lies at full size inside its own column. See `[data-def-full]`
 * in field.module.css.
 */
export const SEAT_BOX_FULL_DEF = 829;
/**
 * Your hand at a wide 3-way table, in seat units at scale 1 (see `--hand-w` / `--lh` under `[data-def-full]` in
 * field.module.css): 6.8 zone sizes wide (112 px each), inside the 829 px field, and about 144 deep, hanging 15 px up over
 * the field's bottom pad. The classic hand is 605 by 116.
 */
const OWN_HAND_WIDE = { width: 762, height: 144, rise: 15 } as const;
/** The least spread (stage px beyond each side) that has room for the wide 3-way fields; every floating-HUD screen has it. */
const FULL_DEF_SPREAD = 200;
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
/**
 * The FINAL DUEL board of a 3-way table on a wide screen (two seats left, as the 4-way finale): the 1v1 composition. Both
 * fields are the wide ones (full-size Defense cards), face to face on the centre line; the far one is tilted away and
 * smaller (.76, the size that keeps its hand backs inside the stage and about 30 stage px of air above yours). The turn ring moves to
 * the open stage left of both fields (`ringPose`). Null where the box is too narrow: the classic face-off stays.
 */
export function duoFinaleSlots(spread: number): Partial<Record<PoseSlot, HomeSlot>> | null {
  if (!(spread >= FULL_DEF_SPREAD)) return null;
  return {
    home: { ...FFA3_HOME[0], width: SEAT_BOX_FULL_DEF },
    focus: { x: 550, y: 218, rotateDeg: 180, scale: 0.76, tiltDeg: 9, width: SEAT_BOX_FULL_DEF },
  };
}

export function wideHomeSlots(format: TableFormat, spread: number, view?: PlazaView): Partial<Record<PoseSlot, HomeSlot>> | null {
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
  const width = spread >= FULL_DEF_SPREAD ? SEAT_BOX_FULL_DEF : undefined;
  const home = width ? { ...FFA3_HOME[0], width } : FFA3_HOME[0];
  const left = ffa3WideRival(spread, view ?? { k: 1, top: 0 }, width ?? SEAT_BOX.width);
  const rival = width ? { ...left, width } : left;
  return { home, vL: rival, vN: rival, vR: { ...rival, x: 1100 - left.x, rotateDeg: 360 - left.rotateDeg } };
}

/** The scale of the stage in the table box (screen px per stage px) and the stage y at the top edge of the box. */
export interface PlazaView {
  k: number;
  top: number;
}

/** The plaza view of a fitted table box (see `seatPoses`): its scale and the stage y its top edge shows. */
export function plazaView(fit: { width: number; height: number }): PlazaView {
  const k = stageFit(fit);
  if (!(k > 0)) return { k: 1, top: 0 };
  // The canvas (stage plus the hand row, 956 tall) is centred in the box, whose full height is fit.height * 956 / 860.
  return { k, top: -((fit.height * 956) / 860 - 956 * k) / (2 * k) };
}

/**
 * The floating HUD's left column over a 3-way plaza (the HUD runs to the edge there, see `[data-plaza-hud]` in
 * table-shell.module.css), in screen px from the top left of the table box, air included: the dock, then the chain tower
 * under it (up to six links). The rival fields keep clear of it. The Deck Master plate in the bottom left corner and the
 * turn controls in the bottom right corner sit level with your own field, which never reaches them.
 */
export const PLAZA_HUD_KEEP: readonly { x: number; y: number; width: number; height: number }[] = [
  { x: 0, y: 0, width: 60, height: 170 },
  { x: 0, y: 170, width: 162, height: 356 },
];

/**
 * How a 3-way rival stands at a wide table. The two rivals keep the classic look (tilted, turned 22 degrees to face the
 * ring) and stay clear of each other, of the turn ring, of your field and of the HUD column, all in screen px. They back
 * up to the top of the stage and grow no bigger than .76 of your field; a short box makes them smaller, down to .56.
 */
const FFA3_WIDE = {
  maxScale: 0.76,
  minScale: 0.56,
  /** The classic turn first; a tight box turns them a little less toward the ring before it makes them smaller. */
  rotateDeg: [158, 162, 166, 170],
  tiltDeg: 12,
  /** Air in screen px: between the two rivals, from your field, from the ring, from the HUD column, from the box edge. */
  air: { rival: 32, me: 24, ring: 12, keep: 12, edge: 6 },
} as const;
/** The turn ring of the 3-way home view with its TURN label (ringPose), in stage px. */
const FFA3_RING: Bounds = { l: 550 - 64, r: 550 + 64, t: 322 - 64, b: 322 + 80 };

const wideRivalCache = new Map<string, HomeSlot>();

function ffa3WideRival(rawSpread: number, rawView: PlazaView, W: number): HomeSlot {
  // The search is slow, so a resize must not run it at each pixel: snap the box to steps that only ever make the room
  // a little smaller (less spread, a smaller k gives more air, a lower top edge), and cache by the steps.
  const spread = Math.floor(rawSpread / 8) * 8;
  const view = { k: Math.floor(rawView.k * 50) / 50 || rawView.k, top: Math.ceil(rawView.top / 4) * 4 };
  const key = `${spread}|${view.k}|${view.top}|${W}`;
  const hit = wideRivalCache.get(key);
  if (hit) return hit;
  const { k } = view;
  const air = FFA3_WIDE.air;
  const me = seatQuad(FFA3_HOME[0], 0, 0, W, SEAT_BOX.height);
  const ring = boundsQuad(FFA3_RING);
  // The HUD column in stage px: the box's left edge is at -spread, its top edge at view.top.
  const keep = PLAZA_HUD_KEEP.map((r) => boundsQuad({ l: -spread + r.x / k, r: -spread + (r.x + r.width) / k, t: view.top + r.y / k, b: view.top + (r.y + r.height) / k }));
  let found: HomeSlot | null = null;
  for (let scale = FFA3_WIDE.maxScale; scale >= FFA3_WIDE.minScale - 1e-9 && !found; scale -= 0.02) {
    for (const rotateDeg of FFA3_WIDE.rotateDeg) for (let y = 120; y <= 330 && !found; y += 4) {
      const base = { rotateDeg, tiltDeg: FFA3_WIDE.tiltDeg };
      const probe = { ...base, scale, x: 0, y };
      // The board and the hand backs over its back edge stay inside the box.
      const top = Math.min(...seatQuad(probe, 0, 0, W, SEAT_BOX.height).concat(seatQuad(probe, 0, 225, W, 70)).map((p) => p.y));
      if (top - view.top < air.edge / k) continue;
      for (let half = 240; half <= 1100; half += 4) {
        const pose = { ...probe, x: 550 - half };
        const board = seatQuad(pose, 0, 0, W, SEAT_BOX.height);
        const mirror = board.map((p) => ({ x: 1100 - p.x, y: p.y }));
        if (polygonGap(board, mirror) < air.rival / k || polygonGap(board, me) < air.me / k || polygonGap(board, ring) < air.ring / k) continue;
        const hand = seatQuad(pose, 0, 225, W, 70);
        const ok = Math.min(...board.concat(hand).map((p) => p.x)) >= -spread + air.edge / k &&
          keep.every((r) => polygonGap(r, board) >= air.keep / k && polygonGap(r, hand) >= air.keep / k);
        if (ok) found = { ...pose, x: 550 - half };
        break;
      }
    }
  }
  // A box with no room for the smallest rival: the classic place, scaled for the spread.
  const slot = found ?? { rotateDeg: 158, tiltDeg: FFA3_WIDE.tiltDeg, x: 298 - Math.min(spread, 120), y: 222, scale: FFA3_WIDE.minScale };
  if (wideRivalCache.size > 256) wideRivalCache.clear();
  wideRivalCache.set(key, slot);
  return slot;
}

type Point = { x: number; y: number };

/** The four corners of a rectangle given in a seat's own frame (centre lx, ly; size w by h), on the stage: the seat transform. */
export function seatQuad(pose: Pick<SeatPose, "x" | "y" | "rotateDeg" | "tiltDeg" | "scale">, lx: number, ly: number, w: number, h: number): Point[] {
  const rot = (pose.rotateDeg * Math.PI) / 180;
  const tilt = ((pose.tiltDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const px = (lx + (sx * w) / 2) * pose.scale;
    const py = (ly + (sy * h) / 2) * pose.scale;
    const x = px * cos - py * sin;
    const y = px * sin + py * cos;
    const depth = y * Math.sin(tilt);
    const d = 1 - depth / PERSPECTIVE;
    return { x: pose.x + x / d, y: pose.y + (y * Math.cos(tilt)) / d };
  });
}

const boundsQuad = (b: Bounds): Point[] => [{ x: b.l, y: b.t }, { x: b.r, y: b.t }, { x: b.r, y: b.b }, { x: b.l, y: b.b }];

/** The gap between two convex polygons along the best separating axis: negative when they overlap. */
export function polygonGap(a: readonly Point[], b: readonly Point[]): number {
  let best = -Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = q.y - p.y;
      const ny = p.x - q.x;
      const len = Math.hypot(nx, ny) || 1;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of a) { const d = (v.x * nx + v.y * ny) / len; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of b) { const d = (v.x * nx + v.y * ny) / len; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      best = Math.max(best, b0 - a1, a0 - b1);
    }
  }
  return best;
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
export function boardBounds(pose: Pick<SeatPose, "x" | "y" | "rotateDeg" | "tiltDeg" | "scale" | "width">): Bounds {
  const boxWidth = pose.width ?? SEAT_BOX.width;
  const rot = (pose.rotateDeg * Math.PI) / 180;
  const tilt = ((pose.tiltDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const px = (sx * boxWidth * pose.scale) / 2;
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

/** Screen px of the camera hint pill in the same corner: always kept clear. */
export const CAMERA_HINT = { width: 250, height: 40 } as const;
/** The floating HUD's bottom right corner (the clock, the responses and the turn button), in box px with its air. */
export const HUD_CORNER = { width: 204, height: 236 } as const;

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
  /** The camera hint pill in the table's bottom left corner, in stage px: always kept clear. */
  corner?: { hint: { width: number; height: number }; hud?: { width: number; height: number } },
): Map<number, HoloAnchor> | null {
  const plan = slotPlan(layout, camera);
  const finale = arrangementOf(layout) === "duo" && camera.mode !== "fly" && duoFinaleSlots(spread) != null;
  if (!(spread > 0) || !plan || !plan.every((name) => HOME_PLACES.has(name) || (finale && name === "focus"))) return null;
  const four = layout.slots.length === 4;
  const boards = new Map<number, Bounds>();
  for (const slot of layout.slots) {
    const pose = poses.get(slot.seat);
    if (pose) boards.set(slot.seat, boardBounds(pose));
  }
  const left = -spread + 6;
  const right = STAGE.width + spread - 6;
  // The turn ring in the middle is never covered.
  const ringHalf = 62;
  const ringAt = finale ? ringPose(layout, camera, spread) : ARENA_CENTER;
  const taken: Bounds[] = [{ l: ringAt.x - ringHalf, r: ringAt.x + ringHalf, t: ringAt.y - 62, b: ringAt.y + 76 }];
  // Your hand fans along the bottom edge under your board: up to ten cards, about 660 stage px.
  taken.push({ l: ARENA_CENTER.x - 330, r: ARENA_CENTER.x + 330, t: STAGE.height - 4, b: 960 });
  // The hand as drawn (at a wide 3-way table it is 762 px wide and rises over the field's bottom pad) and your name label
  // stay clear too. Your seat's pose is upright, so its rectangles are exact.
  const homeSlot = plan[0] === "home" ? layout.slots[0] : undefined;
  const homePose = homeSlot ? poses.get(homeSlot.seat) : undefined;
  if (homePose && !homePose.hidden) {
    for (const r of seatObstacles(homePose, true).slice(1)) taken.push({ l: r.x - r.width / 2, r: r.x + r.width / 2, t: r.y - r.height / 2, b: r.y + r.height / 2 });
  }
  // The camera hint pill lives in the bottom left corner of the table area.
  if (corner) taken.push({ l: left - 6, r: left + corner.hint.width, t: 952 - corner.hint.height, b: 952 });
  // The floating HUD's turn controls in the bottom right corner (a 3-way plaza).
  if (corner?.hud) taken.push({ l: right + 6 - corner.hud.width, r: right + 6, t: 952 - corner.hud.height, b: 952 });
  const anchors = new Map<number, HoloAnchor>();
  const rectAt = (x: number, y: number, size: { width: number; height: number }): Bounds => ({ l: x, r: x + size.width, t: y, b: y + size.height });
  const inside = (r: Bounds) => r.l >= left && r.r <= right && r.t >= 4 && r.b <= 952;
  const clear = (r: Bounds, own: number) =>
    inside(r) &&
    !taken.some((t) => overlaps(t, r, 4)) &&
    ![...boards].some(([seat, board]) => seat !== own && overlaps(board, r, 4));
  // The first candidate that is clear; else the first one, pushed down until it is. The result is checked again after the
  // clamp into the visible stage: a plate that still collides goes to the nearest clear place, so it never lands on a field.
  const settle = (cands: ReadonlyArray<readonly [number, number]>, size: { width: number; height: number }, own: number, tight?: { width: number; height: number }) => {
    const found = cands.find(([x, y]) => clear(rectAt(x, y, size), own));
    const [x, y0] = found ?? cands[0];
    let y = y0;
    if (!found) {
      let guard = 0;
      while (guard++ < 60 && !clear(rectAt(x, y, size), own) && y + size.height < 940) y += 6;
    }
    let x2 = Math.min(right - size.width, Math.max(left, x));
    let y2 = y;
    if (!clear(rectAt(x2, y2, size), own)) {
      let best: { x: number; y: number; d: number } | null = null;
      for (let gx = left; gx <= right - size.width; gx += 8) {
        for (let gy = 4; gy + size.height <= 952; gy += 8) {
          const d = (gx - x2) ** 2 + (gy - y2) ** 2;
          if ((!best || d < best.d) && clear(rectAt(gx, gy, size), own)) best = { x: gx, y: gy, d };
        }
      }
      if (best) {
        x2 = best.x;
        y2 = best.y;
      }
    }
    let narrowed = false;
    // Nothing is clear for the full footprint (a small, tall table): the plate keeps its own width and the chip under it shrinks to
    // it (`tight`), so the plate still stays off every field.
    if (tight && !clear(rectAt(x2, y2, size), own)) {
      let best: { x: number; y: number; d: number } | null = null;
      for (let gx = left; gx <= right - tight.width; gx += 4) {
        for (let gy = 4; gy + tight.height <= 952; gy += 4) {
          const d = (gx - x2) ** 2 + (gy - y2) ** 2;
          if ((!best || d < best.d) && clear(rectAt(gx, gy, tight), own)) best = { x: gx, y: gy, d };
        }
      }
      if (best) {
        x2 = best.x;
        y2 = best.y;
        narrowed = true;
      }
    }
    taken.push(rectAt(x2, y2, narrowed && tight ? tight : size));
    return { x: x2, y: y2, tight: narrowed };
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
    let at: { x: number; y: number; tight?: boolean };
    if (name === "home") {
      // Beside your board (upright, so its box is exact: the plate never rests on it), low enough that a rival's panel above it stays clear; the Deck Master chip hangs below.
      const y = board.b - plate.height;
      at = settle([[board.r + 14, y + 34], [board.r + 14, y + 22], [board.r + 14, y - 30], [board.r + 14, board.t + 20]], size, -1, isMine && meFooter ? { width: plate.width, height: size.height } : undefined);
    } else if (name === "focus") {
      // The far field of the FINAL DUEL board: beside its top left corner (the classic face-off place), else its right one.
      at = settle([[board.l - 14 - size.width, board.t + 6], [board.l - 14 - size.width, board.b - size.height], [board.r + 14, board.t + 6]], size, slot.seat);
    } else if (four && name === "vL") {
      // Hugging the lower inner corner of its own board: under it, else beside it, else under its far end.
      const edge = me ? Math.max(left, me.l - 10 - size.width) : right;
      at = settle([[Math.min(board.r - size.width, edge), board.b + 10], [Math.min(board.r + 10, edge), board.b - size.height], [Math.min(board.r - size.width, edge), board.b - size.height], [board.l, board.b + 10]], size, slot.seat);
    } else if (four && name === "vR") {
      at = settle([[board.l, board.b + 10], [board.r - size.width, board.b + 10], [board.l - size.width - 10, board.b - size.height]], size, slot.seat);
    } else if (four) {
      // vN: beside the front-left corner; else under the board, left of the ring.
      at = settle([[board.l - 14 - size.width, board.b - size.height], [ringX - ringHalf - 14 - size.width, board.b + 4], [ringX + ringHalf + 14, board.b + 4], [board.r + 14, board.b - size.height]], size, slot.seat);
    } else {
      // 3-way: on the flank of its rival, below it and off your board.
      const west = name === "vL";
      const flank = west ? (me ? me.l - 18 - size.width : left) : (me ? me.r + 18 : right - size.width);
      const edge = west ? left : right - size.width;
      const ys = [board.b + 10, me ? me.t + (me.b - me.t) / 2 - size.height / 2 : board.b + 60, me ? me.b - size.height : board.b + 120];
      at = settle([...ys.map((y) => [flank, y] as const), ...ys.map((y) => [edge, y] as const)], size, slot.seat);
    }
    anchors.set(slot.seat, { x: at.x, y: at.y, me: isMine, beam: "none", ...(at.tight ? { footerTight: true } : null) });
  }
  return anchors;
}

export interface PromptRoom {
  /** Top-left and size of the free room, stage px. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A free room on the table for a prompt (the seat choice, the "Activate?" bar, the card-pick bar): clear of every board, every
 * LP plate, the turn ring, your hand and the camera hint, so a prompt about a rival's field never covers its zones. The
 * first size of `sizes` that has a room is used; among the rooms of that size the one nearest your board's
 * lower outer corner wins. Null when no size has a room (the prompt then keeps its old place and its hide button).
 * `anchors` are the plates as drawn: the wide ones, or the classic anchors of a table that is not wider than the stage.
 */
export function promptRoom(input: {
  layout: TableLayout;
  camera: CameraView;
  poses: ReadonlyMap<number, SeatPose>;
  anchors: ReadonlyMap<number, Pick<HoloAnchor, "x" | "y" | "me" | "footerTight">>;
  spread: number;
  /** A Deck Master chip hangs under your plate. */
  meFooter?: boolean;
  /** Camera hint pill, stage px. */
  hint: { width: number; height: number };
  /** Sizes to try, best first (stage px): the first one that has a room is used. */
  sizes: ReadonlyArray<{ width: number; height: number }>;
  reserved?: readonly PromptRoom[];
  prefer?: { x: number; y: number };
}): PromptRoom | null {
  const { layout, poses, anchors, spread, hint, sizes } = input;
  // The home and look views are the ones with the room to spare; focus and the fly-in keep the prompt's own place.
  if (input.camera.mode !== "home" && input.camera.mode !== "look") return null;
  const left = -spread + 6;
  const right = STAGE.width + spread - 6;
  const blocked: Bounds[] = (input.reserved ?? []).map((room) => ({ l: room.x, r: room.x + room.width, t: room.y, b: room.y + room.height }));
  // The name plate (REN ARATA) is a soft block: covering it is better than covering a card.
  const plate: Bounds[] = [];
  let mine: Bounds | null = null;
  for (const slot of layout.slots) {
    const pose = poses.get(slot.seat);
    if (!pose) continue;
    const board = boardBounds(pose);
    const fan = HAND_OUT * pose.scale;
    // A rival's hand backs hang off its outer edge: the room stays off them too.
    const box: Bounds = { ...board };
    if (pose.slot === "vL" || pose.slot === "dockL") box.l -= fan;
    else if (pose.slot === "vR" || pose.slot === "dockR") box.r += fan;
    else if (pose.slot !== "home") box.t -= fan;
    blocked.push(box);
    if (pose.slot === "home") {
      mine = board;
      // The hand starts at the board edge, not at the bottom of the nominal stage.
      blocked.push({ l: pose.x - 330 * pose.scale, r: pose.x + 330 * pose.scale, t: board.b, b: board.b + 120 * pose.scale });
      // The name plate (REN ARATA) hangs under the board's left corner; a big text size makes it wider.
      plate.push({ l: board.l, r: board.l + 230 * pose.scale, t: board.b - 6, b: board.b + 44 * pose.scale });
    }
  }
  for (const [seat, anchor] of anchors) {
    const mineSeat = layout.viewerSeat === seat || anchor.me;
    const size = mineSeat && input.meFooter ? { width: anchor.footerTight ? HOLO_ME.width : HOLO_MASTER_CHIP.width, height: HOLO_ME.height + HOLO_MASTER_CHIP.height } : mineSeat ? HOLO_ME : HOLO_RIVAL;
    blocked.push({ l: anchor.x, r: anchor.x + size.width, t: anchor.y - (anchor.me ? 0 : 14), b: anchor.y + Math.max(size.height, anchor.me ? 128 : 122) });
  }
  blocked.push({ l: ARENA_CENTER.x - 62, r: ARENA_CENTER.x + 62, t: ARENA_CENTER.y - 62, b: ARENA_CENTER.y + 76 });
  blocked.push({ l: ARENA_CENTER.x - 330, r: ARENA_CENTER.x + 330, t: STAGE.height - 4, b: 960 });
  blocked.push({ l: left - 6, r: left + hint.width, t: 952 - hint.height, b: 952 });
  const prefer = input.prefer ?? (mine ? { x: mine.l, y: mine.b } : { x: ARENA_CENTER.x, y: 760 });
  const search = (extra: readonly Bounds[]): PromptRoom | null => {
    for (const { width, height } of sizes) {
      let best: PromptRoom | null = null;
      let bestD = Infinity;
      for (let x = left; x + width <= right; x += 8) {
        for (let y = 4; y + height <= 952; y += 8) {
          const rect: Bounds = { l: x, r: x + width, t: y, b: y + height };
          const d = (x + width / 2 - prefer.x) ** 2 + (y + height / 2 - prefer.y) ** 2;
          if (d >= bestD || blocked.some((b) => overlaps(b, rect, 4)) || extra.some((b) => overlaps(b, rect, 4))) continue;
          best = { x, y, width, height };
          bestD = d;
        }
      }
      if (best) return best;
    }
    return null;
  };
  return search(plate) ?? (plate.length ? search([]) : null);
}

/** Prompt sizes in screen px, best first. Height comes first: the three seat choices should be whole before the panel narrows. */
const PANEL_HEIGHTS = [300, 280, 240, 200, 180, 160] as const;
const PANEL_WIDTHS = [320, 290, 260, 230, 204, 188] as const;
const BAR_HEIGHTS = [130, 120] as const;
const BAR_WIDTHS = [420, 360, 300, 240, 200, 188] as const;

/**
 * The rooms of a table for its two kinds of prompt, in stage px (null: no room, the prompt keeps its own place). `box` is the
 * table area in screen px and `k` the stage scale.
 */
export function promptRooms(input: {
  layout: TableLayout;
  camera: CameraView;
  poses: ReadonlyMap<number, SeatPose>;
  anchors: ReadonlyMap<number, Pick<HoloAnchor, "x" | "y" | "me" | "footerTight">>;
  spread: number;
  meFooter?: boolean;
  box: { width: number; height: number };
  k: number;
  /** Measured strip including its priority row, in screen px. */
  chainSize?: { width: number; height: number } | null;
}): { panel: PromptRoom | null; bar: PromptRoom | null; chain: PromptRoom | null } {
  const { box, k } = input;
  if (!(k > 0)) return { panel: null, bar: null, chain: null };
  const hint = { width: CAMERA_HINT.width / k, height: CAMERA_HINT.height / k };
  const grid = (heights: readonly number[], widths: readonly number[]) =>
    heights.flatMap((height) => widths.map((width) => ({ width: width / k, height: height / k })));
  const panelMax = Math.min(320, Math.max(220, box.width * 0.27));
  const base = { layout: input.layout, camera: input.camera, poses: input.poses, anchors: input.anchors, spread: input.spread, meFooter: input.meFooter, hint };
  const hub = hubPose(input.layout, input.camera, { box: { width: box.width, height: k * STAGE.height }, meFooter: input.meFooter });
  const ring = ringPose(input.layout, input.camera, input.spread);
  const furniture: PromptRoom[] = [
    { x: hub.x - hub.width / 2, y: hub.y - hub.height / 2, width: hub.width, height: hub.height },
    { x: ring.x - 70 * ring.scale, y: ring.y - 70 * ring.scale, width: 140 * ring.scale, height: 154 * ring.scale },
  ];
  const chain = input.chainSize ? promptRoom({
    ...base,
    sizes: [{ width: input.chainSize.width / k, height: input.chainSize.height / k }],
    prefer: { x: ARENA_CENTER.x, y: 100 },
    reserved: furniture,
  }) : null;
  const reserved = chain ? [...furniture, chain] : furniture;
  return {
    chain,
    panel: promptRoom({ ...base, reserved, sizes: grid(PANEL_HEIGHTS, PANEL_WIDTHS.filter((width) => width <= panelMax || width < 204)) }),
    bar: promptRoom({ ...base, reserved, sizes: grid(BAR_HEIGHTS, BAR_WIDTHS) }),
  };
}

/**
 * Some drawer/window combinations have no room for a readable strip. Reserve a row above the
 * scaled stage in that case, with a separate prompt room beside it.
 * The same decision is used for drawing and placement, including the recap after chain-end.
 */
export function chainStripInset(input: {
  layout: TableLayout;
  camera: CameraView;
  box: { width: number; height: number; screenWidth?: number };
  chainSize: { width: number; height: number } | null;
  meFooter: boolean;
}): number {
  if (!input.chainSize || !(input.box.width > 0) || !(input.box.height > 0)) return 0;
  const fit = { ...input.box, height: input.box.height * STAGE.height / 956 };
  const k = stageFit(fit);
  const spread = stageSpread(fit);
  const poses = seatPoses(input.layout, input.camera, fit);
  const wide = wideHoloAnchors(input.layout, input.camera, poses, spread, input.meFooter, { hint: { width: CAMERA_HINT.width / k, height: CAMERA_HINT.height / k } });
  const anchors = new Map(input.layout.slots.map(({ seat }) => [seat, wide?.get(seat) ?? holoAnchor(input.layout, seat, input.camera)]));
  const rooms = promptRooms({ ...input, poses, anchors, spread, k });
  return rooms.chain && rooms.panel && rooms.bar ? 0 : chainBandRooms(input.chainSize, input.box).height;
}

/** A shared row above the stage when its free rooms cannot hold both a chain and a prompt. Screen px. */
export function chainBandRooms(chain: { width: number; height: number }, box: { width: number }): {
  height: number; chain: PromptRoom; panel: PromptRoom; bar: PromptRoom;
} {
  const panelX = chain.width + 18;
  const width = Math.max(0, Math.min(420, box.width - panelX - 6));
  const height = Math.max(200, chain.height) + 12;
  return {
    height,
    chain: { x: 6, y: 4, ...chain },
    panel: { x: panelX, y: 6, width, height: 200 },
    bar: { x: panelX, y: 6, width, height: 130 },
  };
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
  /** True when the Deck Master chip under your panel must stay within the panel's own width (no room for the wider case). */
  footerTight?: boolean;
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
export function ringPose(layout: TableLayout, camera: CameraView, spread = 0): { x: number; y: number; scale: number } {
  if (arrangementOf(layout) === "duo") {
    if (camera.mode === "fly") return { x: 550, y: 430, scale: 1 };
    // The FINAL DUEL board: left of both wide fields, level with the gap between them.
    if (duoFinaleSlots(spread)) return { x: 60, y: 392, scale: 1 };
    return { x: 550, y: 322, scale: 1 };
  }
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
    if (isOwnFocus(layout, camera)) return OWN_FOCUS.ring;
    // Beside the docked rival's far side, so it never covers that field.
    const place = layout.slots.findIndex((slot) => slot.seat === camera.focusSeat);
    return { x: place === 2 ? 950 : 150, y: 404, scale: 0.62 };
  }
  return { x: 550, y: 322, scale: 1 };
}

/**
 * The two sizes of the phase hub strip, in stage px (the PhaseHub "table" variant draws exactly this, by the
 * `data-hub-size` of its wrapper). The stage is scaled to the window (about 0.79 at 1440 x 900).
 *   lg  chips 41px (32px on screen) with 13px labels, a wide lit chip with the phase's name, a caption line above.
 *   sm  chips 33px (26px) and 30px wide, the lit phase named in the caption.
 */
export const HUB_STRIP = {
  lg: { width: 389, height: 70 },
  sm: { width: 205, height: 61 },
} as const;
export type HubSize = keyof typeof HUB_STRIP;

export interface HubPose {
  /** Centre of the strip in stage px. */
  x: number;
  y: number;
  size: HubSize;
  width: number;
  height: number;
}

/** The ARENA 07 sign on the plaza (plaza.tsx), in stage px. The strip stays off it. */
export const ARENA_SIGN = { x: 517, y: 18, width: 66, height: 17 } as const;

/**
 * Where the phase hub strip stands in a camera mode. Each place was found by scanning the stage for a rectangle that
 * keeps 5px clear of every seat's field, hand and name label (see `seatObstacles`), 8px clear of every holo LP
 * plate (see `holoObstacle`; plates move with the camera), and clear of the ARENA 07 sign and the turn ring; the geometry test repeats the check, so a change to the poses fails loudly. In order of
 * preference: beside the ring; and, where the seats leave no room there, the open stage level with the top half of your
 * own field, to the right of it. Never over cards, hands or plates.
 * The strip is a flat overlay on the canvas: it never tilts with the world, so in the fly view it keeps the home place.
 */
export function hubPose(layout: TableLayout, camera: CameraView, view?: HubView): HubPose {
  const classic = classicHubPose(layout, camera);
  if (!view) return classic;
  // The fly-in view keeps the home place (the strip is a flat overlay and does not follow the camera).
  const home: CameraView = camera.mode === "fly" ? { ...camera, mode: "home" } : camera;
  const spread = stageSpread(view.box);
  const k = stageFit(view.box);
  if (!(spread > 0) || !(k > 0)) return classic;
  const poses = seatPoses(layout, home, view.box);
  const hint = { width: CAMERA_HINT.width / k, height: CAMERA_HINT.height / k };
  const hud = view.hud ? { width: view.hud.width / k, height: view.hud.height / k } : undefined;
  const plates = wideHoloAnchors(layout, home, poses, spread, view.meFooter === true, { hint, hud });
  // Only the home and look views are wide; the others keep the classic places (their boards and plates are the classic ones).
  if (!plates) return classic;
  return wideHubPose(layout, home, poses, plates, spread, view.meFooter === true, hint, classic, hud);
}

/** The table box (screen px, as TableStage measures it) the strip is placed for, and whether a Deck Master chip hangs under your plate. */
export interface HubView {
  box: { width: number; height: number; screenWidth?: number };
  meFooter?: boolean;
  /** The floating HUD's bottom right corner (HUD_CORNER, screen px): the plates and the strip stay off it, as TableStage places them. */
  hud?: { width: number; height: number };
}

/** Air kept around a seat (field, hand, name label) and around an LP plate, in stage px. */
export const HUB_AIR = { seat: 5, plate: 8 } as const;

/** Do two rotated rectangles overlap (separating axis test)? */
export function stageRectsOverlap(a: StageRect, b: StageRect): boolean {
  const corners = (r: StageRect) => {
    const rad = (r.rotateDeg * Math.PI) / 180;
    const c = Math.cos(rad);
    const sn = Math.sin(rad);
    return [[-r.width / 2, -r.height / 2], [r.width / 2, -r.height / 2], [r.width / 2, r.height / 2], [-r.width / 2, r.height / 2]].map(([x, y]) => ({ x: r.x + x * c - y * sn, y: r.y + x * sn + y * c }));
  };
  const pa = corners(a);
  const pb = corners(b);
  for (const poly of [pa, pb]) {
    for (let i = 0; i < 4; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % 4];
      const nx = q.y - p.y;
      const ny = p.x - q.x;
      const range = (pts: typeof pa) => {
        const v = pts.map((t) => t.x * nx + t.y * ny);
        return [Math.min(...v), Math.max(...v)];
      };
      const [a0, a1] = range(pa);
      const [b0, b1] = range(pb);
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}

/** Width of your hand's row under the stage at a wide table: the wide hand (762) with about 55 px of air. */
export const HAND_ROW_WIDTH = OWN_HAND_WIDE.width + 55;

/** What the strip must stay off at a wide table, as stage rectangles with their air already added. */
export function hubObstacles(
  layout: TableLayout,
  poses: ReadonlyMap<number, SeatPose>,
  plates: ReadonlyMap<number, Pick<HoloAnchor, "x" | "y" | "me" | "footerTight">>,
  meFooter: boolean,
  hint: { width: number; height: number },
  spread: number,
  ring: { x: number; y: number; scale: number },
): StageRect[] {
  const out: StageRect[] = [];
  const grow = (r: StageRect, air: number): StageRect => ({ ...r, width: r.width + air * 2, height: r.height + air * 2 });
  layout.slots.forEach((slot, place) => {
    const pose = poses.get(slot.seat);
    if (!pose || pose.hidden) return;
    for (const rect of seatObstacles(pose, place === 0)) out.push(grow(rect, HUB_AIR.seat));
  });
  for (const anchor of plates.values()) {
    // The plate is drawn as yours when its anchor says so (`me`; in the look view your own plate is a rival-sized one).
    let plate = holoObstacle(anchor);
    if (anchor.me && meFooter) {
      // Your Deck Master chip hangs under your plate: its room is part of it.
      const width = anchor.footerTight ? HOLO_ME.width : HOLO_MASTER_CHIP.width;
      const height = HOLO_ME.height + HOLO_MASTER_CHIP.height;
      plate = { x: anchor.x + width / 2, y: anchor.y + height / 2, width, height, rotateDeg: 0 };
    }
    out.push(grow(plate, HUB_AIR.plate));
  }
  out.push({ x: ARENA_SIGN.x + ARENA_SIGN.width / 2, y: ARENA_SIGN.y + ARENA_SIGN.height / 2, width: ARENA_SIGN.width, height: ARENA_SIGN.height, rotateDeg: 0 });
  // The turn ring, the same room the plates keep, and your hand's row under the stage and the camera hint.
  out.push({ x: ring.x, y: ring.y + 7, width: 124 * ring.scale + 16, height: 138 * ring.scale + 16, rotateDeg: 0 });
  out.push({ x: ARENA_CENTER.x, y: (STAGE.height - 4 + 960) / 2, width: HAND_ROW_WIDTH, height: 960 - (STAGE.height - 4), rotateDeg: 0 });
  const left = -spread + 6;
  out.push({ x: left - 6 + (hint.width + 6) / 2, y: 952 - hint.height / 2, width: hint.width + 6, height: hint.height, rotateDeg: 0 });
  return out;
}

/**
 * The strip at a wide table (home and look): the clear place nearest the turn ring (4-way) or your field (3-way). The visible
 * stage is the 1100 px stage plus `spread` at each side; the strip must stay inside it and keep the air of `hubObstacles` off
 * every board, hand, name label, plate, the ARENA 07 sign, the ring, your hand's row and the camera hint. The scan is
 * deterministic and only runs when a pose, a plate or the box changes. The classic place is the fallback if nothing is clear.
 */
function wideHubPose(
  layout: TableLayout,
  camera: CameraView,
  poses: ReadonlyMap<number, SeatPose>,
  plates: ReadonlyMap<number, HoloAnchor>,
  spread: number,
  meFooter: boolean,
  hint: { width: number; height: number },
  fallback: HubPose,
  hud?: { width: number; height: number },
): HubPose {
  const ring = ringPose(layout, camera, spread);
  const obstacles = hubObstacles(layout, poses, plates, meFooter, hint, spread, ring);
  if (hud) {
    const right = STAGE.width + spread;
    obstacles.push({ x: right - hud.width / 2, y: 952 - hud.height / 2, width: hud.width, height: hud.height, rotateDeg: 0 });
  }
  const size: HubSize = "sm";
  const { width, height } = HUB_STRIP[size];
  const l0 = -spread + 6 + width / 2;
  const r0 = STAGE.width + spread - 6 - width / 2;
  const t0 = 4 + height / 2;
  const b0 = 952 - height / 2;
  const step = 6;
  // 4-way: the clear place nearest the ring. 3-way: the rivals close in on the ring from both sides, so the strip stays by your
  // own field instead (its right side, level with the top quarter), the same place the classic table gives it.
  const mine = [...poses.values()].find((pose) => pose.slot === "home");
  const board = mine && arrangementOf(layout) !== "ffa4" ? boardBounds(mine) : null;
  const want = board ? { x: board.r + 12 + width / 2, y: board.t + (board.b - board.t) / 4 } : ring;
  const spots: Array<{ x: number; y: number; d: number }> = [];
  for (let x = l0; x <= r0; x += step) {
    for (let y = t0; y <= b0; y += step) spots.push({ x, y, d: Math.hypot(x - want.x, y - want.y) });
  }
  spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  for (const spot of spots) {
    const rect: StageRect = { x: spot.x, y: spot.y, width, height, rotateDeg: 0 };
    if (!obstacles.some((o) => stageRectsOverlap(o, rect))) return { x: spot.x, y: spot.y, size, width, height };
  }
  return fallback;
}

function classicHubPose(layout: TableLayout, camera: CameraView): HubPose {
  const ring = ringPose(layout, camera);
  let size: HubSize;
  let at: { x: number; y: number };
  if (layout.format === "ffa4") {
    if (camera.mode === "overview") {
      // Centred above the ring.
      size = "lg";
      at = { x: ring.x, y: 282 };
    } else if (camera.mode === "focus") {
      // The far rival's field and name fill the top row, so the strip stands right of your own small field instead, in the
      // gap between the right-hand rival's LP plate and yours.
      size = "sm";
      at = { x: 985, y: 636 };
    } else {
      // Right of the ring, between it and the right-hand rival.
      size = "sm";
      at = { x: 725, y: 342 };
    }
  } else if (camera.mode === "overview") {
    // Left of the ring, in the top row of the stage.
    size = "sm";
    at = { x: 384, y: 40 };
  } else if (camera.mode === "focus") {
    // Above the small ring beside the docked rival.
    size = "sm";
    at = isOwnFocus(layout, camera) ? OWN_FOCUS.hub : layout.slots.findIndex((slot) => slot.seat === camera.focusSeat) === 2 ? { x: 952, y: 326 } : { x: 109, y: 326 };
  } else {
    // Home, look and fly: the seats close in on the ring from every side, so the strip stands in the open stage right
    // of your own field, level with its top half and above your LP plate.
    size = "sm";
    at = { x: 988, y: 490 };
  }
  const { width, height } = HUB_STRIP[size];
  return { ...at, size, width, height };
}

/** A rotated rectangle in stage px: centre, size and turn. */
export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rotateDeg: number;
}

/**
 * Everything one seat draws, as rectangles on the stage: the 653 x 380 field, the hand hanging off its back edge
 * (your face-up hand is 605 wide and 116 deep, with room to grow, or 762 by 144 at a wide 3-way table, `OWN_HAND_WIDE`; a
 * rival's backs about 420 by 100 with their hover lift)
 * and the name label under the field's left side. The phase hub keeps clear of all three, so it never lands on cards.
 */
export function seatObstacles(pose: Pick<SeatPose, "x" | "y" | "scale" | "rotateDeg" | "width">, own: boolean): StageRect[] {
  const boxWidth = pose.width ?? SEAT_BOX.width;
  const r = (pose.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // A rect given in the seat's own frame (origin at the field centre, +y toward its back edge), placed on the stage.
  const rect = (lx: number, ly: number, width: number, height: number): StageRect => ({
    x: pose.x + (lx * cos - ly * sin) * pose.scale,
    y: pose.y + (lx * sin + ly * cos) * pose.scale,
    width: width * pose.scale,
    height: height * pose.scale,
    rotateDeg: pose.rotateDeg,
  });
  const wide = own && pose.width != null;
  const handW = wide ? OWN_HAND_WIDE.width : own ? 605 : 420;
  const handH = wide ? OWN_HAND_WIDE.height : own ? 116 : 100;
  return [
    rect(0, 0, boxWidth, 380),
    rect(0, 190 + handH / 2 - (wide ? OWN_HAND_WIDE.rise : 2), handW, handH),
    // Your name label stands left of the field at a wide 3-way table (field.module.css), else under its left side.
    wide ? rect(-boxWidth / 2 - 75, 190 + 14, 150, 28) : rect(-boxWidth / 2 + 0.17 * boxWidth, 190 + 14, 150, 28),
  ];
}

/**
 * The most a holo LP panel can cover: its anchor is the top left; it is 196 wide (212 for yours) and, with the clock, the
 * state line and "choosing..." all shown, about 122 tall (128), and a rival's Deck Master thumb rises 14 above it.
 */
export function holoObstacle(anchor: Pick<HoloAnchor, "x" | "y" | "me">): StageRect {
  const width = anchor.me ? 212 : 196;
  const height = (anchor.me ? 128 : 122) + (anchor.me ? 0 : 14);
  return { x: anchor.x + width / 2, y: anchor.y - (anchor.me ? 0 : 14) + height / 2, width, height, rotateDeg: 0 };
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
