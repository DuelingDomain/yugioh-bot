"use client";

import Link from "next/link";
import { cx, sheetButtonClass } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import { ownStartBlockedText, type OwnStartBlocked } from "./start-blocked";

/**
 * A quiet note under the seats when a deck stops the start. The owner reads the reason and the card names;
 * everybody else reads the neutral line, which names no card.
 */
export function StartBlockedNotice({ own, neutral, onEditDeck, deckHref, className }: {
  own?: OwnStartBlocked | null;
  neutral?: string | null;
  /** Moves to the deck editor on this screen. */
  onEditDeck?: () => void;
  /** Where the deck is edited when this screen has no editor. */
  deckHref?: string;
  className?: string;
}) {
  if (!own && !neutral) return null;
  return (
    <div className={cx(ui.hint, className)} role="status" data-testid="start-blocked">
      <span>{own ? ownStartBlockedText(own) : neutral}</span>
      {own && onEditDeck ? <> <button type="button" className={sheetButtonClass("quiet", "sm")} onClick={onEditDeck}>Edit your deck</button></> : null}
      {own && !onEditDeck && deckHref ? <> <Link href={deckHref} className={sheetButtonClass("quiet", "sm")}>Edit your deck</Link></> : null}
    </div>
  );
}
