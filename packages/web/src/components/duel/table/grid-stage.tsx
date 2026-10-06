"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent } from "react";
import { engineFormat } from "../multi-seat";
import { AttackLine } from "./attack-line";
import { boxOf, cancelTracks, FLIP_EASING, FLIP_MS, playFlip, type FlipTrack } from "./grid-flip";
import { FINALE_GLIDE_EASING, FINALE_GLIDE_MS } from "./grid-finale";
import { useGridFocus } from "./grid-focus";
import {
  cellIndex,
  cellState,
  gridCells,
  gridFocusLayout,
  gridWorld,
  HUD_CORNER,
  OUT_HOLD_MS,
  OVERLAP,
  PAIR_GAP,
  PAIR_LEFT,
  pairDrawer,
  type CellState,
  type GridCellRect,
  type GridRect,
} from "./grid-layout";
import { holoStatus, HoloLp } from "./holo-lp";
import { lastSeatDamage } from "./seat-state";
import { ExitingSeat, RivalField } from "./rival-field";
import { useSeatExits } from "./use-seat-exits";
import { LOCATION_HAND } from "../constants";
import { SEAT_Z } from "./geometry";
import { hexToRgbTriplet } from "./seat-angle";
import { bandHubFit } from "../phase-hub-model";
import { SEAT_TONE_HEX, type SeatFieldProps, type SeatPose, type SeatTone } from "./types";
import { useViewZoom } from "./use-view-zoom";
import { ViewReset } from "./view-reset";
import { followCss, visibleRect } from "./view-zoom";
import zoomStyles from "./view-zoom.module.css";
import type { TableStageViewProps } from "./table-stage";
import styles from "./grid-stage.module.css";

/**
 * How long each out seat has been out, as a cell state per seat. A seat that is out when the table opens is `empty`
 * at once; a seat that goes out while the table is open stays drawn as `out` (its field crumbles in its own cell)
 * for `OUT_HOLD_MS`, then the cell is empty. Cells never move.
 */
export function useCellStates(seats: readonly { seat: number; eliminated?: boolean; pendingElimination?: boolean }[]): ReadonlyMap<number, CellState> {
  const since = useRef(new Map<number, number | null>());
  const opened = useRef(false);
  const [tick, setTick] = useState(0);
  const now = Date.now();
  for (const view of seats) {
    if (view.eliminated !== true) since.current.delete(view.seat);
    else if (!since.current.has(view.seat)) since.current.set(view.seat, opened.current ? now : null);
  }
  const states = new Map<number, CellState>(seats.map((view) => [view.seat, cellState(view, since.current.get(view.seat) ?? null, now)]));
  // The next moment an `out` cell turns `empty`. Only seats still `out` count: a seat that is already empty has a
  // deadline in the past and would make the timer fire at once, without ever reaching the seat that is still out.
  let deadline: number | null = null;
  for (const view of seats) {
    const at = since.current.get(view.seat);
    if (states.get(view.seat) !== "out" || at == null) continue;
    deadline = deadline == null ? at + OUT_HOLD_MS : Math.min(deadline, at + OUT_HOLD_MS);
  }
  useEffect(() => {
    opened.current = true;
  }, []);
  useEffect(() => {
    if (deadline == null) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), Math.max(50, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [deadline, tick]);
  return states;
}

/** Natural height of the contents of a life plate (px) and the width it needs for five numerals; a smaller box shrinks them. */
const LP_NATURAL_HEIGHT = 90;
const LP_NATURAL_WIDTH = 130;
const lpFit = (rect: GridRect) => Math.min(1, rect.height / LP_NATURAL_HEIGHT, rect.width / LP_NATURAL_WIDTH);

/** A click on these keeps its own meaning; every other click on a field or life box focuses it. */
const OWN_CLICK = "button, a, input, select, textarea, [role='button'], [data-zones], [data-legal='true']";

/** What a legal pick is made of: a field pick (zones, cards on the board), a hand pick, or both (an open main phase). */
export type PickKind = "field" | "hand" | "mixed" | null;

export function pickKindOf(legalKeys: ReadonlySet<string>): PickKind {
  let hand = false;
  let field = false;
  for (const key of legalKeys) {
    if (key.split(":")[1] === String(LOCATION_HAND)) hand = true;
    else field = true;
    if (hand && field) return "mixed";
  }
  return field ? "field" : hand ? "hand" : null;
}

/** The pick bar as the room plans it (board px): its widest size and its height in one row, or stacked when narrow. */
export const PICK_BAR = { max: 420, row: 400, rowHeight: 92, stackHeight: 136, edge: 12, clear: 6 } as const;

const overlap = (a: GridRect, b: GridRect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * The size unit (px) of the modal prompts (option and effect lists, yes/no, card grid, positions, numbers, chain list)
 * in the 4-way grid: it follows the height of YOUR pair, so a prompt keeps to about one row band of the board on a small
 * screen. The finale board is larger than a pair, so it uses a larger divisor and its prompts do not grow with it. The
 * pick bar keeps the room unit (its look at 1920x1080 is the reference).
 */
export function promptUnit(height: number, finale: boolean): number {
  const unit = height / (finale ? PROMPT_UNIT.finale : PROMPT_UNIT.pair);
  return Math.round(Math.min(PROMPT_UNIT.max, Math.max(PROMPT_UNIT.min, unit)) * 100) / 100;
}
export const PROMPT_UNIT = { pair: 680, finale: 820, min: 0.72, max: 1.15 } as const;

/**
 * The room of the pick bar (zone and card picks on the board) in YOUR pair, as "x,y,width,height" for `data-bar-room`:
 * as near the middle of the pair as it can be (the band between the two fields, as in the 1v1 room), and never over a
 * target. `pair` is the frame of your pair (or the finale board, or the pair a spectator looks at); `targets` are the
 * boxes of every legal zone and card (board px). The bar is planned at its widest size, so a narrower bar is clear too.
 * When no place is clear (targets everywhere) the place that covers the least of them wins.
 */
export function pickBarRoom(pair: GridRect, targets: readonly GridRect[]): string | undefined {
  if (pair.width <= 0 || pair.height <= 0) return undefined;
  const width = Math.min(PICK_BAR.max, pair.width - 2 * PICK_BAR.edge);
  if (width < 200) return undefined;
  const height = Math.min(width < PICK_BAR.row ? PICK_BAR.stackHeight : PICK_BAR.rowHeight, pair.height - 2 * PICK_BAR.edge);
  const blocks = targets
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x: r.x - PICK_BAR.clear, y: r.y - PICK_BAR.clear, width: r.width + 2 * PICK_BAR.clear, height: r.height + 2 * PICK_BAR.clear }));
  const centreX = pair.x + pair.width / 2;
  const centreY = pair.y + pair.height / 2;
  const reachX = Math.max(0, (pair.width - width) / 2 - PICK_BAR.edge);
  const reachY = Math.max(0, (pair.height - height) / 2 - PICK_BAR.edge);
  let best = null as { box: GridRect; cover: number; far: number } | null;
  // Steps out from the middle; up before down at the same distance (the half of the pair in front of you).
  for (let dy = 0; dy <= reachY; dy += 4) {
    for (const sy of dy === 0 ? [0] : [-1, 1]) {
      for (let dx = 0; dx <= reachX; dx += 8) {
        for (const sx of dx === 0 ? [0] : [-1, 1]) {
          const box = { x: centreX + sx * dx - width / 2, y: centreY + sy * dy - height / 2, width, height };
          const cover = blocks.reduce((sum, r) => sum + overlap(box, r), 0);
          const far = Math.hypot(dx, dy);
          if (!best || cover < best.cover || (cover === best.cover && far < best.far)) best = { box, cover, far };
        }
      }
      if (best && best.cover === 0 && best.far <= dy) break;
    }
    if (best && best.cover === 0 && best.far <= dy) break;
  }
  if (!best) return undefined;
  return [best.box.x, best.box.y, best.box.width, best.box.height].map(Math.round).join(",");
}

