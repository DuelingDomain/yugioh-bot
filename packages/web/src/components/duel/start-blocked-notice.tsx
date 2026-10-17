"use client";

import { cx, sheetButtonClass } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import { ownStartBlockedText, type OwnStartBlocked } from "./start-blocked";

// An empty region stays on the page so a screen reader announces the text when it arrives; it takes no room.
const HIDDEN = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

/**
 * A quiet note under the seats when a deck stops the start. The owner reads the reason and the card names;
 * everybody else reads the neutral line, which names no card.
 */
export function StartBlockedNotice({ own, neutral, onEditDeck, lockedText, reasonShown = false, className }: {
  own?: OwnStartBlocked | null;
  neutral?: string | null;
  /** Moves to the deck editor on this screen. */
  onEditDeck?: () => void;
  /** Said instead of an edit action when the deck cannot be edited here. */
  lockedText?: string;
  /** Another line already shows the reason (an error): keep only what it leaves out. */
  reasonShown?: boolean;
  className?: string;
}) {
  const text = own ? [ownStartBlockedText(own, reasonShown), lockedText].filter(Boolean).join(" ") : (neutral ?? "");
  const edit = own && onEditDeck;
  return (
    <div className={cx(ui.hint, className)} role="status" data-testid="start-blocked" style={text || edit ? undefined : HIDDEN}>
      <span>{text}</span>
      {edit ? <> <button type="button" className={sheetButtonClass("quiet", "sm")} onClick={onEditDeck}>Edit your deck</button></> : null}
    </div>
  );
}
