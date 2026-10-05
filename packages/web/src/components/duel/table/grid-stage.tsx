"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { engineFormat } from "../multi-seat";
import { AttackLine } from "./attack-line";
import { STAGE } from "./geometry";
import {
  cellState,
  gridCells,
  gridMetrics,
  gridPartnerSeat,
  gridPose,
  lpAnchor,
  LP_WIDTH_ME,
  OUT_HOLD_MS,
  type CellState,
  type GridCell,
} from "./grid-layout";
import { holoStatus, HoloLp } from "./holo-lp";
import { lastSeatDamage } from "./seat-state";
import { RivalField } from "./rival-field";
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

/** The 4-way table as a 2 by 2 grid of full fields (see grid-layout.ts). */
export function GridStage({ controller, layout, camera, renderSeatField, fx, promptCenter, overlay, wantMode, locked = false }: TableStageViewProps) {
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
  const metrics = useMemo(() => gridMetrics(masterRule), [masterRule]);
  const cells = useMemo(() => gridCells(layout), [layout]);
  const tones = useMemo(() => new Map<number, SeatTone>(layout.slots.map((slot) => [slot.seat, slot.tone])), [layout.slots]);
  const states = useCellStates(engine.seats);
  const partner = gridPartnerSeat(layout, engine.seats);

  const k = box.width > 0 && box.height > 0 ? Math.min(box.width / STAGE.width, box.height / metrics.height) : 0;
  const canvas: CSSProperties = {
    width: STAGE.width,
    height: metrics.height,
    transform: `translate(${(box.width - STAGE.width * k) / 2}px, ${(box.height - metrics.height * k) / 2}px) scale(${k})`,
  };

  const picks = controller.seatPick;
  const pickOrder = picks ? layout.slots.map((slot) => slot.seat).filter((seat) => picks.options.has(seat)) : [];
  const promptSeat = controller.prompt?.seat ?? null;
  const format = engineFormat(engine);
  const attackerSeat = controller.aim?.from ? Number(controller.aim.from.split(":")[0]) : null;
  const attackerTone = (attackerSeat != null ? tones.get(attackerSeat) : null) ?? "violet";

  const homeCell = cells.find((cell) => cell.home);
  const partnerCell = partner != null ? cells.find((cell) => cell.seat === partner) : undefined;
  const link = homeCell && partnerCell && viewerSeat != null ? columnLink(homeCell, partnerCell, metrics) : null;

  return (
    <div
      ref={rootRef}
      className={styles.board}
      data-prompt-scope
      data-table-stage={layout.format}
      data-grid-stage="true"
      data-format={format}
      data-camera-mode={camera.mode}
      data-camera-want={wantMode ?? camera.mode}
      data-camera-lock={locked ? "true" : undefined}
      data-fly="false"
      data-upright={camera.upright ? "true" : "false"}
      data-stage-scale={k.toFixed(3)}
      data-ready={k > 0 ? "true" : "false"}
      data-battle={engine.phase === "battle" ? "true" : undefined}
    >
      <div className={styles.canvas} style={canvas}>
        <div className={styles.plane} style={{ "--grid-tilt": `${metrics.tiltDeg}deg` } as CSSProperties}>
          <div className={styles.seam} aria-hidden="true" style={{ top: metrics.bandTop, height: metrics.bandHeight }} />
          {cells.map((cell) => {
            const slot = layout.slots.find((entry) => entry.seat === cell.seat);
            const pose = gridPose(cell, metrics);
            const state = states.get(cell.seat) ?? "live";
            if (!slot) return null;
            const empty = state === "empty";
            const self = slot.relation === "self";
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
              emz: "own",
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
                data-partner={cell.seat === partner || (cell.home && partner != null) ? "true" : undefined}
              >
                {empty ? null : <RivalField pose={pose} field={field} render={renderSeatField} />}
              </div>
            );
          })}
          {link ? (
            <div className={styles.link} data-column-link={partner} style={link} aria-label={`Column partner: ${nameOf(partner!)}`} role="img">
              <i aria-hidden="true" />
              <b>Column</b>
              <i aria-hidden="true" />
            </div>
          ) : null}
          {cells.map((cell) => {
            const view = engine.seats.find((entry) => entry.seat === cell.seat);
            const slot = layout.slots.find((entry) => entry.seat === cell.seat);
            if (!view || !slot) return null;
            const anchor = lpAnchor(cell, metrics);
            const pickable = picks?.options.has(cell.seat) === true;
            const index = pickOrder.indexOf(cell.seat);
            return (
              <HoloLp
                key={cell.seat}
                seat={cell.seat}
                name={nameOf(cell.seat)}
                tone={slot.tone}
                lp={view.lp}
                handCount={view.hand.length}
                deckCount={view.deckCount}
                clockMs={room.clock?.remainingMs[cell.seat] ?? null}
                status={holoStatus(engine, cell.seat, promptSeat)}
                me={slot.relation === "self"}
                x={anchor.x}
                y={anchor.y}
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
            );
          })}
        </div>
        {controller.aim?.from ? <AttackLine aim={controller.aim} tone={attackerTone} stageHeight={metrics.height} /> : null}
      </div>
      {fx ? <div className={styles.slot} data-slot="fx">{fx}</div> : null}
      {promptCenter ? <div className={styles.slot} data-slot="prompt" data-seat-pick={picks ? "true" : undefined}>{promptCenter}</div> : null}
      {overlay ? <div className={styles.slot} data-slot="overlay">{overlay}</div> : null}
    </div>
  );
}

/** The gold connector between the viewer's LP panel and the column partner's, in stage px. */
function columnLink(home: GridCell, partner: GridCell, metrics: ReturnType<typeof gridMetrics>): CSSProperties {
  const mine = lpAnchor(home, metrics);
  const theirs = lpAnchor(partner, metrics);
  const left = mine.x + LP_WIDTH_ME + 6;
  const right = theirs.x - 6;
  const width = Math.max(0, right - left);
  return { left, width, top: mine.y + 20 };
}
