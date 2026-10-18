"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import type { CardSummary } from "@/lib/card-types";
import { fetchCardNote, type CardNote } from "./effect-api";
import styles from "./effect-search.module.css";

const WIDTH = 300;
const GUTTER = 12;
const GAP = 10;

/** Where the card goes: left of the row, else right, else under (or over) it. Always inside the window. */
export function placeNote(anchor: DOMRect, size: { w: number; h: number }, view: { w: number; h: number }): { left: number; top: number } {
  const clampY = (y: number) => Math.max(GUTTER, Math.min(y, view.h - size.h - GUTTER));
  if (anchor.left - size.w - GAP >= GUTTER) return { left: anchor.left - size.w - GAP, top: clampY(anchor.top) };
  if (anchor.right + size.w + GAP <= view.w - GUTTER) return { left: anchor.right + GAP, top: clampY(anchor.top) };
  const left = Math.max(GUTTER, Math.min(anchor.left, view.w - size.w - GUTTER));
  const below = anchor.bottom + 6;
  const top = below + size.h <= view.h - GUTTER ? below : Math.max(GUTTER, anchor.top - size.h - 6);
  return { left, top };
}

function shortText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 260 ? `${clean.slice(0, 257)}...` : clean;
}

/**
 * The written summary of one card, shown beside its row. It is a fixed overlay on the page, so nothing in
 * the list moves when it appears. The summary is read on first need; a card with none shows its text.
 */
export function CardNotePopover({
  card,
  anchor,
  id,
  pinned = false,
}: {
  card: CardSummary;
  anchor: HTMLElement;
  id: string;
  /** Opened by the info button: it can take the pointer and the player closes it. */
  pinned?: boolean;
}) {
  const [note, setNote] = React.useState<CardNote | null>(null);
  const [failed, setFailed] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [at, setAt] = React.useState<{ left: number; top: number } | null>(null);

  React.useEffect(() => {
    let live = true;
    setNote(null);
    setFailed(false);
    fetchCardNote(card.id)
      .then((n) => live && setNote(n))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [card.id]);

  const place = React.useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const size = { w: Math.min(WIDTH, window.innerWidth - GUTTER * 2), h: box.offsetHeight };
    setAt(placeNote(anchor.getBoundingClientRect(), size, { w: window.innerWidth, h: window.innerHeight }));
  }, [anchor]);

  // Measured after paint of the text, and again when the page scrolls or resizes under a pinned card.
  React.useLayoutEffect(place, [place, note, failed, card.id]);
  React.useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);

  const host = anchor.closest(".ms") ?? document.body;
  const text = note?.summary ?? (note || failed ? shortText(card.effectText) : null);
  return createPortal(
    <div
      ref={boxRef}
      id={id}
      role="tooltip"
      className={styles.pop}
      data-pinned={pinned ? "" : undefined}
      style={{ left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? "visible" : "hidden" }}
    >
      <p className={styles.popName}>{card.name}</p>
      <p className={styles.popType}>{card.type}</p>
      {text == null ? <p className={styles.popWait}>Reading the card...</p> : <p className={styles.popText}>{text}</p>}
      {note && note.roles.length > 0 && (
        <ul className={styles.popRoles}>
          {note.roles.slice(0, 5).map((role) => (
            <li key={role}>{role.replaceAll("_", " ")}</li>
          ))}
        </ul>
      )}
    </div>,
    host,
  );
}
