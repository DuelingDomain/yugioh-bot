"use client";

import Link from "next/link";
import type { SavedDeckView } from "../decks/api";
import { cx, sheetButtonClass } from "./sheet-ui";
import styles from "./deck-editor.module.css";

/** Where the editor for a saved deck is. The room query lets the editor link back to the room and keep it open. */
export function deckEditHref(saved: SavedDeckView, roomSlug?: string): string {
  return saved.editHref ?? `/decks/${saved.id}${roomSlug ? `?room=${encodeURIComponent(roomSlug)}` : ""}`;
}

/** The "Edit" action of one saved deck. It opens the deck editor in this tab, with a way back to the room. */
export function EditDeckLink({ saved, roomSlug, onBeforeEdit, className }: {
  saved: SavedDeckView; roomSlug?: string; onBeforeEdit?: () => boolean; className?: string;
}) {
  return (
    <Link href={deckEditHref(saved, roomSlug)} className={cx(sheetButtonClass("secondary", "sm"), styles.editLink, className)}
      aria-label={`Edit ${saved.name}`}
      onClick={(event) => { if (onBeforeEdit && !onBeforeEdit()) event.preventDefault(); }}>
      Edit
    </Link>
  );
}

