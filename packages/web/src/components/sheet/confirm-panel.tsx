"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * Inline confirm. Not a modal: the caller decides where it shows. Focus moves to the
 * cancel button when it mounts, so Enter never confirms by accident.
 */
export function ConfirmPanel({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  returnFocusRef,
  busy = false,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  /** Focus target on close; use the trigger's ref when the panel replaces it. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  busy?: boolean;
  className?: string;
}) {
  const headingId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      const target = returnFocusRef?.current ?? previousFocus;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);
  return (
    <div className={cn("cfm", className)} role="dialog" aria-modal="false" aria-labelledby={headingId}>
      <h4 id={headingId}>{title}</h4>
      {children}
      <div className="acts">
        <button ref={cancelRef} className="btn btn-quiet" type="button" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button className="btn btn-danger" type="button" onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
