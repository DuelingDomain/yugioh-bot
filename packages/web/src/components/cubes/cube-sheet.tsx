"use client";

import * as React from "react";
import { RotateCcw, X } from "lucide-react";
import { SheetPortal } from "@/components/sheet";
import { DURATION, usePresence } from "@/lib/motion";
import styles from "./cubes.module.css";

/**
 * A bottom sheet for phones (the rail is hidden there). Esc and the scrim close it.
 * It stays mounted while it slides out, showing the label and content it had when it was open.
 * Escape and the focus return belong to `open`, so they let go the moment it starts closing.
 */
export function CubeBottomSheet({
  open,
  label,
  onClose,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { mounted, state } = usePresence(open, DURATION.modalOut);
  const shown = React.useRef({ label, children });
  if (open) shown.current = { label, children };
  const ref = React.useRef<HTMLDivElement | null>(null);
  // SheetPortal renders one tick after this component, so the sheet takes focus when it attaches.
  const attach = React.useCallback((node: HTMLDivElement | null) => {
    const first = ref.current === null && node !== null;
    ref.current = node;
    if (first) node?.focus();
  }, []);
  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <SheetPortal>
      <div className={styles.scrim} data-mo="scrim" data-state={state} aria-hidden="true" onClick={onClose} />
      <div
        ref={attach}
        className={`sheet ${styles.sheetFixed}`}
        data-mo="slide"
        data-state={state}
        inert={!open}
        role="dialog"
        aria-modal="true"
        aria-label={shown.current.label}
        tabIndex={-1}
      >
        <div className={styles.sheetHead}>
          <h2>{shown.current.label}</h2>
          <button className="ib" type="button" aria-label="Close" onClick={onClose}>
            <X className="ic" aria-hidden="true" />
          </button>
        </div>
        {shown.current.children}
      </div>
    </SheetPortal>
  );
}

/**
 * "Removed X (×2) from Main" with Undo, for ten seconds. It rises in and settles out; while it leaves it
 * keeps the message it showed. `resetKey` restarts the ten seconds for a new removal.
 */
export function UndoToast({
  open,
  message,
  resetKey,
  onUndo,
  onDismiss,
  busy,
}: {
  open: boolean;
  message: string;
  resetKey?: number;
  onUndo: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const { mounted, state } = usePresence(open, DURATION.toastOut);
  const shown = React.useRef(message);
  if (open) shown.current = message;
  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(onDismiss, 10000);
    return () => clearTimeout(t);
  }, [open, message, resetKey, onDismiss]);
  if (!mounted) return null;
  return (
    <SheetPortal>
      <div className={styles.toastWrap}>
        <div className={`undo ${styles.toast}`} data-mo="slide" data-state={state} inert={!open} role="status">
          <span>{shown.current}</span>
          <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={onUndo}>
            <RotateCcw className="ic sm" aria-hidden="true" />
            Undo
          </button>
        </div>
      </div>
    </SheetPortal>
  );
}
