"use client";

import type { Rect } from "./popup";
import s from "./remote-ui.module.css";
import x from "./surrender.module.css";

/** "Surrender this game?" The Cancel button has the focus, so Enter never gives the game up by accident. */
export function SurrenderConfirm({ open, game, bestOf, seatCount, solo, name, busy, onConfirm, onCancel }: {
  open: boolean; /** The game in progress: 1, 2 or 3. */ game: number; bestOf: number; seatCount: number;
  /** A solo table: the seat whose turn it is gives up, to end the test game. */ solo: boolean; /** Who gives up. */ name: string;
  busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  const body = solo ? `${name} gives up. The test game ends right away.`
    : seatCount > 2 ? "You are out of this game right away. The others play on."
      : "You lose this game right away.";
  return <div className={x.scrim} data-testid="surrender-scrim">
    <div className={x.dialog} data-layer="surrender" role="alertdialog" aria-modal="true" aria-labelledby="surrender-q" aria-describedby="surrender-d" data-testid="surrender-confirm">
      {bestOf === 3 ? <p className={x.kicker} data-testid="surrender-game">Game {game} of 3</p> : null}
      <h2 id="surrender-q" className={x.title}>Surrender this game?</h2>
      <p id="surrender-d" className={x.body}>{body}</p>
      <div className={x.actions}>
        <button type="button" className={`${s.btn} ${x.yes}`} disabled={busy} onClick={onConfirm} data-testid="surrender-yes">Surrender</button>
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
