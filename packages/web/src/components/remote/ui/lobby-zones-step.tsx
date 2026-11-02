"use client";

import { Check, Crosshair } from "lucide-react";
import type { FieldCalibration } from "@yugidraft/vision";
import { cx, SheetButton } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { FieldOrientationControls } from "../field-orientation";
import { defaultSideFor } from "@/lib/remote/zone-grid";
import s from "./lobby-camera-preview.module.css";

/**
 * The lobby's "Calibrate zones" step for a webcam. The grid on the preview shows the result live.
 * First time: highlighted and recommended, never a block (the table asks again if the player skips).
 * With a saved calibration: one compact line with Redo. The record is the one the table reads.
 */
export function LobbyZonesStep({ live, calibrated, skipped, calibration, onCalibrate, onSkip, onChange }: {
  live: boolean; calibrated: boolean; skipped: boolean; calibration?: FieldCalibration;
  onCalibrate(): void; onSkip(): void; onChange(value: FieldCalibration): void;
}) {
  const state = calibrated ? "done" : skipped ? "skipped" : "first";
  return <div className={s.zones} data-testid="lobby-cam-zones" data-state={state} data-recommended={state === "first" && live ? "" : undefined}>
    <div className={s.zonesHead}>
      <span className={cx(ui.label, s.rowLabel)}><Crosshair size={13} strokeWidth={1.6} aria-hidden /> Calibrate zones</span>
      {state === "first" && live ? <span className={s.badge}>Recommended · one time</span> : null}
    </div>
    {calibrated ? <div className={s.zonesDone}>
      <p className={s.zonesOk} role="status"><Check size={15} strokeWidth={2} aria-hidden /> Calibrated <span aria-hidden>·</span> saved for this camera</p>
      <SheetButton size="sm" disabled={!live} onClick={onCalibrate} data-testid="lobby-cam-calibrate">Redo</SheetButton>
    </div> : <>
      <p className={s.zonesWarn} role="status">Not calibrated</p>
      {state === "first" ? <p className={ui.hint}>{live
        ? "Place a monster in M1 and a spell or trap in S5, flat on your mat. Then press Calibrate. The grid on the preview shows where the zones are."
        : "Turn on the camera to calibrate the zones."}</p>
        : <p className={ui.hint}>You can calibrate at the table instead.</p>}
      <div className={s.zonesActions}>
        <SheetButton kind={state === "first" ? "primary" : "secondary"} size="sm" disabled={!live} onClick={onCalibrate} data-testid="lobby-cam-calibrate">Calibrate zones</SheetButton>
        {state === "first" ? <SheetButton kind="quiet" size="sm" onClick={onSkip} data-testid="lobby-cam-zones-skip">Skip, calibrate at table</SheetButton> : null}
      </div>
    </>}
    <FieldOrientationControls calibration={calibration} defaultSide={defaultSideFor("webcam")} confirmHint={false} onChange={onChange} disabled={!live} />
  </div>;
}
