"use client";

import type { Rect } from "./popup";
import s from "./remote-ui.module.css";
import x from "./surrender.module.css";

/** "Surrender this game?" The Cancel button has the focus, so Enter never gives the game up by accident. */
export function SurrenderConfirm({ open, mode = "game", game, bestOf, seatCount, solo, name, busy, onConfirm, onCancel }: {
  open: boolean; /** "game": lose this game. "match": quit the whole match, which cannot be undone. */ mode?: "game" | "match"; /** The game in progress: 1, 2 or 3. */ game: number; bestOf: number; seatCount: number;
  /** A solo table: the seat whose turn it is gives up, to end the test game. */ solo: boolean; /** Who gives up. */ name: string;
  busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  const quit = mode === "match";
  const body = quit ? (seatCount > 2 ? "You leave the match for good. The others play on without you. This cannot be undone." : "You lose the whole match and your opponent wins. This cannot be undone.")
    : solo ? `${name} gives up. The test game ends right away.`
    : seatCount > 2 ? "You are out of this game right away. The others play on."
      : "You lose this game right away.";
  return <div className={x.scrim} data-testid="surrender-scrim">
    <div className={x.dialog} data-layer="surrender" role="alertdialog" aria-modal="true" aria-labelledby="surrender-q" aria-describedby="surrender-d" data-testid="surrender-confirm">
      {bestOf === 3 && !quit ? <p className={x.kicker} data-testid="surrender-game">Game {game} of 3</p> : null}
      <h2 id="surrender-q" className={x.title}>{quit ? "Quit the match?" : "Surrender this game?"}</h2>
      <p id="surrender-d" className={x.body}>{body}</p>
      <div className={x.actions}>
        <button type="button" className={`${s.btn} ${x.yes}`} disabled={busy} onClick={onConfirm} data-testid={quit ? "quit-yes" : "surrender-yes"}>{quit ? "Quit match" : "Surrender"}</button>
        <button type="button" className={s.btn} onClick={onCancel} data-autofocus data-testid="surrender-no">Cancel</button>
      </div>
    </div>
  </div>;
}

/** The small menu on my own Deck pile on the virtual field. */
export function DeckMenu({ open, anchor, deckCards, onView, onSurrender }: {
  open: boolean; anchor: Rect | null; /** Cards the table holds in my Deck. */ deckCards: number; onView: () => void; onSurrender: () => void;
}) {
  if (!open) return null;
  const width = 190;
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const left = anchor ? Math.max(8, Math.min(vw - width - 8, (anchor.left + anchor.right) / 2 - width / 2)) : 8;
  // Above the pile: the Deck sits in the lower row of the field.
  const bottom = anchor && typeof window !== "undefined" ? Math.max(8, window.innerHeight - anchor.top + 8) : 8;
  return <div className={x.menu} data-layer="deck" role="group" aria-label="Deck actions" style={{ left, bottom, width }} data-testid="deck-menu">
    {deckCards > 0 ? <button type="button" className={x.item} onClick={onView} data-testid="deck-menu-view">View Deck <small>{deckCards}</small></button> : null}
    <button type="button" className={`${x.item} ${x.bad}`} onClick={onSurrender} data-testid="deck-menu-surrender">Surrender</button>
  </div>;
}

/**
 * Surrender and Quit for the screens that cover the top bar: the die roll, the result and side decking.
 * Surrender is only offered while a game is live (the die roll); between games only Quit makes sense.
 */
export function LeaveDock({ onSurrender, onQuit }: { onSurrender?: () => void; onQuit?: () => void }) {
  if (!onSurrender && !onQuit) return null;
  return <div className={x.dock} role="group" aria-label="Leave" data-testid="leave-dock">
    {onSurrender ? <button type="button" className={`${s.btn} ${s.sm} ${x.dockBtn}`} onClick={onSurrender} data-testid="dock-surrender">Surrender</button> : null}
    {onQuit ? <button type="button" className={`${s.btn} ${s.sm} ${x.dockBtn}`} onClick={onQuit} data-testid="dock-quit">Quit match</button> : null}
  </div>;
}
