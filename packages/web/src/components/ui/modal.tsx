import * as React from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { DURATION, usePresence } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const didCaptureRef = React.useRef(false);
  // Stays mounted while the exit plays. Everything that traps the user (scroll lock, focus trap,
  // Escape) is keyed to `open`, so it lets go the moment the dialog starts closing.
  const { mounted, state } = usePresence(open, DURATION.modalOut);

  // Lock body scroll
  React.useEffect(() => {
    if (open) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [open]);

  // Escape to close
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Capture previous focus, and give it back as soon as the dialog starts closing.
  React.useEffect(() => {
    if (open) {
      if (!didCaptureRef.current) {
        previousFocusRef.current = document.activeElement as HTMLElement | null;
        didCaptureRef.current = true;
      }
      return;
    }
    didCaptureRef.current = false;
    const previous = previousFocusRef.current;
    previousFocusRef.current = null;
    if (previous?.isConnected) previous.focus();
  }, [open]);

  // Initial focus
  React.useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
  }, [open]);

  // Focus trap
  useFocusTrap(panelRef, open);

  if (!mounted) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
      inert={!open}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-bg-deep/80 backdrop-blur-sm"
        data-mo="scrim"
        data-state={state}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn("relative z-10 w-full max-w-lg rounded-lg bg-bg-surface p-6 shadow-card", className)}
        data-mo="modal"
        data-state={state}
      >
        <div className="flex items-start justify-between gap-4">
          {title && (
            <h2
              id="modal-title"
              className="text-lg font-semibold text-text-primary font-body"
            >
              {title}
            </h2>
          )}
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
