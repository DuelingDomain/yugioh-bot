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
 * First time: highlighted and recommended, never a block. A skip is safe: the table asks for the side and the zones.
 * With a saved calibration: one compact line with Redo. The record is the one the table reads.
 * "Calibrated" means the zones were saved from the calibration dialog, so the side buttons show only then (to flip a saved side).
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
    <div className={s.zonesDone}>
      {/* One live region that stays in the DOM, so a screen reader hears the change. */}
      <p className={calibrated ? s.zonesOk : s.zonesWarn} role="status" aria-live="polite">
        {calibrated ? <><Check size={15} strokeWidth={2} aria-hidden /> Calibrated</> : live ? "Not calibrated" : "Camera is off"}
      </p>
      {calibrated ? <SheetButton size="sm" onClick={onCalibrate} data-testid="lobby-cam-calibrate">Redo</SheetButton> : null}
    </div>
    {calibrated ? null : <>
      {state === "first" ? <p className={ui.hint}>{live
        ? "Put a monster upright in M1 (front-left) and a spell or trap upright in S5 (back-right). Then press Calibrate zones. The dashed grid is only a guess until you calibrate."
        : "Turn on the camera to calibrate the zones."}</p>
        : <p className={ui.hint}>At the table, you can choose your side and calibrate the zones.</p>}
      <div className={s.zonesActions}>
        <SheetButton kind={state === "first" ? "primary" : "secondary"} size="sm" disabled={!live} onClick={onCalibrate} data-testid="lobby-cam-calibrate">Calibrate zones</SheetButton>
        {state === "first" ? <SheetButton kind="quiet" size="sm" onClick={onSkip} data-testid="lobby-cam-zones-skip">Skip, calibrate at table</SheetButton> : null}
      </div>
    </>}
    {calibrated ? <FieldOrientationControls calibration={calibration} defaultSide={defaultSideFor("webcam")} confirmHint={false} onChange={onChange} /> : null}
  </div>;
}