/**
 * The frame of a pair: ONE mat round the fields of a column that are still in (both halves and the shared Extra Monster
 * row between them), so the pair reads as one field. Its turn light and the light of the lifted pair are on it, never
 * on one half. A pair that loses a seat breaks: the frame shrinks to the field that is left. On the finale board the
 * frame of the bottom seat's column is the frame of the whole board; the other one fades.
 */
export function pairFrameRect(spots: readonly GridRect[]): GridRect | null {
  if (spots.length === 0) return null;
  const x = Math.min(...spots.map((r) => r.x));
  const y = Math.min(...spots.map((r) => r.y));
  return { x, y, width: Math.max(...spots.map((r) => r.x + r.width)) - x, height: Math.max(...spots.map((r) => r.y + r.height)) - y };
}

interface FrameTrack {
  rect: GridRect;
  anim: Animation | null;
}

/** Moves a frame box from where it shows now to its new rect by its own left, top, width and height (its line stays sharp). */
function moveFrame(el: HTMLElement, tracks: Map<string, FrameTrack>, key: string, next: GridRect, animate: boolean, duration: number, easing: string, origin: DOMRect) {
  const track = tracks.get(key);
  const running = track?.anim != null && track.anim.playState === "running" ? el.getBoundingClientRect() : null;
  track?.anim?.cancel();
  const from = running ? { x: running.left - origin.left, y: running.top - origin.top, width: running.width, height: running.height } : track?.rect;
  const rest: FrameTrack = { rect: next, anim: null };
  tracks.set(key, rest);
  if (!animate || !from || typeof el.animate !== "function") return;
  if (Math.abs(from.x - next.x) < 0.5 && Math.abs(from.y - next.y) < 0.5 && Math.abs(from.width - next.width) < 0.5 && Math.abs(from.height - next.height) < 0.5) return;
  const px = (r: GridRect) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  rest.anim = el.animate([px(from), px(next)], { duration, easing });
}

const sameRects = (a: readonly GridRect[], b: readonly GridRect[]) =>
  a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height);

