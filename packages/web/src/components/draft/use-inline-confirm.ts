"use client";

import * as React from "react";

/**
 * Open state for an inline ConfirmPanel that replaces the button that opened it.
 * Escape backs out (unless the action is running), and backing out puts focus back on
 * that button, which has just re-mounted.
 */
export function useInlineConfirm(busy = false) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const wasOpen = React.useRef(false);

  React.useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      e.stopPropagation();
      setOpen(false);
    },
    [busy],
  );

  return { open, setOpen, triggerRef, onKeyDown };
}
