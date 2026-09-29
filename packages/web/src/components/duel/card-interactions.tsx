"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DuelCard, DuelPromptOption } from "@yugidraft/shared/duels";
import { cardDetailsText, cardStatsText } from "./constants";
import styles from "./room.module.css";

function useAnchoredPosition(anchor: HTMLElement, interactive: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });

  useLayoutEffect(() => {
    function place() {
      const surface = ref.current;
      if (!surface || !anchor.isConnected) return;
      const card = anchor.getBoundingClientRect();
      const width = surface.offsetWidth;
      const height = surface.offsetHeight;
      const margin = 8;
      const preferredLeft = interactive ? card.left : card.right + margin;
      const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin));
      const above = card.top - height - margin;
      const preferredTop = interactive && above >= margin ? above : card.bottom + margin;
      const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - height - margin));
      setPosition({ left, top, ready: true });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, interactive]);

  return { ref, style: { left: position.left, top: position.top, visibility: position.ready ? "visible" as const : "hidden" as const } };
}

export function CardActionMenu({
  anchor,
  title,
  options,
  busy,
  onChoose,
  onClose,
}: {
  anchor: HTMLElement;
  title: string;
  options: readonly DuelPromptOption[];
  busy: boolean;
  onChoose: (option: DuelPromptOption) => void;
  onClose: () => void;
}) {
  const { ref, style } = useAnchoredPosition(anchor, true);

  useLayoutEffect(() => {
    // The first layout pass measures a hidden menu; hidden items cannot focus.
    if (style.visibility !== "visible") return;
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    function dismiss(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor, onClose, ref, style.visibility]);

  return createPortal(
    <div
      ref={ref}
      className={styles.cardMenu}
      style={style}
      role="menu"
      aria-label={`${title} actions`}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key === "Tab") {
          onClose();
          return;
        }
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next: number | null = null;
        if (event.key === "ArrowDown") next = (current + 1) % buttons.length;
        if (event.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = buttons.length - 1;
        if (next != null) {
          event.preventDefault();
          buttons[next]?.focus();
        }
      }}
    >
      <div className={styles.menuTitle}>{title}</div>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => onChoose(option)}
        >
          {option.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export function CardHoverInfo({ card, anchor }: { card: DuelCard; anchor: HTMLElement }) {
  const { ref, style } = useAnchoredPosition(anchor, false);
  const stats = cardStatsText(card);
  const details = cardDetailsText(card);
  if (card.code == null) return null;

  return createPortal(
    <div ref={ref} className={styles.cardTooltip} style={style} role="tooltip">
      <strong>{card.name ?? `Card ${card.code}`}</strong>
      {stats ? <span className={styles.tooltipStats}>{stats}</span> : null}
      {details ? <span>{details}</span> : null}
    </div>,
    document.body,
  );
}