/** The pose of a seat that left, for its crumble: the centre of its box, upright size, turned like its field. */
const exitPose = (seat: number, spot: GridCellRect, rotateDeg: 0 | 180): SeatPose => ({
  seat,
  x: spot.rect.x + spot.rect.width / 2,
  y: spot.rect.y + spot.rect.height / 2,
  scale: 1,
  rotateDeg,
  z: spot.z,
  docked: false,
  compact: false,
  hidden: false,
});

/** The 4-way table as two columns of facing fields that share an Extra Monster row (see grid-layout.ts). */
export function GridStage({ controller, layout, camera, renderSeatField, fx, promptCenter, overlay, wantMode, locked = false, grid, placeLabels, gridFinale = null, gridHub, hubPlace = "band" }: TableStageViewProps) {
  const { engine, room, viewerSeat, nameOf, legalKeys, selectedKeys, reducedMotion } = controller;
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  // In the floating HUD the board runs to the right edge of the screen, under the corner of turn controls: the layout
  // keeps that corner clear of every field (HUD_CORNER in grid-layout.ts).
  const [hud, setHud] = useState(false);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const read = () => setBox((prev) => {
      const next = { width: node.clientWidth, height: node.clientHeight };
      return prev.width === next.width && prev.height === next.height ? prev : next;
    });
    read();
    setHud(node.closest('[data-hud="true"]') != null);
    const observer = new ResizeObserver(read);
    observer.observe(node);
    window.addEventListener("resize", read);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", read);
    };
  }, []);

  const masterRule = room.session.masterRule;
  const world = useMemo(() => gridWorld(masterRule), [masterRule]);
  const cells = useMemo(() => gridCells(layout), [layout]);
  const tones = useMemo(() => new Map<number, SeatTone>(layout.slots.map((slot) => [slot.seat, slot.tone])), [layout.slots]);
  const states = useCellStates(engine.seats);
  const homeCell = cells.find((cell) => cell.home);
  const shown = useMemo(() => cells.filter((cell) => (states.get(cell.seat) ?? "live") !== "empty").map((cell) => cell.seat), [cells, states]);

  // The shell owns the focus (the turn strip drives it too). A stage that is rendered alone keeps its own.
  const picks = controller.seatPick;
  const local = useGridFocus({
    enabled: grid == null,
    home: homeCell?.seat ?? 0,
    shown,
    suspended: false,
    digitsFree: picks == null && controller.aim?.from == null,
    escapeFree: controller.aim?.from == null,
  });
  const focusControl = grid ?? local;
  const { focus } = focusControl;
  const focusCell = focus.seat != null ? cells.find((cell) => cell.seat === focus.seat) ?? null : null;

  // A seat pick shows every life plate (they are the targets, with their keys), so the camera steps back for it and
  // returns to the field it left when the pick is over.
  const picking = picks != null;
  const resume = useRef<number | null>(null);
  const live = useRef({ seat: focus.seat, control: focusControl });
  live.current = { seat: focus.seat, control: focusControl };
  // A layout effect: the step back to all fields lands in the frame the pick opens, with no frame of the old focus.
  useLayoutEffect(() => {
    const { seat, control } = live.current;
    if (picking) {
      if (seat != null) {
        resume.current = seat;
        control.showAll();
      }
    } else if (resume.current != null) {
      const back = resume.current;
      resume.current = null;
      if (seat == null) control.focusSeat(back);
    }
  }, [picking]);

  // The final layout, once. The fields get real sizes from it (never a zoom); a change of focus only FLIPs between two layouts.
  // Only a seat in the duel draws a field: one that is out crumbles (see `useSeatExits`) and leaves an outline.
  const homeColumn = homeCell?.column ?? null;
  const gone = (seat: number) => (states.get(seat) ?? "live") !== "live";
  const drawerSeats = ([0, 1] as const).map((column) => pairDrawer(cells, states, column));
  const drawerRow = ([0, 1] as const).map((column) => cells.find((cell) => cell.seat === drawerSeats[column])?.row ?? 1) as [0 | 1, 0 | 1];
  const drawerKey = drawerRow.join("");
  // The finale board: the last two seats in the middle, as on the 1v1 table (see grid-finale.ts).
  const finaleBottom = gridFinale ? cells.find((cell) => cell.seat === gridFinale.bottom) ?? null : null;
  const finaleTop = gridFinale ? cells.find((cell) => cell.seat === gridFinale.top) ?? null : null;
  const finale = finaleBottom && finaleTop && gridFinale ? { kind: gridFinale.kind, bottom: finaleBottom, top: finaleTop } : null;
  const finaleKey = finale ? `${finale.kind}:${finale.bottom.seat}:${finale.top.seat}` : null;
  const inFinale = (seat: number) => finale != null && (finale.bottom.seat === seat || finale.top.seat === seat);
  const layoutBox = useMemo(() => {
    if (box.width <= 0 || box.height <= 0) return null;
    const ends = finaleKey ? finaleKey.split(":") : null;
    const bottom = ends ? cells.find((cell) => cell.seat === Number(ends[1])) : undefined;
    const top = ends ? cells.find((cell) => cell.seat === Number(ends[2])) : undefined;
    return gridFocusLayout(world, box, focusCell, {
      homeColumn,
      drawerRow: drawerKey.split("").map(Number) as [0 | 1, 0 | 1],
      finale: bottom && top ? { bottom, top, homeHand: bottom.home } : null,
      corner: hud ? HUD_CORNER : null,
    });
  }, [box, cells, drawerKey, finaleKey, focusCell, homeColumn, world, hud]);
  const placed = layoutBox;

  // The pair frames (see `pairFrameRect`): the live fields of each column, or the whole finale board.
  const frameOf = (column: 0 | 1): GridRect | null => {
    if (!placed) return null;
    // On the finale board: the whole board; the other column's frame stays where it was while it fades.
    if (finale && placed.finale && finale.bottom.column === column) return placed.finale.frame;
    const spots = finale ? placed.regular : placed.cells;
    return pairFrameRect(cells.filter((cell) => cell.column === column && !gone(cell.seat)).map((cell) => spots[cellIndex(cell)].rect));
  };
  const frames = [frameOf(0), frameOf(1)] as const;
  const frameKey = frames.map((r) => (r ? `${r.x},${r.y},${r.width},${r.height}` : "-")).join("|");

  const tracks = useRef(new Map<string, FlipTrack>());
  // A field that turns on its way (the finale board) draws its labels and card faces for its old turn during the first
  // half of the move, then for the new one: its text never shows upside down while the field spins.
  const [lateTurns, setLateTurns] = useState<ReadonlyMap<number, 0 | 180> | null>(null);
  const turnTimer = useRef<number | undefined>(undefined);
  const frameTracks = useRef(new Map<string, FrameTrack>());
  const lastBox = useRef({ width: 0, height: 0 });
  const lastFinale = useRef<string | null>(finaleKey);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !placed) return;
    const resized = lastBox.current.width !== box.width || lastBox.current.height !== box.height;
    lastBox.current = { width: box.width, height: box.height };
    const toFinale = lastFinale.current !== finaleKey;
    lastFinale.current = finaleKey;
    const animate = !resized && !reducedMotion;
    const seen = new Set<string>();
    const move = (key: string, el: HTMLElement | null, rect: GridRect, turn: 0 | 180, fadeText: boolean, finaleMove: boolean) => {
      if (!el) return null;
      seen.add(key);
      const options = finaleMove ? { turn, fadeText, duration: FINALE_GLIDE_MS, easing: FINALE_GLIDE_EASING } : { turn, fadeText };
      const track = playFlip(el, tracks.current.get(key), boxOf(rect), animate, options);
      tracks.current.set(key, track);
      return track;
    };
    const turned = new Map<number, 0 | 180>();
    for (const cell of cells) {
      const spot = placed.cells[cellIndex(cell)];
      const glide = toFinale;
      const before = tracks.current.get(`f${cell.seat}`)?.turn;
      const track = move(`f${cell.seat}`, root.querySelector<HTMLElement>(`[data-seat-slot="${cell.seat}"]`), spot.rect, spot.turn, false, glide);
      if (track?.anim && before != null && before !== spot.turn) turned.set(cell.seat, before);
      move(`l${cell.seat}`, root.querySelector<HTMLElement>(`[data-grid-lp="${cell.seat}"]`), spot.plate, 0, true, glide);
    }
    const origin = root.getBoundingClientRect();
    for (const column of [0, 1] as const) {
      const el = root.querySelector<HTMLElement>(`[data-pair-frame="${column}"]`);
      const rect = frames[column];
      if (!el || !rect) continue;
      moveFrame(el, frameTracks.current, `p${column}`, rect, animate, toFinale ? FINALE_GLIDE_MS : FLIP_MS, toFinale ? FINALE_GLIDE_EASING : FLIP_EASING, origin);
    }
    for (const key of [...tracks.current.keys()]) {
      if (seen.has(key)) continue;
      cancelTracks([tracks.current.get(key)!]);
      tracks.current.delete(key);
    }
    if (turned.size > 0) {
      window.clearTimeout(turnTimer.current);
      setLateTurns(turned);
      turnTimer.current = window.setTimeout(() => setLateTurns(null), (toFinale ? FINALE_GLIDE_MS : FLIP_MS) / 2);
    } else {
      // Any other run (a resize, reduced motion, a new focus) ends a turn that was under way: the field stands at its
      // new turn at once, so its faces turn with it.
      window.clearTimeout(turnTimer.current);
      setLateTurns(null);
    }
    // The frames are read from `frameKey`; a seat that goes out changes them without a new layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, box.width, box.height, cells, reducedMotion, finaleKey, frameKey]);
  useEffect(() => {
    const live = tracks.current;
    return () => {
      cancelTracks(live.values());
      window.clearTimeout(turnTimer.current);
    };
  }, []);

  // The seat fields are memoized: a field is drawn again only when something in it changes, never for a move or a
  // resize. The pair prop is an object, so the same values give the same object.
  const pairs = useRef(new Map<number, NonNullable<SeatFieldProps["pair"]>>());
  const stablePair = (seat: number, next: NonNullable<SeatFieldProps["pair"]>) => {
    const had = pairs.current.get(seat);
    if (had && had.other === next.other && had.left === next.left && had.right === next.right && had.gap === next.gap && had.joined === next.joined && had.framed === next.framed) return had;
    pairs.current.set(seat, next);
    return next;
  };

  // The crumble of a seat that leaves: its last board, drawn at the box it had, cut where the shared row begins.
  const outSeats = useMemo(() => engine.seats.filter((view) => view.eliminated === true).map((view) => view.seat), [engine.seats]);
  const poses = new Map<number, SeatPose>();
  if (placed) for (const cell of cells) poses.set(cell.seat, exitPose(cell.seat, placed.cells[cellIndex(cell)], placed.cells[cellIndex(cell)].turn));
  const exitState = useSeatExits({
    out: outSeats,
    seats: engine.seats,
    poses,
    faceUpHand: (seat) => seat === viewerSeat,
    enabled: true,
    resetKey: `${room.session.slug}:${room.series?.gameNumber ?? 0}`,
  });
  // An outline that waits for the crumble, or one that is there at once (a seat that was out when the table opened).
  const lateOutline = useRef(new Map<number, boolean>());
  for (const seat of outSeats) if (!lateOutline.current.has(seat)) lateOutline.current.set(seat, exitState.exits.some((exit) => exit.seat === seat));
  for (const seat of [...lateOutline.current.keys()]) if (!outSeats.includes(seat)) lateOutline.current.delete(seat);

  // Zoom and pan of the board (view-zoom.ts): the fields zoom, the life plates, the hub and the prompts stay. A new
  // focus, a seat that goes out or the final duel resets it.
  const zoom = useViewZoom({ rootRef, layerRef, enabled: placed != null, reducedMotion, resetKey: `${focus.seat ?? "all"}|${finaleKey ?? ""}|${outSeats.join(",")}` });

  // A focused seat that goes out stays in focus while its field crumbles, then the focus goes home (grid-focus.ts).
  const crumbling = useMemo(() => exitState.exits.map((exit) => exit.seat), [exitState.exits]);
  const { hold } = focusControl;
  useLayoutEffect(() => {
    hold(crumbling);
  }, [hold, crumbling]);

  const pickOrder = picks ? layout.slots.map((slot) => slot.seat).filter((seat) => picks.options.has(seat)) : [];
  const promptSeat = controller.prompt?.seat ?? null;
  const format = engineFormat(engine);
  const attackerSeat = controller.aim?.from ? Number(controller.aim.from.split(":")[0]) : null;
  const attackerTone = (attackerSeat != null ? tones.get(attackerSeat) : null) ?? "violet";
  const pickKind = pickKindOf(legalKeys);

  const focusOn = (seat: number) => {
    if (focus.seat !== seat) focusControl.focusSeat(seat);
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(OWN_CLICK)) return;
    const host = target.closest<HTMLElement>("[data-grid-cell], [data-grid-lp]");
    const seat = host ? Number(host.dataset.gridCell ?? host.dataset.gridLp) : NaN;
    if (Number.isInteger(seat)) focusOn(seat);
  };
  // Tab into a field that is out of view brings it into view.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (focus.seat == null) return;
    const target = event.target as HTMLElement;
    let keyboard = false;
    try {
      keyboard = target.matches(":focus-visible");
    } catch {
      keyboard = false;
    }
    if (!keyboard) return;
    const host = target.closest<HTMLElement>("[data-grid-cell], [data-grid-lp]");
    const seat = host ? Number(host.dataset.gridCell ?? host.dataset.gridLp) : NaN;
    if (Number.isInteger(seat)) focusOn(seat);
  };

  // The phase hub: in the band of the pair that shares the Extra Monster row (yours, else the finale pair, else any
  // that is still drawn), or in the middle of the table between the pairs.
  const hubColumn: 0 | 1 | null = finale?.bottom.column ?? (homeColumn != null && drawerSeats[homeColumn] != null ? homeColumn : drawerSeats[0] != null ? 0 : drawerSeats[1] != null ? 1 : null);
  // Its chips stay in the free cells beside the Extra Monster Zones (five columns, 0.075 z apart): a pair side by side
  // where it fits, else stacked (see bandHubFit). On the finale board: the bottom seat's row of that board.
  const hubBand = placed && hubColumn != null ? placed.finale?.band ?? placed.bands[hubColumn] : null;
  const hubFit = hubBand ? bandHubFit(hubBand.z, (hubBand.rect.width - 4 * hubBand.z * 0.075) / 5) : null;
  const hubStyle = ((): CSSProperties | null => {
    if (!placed || !gridHub) return null;
    if (hubPlace === "center" && finale == null) {
      const left = placed.cells[0].rect;
      const right = placed.cells[2].rect;
      const gutterX = (left.x + left.width + right.x) / 2;
      const line = placed.bands[0].rect.y + placed.bands[0].rect.height / 2;
      // Under a zoom it keeps its size and follows the gutter (followCss).
      return zoom.zoomed
        ? { left: followCss(gutterX, gutterX, "x"), top: followCss(line, line, "y"), ["--hub-z" as string]: `${placed.bands[0].z}px` }
        : { left: gutterX, top: line, ["--hub-z" as string]: `${placed.bands[0].z}px` };
    }
    if (hubColumn == null) return null;
    const band = placed.finale?.band ?? placed.bands[hubColumn];
    const z = band.z;
    const fit = { width: band.rect.width, height: band.rect.height, ["--z" as string]: `${z}px`, ["--g" as string]: `${z * 0.075}px`, ["--hub-hc" as string]: `${hubFit?.chip ?? 0}px` };
    // The chips of a band sit in the free cells beside the Extra Monster Zones: under a zoom they grow with the board, so
    // they stay in those cells and off the zones and their markers.
    return zoom.zoomed
      ? { ...fit, left: followCss(band.rect.x, band.rect.x, "x"), top: followCss(band.rect.y, band.rect.y, "y"), scale: "var(--vz-s, 1)", transformOrigin: "0 0" }
      : { ...fit, left: band.rect.x, top: band.rect.y };
  })();

  // Every prompt sits in the middle of YOUR pair (the half of the table where your field is), as the 1v1 room puts it in
  // the middle of the board: on the finale board the middle of that board; a spectator's, the pair in focus (else the
  // middle of the table). The prompt slot carries that box as --pr-* (board px) for the panels and the yes/no bar.
  const promptColumn: 0 | 1 | null = finale ? finale.bottom.column : viewerSeat != null ? homeColumn : focusCell?.column ?? null;
  const pairFrame = promptColumn != null ? frames[promptColumn] : null;
  // Under a zoom the prompts keep their size and sit in the part of that pair that is on the screen (the whole board
  // when none of it is); the pick bar plans its room there too, from the targets as they show after the zoom.
  const promptPair = pairFrame && zoom.zoomed ? visibleRect(zoom.view, pairFrame, box) ?? { x: 0, y: 0, width: box.width, height: box.height } : pairFrame;
  const promptStyle = promptPair && pairFrame
    ? ({
        ["--pr-cx" as string]: `${Math.round(promptPair.x + promptPair.width / 2)}px`,
        ["--pr-cy" as string]: `${Math.round(promptPair.y + promptPair.height / 2)}px`,
        ["--pr-w" as string]: `${Math.round(promptPair.width)}px`,
        ["--pr-h" as string]: `${Math.round(promptPair.height)}px`,
        ["--pr-unit" as string]: `${promptUnit(pairFrame.height, finale != null)}px`,
      } as CSSProperties)
    : undefined;

  // The pick bar (zone and card picks) is in that pair too, near its middle, and never over a target: the boxes of the
  // legal zones and cards are measured when the targets change and again once the fields stand still (a FLIP or the
  // finale glide moves them). The prompt reads `data-bar-room` as "x,y,width,height" in board pixels and follows it.
  const [targets, setTargets] = useState<readonly GridRect[]>([]);
  const legalKey = [...legalKeys].sort().join(",");
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !placed) return;
    const measure = () => {
      const board = root.getBoundingClientRect();
      const next = Array.from(root.querySelectorAll<HTMLElement>('[data-legal="true"]'))
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({ x: Math.round(r.left - board.left), y: Math.round(r.top - board.top), width: Math.round(r.width), height: Math.round(r.height) }));
      setTargets((current) => (sameRects(current, next) ? current : next));
    };
    const frame = window.requestAnimationFrame(measure);
    const timer = window.setTimeout(measure, reducedMotion ? 0 : Math.max(FLIP_MS, FINALE_GLIDE_MS) + 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [placed, legalKey, reducedMotion, zoom.view]);
  const barRoom = useMemo(() => (promptPair ? pickBarRoom(promptPair, targets) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [promptPair?.x, promptPair?.y, promptPair?.width, promptPair?.height, targets]);

  return (
    <div
      ref={rootRef}
      className={styles.board}
      data-bar-room={barRoom}
      data-prompt-scope
      data-table-stage={layout.format}
      data-grid-stage="true"
      data-grid-focus={focus.seat ?? "all"}
      data-grid-finale={finale?.kind}
      data-format={format}
      data-camera-mode={camera.mode}
      data-camera-want={wantMode ?? camera.mode}
      data-camera-lock={locked ? "true" : undefined}
      data-fly="false"
      data-upright={camera.upright ? "true" : "false"}
      data-stage-scale={((placed?.sizes.equal ?? 0) / SEAT_Z).toFixed(3)}
      data-ready={placed ? "true" : "false"}
      data-battle={engine.phase === "battle" ? "true" : undefined}
      data-pick-kind={pickKind ?? undefined}
    >
      <div className={styles.world} onClick={onClick} onFocusCapture={onFocus}>
        <div ref={layerRef} className={zoomStyles.layer} data-view-layer>
          {placed
            ? ([0, 1] as const).map((column) => {
            const rect = frames[column];
            if (!rect) return null;
            const members = finale && finale.bottom.column === column ? [finale.bottom.seat, finale.top.seat] : cells.filter((cell) => cell.column === column).map((cell) => cell.seat);
            const turnSeat = engine.turnSeat != null && members.includes(engine.turnSeat) && !gone(engine.turnSeat) ? engine.turnSeat : null;
            const turnTone = turnSeat != null ? tones.get(turnSeat) : undefined;
            const faded = finale != null && finale.bottom.column !== column;
            const lifted = finale == null && focus.seat != null && cells.some((cell) => cell.column === column && cell.seat === focus.seat);
            return (
              <div
                key={`frame${column}`}
                className={styles.frame}
                data-pair-frame={column}
                data-focus={lifted ? "true" : undefined}
                data-turn={turnTone ? "true" : undefined}
                data-gone={faded ? "true" : undefined}
                aria-hidden="true"
                style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, ...(turnTone ? { ["--t" as string]: hexToRgbTriplet(SEAT_TONE_HEX[turnTone].main) } : {}) }}
              />
            );
              })
            : null}
          {placed && finale == null
            ? ([0, 1] as const).map((column) => {
            // The break of a pair: a seam flashes on the edge where the field that went out was joined.
            const inColumn = cells.filter((cell) => cell.column === column);
            const left = inColumn.filter((cell) => !gone(cell.seat));
            const broken = inColumn.find((cell) => (states.get(cell.seat) ?? "live") === "out");
            if (left.length !== 1 || !broken || reducedMotion) return null;
            const rest = placed.cells[cellIndex(left[0])].rect;
            const y = left[0].row === 1 ? rest.y : rest.y + rest.height;
            const tone = tones.get(broken.seat);
            return (
              <div
                key={`seam${broken.seat}`}
                className={styles.seam}
                data-pair-break={column}
                aria-hidden="true"
                style={{ left: rest.x, top: y, width: rest.width, ...(tone ? { ["--t" as string]: hexToRgbTriplet(SEAT_TONE_HEX[tone].main) } : {}) }}
              />
            );
              })
            : null}
          {placed
            ? cells.map((cell) => {
            const slot = layout.slots.find((entry) => entry.seat === cell.seat);
            const state = states.get(cell.seat) ?? "live";
            if (!slot) return null;
            const spot = placed.cells[cellIndex(cell)];
            const pose: SeatPose = {
              seat: cell.seat,
              x: 0,
              y: 0,
              scale: spot.z / SEAT_Z,
              rotateDeg: spot.turn,
              z: spot.z,
              docked: false,
              compact: false,
              hidden: false,
            };
            const out = state !== "live";
            const self = slot.relation === "self";
            const drawer = drawerSeats[cell.column];
            // On a cross finale board each field draws its own Extra Monster row (the two seats share no zone).
            const emz = finale?.kind === "cross" && inFinale(cell.seat) ? "own" : drawer === cell.seat ? "pair" : "none";
            const field: Omit<SeatFieldProps, "angleDeg" | "scale"> = {
              engine,
              seat: cell.seat,
              viewerSeat,
              masterRule,
              side: cell.home ? "you" : "opp",
              upright: camera.upright,
              tone: slot.tone,
              density: "full",
              hand: self ? "face" : "backs",
              emz,
              pair: stablePair(cell.seat, {
                other: cell.partner,
                left: PAIR_LEFT,
                right: 0,
                gap: PAIR_GAP,
                joined: (states.get(cell.partner) ?? "live") === "live",
                framed: true,
              }),
              showTally: false,
              usable: slot.relation === "self" || slot.relation === "opponent",
              name: nameOf(cell.seat),
              legalKeys,
              selectedKeys,
              reducedMotion,
              onActivate: controller.onActivate,
              onInspect: controller.onInspect,
              onHoverCard: controller.onHoverCard,
            };
            const exitRow = exitState.exits.find((entry) => entry.seat === cell.seat);
            // In the finale the seats that left are gone from the table; the last one out keeps its outline on the board.
            const outline = out && (finale == null || inFinale(cell.seat)) ? placed.cells[cellIndex(cell)].own : null;
            return (
              <div
                key={cell.seat}
                className={styles.cell}
                data-grid-cell={cell.seat}
                data-quadrant={cell.quadrant}
                data-cell-state={state}
                data-small={spot.small ? "true" : undefined}
                data-focus={focus.seat === cell.seat ? "true" : undefined}
                data-partner={cell.home ? cell.partner : undefined}
                role="group"
                aria-label={`${nameOf(cell.seat)}${self ? " (you)" : ""}, field${focus.seat === cell.seat ? ", in focus" : ""}${out ? ", out of the duel" : ""}`}
              >
                {out ? null : (
                  <RivalField
                    pose={pose}
                    angleOffsetDeg={(lateTurns?.get(cell.seat) ?? spot.turn) - spot.turn}
                    field={field}
                    render={renderSeatField}
                    placement={{
                      left: spot.rect.x,
                      top: spot.rect.y,
                      zIndex: focus.seat === cell.seat ? 30 : spot.drawer ? 14 : 10,
                      small: spot.small,
                      lh: spot.lh,
                      boxX: self ? spot.rect.x : undefined,
                      handShift: spot.hand.shift,
                      handWidth: spot.hand.width,
                    }}
                  />
                )}
                {exitRow ? (
                  <ExitingSeat
                    pose={exitPose(cell.seat, spot, spot.turn)}
                    tone={slot.tone}
                    view={exitRow.view}
                    masterRule={masterRule}
                    faceUpHand={exitRow.faceUpHand}
                    reducedMotion={reducedMotion}
                    clipTop={finale?.kind === "cross" && inFinale(cell.seat) ? 0 : OVERLAP * spot.z}
                    onDone={() => exitState.finish(cell.seat)}
                  />
                ) : null}
                {outline ? (
                  <div
                    className={styles.outline}
                    data-out-outline={cell.seat}
                    data-late={lateOutline.current.get(cell.seat) ? "true" : undefined}
                    data-tone={slot.tone}
                    style={{ left: outline.x, top: outline.y, width: outline.width, height: outline.height, ["--z" as string]: `${spot.z}px` }}
                  >
                    <span>{nameOf(cell.seat)} · OUT</span>
                  </div>
                ) : null}
              </div>
            );
              })
            : null}
        </div>
          {placed
            ? cells.map((cell) => {
            const view = engine.seats.find((entry) => entry.seat === cell.seat);
            const slot = layout.slots.find((entry) => entry.seat === cell.seat);
            if (!view || !slot) return null;
            const lp = placed.cells[cellIndex(cell)].plate;
            // Under a zoom the plate keeps its size and follows the middle of its place on the board (followCss).
            const lpStyle: CSSProperties = zoom.zoomed
              ? { left: followCss(lp.x, lp.x + lp.width / 2, "x"), top: followCss(lp.y, lp.y + lp.height / 2, "y"), width: lp.width, height: lp.height }
              : { left: lp.x, top: lp.y, width: lp.width, height: lp.height };
            const pickable = picks?.options.has(cell.seat) === true;
            const index = pickOrder.indexOf(cell.seat);
            return (
              <div
                key={cell.seat}
                className={styles.lp}
                data-grid-lp={cell.seat}
                data-lp-side={inFinale(cell.seat) ? "left" : undefined}
                data-gone={finale != null && !inFinale(cell.seat) ? "true" : undefined}
                style={lpStyle}
              >
                <HoloLp
                  seat={cell.seat}
                  name={nameOf(cell.seat)}
                  tone={slot.tone}
                  lp={view.lp}
                  handCount={view.hand.length}
                  deckCount={view.deckCount}
                  clockMs={room.clock?.remainingMs[cell.seat] ?? null}
                  status={holoStatus(engine, cell.seat, promptSeat)}
                  me={slot.relation === "self"}
                  x={0}
                  y={0}
                  fit={lpFit(lp)}
                  beam="none"
                  master={slot.relation === "self" ? null : view.deckMaster?.card ?? null}
                  onInspectMaster={(card) => controller.onInspect({ type: "info", card })}
                  lastDamage={lastSeatDamage(engine.events, cell.seat)}
                  legal={pickable}
                  hotkey={pickable && index >= 0 ? index + 1 : null}
                  onPick={() => picks?.onPick(cell.seat)}
                  onHover={(hover) => controller.onAim?.(hover ? { lpSeat: cell.seat } : null)}
                  placeLabel={placeLabels?.get(cell.seat) ?? null}
                  reducedMotion={reducedMotion}
                />
              </div>
            );
              })
            : null}
          {hubStyle && gridHub ? (
            <div className={styles.hub} data-grid-hub={hubPlace === "center" && finale == null ? "center" : "band"} data-hub-fit={hubPlace === "center" && finale == null ? undefined : hubFit?.mode} style={hubStyle}>
              {gridHub(hubPlace === "center" && finale == null ? "center" : "band")}
            </div>
          ) : null}
      </div>
      {controller.aim?.from ? <AttackLine aim={controller.aim} tone={attackerTone} stageWidth={box.width} stageHeight={box.height} /> : null}
      <div className={styles.live} role="status" aria-live="polite" data-grid-live>
        {focus.seat == null ? "Focus: all fields" : `Focus: ${nameOf(focus.seat)}`}
      </div>
      <div className={styles.controls} role="group" aria-label="Table view" data-grid-controls>
        <button type="button" className={styles.control} data-testid="grid-all" aria-pressed={focus.seat == null} aria-keyshortcuts="O Escape" title="All fields (O or Esc)" onClick={focusControl.showAll}>
          All fields
        </button>
      </div>
      <ViewReset zoomed={zoom.zoomed} scale={zoom.view.s} onReset={zoom.reset} style={{ right: 10, top: 44 }} />
      {fx ? <div className={styles.slot} data-slot="fx">{fx}</div> : null}
      {promptCenter ? <div className={styles.slot} data-slot="prompt" data-seat-pick={picks ? "true" : undefined} data-prompt-pair={promptPair ? promptColumn ?? undefined : undefined} data-prompt-dense={promptPair ? "true" : undefined} style={promptStyle}>{promptCenter}</div> : null}
      {overlay ? <div className={styles.slot} data-slot="overlay">{overlay}</div> : null}
    </div>
  );
}
