"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { engineFormat } from "../multi-seat";
import { AttackLine } from "./attack-line";
import { FlyCity } from "./fly-city";
import { flyWorld, holoAnchor, normalizeAngle, ringAngles, ringPose, seatPoses, slotPlan, stageFit, STAGE } from "./geometry";
import { holoStatus, HoloLp } from "./holo-lp";
import { Plaza } from "./plaza";
import { RivalField } from "./rival-field";
import { TurnRing } from "./turn-ring";
import { useFlyGestures } from "./use-fly-gestures";
import { useFlyWorld } from "./use-fly-world";
import type { CameraMode, SeatFieldProps, SeatPose, SeatTone, TableStageProps } from "./types";
import styles from "./table-stage.module.css";

/** What a click on a seat must leave alone: the controls and the legal targets inside a field. */
const CLICK_PASS = "button, a, [data-legal='true'], [data-holo]";

export interface TableStageViewProps extends TableStageProps {
  /** The stored camera mode, when the FX lock shows another one (a lock sends the view home). */
  wantMode?: CameraMode;
  /** The FX lock is on. */
  locked?: boolean;
  /** Seats that are out of the duel: a click on them does nothing. */
  out?: readonly number[];
  /** Draw the turn ring (default true on a 3-way table). */
  ring?: boolean;
}

/**
 * The stage of a 3 or 4 seat table. A 1100 by 860 canvas is scaled to fit the board box it sits in. The plaza, the
 * seat fields and the turn ring live in a world (`wstage`) that the fly-in camera turns, tilts and zooms; the holo LP
 * panels, the tethers and the attack line sit over the world, flat on the canvas. FX, the prompt panel and any
 * overlay are slots over the whole box, so they measure the real screen position of `[data-zones]` and
 * `[data-lp-seat]` nodes. `camera` is the camera to draw (the shell passes the effective one).
 */
