"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import styles from "./replay.module.css";

/** How long an error stays over the page before it hides itself. */
export const REPLAY_TOAST_MS = 8000;

/**
 * An error over the page. It is drawn in the body, not in the controls: a `contain: layout` ancestor would make
 * `position: fixed` relative to the controls and put the message over the view buttons. It has a close button and hides itself.
 */
export function ReplayToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(onDismiss, REPLAY_TOAST_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  if (!mounted || !message) return null;
  return createPortal(
    <div role="alert" className={styles.toast}>
      <span>{message}</span>
      <button type="button" className={styles.toastClose} aria-label="Dismiss message" onClick={onDismiss}><X size={14} aria-hidden /></button>
    </div>,
    document.body,
  );
}
