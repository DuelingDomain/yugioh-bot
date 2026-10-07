"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Eye, Focus, House, Lock, Orbit, Video } from "lucide-react";
import { isFaceOff } from "./camera-model";
import type { TargetHint } from "./use-camera";
import { hexToRgbTriplet } from "./seat-angle";
import { SEAT_TONE_HEX, type CameraAction, type CameraState, type TableLayout } from "./types";
import styles from "./camera-controls.module.css";

export interface CameraControlsProps {
  layout: TableLayout;
  /** The stored camera (where the player left it). */
  camera: CameraState;
  locked: boolean;
  /** A field that holds the targets to pick, when it is not the focus. The camera never goes there by itself. */
  hint?: TargetHint | null;
  nameOf: (seat: number) => string;
  dispatch: (action: CameraAction) => void;
  /** Seats that are out: no button for them. */
  out?: readonly number[];
  /**
   * `float` (default): everything floats over the board. `panel`: only the View panel, in the flow of its parent (a
   * side column). `stage`: the chip, the target hint and the look banner, without the View panel. A table that
   * puts the panel in a column renders `panel` there and `stage` over the board.
   */
  variant?: "float" | "panel" | "stage";
  /**
   * The wide table: the View button lives on its rail and owns whether the grid is open. The panel then has no toggle of
   * its own and opens at the left edge of the board, next to the rail.
   */
  view?: { open: boolean };
}

function toneVars(layout: TableLayout, seat: number): CSSProperties {
  const tone = layout.slots.find((slot) => slot.seat === seat)?.tone ?? "ice";
  return { "--t": hexToRgbTriplet(SEAT_TONE_HEX[tone].main), "--tink": SEAT_TONE_HEX[tone].ink } as CSSProperties;
}

/** The words of the camera chip for the stored camera. */
export function cameraLabel(camera: CameraState, nameOf: (seat: number) => string, anchorSeat: number): string {
  switch (camera.mode) {
    case "home":
      return "Home";
    case "overview":
      return "Overview";
    case "focus":
      return camera.focusSeat != null ? `Focus · ${nameOf(camera.focusSeat)}` : "Focus";
    case "look":
      return camera.lookSeat != null ? `From ${nameOf(camera.lookSeat)}'s seat` : "Look";
    case "fly":
      if (camera.fly.free) return "Plaza · free orbit";
      if (camera.fly.targetSeat != null) return camera.fly.targetSeat === anchorSeat ? "Plaza · your seat" : `Plaza · ${nameOf(camera.fly.targetSeat)}'s seat`;
      return "Plaza · fly-in";
  }
}

