"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { SheetPortal } from "@/components/sheet";
import styles from "./editor.module.css";

/** A phone reader with keyboard containment and focus restored to the tapped tile. */
export function CardBottomSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>("button")?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const items = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]');
      const first = items?.[0];
      const last = items?.[items.length - 1];
      if (!first || !last) { event.preventDefault(); panel.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey, true);
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, []);
  return (
    <SheetPortal>
      <div className={styles["de-scrim"]} aria-hidden="true" onClick={onClose} />
      <section ref={panel} className={styles["de-bs"]} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <span className={styles["de-grab"]} aria-hidden="true" />
        <button type="button" className={styles["de-bs-close"]} aria-label="Close card" onClick={onClose}><X className="ic" aria-hidden /></button>
        {children}
      </section>
    </SheetPortal>
  );
}
