"use client";

import type { CSSProperties } from "react";
import { hexToRgbTriplet } from "../table/seat-angle";
import { SEAT_TONE_HEX, type CameraAction, type CameraLockReason, type TableLayout } from "../table/types";
import { cameraLabel, lockLabel, ROOF_FIELD, ROOF_WORLD, roofSlots, type RoofCameraState } from "./roof-camera";
import styles from "./tag-shell.module.css";

export interface CameraDockProps {
  camera: RoofCameraState;
  layout: TableLayout;
  dispatch: (action: CameraAction) => void;
  nameOf: (seat: number) => string;
  turnSeat: number | null;
  outSeats: readonly number[];
}

/** Map scale: 1 map unit = 10 world units. The map keeps the roof's own proportions. */
const K = 0.1;
const MAP_W = ROOF_WORLD.width * K;
const MAP_H = ROOF_WORLD.depth * K;

function mapX(x: number): number {
  return MAP_W / 2 + x * K;
}
function mapY(y: number): number {
  return MAP_H / 2 + y * K;
}

function keyPress(run: () => void) {
  return (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      run();
    }
  };
}

/**
 * The camera dock: a top-down roof map (click a field to fly to it), the preset buttons, one button per seat,
 * orbit and zoom. The map shows the camera cone and the lock state. All actions go through the roof reducer, which
 * ignores them while the FX lock runs, so the buttons are disabled then.
 */
export function CameraDock({ camera, layout, dispatch, nameOf, turnSeat, outSeats }: CameraDockProps) {
  const slots = roofSlots(camera.anchor);
  const locked = camera.lock != null;
  const lockReason: CameraLockReason | null = camera.lock?.reason ?? null;
  const pose = camera.pose;
  const coneX = mapX(pose.fx);
  const coneY = mapY(pose.fy + 170 * Math.max(0.5, 1 / pose.zoom));
  const coneRot = pose.yaw;
  const coneLen = 7 + 9 / Math.max(pose.zoom, 0.4);
  const bySeat = new Map(layout.slots.map((slot) => [slot.seat, slot]));
  const order = layout.slots.slice().sort((a, b) => a.turnOrder - b.turnOrder);

  return (
    <section className={styles.dock} aria-label="Camera" data-camera-dock data-locked={locked ? "true" : "false"} data-cam={camera.mode}>
      <header className={styles.dockHead}>
        <span>Camera</span>
        <b data-camera-name>{locked && lockReason ? `Locked · ${lockLabel(lockReason)}` : cameraLabel(camera, nameOf)}</b>
      </header>
      <svg className={styles.map} viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="group" aria-label="Roof map" data-roof-map>
        <rect className={styles.mapRoof} x={2} y={2} width={MAP_W - 4} height={MAP_H - 4} rx={3} />
        <circle className={styles.mapPad} cx={mapX(0)} cy={mapY(0)} r={11} />
        <circle className={styles.mapPadDot} cx={mapX(0)} cy={mapY(0)} r={1.6} />
        {Object.values(slots).map((slot) => {
          const info = bySeat.get(slot.seat);
          const hex = SEAT_TONE_HEX[info?.tone ?? "violet"];
          const w = ROOF_FIELD.width * K;
          const h = ROOF_FIELD.height * K;
          const gone = outSeats.includes(slot.seat);
          const style = { "--seat": hexToRgbTriplet(hex.main), "--ink": hex.ink } as CSSProperties;
          const run = () => dispatch({ type: "focus", seat: slot.seat });
          return (
            <g
              key={slot.seat}
              className={styles.mapField}
              style={style}
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-label={`Fly to ${nameOf(slot.seat)}`}
              aria-disabled={locked}
              data-map-seat={slot.seat}
              data-now={turnSeat === slot.seat ? "true" : "false"}
              data-out={gone ? "true" : "false"}
              data-focus={camera.mode === "focus" && camera.focusSeat === slot.seat ? "true" : "false"}
              onClick={locked ? undefined : run}
              onKeyDown={locked ? undefined : keyPress(run)}
            >
              <rect x={mapX(slot.x) - w / 2} y={mapY(slot.y) - h / 2} width={w} height={h} rx={2} />
              <text x={mapX(slot.x)} y={mapY(slot.y) + 2.2} textAnchor="middle">{info?.code ?? ""}</text>
            </g>
          );
        })}
        <g className={styles.mapCone} transform={`rotate(${coneRot} ${coneX} ${coneY})`} data-map-cone>
          <path d={`M ${coneX} ${coneY} L ${coneX - coneLen * 0.55} ${coneY - coneLen * 1.2} L ${coneX + coneLen * 0.55} ${coneY - coneLen * 1.2} Z`} />
          <circle cx={coneX} cy={coneY} r={1.7} />
        </g>
      </svg>
      <div className={styles.presets}>
        <button type="button" disabled={locked} aria-pressed={camera.mode === "home"} onClick={() => dispatch({ type: "home" })}>
          Home <kbd>H</kbd>
        </button>
        <button type="button" disabled={locked} aria-pressed={camera.mode === "overview"} onClick={() => dispatch({ type: "overview" })}>
          Overview <kbd>0</kbd>
        </button>
        <button type="button" disabled={locked} aria-pressed={camera.mode === "look"} onClick={() => dispatch({ type: "look", seat: (camera.anchor + 1) % 4 })}>
          Rival end <kbd>V</kbd>
        </button>
      </div>
      <p className={styles.dockLabel}>Focus a field <span>1-4</span></p>
      <div className={styles.seatBtns}>
        {order.map((slot) => {
          const hex = SEAT_TONE_HEX[slot.tone];
          const style = { "--seat": hexToRgbTriplet(hex.main), "--ink": hex.ink } as CSSProperties;
          return (
            <button
              key={slot.seat}
              type="button"
              style={style}
              disabled={locked}
              aria-pressed={camera.mode === "focus" && camera.focusSeat === slot.seat}
              data-seat-btn={slot.seat}
              onClick={() => dispatch({ type: "focus", seat: slot.seat })}
            >
              <kbd>{slot.turnOrder + 1}</kbd>
              <span>{slot.seat === layout.viewerSeat ? "You" : nameOf(slot.seat).split(" ")[0]}</span>
              <i>{slot.code}</i>
            </button>
          );
        })}
      </div>
      <div className={styles.tools}>
        <button type="button" disabled={locked} aria-label="Orbit left" onClick={() => dispatch({ type: "orbit", dYawDeg: -30, dTiltDeg: 0 })}>
          <kbd>Q</kbd> &#8634;
        </button>
        <button type="button" disabled={locked} aria-label="Orbit right" onClick={() => dispatch({ type: "orbit", dYawDeg: 30, dTiltDeg: 0 })}>
          &#8635; <kbd>E</kbd>
        </button>
        <button type="button" disabled={locked} aria-label="Zoom out" onClick={() => dispatch({ type: "zoom", factor: 1 / 1.18 })}>&minus;</button>
        <button type="button" disabled={locked} aria-label="Zoom in" onClick={() => dispatch({ type: "zoom", factor: 1.18 })}>+</button>
        <button type="button" disabled={locked} aria-pressed={camera.mode === "fly"} onClick={() => dispatch({ type: "toggleFly" })}>
          Fly in <kbd>I</kbd>
        </button>
      </div>
    </section>
  );
}
