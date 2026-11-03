"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Crosshair, LassoSelect } from "lucide-react";
import type { FieldCalibration, FieldFormat, ZoneOverrides } from "@yugidraft/vision";
import { cx, SheetButton, sheetRoot } from "@/components/duel/sheet-ui";
import { ZONE_SPACING } from "@/lib/remote/use-field-watcher";
import { defaultSideFor, displayCalibration } from "@/lib/remote/zone-grid";
import { useZoneEditor, ZoneEditorOverlay, ZoneEditorToolbar } from "../zone-editor";
import { FieldOrientationControls } from "../field-orientation";
import { PreviewGrid } from "./lobby-preview-grid";
import s from "./lobby-zones-view.module.css";

/**
 * The large check for the lobby webcam: the live feed under the zone grid, as big as the screen allows.
 * Side, spacing and Redo are here, so the zones can be judged and fixed in one place. "Looks good" closes it.
 * Escape closes it too, and focus goes back to the control that opened it (or to `restoreFocus`).
 */
export function LobbyZonesView({ stream, ratio, format, calibration, calibrated, zoneSpacing, restoreFocus, onChange, onSpacing, onZones, onRedo, onClose }: {
  stream: MediaStream | null; ratio: number; format: FieldFormat; calibration?: FieldCalibration; calibrated: boolean; zoneSpacing: number;
  restoreFocus?: () => HTMLElement | null;
  onChange(value: FieldCalibration): void; onSpacing(value: number): void; onZones(zones: ZoneOverrides | undefined): void; onRedo(): void; onClose(): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const restore = useRef(restoreFocus); restore.current = restoreFocus;
  const video = useRef<HTMLVideoElement>(null);
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(false); editingRef.current = editing;
  const shown = displayCalibration(calibration, defaultSideFor("webcam"));
  const editor = useZoneEditor(shown, format);
  const edit = () => { editor.begin(calibration?.zones); setEditing(true); };

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
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (editingRef.current) setEditing(false); else close.current(); return; }
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
        <p className={calibrated ? s.ok : s.warn}>{calibrated ? <><Check size={14} strokeWidth={2} aria-hidden /> Calibrated</> : "Not calibrated. The dashed grid is only a guess."}</p>
      </header>
      <div className={s.stage} style={{ "--ar": ratio.toFixed(4) } as React.CSSProperties}>
        <video ref={video} className={s.video} autoPlay muted playsInline data-testid="lobby-zones-view-video" />
        {editing
          ? <ZoneEditorOverlay editor={editor} ratio={ratio} />
          : <PreviewGrid calibration={calibration} format={format} kind="webcam" guess={!calibrated} large ratio={ratio} />}
      </div>
      <div className={s.controls}>
        {editing ? <ZoneEditorToolbar editor={editor} onCancel={() => setEditing(false)} onDone={zones => { setEditing(false); onZones(Object.keys(zones).length ? zones : undefined); }} />
        : calibrated ? <>
          <FieldOrientationControls calibration={calibration} defaultSide={defaultSideFor("webcam")} confirmHint={false} onChange={onChange} />
          <label className={s.spacing}>
            <span>Zone spacing</span>
            <input type="range" min={ZONE_SPACING.min} max={ZONE_SPACING.max} step={ZONE_SPACING.step} value={zoneSpacing}
              onChange={event => onSpacing(Number(event.currentTarget.value))} data-testid="lobby-zones-spacing" aria-valuetext={`${zoneSpacing.toFixed(2)} times`} />
            <output>{zoneSpacing.toFixed(2)}×</output>
          </label>
        </> : <p className={s.note}>Press Calibrate zones to place the grid on your mat. Then you can set the side and the zone spacing here.</p>}
        {editing ? null : <div className={s.actions}>
          {calibrated ? <SheetButton size="sm" onClick={edit} data-testid="lobby-zones-edit"><LassoSelect size={14} strokeWidth={1.6} aria-hidden /> Edit zones</SheetButton> : null}
          <SheetButton size="sm" onClick={onRedo} data-testid="lobby-zones-view-calibrate">{calibrated ? "Redo" : "Calibrate zones"}</SheetButton>
          <SheetButton kind="primary" size="sm" onClick={onClose} data-testid="lobby-zones-view-done">Looks good</SheetButton>
        </div>}
      </div>
    </div>
  </div>, document.body);
}
