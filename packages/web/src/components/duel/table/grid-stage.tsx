"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent } from "react";
import { engineFormat } from "../multi-seat";
import { AttackLine } from "./attack-line";
import { boxOf, cancelTracks, FLIP_MS, playFlip, type FlipTrack } from "./grid-flip";
import { FINALE_GLIDE_EASING, FINALE_GLIDE_MS } from "./grid-finale";
import { useGridFocus } from "./grid-focus";
import {
  cellIndex,
  cellState,
  gridCells,
  gridFocusLayout,
  gridWorld,
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
import { LOCATION_HAND, LOCATION_MZONE } from "../constants";
import { SEAT_Z } from "./geometry";
import type { SeatFieldProps, SeatPose, SeatTone } from "./types";
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

/** True when a legal or selected key is an Extra Monster Zone (a monster zone of sequence 5 or 6): the phase hub over
 *  the shared band then lets the click through to it. */
export function picksExtraZone(keys: Iterable<string>): boolean {
  for (const key of keys) {
    const [, location, sequence] = key.split(":");
    if (location === String(LOCATION_MZONE) && Number(sequence) >= 5) return true;
  }
  return false;
}

/** The top lane of the board where the pick bar may sit (board px): 8px down, 80px high, room for a bar of two rows. */
export const BAR_LANE = { top: 8, height: 80 } as const;
const BAR_MAX = 440;
const BAR_MIN = 240;
const BAR_EDGE = 8;

/**
 * The room of the pick bar in the top lane, as "x,y,width,height" for `data-bar-room`, or undefined when no gap is wide
 * enough (the prompt then places the bar itself). `blocks` are the boxes the bar must not cover (plates, fields, the far
 * hands, the view control); only the ones that reach into the lane count. Of the gaps that hold a full bar, the one
 * nearest the middle of the board wins; else the widest gap.
 */
export function barRoomOf(boardWidth: number, blocks: readonly GridRect[]): string | undefined {
  const top = BAR_LANE.top;
  const bottom = BAR_LANE.top + BAR_LANE.height;
  const spans = blocks
    .filter((r) => r.width > 0 && r.height > 0 && r.y < bottom && r.y + r.height > top)
    .map((r) => [r.x, r.x + r.width] as const)
    .sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let from = BAR_EDGE;
  for (const [left, right] of spans) {
    if (left > from) gaps.push([from, left]);
    from = Math.max(from, right);
  }
  if (boardWidth - BAR_EDGE > from) gaps.push([from, boardWidth - BAR_EDGE]);
  const usable = gaps.map(([left, right]) => ({ left, right, width: Math.min(BAR_MAX, right - left - 16) })).filter((gap) => gap.width >= BAR_MIN);
  if (usable.length === 0) return undefined;
  const middle = boardWidth / 2;
  // The bar sits as near the middle as its gap allows.
  const centreOf = (gap: { left: number; right: number; width: number }) => Math.min(Math.max(middle, gap.left + 8 + gap.width / 2), gap.right - 8 - gap.width / 2);
  const full = usable.filter((gap) => gap.width >= BAR_MAX);
  const pick = full.length > 0
    ? full.reduce((best, gap) => (Math.abs(centreOf(gap) - middle) < Math.abs(centreOf(best) - middle) ? gap : best))
    : usable.reduce((best, gap) => (gap.width > best.width ? gap : best));
  const half = pick.width / 2;
  const centreX = centreOf(pick);
  return [centreX - half, top, pick.width, BAR_LANE.height].map(Math.round).join(",");
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
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const read = () => setBox((prev) => {
      const next = { width: node.clientWidth, height: node.clientHeight };
      return prev.width === next.width && prev.height === next.height ? prev : next;
    });
    read();
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
  // The finale board only when both seats of its column are still in.
  const finaleColumn = gridFinale != null && cells.filter((cell) => cell.column === gridFinale && !gone(cell.seat)).length === 2 ? gridFinale : null;
  const layoutBox = useMemo(
    () => (box.width > 0 && box.height > 0 ? gridFocusLayout(world, box, focusCell, { homeColumn, drawerRow: drawerKey.split("").map(Number) as [0 | 1, 0 | 1], finale: finaleColumn }) : null),
    [box, drawerKey, finaleColumn, focusCell, homeColumn, world],
  );
  const placed = layoutBox;

  const tracks = useRef(new Map<string, FlipTrack>());
  const lastBox = useRef({ width: 0, height: 0 });
  const lastFinale = useRef<0 | 1 | null>(finaleColumn);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !placed) return;
    const resized = lastBox.current.width !== box.width || lastBox.current.height !== box.height;
    lastBox.current = { width: box.width, height: box.height };
    const toFinale = lastFinale.current !== finaleColumn;
    lastFinale.current = finaleColumn;
    const animate = !resized && !reducedMotion;
    const seen = new Set<string>();
    const move = (key: string, el: HTMLElement | null, rect: GridRect, turn: 0 | 180, fadeText: boolean, finaleMove: boolean) => {
      if (!el) return;
      seen.add(key);
      const options = finaleMove ? { turn, fadeText, duration: FINALE_GLIDE_MS, easing: FINALE_GLIDE_EASING } : { turn, fadeText };
      tracks.current.set(key, playFlip(el, tracks.current.get(key), boxOf(rect), animate, options));
    };
    for (const cell of cells) {
      const spot = placed.cells[cellIndex(cell)];
      const glide = toFinale;
      move(`f${cell.seat}`, root.querySelector<HTMLElement>(`[data-seat-slot="${cell.seat}"]`), spot.rect, cell.rotateDeg, false, glide);
      move(`l${cell.seat}`, root.querySelector<HTMLElement>(`[data-grid-lp="${cell.seat}"]`), spot.plate, 0, true, glide);
    }
    for (const key of [...tracks.current.keys()]) {
      if (seen.has(key)) continue;
      cancelTracks([tracks.current.get(key)!]);
      tracks.current.delete(key);
    }
  }, [placed, box.width, box.height, cells, reducedMotion, finaleColumn]);
  useEffect(() => {
    const live = tracks.current;
    return () => cancelTracks(live.values());
  }, []);

  // The seat fields are memoized: a field is drawn again only when something in it changes, never for a move or a
  // resize. The pair prop is an object, so the same values give the same object.
  const pairs = useRef(new Map<number, NonNullable<SeatFieldProps["pair"]>>());
  const stablePair = (seat: number, next: NonNullable<SeatFieldProps["pair"]>) => {
    const had = pairs.current.get(seat);
    if (had && had.other === next.other && had.left === next.left && had.right === next.right && had.gap === next.gap && had.joined === next.joined) return had;
    pairs.current.set(seat, next);
    return next;
  };

  // The crumble of a seat that leaves: its last board, drawn at the box it had, cut where the shared row begins.
  const outSeats = useMemo(() => engine.seats.filter((view) => view.eliminated === true).map((view) => view.seat), [engine.seats]);
  const poses = new Map<number, SeatPose>();
  if (placed) for (const cell of cells) poses.set(cell.seat, exitPose(cell.seat, placed.cells[cellIndex(cell)], cell.rotateDeg));
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

  const pickOrder = picks ? layout.slots.map((slot) => slot.seat).filter((seat) => picks.options.has(seat)) : [];
  const promptSeat = controller.prompt?.seat ?? null;
  const format = engineFormat(engine);
  const attackerSeat = controller.aim?.from ? Number(controller.aim.from.split(":")[0]) : null;
  const attackerTone = (attackerSeat != null ? tones.get(attackerSeat) : null) ?? "violet";
  const pickKind = pickKindOf(legalKeys);
  const extraZonePick = picksExtraZone(legalKeys) || picksExtraZone(selectedKeys);

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
  const hubColumn: 0 | 1 | null = finaleColumn ?? (homeColumn != null && drawerSeats[homeColumn] != null ? homeColumn : drawerSeats[0] != null ? 0 : drawerSeats[1] != null ? 1 : null);
  const hubStyle = ((): CSSProperties | null => {
    if (!placed || !gridHub) return null;
    if (hubPlace === "center" && finaleColumn == null) {
      const left = placed.cells[0].rect;
      const right = placed.cells[2].rect;
      const gutterX = (left.x + left.width + right.x) / 2;
      const line = placed.bands[0].rect.y + placed.bands[0].rect.height / 2;
      return { left: gutterX, top: line, ["--hub-z" as string]: `${placed.bands[0].z}px` };
    }
    if (hubColumn == null) return null;
    const band = placed.bands[hubColumn];
    const z = band.z;
    return { left: band.rect.x, top: band.rect.y, width: band.rect.width, height: band.rect.height, ["--z" as string]: `${z}px`, ["--g" as string]: `${z * 0.075}px` };
  })();

  // The pick bar takes a free gap of the top lane (over no plate, field, far hand or the view control). The prompt reads
  // `data-bar-room` as "x,y,width,height" in board pixels and follows its changes. The far hands and the control are
  // measured once the fields stand still (a FLIP or the finale glide moves them); plates and fields come from the layout.
  const [measured, setMeasured] = useState<readonly GridRect[]>([]);
  const handsKey = engine.seats.map((view) => `${view.seat}:${view.hand.length}:${view.eliminated === true ? 1 : 0}`).join(",");
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !placed) return;
    const measure = () => {
      const board = root.getBoundingClientRect();
      const nodes = root.querySelectorAll<HTMLElement>('[data-hand-seat][data-side="opp"], [data-grid-controls]');
      const next = Array.from(nodes)
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({ x: Math.round(r.left - board.left), y: Math.round(r.top - board.top), width: Math.round(r.width), height: Math.round(r.height) }));
      setMeasured((current) => (sameRects(current, next) ? current : next));
    };
    const wait = reducedMotion ? 0 : Math.max(FLIP_MS, FINALE_GLIDE_MS) + 80;
    const timer = window.setTimeout(measure, wait);
    return () => window.clearTimeout(timer);
  }, [placed, handsKey, reducedMotion]);
  const barRoom = ((): string | undefined => {
    if (!placed) return undefined;
    const blocks: GridRect[] = [...measured];
    for (const cell of cells) {
      const spot = placed.cells[cellIndex(cell)];
      const state = states.get(cell.seat) ?? "live";
      if (state === "empty") continue;
      blocks.push(spot.plate);
      // In the finale the two seats that left keep only their plates.
      if (state === "live") blocks.push(spot.rect);
      else if (finaleColumn == null || cell.column === finaleColumn) blocks.push(spot.own);
    }
    return barRoomOf(box.width, blocks);
  })();

  return (
    <div
      ref={rootRef}
      className={styles.board}
      data-bar-room={barRoom}
      data-prompt-scope
      data-table-stage={layout.format}
      data-grid-stage="true"
      data-grid-focus={focus.seat ?? "all"}
      data-grid-finale={finaleColumn ?? undefined}
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
      data-emz-pick={extraZonePick ? "true" : undefined}
    >
      <div className={styles.world} onClick={onClick} onFocusCapture={onFocus}>
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
              rotateDeg: cell.rotateDeg,
              z: spot.z,
              docked: false,
              compact: false,
              hidden: false,
            };
            const out = state !== "live";
            const self = slot.relation === "self";
            const drawer = drawerSeats[cell.column];
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
              emz: drawer === cell.seat ? "pair" : "none",
              pair: stablePair(cell.seat, {
                other: cell.partner,
                left: PAIR_LEFT,
                right: 0,
                gap: PAIR_GAP,
                joined: (states.get(cell.partner) ?? "live") === "live",
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
            // In the finale the two seats that left fade out of the board: only their plates stay.
            const outline = out && (finaleColumn == null || cell.column === finaleColumn) ? placed.cells[cellIndex(cell)].own : null;
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
                    pose={exitPose(cell.seat, spot, cell.rotateDeg)}
                    tone={slot.tone}
                    view={exitRow.view}
                    masterRule={masterRule}
                    faceUpHand={exitRow.faceUpHand}
                    reducedMotion={reducedMotion}
                    clipTop={OVERLAP * spot.z}
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
          {placed
            ? cells.map((cell) => {
            const view = engine.seats.find((entry) => entry.seat === cell.seat);
            const slot = layout.slots.find((entry) => entry.seat === cell.seat);
            if (!view || !slot) return null;
            const lp = placed.cells[cellIndex(cell)].plate;
            const lpStyle: CSSProperties = { left: lp.x, top: lp.y, width: lp.width, height: lp.height };
            const pickable = picks?.options.has(cell.seat) === true;
            const index = pickOrder.indexOf(cell.seat);
            return (
              <div key={cell.seat} className={styles.lp} data-grid-lp={cell.seat} data-lp-side={finaleColumn === cell.column && cell.row === 1 ? "left" : undefined} style={lpStyle}>
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
            <div className={styles.hub} data-grid-hub={hubPlace === "center" && finaleColumn == null ? "center" : "band"} style={hubStyle}>
              {gridHub(hubPlace === "center" && finaleColumn == null ? "center" : "band")}
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
      {fx ? <div className={styles.slot} data-slot="fx">{fx}</div> : null}
      {promptCenter ? <div className={styles.slot} data-slot="prompt" data-seat-pick={picks ? "true" : undefined}>{promptCenter}</div> : null}
      {overlay ? <div className={styles.slot} data-slot="overlay">{overlay}</div> : null}
    </div>
  );
}
