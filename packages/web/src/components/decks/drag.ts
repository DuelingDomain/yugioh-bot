import type { DragEvent } from "react";
import type { DeckSection } from "./model";

/** Card drags carry their own type, so a file dropped on the editor is never read as a card. */
export const CARD_DRAG_TYPE = "application/x-yugidraft-card";

export type CardDragSource = "list" | "master" | DeckSection;

export interface CardDrag {
  code: number;
  from: CardDragSource;
  /** Position in the source section, so the dragged copy (not another one) moves. */
  index?: number;
}

const SOURCES: readonly CardDragSource[] = ["list", "master", "main", "extra", "side"];

export function writeCardDrag(event: DragEvent, drag: CardDrag): void {
  event.dataTransfer.setData(CARD_DRAG_TYPE, JSON.stringify(drag));
  event.dataTransfer.setData("text/plain", String(drag.code));
  event.dataTransfer.effectAllowed = drag.from === "list" ? "copy" : "move";
}

export function hasCardDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(CARD_DRAG_TYPE);
}

export function readCardDrag(event: DragEvent): CardDrag | null {
  try {
    const parsed: unknown = JSON.parse(event.dataTransfer.getData(CARD_DRAG_TYPE));
    if (!parsed || typeof parsed !== "object") return null;
    const { code, from, index } = parsed as Record<string, unknown>;
    if (typeof code !== "number" || !Number.isSafeInteger(code) || code <= 0) return null;
    if (!SOURCES.includes(from as CardDragSource)) return null;
    const drag: CardDrag = { code, from: from as CardDragSource };
    if (typeof index === "number" && Number.isSafeInteger(index) && index >= 0) drag.index = index;
    return drag;
  } catch {
    return null;
  }
}
