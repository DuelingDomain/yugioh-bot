"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
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
  busy = false,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  className?: string;
}) {
  const headingId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
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
