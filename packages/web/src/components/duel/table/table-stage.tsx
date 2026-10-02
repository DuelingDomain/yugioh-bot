"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { engineFormat } from "../multi-seat";
import { holoAnchor, seatPoses, stageFit, STAGE } from "./geometry";
import { holoStatus, HoloLp } from "./holo-lp";
import { Plaza } from "./plaza";
import { RivalField } from "./rival-field";
import type { SeatFieldProps, TableStageProps } from "./types";
import styles from "./table-stage.module.css";

/**
 * The stage of a 3 or 4 seat table. A 1100 by 860 canvas is scaled to fit the board box it sits in; the plaza,
 * the seat fields and the holo LP panels live on that canvas. FX, the prompt panel and any overlay are slots
 * over the whole box, so they measure the real screen position of `[data-zones]` and `[data-lp-seat]` nodes.
 * Only the home pose is drawn for now: the camera step adds focus, look-from-seat, overview and fly-in.
 */
export function TableStage({ controller, layout, camera, renderSeatField, fx, promptCenter, overlay }: TableStageProps) {
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
    return () => observer.disconnect();
  }, []);

  const k = stageFit(box);
  const poses = useMemo(() => seatPoses(layout, camera, box), [layout, camera, box]);
  const format = engineFormat(engine);
  const masterRule = room.session.masterRule;
  const picks = controller.seatPick;
  const pickOrder = picks ? [...picks.options.keys()] : [];
  const promptSeat = controller.prompt?.seat ?? null;

  const canvas: CSSProperties = {
    width: STAGE.width,
    height: STAGE.height,
    transform: `translate(${(box.width - STAGE.width * k) / 2}px, ${(box.height - STAGE.height * k) / 2}px) scale(${k})`,
  };

  return (
    <div
      ref={rootRef}
      className={styles.board}
      data-table-stage={layout.format}
      data-format={format}
      data-camera-mode={camera.mode}
      data-upright={camera.upright ? "true" : "false"}
      data-stage-scale={k.toFixed(3)}
      data-ready={k > 0 ? "true" : "false"}
      data-battle={engine.phase === "battle" ? "true" : undefined}
    >
      <div className={styles.canvas} style={canvas}>
        <Plaza layout={layout} poses={poses} />
        {layout.slots.map((slot) => {
          const pose = poses.get(slot.seat);
          if (!pose) return null;
          const place = layout.slots.indexOf(slot);
          const self = slot.relation === "self";
          const field: Omit<SeatFieldProps, "angleDeg" | "scale"> = {
            engine,
            seat: slot.seat,
            viewerSeat,
            masterRule,
            side: place === 0 ? "you" : "opp",
            upright: camera.upright,
            tone: slot.tone,
            density: place === 0 ? "full" : "rival",
            hand: self ? "face" : "backs",
            emz: "own",
            showTally: false,
            usable: slot.relation === "self" || slot.relation === "opponent",
            name: nameOf(slot.seat),
            legalKeys,
            selectedKeys,
            reducedMotion,
            onActivate: controller.onActivate,
            onInspect: controller.onInspect,
            onHoverCard: controller.onHoverCard,
          };
          return <RivalField key={slot.seat} pose={pose} field={field} render={renderSeatField} />;
        })}
        {layout.slots.map((slot, place) => {
          const view = engine.seats.find((entry) => entry.seat === slot.seat);
          if (!view) return null;
          const anchor = holoAnchor(layout, slot.seat);
          const pickable = picks?.options.has(slot.seat) === true;
          const index = pickOrder.indexOf(slot.seat);
          return (
            <HoloLp
              key={slot.seat}
              seat={slot.seat}
              name={nameOf(slot.seat)}
              tone={slot.tone}
              lp={view.lp}
              handCount={view.hand.length}
              deckCount={view.deckCount}
              clockMs={room.clock?.remainingMs[slot.seat] ?? null}
              status={holoStatus(engine, slot.seat, promptSeat)}
              me={anchor.me}
              x={anchor.x}
              y={anchor.y}
              beam={place === 0 ? "none" : "down"}
              legal={pickable}
              hotkey={pickable && index >= 0 ? index + 1 : null}
              onPick={() => picks?.onPick(slot.seat)}
              onHover={(hover) => controller.onAim?.(hover ? { lpSeat: slot.seat } : null)}
              reducedMotion={reducedMotion}
            />
          );
        })}
      </div>
      {fx ? <div className={styles.slot} data-slot="fx">{fx}</div> : null}
      {promptCenter ? <div className={styles.slot} data-slot="prompt">{promptCenter}</div> : null}
      {overlay ? <div className={styles.slot} data-slot="overlay">{overlay}</div> : null}
    </div>
  );
}
