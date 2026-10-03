"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { Segmented, SheetPortal } from "@/components/sheet";
import { isMotion, type Motion } from "./use-animations";
import styles from "./fx.module.css";

const OPTIONS: Array<{ value: Motion; label: string }> = [
  { value: "full", label: "Full" },
  { value: "calm", label: "Calm" },
  { value: "off", label: "Off" },
];

/**
 * The Animations button for the page bar, with its popover. The popover is position: fixed, so it
 * renders through SheetPortal and is placed under the button when it opens.
 */
export function AnimationsControl({ motion, reduced, onChange }: { motion: Motion; reduced: boolean; onChange: (level: Motion) => void }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = useId();

  function toggle() {
    if (!open && button.current) {
      const rect = button.current.getBoundingClientRect();
      setPlace({ top: rect.bottom + 8, right: Math.max(10, window.innerWidth - rect.right) });
    }
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (pop.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <>
      <button ref={button} type="button" className={styles.barButton} aria-expanded={open} aria-controls={open ? popId : undefined} aria-label="Animations" onClick={toggle}>
        <Activity size={17} strokeWidth={1.7} aria-hidden="true" />
        <span className={styles.barLabel}>Animations</span>
      </button>
      {open && place && (
        <SheetPortal>
          <div ref={pop} id={popId} className={styles.pop} style={{ top: place.top, right: place.right }} role="group" aria-label="Animations">
            <h3 className={styles.popTitle}>Animations</h3>
            <Segmented
              label="Animations"
              value={motion}
              options={reduced ? OPTIONS.filter((option) => option.value !== "full") : OPTIONS}
              onChange={(value) => { if (isMotion(value)) onChange(value); }}
            />
            <p className={styles.popNote}>
              {reduced
                ? "Your device asks for less motion, so Full is not offered. Calm keeps the moment short with no looping light. Off keeps everything still."
                : "Full plays the whole moment and the slow drift of light. Calm keeps it short with no looping light. Off keeps everything still."}
            </p>
          </div>
        </SheetPortal>
      )}
    </>
  );
}
