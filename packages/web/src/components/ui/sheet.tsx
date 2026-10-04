import * as React from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { DURATION, usePresence } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: SheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const touchStartY = React.useRef<number | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const didCaptureRef = React.useRef(false);
  // Stays mounted while the exit plays. The scroll lock, focus trap and Escape are keyed to `open`,
  // so they let go the moment the sheet starts closing.
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

  // Capture previous focus, and give it back as soon as the sheet starts closing.
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

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current == null) return;
    const diff = e.changedTouches[0].clientY - touchStartY.current;
    if (diff > 80) {
      onClose();
    }
    touchStartY.current = null;
  };

  if (!mounted) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "sheet-title" : undefined}
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
        className={cn(
          "absolute z-10 bg-surface shadow-card",
          // Mobile: bottom sheet
          "bottom-0 left-0 right-0 rounded-t-lg max-h-[90vh] overflow-y-auto",
          // Desktop: right sheet
          "md:bottom-auto md:left-auto md:right-0 md:top-0 md:h-full md:w-96 md:rounded-l-lg md:rounded-tr-none",
          // Slides in from the bottom on a phone and from the right at md; reduced motion fades instead.
          "[--mo-in:var(--d-modal-in)] [--mo-out:var(--d-modal-out)] [--mo-y:100%] md:[--mo-x:100%] md:[--mo-y:0px]",
          className
        )}
        data-mo="slide"
        data-state={state}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex items-start justify-between gap-4 p-6">
          {title && (
            <h2
              id="sheet-title"
              className="text-lg font-semibold text-text-primary font-body"
            >
              {title}
            </h2>
          )}
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
            aria-label="Close sheet"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
