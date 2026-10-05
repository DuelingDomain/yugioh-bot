"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent } from "react";
import { engineFormat } from "../multi-seat";
import { AttackLine } from "./attack-line";
import { boxOf, cancelTracks, playFlip, type FlipTrack } from "./grid-flip";
import { useGridFocus } from "./grid-focus";
import {
  cellIndex,
  cellState,
  gridCells,
  gridFocusLayout,
  gridWorld,
  OUT_HOLD_MS,
  pairDrawer,
  type CellState,
  type GridRect,
} from "./grid-layout";
import { holoStatus, HoloLp } from "./holo-lp";
import { lastSeatDamage } from "./seat-state";
import { RivalField } from "./rival-field";
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

/** Natural height of the contents of a life panel (px) and the width it needs for five numerals; a smaller box shrinks them. */
const LP_NATURAL_HEIGHT = 90;
const LP_NATURAL_WIDTH = 130;
const lpFit = (rect: GridRect) => Math.min(1, rect.height / LP_NATURAL_HEIGHT, rect.width / LP_NATURAL_WIDTH);

/** A click on these keeps its own meaning; every other click on a field or life box focuses it. */
const OWN_CLICK = "button, a, input, select, textarea, [role='button'], [data-zones], [data-legal='true']";

/** The 4-way table as two columns of facing fields that share an Extra Monster row (see grid-layout.ts). */
export function GridStage({ controller, layout, camera, renderSeatField, fx, promptCenter, overlay, wantMode, locked = false, grid }: TableStageViewProps) {
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

  // A seat pick shows every life box (they are the targets, with their keys), so the camera steps back for it and
  // returns to the field it left when the pick is over.
  const picking = picks != null;
  const resume = useRef<number | null>(null);
  const live = useRef({ seat: focus.seat, control: focusControl });
  live.current = { seat: focus.seat, control: focusControl };
  useEffect(() => {
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
  const homeColumn = homeCell?.column ?? 0;
  const drawerSeats = ([0, 1] as const).map((column) => pairDrawer(cells, states, column, focus.seat));
  const drawerRow = ([0, 1] as const).map((column) => cells.find((cell) => cell.seat === drawerSeats[column])?.row ?? 1) as [0 | 1, 0 | 1];
  const drawerKey = drawerRow.join("");
  const layoutBox = useMemo(
    () => (box.width > 0 && box.height > 0 ? gridFocusLayout(world, box, focusCell, { homeColumn, drawerRow: drawerKey.split("").map(Number) as [0 | 1, 0 | 1] }) : null),
    [box, drawerKey, focusCell, homeColumn, world],
  );
  const placed = layoutBox;

  const tracks = useRef(new Map<string, FlipTrack>());
  const lastBox = useRef({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !placed) return;
    const resized = lastBox.current.width !== box.width || lastBox.current.height !== box.height;
    lastBox.current = { width: box.width, height: box.height };
    const animate = !resized && !reducedMotion;
    const seen = new Set<string>();
    const move = (key: string, el: HTMLElement | null, rect: GridRect, turn: 0 | 180, fadeText: boolean) => {
      if (!el) return;
      seen.add(key);
      tracks.current.set(key, playFlip(el, tracks.current.get(key), boxOf(rect), animate, { turn, fadeText }));
    };
    for (const cell of cells) {
      move(`f${cell.seat}`, root.querySelector<HTMLElement>(`[data-seat-slot="${cell.seat}"]`), placed.cells[cellIndex(cell)].rect, cell.rotateDeg, false);
      const band = placed.bands[cell.column];
      move(`l${cell.seat}`, root.querySelector<HTMLElement>(`[data-grid-lp="${cell.seat}"]`), cell.row === 1 ? band.bottomLp : band.topLp, 0, true);
    }
    for (const key of [...tracks.current.keys()]) {
      if (seen.has(key)) continue;
      cancelTracks([tracks.current.get(key)!]);
      tracks.current.delete(key);
    }
  }, [placed, box.width, box.height, cells, reducedMotion]);
  useEffect(() => {
    const live = tracks.current;
    return () => cancelTracks(live.values());
  }, []);

  const pickOrder = picks ? layout.slots.map((slot) => slot.seat).filter((seat) => picks.options.has(seat)) : [];
  const promptSeat = controller.prompt?.seat ?? null;
  const format = engineFormat(engine);
  const attackerSeat = controller.aim?.from ? Number(controller.aim.from.split(":")[0]) : null;
  const attackerTone = (attackerSeat != null ? tones.get(attackerSeat) : null) ?? "violet";

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

  return (
    <div
      ref={rootRef}
      className={styles.board}
      data-prompt-scope
      data-table-stage={layout.format}
      data-grid-stage="true"
      data-grid-focus={focus.seat ?? "all"}
      data-format={format}
      data-camera-mode={camera.mode}
      data-camera-want={wantMode ?? camera.mode}
      data-camera-lock={locked ? "true" : undefined}
      data-fly="false"
      data-upright={camera.upright ? "true" : "false"}
      data-stage-scale={((placed?.sizes.equal ?? 0) / SEAT_Z).toFixed(3)}
      data-ready={placed ? "true" : "false"}
      data-battle={engine.phase === "battle" ? "true" : undefined}
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
            const empty = state === "empty";
            const self = slot.relation === "self";
            const drawer = drawerSeats[cell.column];
            const band = placed.bands[cell.column];
            const bottom = cell.row === 1;
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
              pair: {
                other: cell.partner,
                left: bottom ? band.bottomRoom : band.topRoom,
                right: bottom ? band.topRoom : band.bottomRoom,
                joined: (states.get(cell.partner) ?? "live") !== "empty",
              },
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
              >
                {empty ? null : (
                  <RivalField
                    pose={pose}
                    field={field}
                    render={renderSeatField}
                    placement={{ left: spot.rect.x, top: spot.rect.y, zIndex: focus.seat === cell.seat ? 30 : spot.drawer ? 14 : 10, small: spot.small, lh: spot.lh }}
                  />
                )}
              </div>
            );
              })
            : null}
          {placed
            ? cells.map((cell) => {
            const view = engine.seats.find((entry) => entry.seat === cell.seat);
            const slot = layout.slots.find((entry) => entry.seat === cell.seat);
            if (!view || !slot) return null;
            const lp = cell.row === 1 ? placed.bands[cell.column].bottomLp : placed.bands[cell.column].topLp;
            const lpStyle: CSSProperties = { left: lp.x, top: lp.y, width: lp.width, height: lp.height };
            const pickable = picks?.options.has(cell.seat) === true;
            const index = pickOrder.indexOf(cell.seat);
            return (
              <div key={cell.seat} className={styles.lp} data-grid-lp={cell.seat} style={lpStyle}>
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
                  reducedMotion={reducedMotion}
                />
              </div>
            );
              })
            : null}
      </div>
      {controller.aim?.from ? <AttackLine aim={controller.aim} tone={attackerTone} stageWidth={box.width} stageHeight={box.height} /> : null}
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
