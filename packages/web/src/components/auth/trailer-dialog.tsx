"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { TRAILER_EMBED_URL, TRAILER_SANDBOX, TRAILER_TITLE } from "./community-links";
import { signInFontClasses } from "./fonts";
import styles from "./sign-in-shell.module.css";

/**
 * Open state for the trailer overlay plus the opener to give focus back to. The opener comes from the click event rather than
 * `document.activeElement`, because Safari does not focus a button on click.
 */
export function useTrailerDialog() {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const show = useCallback((event: MouseEvent<HTMLElement>) => {
    openerRef.current = event.currentTarget;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, []);

  return { open, show, close };
}

interface TrailerDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Large trailer overlay. It is portaled to the body (the sign-in page has tilted, clipped ancestors) and renders nothing when
 * closed, so the YouTube iframe only exists while it is open and the audio stops the moment it closes.
 */
export function TrailerDialog({ open, onClose }: TrailerDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className={`${signInFontClasses} ${styles["trailer-dialog"]}`} role="dialog" aria-modal="true" aria-label={TRAILER_TITLE}>
      <div className={styles["trailer-scrim"]} aria-hidden="true" onClick={onClose} />
      <div className={styles["trailer-panel"]} ref={panelRef}>
        <div className={styles["trailer-bar"]}>
          <span className={styles["trailer-bar-title"]} aria-hidden="true">Launch trailer</span>
          <button ref={closeRef} className={styles["trailer-close"]} type="button" onClick={onClose} aria-label="Close the trailer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className={styles["trailer-stage"]}>
          <iframe
            className={styles["trailer-frame"]}
            src={TRAILER_EMBED_URL}
            title={TRAILER_TITLE}
            sandbox={TRAILER_SANDBOX}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            tabIndex={0}
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
