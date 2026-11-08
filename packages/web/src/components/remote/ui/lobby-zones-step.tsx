"use client";

import { Check, Crosshair } from "lucide-react";
import type { FieldCalibration } from "@yugidraft/vision";
import { cx, SheetButton } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { FieldOrientationControls } from "../field-orientation";
import { defaultSideFor } from "@/lib/remote/zone-grid";
import s from "./lobby-camera-preview.module.css";
import { ZoneRowDiagram } from "./zone-row-diagram";

/**
 * The lobby's "Calibrate zones" step for a webcam. The grid on the preview shows the result live.
 * First time: highlighted and recommended, never a block. A skip is safe: the table asks for the side and the zones.
 * With a saved calibration: one compact line with Recalibrate. The record is the one the table reads.
 * "Calibrated" means the zones were saved from the calibration dialog, so the side buttons show only then (to flip a saved side).
 */
export function LobbyZonesStep({ live, calibrated, changed = false, skipped, calibration, onCalibrate, onCheck, onSkip, onChange }: {
  live: boolean; calibrated: boolean; /** A saved calibration made with an older zone layout: it must be checked again. */ changed?: boolean; skipped: boolean; calibration?: FieldCalibration;
  onCalibrate(): void; onCheck?(): void; onSkip(): void; onChange(value: FieldCalibration): void;
}) {
  const state = calibrated ? "done" : changed ? "changed" : skipped ? "skipped" : "first";
  return <div className={s.zones} data-testid="lobby-cam-zones" data-state={state} data-recommended={state === "first" && live ? "" : undefined}>
    <div className={s.zonesHead}>
      <span className={cx(ui.label, s.rowLabel)}><Crosshair size={13} strokeWidth={1.6} aria-hidden /> Calibrate zones</span>
      {state === "first" && live ? <span className={s.badge}>Recommended · one time</span> : null}
    </div>
    <div className={s.zonesDone}>
      {/* One live region that stays in the DOM, so a screen reader hears the change. */}
      <p className={calibrated ? s.zonesOk : s.zonesWarn} role="status" aria-live="polite">
        {calibrated ? <><Check size={15} strokeWidth={2} aria-hidden /> Calibrated</> : changed ? "Check needed" : live ? "Not calibrated" : "Camera is off"}
      </p>
      {calibrated ? <SheetButton size="sm" onClick={onCalibrate} data-testid="lobby-cam-calibrate">Recalibrate</SheetButton> : null}
    </div>
    {changed ? <>
      <p className={ui.hint} role="status" data-testid="lobby-cam-zones-changed">The zone layout changed. Check your zones.</p>
      <div className={s.zonesActions}>
        <SheetButton kind="primary" size="sm" disabled={!live} onClick={onCheck} data-testid="lobby-cam-check-zones">Check zones</SheetButton>
        <SheetButton size="sm" disabled={!live} onClick={onCalibrate} data-testid="lobby-cam-calibrate">Recalibrate</SheetButton>
      </div>
    </> : calibrated ? null : <>
      {state === "first" ? <><p className={ui.hint}>{live
        ? "Put a monster upright in M1: in the Main Monster row (the row nearer the middle of the table), at the far left. Put a spell or trap upright in S5: in the Spell & Trap row (the row nearest you), at the far right. Then press Calibrate zones. The dashed grid is only a guess until you calibrate."
        : "Turn on the camera to calibrate the zones."}</p>{live ? <ZoneRowDiagram /> : null}</>
        : <p className={ui.hint}>At the table, you can choose your side and calibrate the zones.</p>}
      <div className={s.zonesActions}>
        <SheetButton kind={state === "first" ? "primary" : "secondary"} size="sm" disabled={!live} onClick={onCalibrate} data-testid="lobby-cam-calibrate">Calibrate zones</SheetButton>
        {state === "first" ? <SheetButton kind="quiet" size="sm" onClick={onSkip} data-testid="lobby-cam-zones-skip">Skip, calibrate at table</SheetButton> : null}
      </div>
    </>}
    {calibrated ? <FieldOrientationControls calibration={calibration} defaultSide={defaultSideFor("webcam")} confirmHint={false} onChange={onChange} /> : null}
  </div>;
}
