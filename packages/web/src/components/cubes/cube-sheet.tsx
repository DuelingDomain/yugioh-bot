"use client";

import * as React from "react";
import { RotateCcw, X } from "lucide-react";
import { SheetPortal } from "@/components/sheet";
import styles from "./cubes.module.css";

/** A bottom sheet for phones (the rail is hidden there). Esc and the scrim close it. */
export function CubeBottomSheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <SheetPortal>
      <div className={styles.scrim} aria-hidden="true" onClick={onClose} />
      <div ref={ref} className={`sheet ${styles.sheetFixed}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <div className={styles.sheetHead}>
          <h2>{label}</h2>
          <button className="ib" type="button" aria-label="Close" onClick={onClose}>
            <X className="ic" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </SheetPortal>
  );
}

/** "Removed X (×2) from Main" with Undo, for ten seconds. */
export function UndoToast({
  message,
  onUndo,
  onDismiss,
  busy,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  React.useEffect(() => {
    const t = setTimeout(onDismiss, 10000);
    return () => clearTimeout(t);
  }, [message, onDismiss]);
  return (
    <SheetPortal>
      <div className={styles.toastWrap}>
        <div className={`undo ${styles.toast}`} role="status">
          <span>{message}</span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={onUndo}>
            <RotateCcw className="ic sm" aria-hidden="true" />
            Undo
          </button>
        </div>
      </div>
    </SheetPortal>
  );
}