function Key({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

interface ViewButtonProps {
  action: string;
  label: string;
  icon?: ReactNode;
  seatStyle?: CSSProperties;
  hotkey?: string;
  pressed: boolean;
  disabled?: boolean;
  wide?: boolean;
  onClick: () => void;
}

function ViewButton({ action, label, icon, seatStyle, hotkey, pressed, disabled, wide, onClick }: ViewButtonProps) {
  return (
    <button
      type="button"
      className={styles.vb}
      data-cam={action}
      data-wide={wide ? "true" : undefined}
      aria-pressed={pressed}
      disabled={disabled}
      style={seatStyle}
      onClick={onClick}
    >
      {seatStyle ? <i className={styles.dot} aria-hidden="true" /> : icon}
      <span>{label}</span>
      {hotkey ? <Key>{hotkey}</Key> : null}
    </button>
  );
}

/**
 * The camera UI of a table: the View panel (home, overview, focus, look from a seat, fly into a seat, the fly-in,
 * and the upright switch), the camera chip with its preview lock mark, the target hint and the look-from-seat
 * banner. It only dispatches camera actions that the viewer asked for. While the preview lock is on the buttons are off.
 */
export function CameraControls({ layout, camera, locked, hint = null, nameOf, dispatch, out = [], variant = "float", view }: CameraControlsProps) {
  const [ownOpen, setOpen] = useState(false);
  const open = view ? view.open : ownOpen;
  const rivals = layout.slots.filter((slot) => slot.seat !== layout.anchorSeat && !out.includes(slot.seat));
  // A 3-way table with two seats left is a face-off: it has one view, so Overview, Focus, Look and the fly-in do nothing.
  const faceOff = isFaceOff(layout, out);
  const flyOn = camera.mode === "fly";
  const flyReady = camera.flyIn !== false;
  const label = cameraLabel(camera, nameOf, layout.anchorSeat);
  const plaza = layout.format === "ffa3" && !faceOff;
  const enlarged = plaza && camera.mode === "focus";
  const keysHint = faceOff ? "" : flyOn ? "Drag · wheel · 1-3 · Esc" : enlarged ? "Click the field again · Esc back" : plaza ? "Click a field to enlarge · E yours · P look · 0 overview" : "Tab focus · P look · 0 overview";

  const showPanel = variant !== "stage";
  const showStage = variant !== "panel";

  return (
    <>
      {showPanel ? (
      <div
        className={styles.panel}
        data-camera-panel
        data-variant={variant === "panel" ? "column" : undefined}
        data-side={view ? "left" : undefined}
        data-open={open ? "true" : "false"}
        data-locked={locked ? "true" : undefined}
      >
        {view ? null : <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls="camera-view-grid"
          onClick={() => setOpen((value) => !value)}
        >
          <Video size={13} aria-hidden="true" />
          <span>View</span>
          <Key>{open ? "close" : "H"}</Key>
        </button>}
        {open ? (
          <div id="camera-view-grid" className={styles.grid} role="group" aria-label="Camera">
            <ViewButton action="home" label="Home" icon={<House size={13} aria-hidden="true" />} hotkey="H" pressed={camera.mode === "home"} disabled={locked} onClick={() => dispatch({ type: "home" })} />
            {faceOff ? null : (
              <>
                <ViewButton
                  action="overview"
                  label="Overview"
                  icon={<Orbit size={13} aria-hidden="true" />}
                  hotkey="O"
                  pressed={camera.mode === "overview" || (flyOn && camera.fly.targetSeat == null && !camera.fly.free)}
                  disabled={locked}
                  onClick={() => dispatch({ type: "overview" })}
                />
                <div className={styles.sec}>
                  Focus a rival <Key>Tab</Key>
                </div>
                {rivals.map((slot) => (
                  <ViewButton
                    key={`focus-${slot.seat}`}
                    action={`focus:${slot.seat}`}
                    label={nameOf(slot.seat)}
                    seatStyle={toneVars(layout, slot.seat)}
                    pressed={camera.mode === "focus" && camera.focusSeat === slot.seat}
                    disabled={locked}
                    onClick={() => dispatch({ type: "focus", seat: slot.seat })}
                  />
                ))}
                <div className={styles.sec}>
                  Look from seat <Key>P</Key>
                </div>
                {rivals.map((slot) => (
                  <ViewButton
                    key={`look-${slot.seat}`}
                    action={`look:${slot.seat}`}
                    label={`${nameOf(slot.seat)}'s seat`}
                    seatStyle={toneVars(layout, slot.seat)}
                    pressed={camera.mode === "look" && camera.lookSeat === slot.seat}
                    disabled={locked}
                    onClick={() => dispatch({ type: "look", seat: slot.seat })}
                  />
                ))}
              </>
            )}
            {flyOn && !faceOff ? (
              <>
                <div className={styles.sec}>
                  Fly into a seat <Key>1-{layout.slots.length}</Key>
                </div>
                <div className={styles.row}>
                  {layout.slots.map((slot, index) => (
                    <ViewButton
                      key={`fly-${slot.seat}`}
                      action={`fly:${slot.seat}`}
                      label={slot.seat === layout.anchorSeat ? "You" : nameOf(slot.seat)}
                      seatStyle={toneVars(layout, slot.seat)}
                      hotkey={String(index + 1)}
                      pressed={camera.fly.targetSeat === slot.seat}
                      disabled={locked}
                      onClick={() => dispatch({ type: "flyTo", seat: slot.seat })}
                    />
                  ))}
                </div>
              </>
            ) : null}
            {faceOff ? null : <ViewButton action="fly" label={`Fly-in overview ${flyReady ? "on" : "off"}`} icon={<Orbit size={13} aria-hidden="true" />} hotkey="F" pressed={flyReady} disabled={locked} wide onClick={() => dispatch({ type: "toggleFly" })} />}
            <ViewButton action="upright" label={`Upright text ${camera.upright ? "on" : "off"}`} icon={<Focus size={13} aria-hidden="true" />} hotkey="S" pressed={camera.upright} wide onClick={() => dispatch({ type: "toggleUpright" })} />
          </div>
        ) : null}
      </div>
      ) : null}

      {showStage ? (
        <>
      <div className={styles.chip} data-camera-chip data-lock={locked ? "true" : undefined} role="status">
        <Focus size={13} aria-hidden="true" />
        <b>{label}</b>
        {keysHint ? <span className={styles.hint}>{keysHint}</span> : null}
        {enlarged ? (
          <button type="button" className={styles.back} data-camera-back disabled={locked} onClick={() => dispatch({ type: "home" })}>
            Back <Key>Esc</Key>
          </button>
        ) : null}
        <span className={styles.lock}>
          <Lock size={11} aria-hidden="true" />
          Camera locked · FX
        </span>
      </div>

      <div className={styles.phoneSeats} data-seat-switcher role="group" aria-label="Switch seat view">
        <button type="button" data-seat-switch="home" aria-pressed={camera.mode === "home"} disabled={locked} onClick={() => dispatch({ type: "home" })}>
          <House size={12} aria-hidden="true" />
          Home
        </button>
        {(faceOff ? [] : rivals).map((slot) => (
          <button
            key={`switch-${slot.seat}`}
            type="button"
            data-seat-switch={slot.seat}
            aria-pressed={camera.mode === "focus" && camera.focusSeat === slot.seat}
            data-target-hint={hint?.seat === slot.seat ? "true" : undefined}
            disabled={locked}
            style={toneVars(layout, slot.seat)}
            onClick={() => dispatch({ type: "focus", seat: slot.seat })}
          >
            <i className={styles.dot} aria-hidden="true" />
            {nameOf(slot.seat).split(" ")[0]}
          </button>
        ))}
        {faceOff ? null : (
          <button type="button" data-seat-switch="overview" aria-pressed={camera.mode === "overview"} disabled={locked} onClick={() => dispatch({ type: "overview" })}>
            <Orbit size={12} aria-hidden="true" />
            All
          </button>
        )}
      </div>

      {hint ? (
        <div className={styles.cue} data-camera-hint style={toneVars(layout, hint.seat)} role="status">
          <span>
            {hint.reason} on <b>{nameOf(hint.seat)}</b>&apos;s field
          </span>
          <button type="button" onClick={() => dispatch({ type: "focus", seat: hint.seat })} disabled={locked}>
            Show
          </button>
        </div>
      ) : null}

      {camera.mode === "look" && camera.lookSeat != null ? (
        <div className={styles.look} data-camera-look data-format={layout.format} title="Their hand stays hidden." style={toneVars(layout, camera.lookSeat)} role="status">
          <Eye size={14} aria-hidden="true" />
          <span>
            Looking from <b>{nameOf(camera.lookSeat)}</b>&apos;s seat.<span className={styles.lookNote}> Their hand stays hidden.</span>
          </span>
          <button type="button" onClick={() => dispatch({ type: "home" })} disabled={locked}>
            Back to my seat <Key>H</Key>
          </button>
        </div>
      ) : null}
        </>
      ) : null}
    </>
  );
}
