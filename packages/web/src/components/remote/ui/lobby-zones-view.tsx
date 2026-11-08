"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Crosshair } from "lucide-react";
import { createFieldCalibration, type FieldCalibration, type FieldFormat } from "@yugidraft/vision";
import { cx, SheetButton, sheetRoot } from "@/components/duel/sheet-ui";
import { defaultSideFor } from "@/lib/remote/zone-grid";
import { FieldMoveSurface, FieldTransformControls, useFieldTransform } from "../field-transform";
import { FieldOrientationControls } from "../field-orientation";
import { PreviewGrid } from "./lobby-preview-grid";
import s from "./lobby-zones-view.module.css";

/**
 * The large check for the lobby webcam: the live feed under the zone grid, as big as the screen allows.
 * Move, size, width, height, flip, undo, reset and Recalibrate are here, so the grid can be judged and fixed in one place.
 * The zones keep their shape; only the whole grid moves. "Looks good" closes it.
 * Escape closes it too, and focus goes back to the control that opened it (or to `restoreFocus`).
 */
export function LobbyZonesView({ stream, ratio, format, calibration, calibrated, changed = false, onConfirm, restoreFocus, onChange, onRedo, onClose }: {
  stream: MediaStream | null; ratio: number; format: FieldFormat; calibration?: FieldCalibration; calibrated: boolean;
  /** The saved zones were made with an older layout: shown for a check, and "Looks good" confirms them. */ changed?: boolean; onConfirm?(): void;
  restoreFocus?: () => HTMLElement | null;
  onChange(value: FieldCalibration): void; onRedo(): void; onClose(): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const restore = useRef(restoreFocus); restore.current = restoreFocus;
  const video = useRef<HTMLVideoElement>(null);
  const usable = calibrated || changed;
  const latest = useRef(calibration); latest.current = calibration;
  // Every change is saved at once, with the side the player already set.
  const tf = useFieldTransform(calibration?.corners, corners => {
    const side = latest.current?.orientation;
    if (!side) return;
    try { onChange(createFieldCalibration(corners, side)); } catch { /* the transform keeps the field inside the picture */ }
  }, ratio);

  useEffect(() => {
    const el = video.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => { /* The picture shows once the browser allows it. */ });
    return () => { el.srcObject = null; };
  }, [stream]);

  // Focus trap, Escape and focus return: the same pattern as the calibration dialog.
  useLayoutEffect(() => {
    const modal = dialog.current; if (!modal) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    modal.focus({ preventScroll: true });
    const focusable = () => Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled),summary,input:not(:disabled),[tabindex="0"]'));
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); modal.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modal)) { event.preventDefault(); first.focus(); }
    };
    const contain = (event: FocusEvent) => { if (!modal.contains(event.target as Node)) modal.focus({ preventScroll: true }); };
    document.addEventListener("keydown", key, true); document.addEventListener("focusin", contain);
    return () => {
      document.removeEventListener("keydown", key, true); document.removeEventListener("focusin", contain);
      document.body.style.overflow = overflow;
      // After a Save the opener is gone (the page falls back to the body), so the Expand button takes focus.
      const target = opener && opener !== document.body && opener.isConnected ? opener : restore.current?.();
      target?.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(<div className={cx(sheetRoot, s.backdrop)} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <div ref={dialog} className={s.dialog} role="dialog" aria-modal="true" aria-label="Check field zones" tabIndex={-1} data-testid="lobby-zones-view">
      <header className={s.head}>
        <h2><Crosshair size={16} strokeWidth={1.6} aria-hidden /> Check your zones</h2>
        <p className={calibrated ? s.ok : s.warn}>{calibrated ? <><Check size={14} strokeWidth={2} aria-hidden /> Calibrated</> : changed ? "The zone layout changed. Check that the zones line up with your mat, then press Looks good." : "Not calibrated. The dashed grid is only a guess."}</p>
      </header>
      <div className={s.stage} style={{ "--ar": ratio.toFixed(4) } as React.CSSProperties}>
        <video ref={video} className={s.video} autoPlay muted playsInline data-testid="lobby-zones-view-video" />
        <PreviewGrid calibration={calibration} format={format} kind="webcam" guess={!usable} large ratio={ratio} />
        {usable ? <FieldMoveSurface tf={tf} /> : null}
      </div>
      <div className={s.controls}>
        {usable ? <>
          <FieldOrientationControls calibration={calibration} defaultSide={defaultSideFor("webcam")} confirmHint={false} onChange={onChange} />
          <FieldTransformControls tf={tf} />
        </> : <p className={s.note}>Press Calibrate zones to place the grid on your mat. Then you can move it, resize it and set the side here.</p>}
        <div className={s.actions}>
          <SheetButton size="sm" onClick={onRedo} data-testid="lobby-zones-view-calibrate">{usable ? "Recalibrate" : "Calibrate zones"}</SheetButton>
          <SheetButton kind="primary" size="sm" onClick={() => { if (changed) onConfirm?.(); onClose(); }} data-testid="lobby-zones-view-done">Looks good</SheetButton>
        </div>
      </div>
    </div>
  </div>, document.body);
}