export function TableStage({ controller, layout, camera, dispatchCamera, renderSeatField, fx, promptCenter, overlay, wantMode, locked = false, out = [], ring = true }: TableStageViewProps) {
  const { engine, room, viewerSeat, nameOf, legalKeys, selectedKeys, reducedMotion } = controller;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const tetherRef = useRef<SVGSVGElement>(null);
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
  const threeWay = slotPlan(layout, { mode: "home" }) != null;
  const fly = camera.mode === "fly" && threeWay;
  // The city is heavy: it mounts the first time the fly-in shows and stays (the fade out needs it).
  const [cityOn, setCityOn] = useState(fly);
  if (fly && !cityOn) setCityOn(true);
  const rawPoses = useMemo(() => seatPoses(layout, camera, box), [layout, camera, box]);

  // A seat turns by the short way between two places: the angle it draws is the previous one plus the smallest turn.
  const turned = useRef(new Map<number, number>());
  const poses = useMemo(() => {
    const next = new Map<number, SeatPose>();
    for (const [seat, pose] of rawPoses) {
      const before = turned.current.get(seat);
      const rotateDeg = before == null ? pose.rotateDeg : before + normalizeAngle(pose.rotateDeg - before);
      turned.current.set(seat, rotateDeg);
      next.set(seat, rotateDeg === pose.rotateDeg ? pose : { ...pose, rotateDeg });
    }
    return next;
  }, [rawPoses]);

  const world = useMemo(() => flyWorld(layout, camera.fly), [layout, camera.fly]);
  const tones = useMemo(() => new Map<number, SeatTone>(layout.slots.map((slot) => [slot.seat, slot.tone])), [layout.slots]);
  useFlyWorld({
    active: fly,
    target: world,
    free: camera.fly.free === true,
    reducedMotion,
    canvasRef,
    worldRef,
    tetherRef,
    viewerSeat: layout.anchorSeat,
    flySeat: camera.fly.targetSeat,
    tones,
  });
  useFlyGestures(rootRef, fly, dispatchCamera);

  const format = engineFormat(engine);
  const masterRule = room.session.masterRule;
  const picks = controller.seatPick;
  const pickOrder = picks ? layout.slots.map((slot) => slot.seat).filter((seat) => picks.options.has(seat)) : [];
  const promptSeat = controller.prompt?.seat ?? null;
  const looking = camera.mode === "look";
  const flyYaw = fly ? world.yawDeg : 0;

  const onSeatClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    const slot = target?.closest?.("[data-seat-slot]");
    if (!slot || target?.closest?.(CLICK_PASS)) return;
    const seat = Number(slot.getAttribute("data-seat-slot"));
    if (!Number.isInteger(seat) || out.includes(seat)) return;
    if (fly) {
      dispatchCamera({ type: "flyTo", seat });
    } else if (seat !== layout.anchorSeat && !(camera.mode === "focus" && camera.focusSeat === seat) && !(looking && camera.lookSeat === seat)) {
      dispatchCamera({ type: "focus", seat });
    }
  };

  const canvas: CSSProperties = {
    width: STAGE.width,
    height: STAGE.height,
    transform: `translate(${(box.width - STAGE.width * k) / 2}px, ${(box.height - STAGE.height * k) / 2}px) scale(${k})`,
  };
  const attackerSeat = controller.aim?.from ? Number(controller.aim.from.split(":")[0]) : null;
  const attackerTone = (attackerSeat != null ? tones.get(attackerSeat) : null) ?? "violet";
  const ringAt = ringPose(layout, camera);

  return (
    <div
      ref={rootRef}
      className={styles.board}
      data-prompt-scope
      data-table-stage={layout.format}
      data-format={format}
      data-camera-mode={camera.mode}
      data-camera-want={wantMode ?? camera.mode}
      data-camera-lock={locked ? "true" : undefined}
      data-fly={fly ? "true" : "false"}
      data-upright={camera.upright ? "true" : "false"}
      data-stage-scale={k.toFixed(3)}
      data-ready={k > 0 ? "true" : "false"}
      data-battle={engine.phase === "battle" ? "true" : undefined}
    >
      <div ref={canvasRef} className={styles.canvas} style={canvas} data-fly-capable={threeWay ? "true" : undefined}>
        {threeWay ? (
          <>
            <div className={styles.sky} aria-hidden="true" />
            <div className={styles.fog} aria-hidden="true" />
          </>
        ) : null}
        <div ref={worldRef} className={styles.world} data-world>
          {threeWay && cityOn ? <FlyCity /> : null}
          <div className={styles.wstage} onClick={onSeatClick}>
            <Plaza layout={layout} poses={poses} fly={fly} />
            {ring && threeWay ? (
              <TurnRing
                layout={layout}
                engine={engine}
                angles={ringAngles(layout, camera)}
                pose={ringAt}
                promptSeat={promptSeat}
                locked={locked}
              />
            ) : null}
            {layout.slots.map((slot) => {
              const pose = poses.get(slot.seat);
              if (!pose) return null;
              const place = layout.slots.indexOf(slot);
              const self = slot.relation === "self";
              const you = pose.slot ? pose.slot === "home" : place === 0;
              const field: Omit<SeatFieldProps, "angleDeg" | "scale"> = {
                engine,
                seat: slot.seat,
                viewerSeat,
                masterRule,
                side: you ? "you" : "opp",
                upright: camera.upright,
                tone: slot.tone,
                density: you ? "full" : "rival",
                hand: self && !looking ? "face" : "backs",
                emz: "own",
                showTally: false,
                usable: !looking && (slot.relation === "self" || slot.relation === "opponent"),
                name: nameOf(slot.seat),
                legalKeys,
                selectedKeys,
                reducedMotion,
                onActivate: controller.onActivate,
                onInspect: controller.onInspect,
                onHoverCard: controller.onHoverCard,
              };
              return <RivalField key={slot.seat} pose={pose} field={field} render={renderSeatField} angleOffsetDeg={flyYaw} />;
            })}
          </div>
        </div>
        <svg ref={tetherRef} className={styles.tethers} viewBox="0 0 1100 860" aria-hidden="true" />
        {layout.slots.map((slot, place) => {
          const view = engine.seats.find((entry) => entry.seat === slot.seat);
          if (!view) return null;
          const anchor = holoAnchor(layout, slot.seat, camera);
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
              beam={fly ? "none" : threeWay ? anchor.beam : place === 0 ? "none" : "down"}
              floating={fly}
              master={slot.relation === "self" ? null : view.deckMaster?.card ?? null}
              onInspectMaster={(card) => controller.onInspect({ type: "info", card })}
              legal={pickable}
              hotkey={pickable && index >= 0 ? index + 1 : null}
              onPick={() => picks?.onPick(slot.seat)}
              onHover={(hover) => controller.onAim?.(hover ? { lpSeat: slot.seat } : null)}
              reducedMotion={reducedMotion}
            />
          );
        })}
        {controller.aim?.from ? <AttackLine aim={controller.aim} tone={attackerTone} /> : null}
      </div>
      {fx ? <div className={styles.slot} data-slot="fx">{fx}</div> : null}
      {promptCenter ? <div className={styles.slot} data-slot="prompt">{promptCenter}</div> : null}
      {overlay ? <div className={styles.slot} data-slot="overlay">{overlay}</div> : null}
    </div>
  );
}
