"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { engineFormat } from "../multi-seat";
import { AttackLine } from "./attack-line";
import { useGridFocus } from "./grid-focus";
import {
  cellState,
  gridBand,
  gridCells,
  gridPose,
  gridView,
  gridWorld,
  lpBox,
  OUT_HOLD_MS,
  pairDrawer,
  type CellState,
  type GridView,
} from "./grid-layout";
import { holoStatus, HoloLp } from "./holo-lp";
import { lastSeatDamage } from "./seat-state";
import { RivalField } from "./rival-field";
import { textScale } from "./seat-angle";
import type { SeatFieldProps, SeatTone } from "./types";
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

/** How long the camera takes to move between two views. */
export const VIEW_MS = 460;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Moves the camera of the grid. The world is drawn at a real size (`zoom` on the world box, a translate on its
 * parent), never with a scale transform, so the text is laid out at its final size and stays sharp. The move is a
 * short tween written straight to the DOM; with reduced motion, or before the first measure, the view jumps.
 */
function useViewTween(target: GridView | null, reduced: boolean) {
  const panRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const current = useRef<GridView | null>(null);
  const frame = useRef(0);

  const paint = (view: GridView) => {
    current.current = view;
    const pan = panRef.current;
    const world = worldRef.current;
    if (!pan || !world) return;
    pan.style.transform = `translate(${view.x}px, ${view.y}px)`;
    world.style.zoom = String(view.zoom);
    world.style.setProperty("--gts", textScale(view.zoom).toFixed(3));
  };

  useLayoutEffect(() => {
    if (!target) return;
    cancelAnimationFrame(frame.current);
    const from = current.current;
    const settle = (view: GridView): GridView => ({ zoom: view.zoom, x: Math.round(view.x), y: Math.round(view.y) });
    if (!from || reduced) {
      paint(settle(target));
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / VIEW_MS);
      if (t >= 1) {
        paint(settle(target));
        return;
      }
      const e = ease(t);
      paint({ zoom: from.zoom + (target.zoom - from.zoom) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
    // paint only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.zoom, target?.x, target?.y, reduced]);

  return { panRef, worldRef };
}

/** A click on these keeps its own meaning; every other click on a field or life box zooms to it. */
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
    digitsFree: picks == null,
    escapeFree: controller.aim?.from == null,
  });
  const focusControl = grid ?? local;
  const { focus } = focusControl;
  const focusCell = focus.seat != null ? cells.find((cell) => cell.seat === focus.seat) ?? null : null;

  const target = useMemo(
    () => (box.width > 0 && box.height > 0 ? gridView(world, box, focusCell, focus.mul) : null),
    [box, focus.mul, focusCell, world],
  );
  const { panRef, worldRef } = useViewTween(target, reducedMotion);

  const pickOrder = picks ? layout.slots.map((slot) => slot.seat).filter((seat) => picks.options.has(seat)) : [];
  const promptSeat = controller.prompt?.seat ?? null;
  const format = engineFormat(engine);
  const attackerSeat = controller.aim?.from ? Number(controller.aim.from.split(":")[0]) : null;
  const attackerTone = (attackerSeat != null ? tones.get(attackerSeat) : null) ?? "violet";
  const homeColumn = homeCell?.column ?? null;

  const zoomTo = (seat: number) => {
    if (focus.seat !== seat) focusControl.focusSeat(seat);
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(OWN_CLICK)) return;
    const host = target.closest<HTMLElement>("[data-grid-cell], [data-grid-lp]");
    const seat = host ? Number(host.dataset.gridCell ?? host.dataset.gridLp) : NaN;
    if (Number.isInteger(seat)) zoomTo(seat);
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
    if (Number.isInteger(seat)) zoomTo(seat);
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
      data-stage-scale={(target?.zoom ?? 0).toFixed(3)}
      data-ready={target ? "true" : "false"}
      data-battle={engine.phase === "battle" ? "true" : undefined}
    >
      <div className={styles.pan} ref={panRef}>
        <div className={styles.world} ref={worldRef} style={{ width: world.width, height: world.height }} onClick={onClick} onFocusCapture={onFocus}>
          {cells.map((cell) => {
            const slot = layout.slots.find((entry) => entry.seat === cell.seat);
            const pose = gridPose(cell, world);
            const state = states.get(cell.seat) ?? "live";
            if (!slot) return null;
            const empty = state === "empty";
            const self = slot.relation === "self";
            const drawer = pairDrawer(cells, states, cell.column);
            const band = gridBand(cell.column, cell.column === homeColumn, world);
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
                data-focus={focus.seat === cell.seat ? "true" : undefined}
                data-partner={cell.home ? cell.partner : undefined}
              >
                {empty ? null : <RivalField pose={pose} field={field} render={renderSeatField} />}
              </div>
            );
          })}
          {cells.map((cell) => {
            const view = engine.seats.find((entry) => entry.seat === cell.seat);
            const slot = layout.slots.find((entry) => entry.seat === cell.seat);
            if (!view || !slot) return null;
            const lp = lpBox(cell, cell.column === homeColumn, world);
            const pickable = picks?.options.has(cell.seat) === true;
            const index = pickOrder.indexOf(cell.seat);
            return (
              <div key={cell.seat} className={styles.lp} data-grid-lp={cell.seat}>
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
                  x={lp.x}
                  y={lp.y}
                  width={lp.width}
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
          })}
        </div>
      </div>
      {controller.aim?.from ? <AttackLine aim={controller.aim} tone={attackerTone} stageWidth={box.width} stageHeight={box.height} /> : null}
      <div className={styles.controls} role="group" aria-label="Table view" data-grid-controls>
        <button type="button" className={styles.control} data-testid="grid-all" aria-pressed={focus.seat == null} aria-keyshortcuts="O Escape" title="All fields (O or Esc)" onClick={focusControl.showAll}>
          All fields
        </button>
        <button type="button" className={styles.control} data-testid="grid-zoom-out" aria-label="Zoom out" aria-keyshortcuts="-" title="Zoom out (-)" onClick={focusControl.zoomOut} disabled={focus.seat == null}>
          &minus;
        </button>
        <button type="button" className={styles.control} data-testid="grid-zoom-in" aria-label="Zoom in" aria-keyshortcuts="+" title="Zoom in (+)" onClick={focusControl.zoomIn}>
          +
        </button>
      </div>
      {fx ? <div className={styles.slot} data-slot="fx">{fx}</div> : null}
      {promptCenter ? <div className={styles.slot} data-slot="prompt" data-seat-pick={picks ? "true" : undefined}>{promptCenter}</div> : null}
      {overlay ? <div className={styles.slot} data-slot="overlay">{overlay}</div> : null}
    </div>
  );
}
