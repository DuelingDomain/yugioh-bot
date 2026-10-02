"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Eye, Focus, House, Lock, Orbit, Pin, PinOff, Video } from "lucide-react";
import type { CameraCue } from "./use-camera";
import { hexToRgbTriplet } from "./seat-angle";
import { SEAT_TONE_HEX, type CameraAction, type CameraState, type TableLayout } from "./types";
import styles from "./camera-controls.module.css";

export interface CameraControlsProps {
  layout: TableLayout;
  /** The stored camera (where the player left it). */
  camera: CameraState;
  locked: boolean;
  cue: CameraCue | null;
  nameOf: (seat: number) => string;
  dispatch: (action: CameraAction) => void;
  /** Seats that are out: no button for them. */
  out?: readonly number[];
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
 * upright and auto switches, the Keep pin), the camera chip with its FX lock mark, the auto-camera cue and the
 * look-from-seat banner. It only dispatches camera actions. While the FX lock is on the buttons are off.
 */
export function CameraControls({ layout, camera, locked, cue, nameOf, dispatch, out = [] }: CameraControlsProps) {
  const [open, setOpen] = useState(false);
  const rivals = layout.slots.filter((slot) => slot.seat !== layout.anchorSeat && !out.includes(slot.seat));
  const flyOn = camera.mode === "fly";
  const flyReady = camera.flyIn !== false;
  const keep = camera.pinned && camera.mode !== "home";
  const label = cameraLabel(camera, nameOf, layout.anchorSeat);
  const hint = flyOn ? "Drag · wheel · 1-3 · Esc" : "Tab focus · P look · 0 overview";

  return (
    <>
      <div className={styles.panel} data-camera-panel data-open={open ? "true" : "false"} data-locked={locked ? "true" : undefined}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls="camera-view-grid"
          onClick={() => setOpen((value) => !value)}
        >
          <Video size={13} aria-hidden="true" />
          <span>View</span>
          <Key>{open ? "close" : "H"}</Key>
        </button>
        {open ? (
          <div id="camera-view-grid" className={styles.grid} role="group" aria-label="Camera">
            <ViewButton action="home" label="Home" icon={<House size={13} aria-hidden="true" />} hotkey="H" pressed={camera.mode === "home"} disabled={locked} onClick={() => dispatch({ type: "home" })} />
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
            {flyOn ? (
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
            <ViewButton action="fly" label={`Fly-in overview ${flyReady ? "on" : "off"}`} icon={<Orbit size={13} aria-hidden="true" />} hotkey="F" pressed={flyReady} disabled={locked} wide onClick={() => dispatch({ type: "toggleFly" })} />
            <ViewButton action="upright" label={`Upright text ${camera.upright ? "on" : "off"}`} icon={<Focus size={13} aria-hidden="true" />} hotkey="S" pressed={camera.upright} wide onClick={() => dispatch({ type: "toggleUpright" })} />
            <ViewButton action="auto" label={`Auto camera ${camera.auto ? "on" : "off"}`} icon={<Focus size={13} aria-hidden="true" />} hotkey="A" pressed={camera.auto} wide onClick={() => dispatch({ type: "toggleAuto" })} />
            <ViewButton
              action="keep"
              label={keep ? "Camera kept" : "Keep this view"}
              icon={keep ? <Pin size={13} aria-hidden="true" /> : <PinOff size={13} aria-hidden="true" />}
              hotkey="K"
              pressed={keep}
              disabled={camera.mode === "home"}
              wide
              onClick={() => dispatch({ type: "pin", on: !camera.pinned })}
            />
          </div>
        ) : null}
      </div>

      <div className={styles.chip} data-camera-chip data-lock={locked ? "true" : undefined} role="status">
        <Focus size={13} aria-hidden="true" />
        <b>{label}</b>
        <span className={styles.hint}>{hint}</span>
        <span className={styles.lock}>
          <Lock size={11} aria-hidden="true" />
          Camera locked · FX
        </span>
      </div>

      {cue ? (
        <div className={styles.cue} data-camera-cue style={toneVars(layout, cue.seat)} role="status">
          <span>
            Auto camera · <b>{nameOf(cue.seat)}</b> · {cue.reason}
          </span>
          <button type="button" onClick={() => dispatch({ type: "pin", on: true })}>
            Keep
          </button>
          <button type="button" onClick={() => dispatch({ type: "home" })}>
            Home
          </button>
        </div>
      ) : null}

      {camera.mode === "look" && camera.lookSeat != null ? (
        <div className={styles.look} data-camera-look style={toneVars(layout, camera.lookSeat)} role="status">
          <Eye size={14} aria-hidden="true" />
          <span>
            Looking from <b>{nameOf(camera.lookSeat)}</b>&apos;s seat. Their hand stays hidden.
          </span>
          <button type="button" onClick={() => dispatch({ type: "home" })} disabled={locked}>
            Back to my seat <Key>H</Key>
          </button>
        </div>
      ) : null}
    </>
  );
}
