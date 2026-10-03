/**
 * Decisions for the moment the organizer clicks Start duel. The server moves the table to active
 * before it answers, so a lobby that is still on screen must not treat that as a failure.
 */

/** Deck checks only make sense while decks can still change. */
export function shouldCheckDeck(sessionStatus: string): boolean {
  return sessionStatus === "lobby";
}

/**
 * True when the tab shows the "Duel is open in its own window" screen. That is only the tab that
 * opened the duel window itself (`windowOpened`), while that window is open: for a live duel, and for
 * the lobby from the click on Start duel (the request takes a moment; the pop-up already has the
 * duel). Anyone else who lands on a live duel, or whose pop-up was blocked or closed, gets the board
 * in this tab.
 */
export function ownWindowGateVisible(input: {
  status: string;
  mySeat: number | null | undefined;
  inDuelWindow: boolean;
  playHere: boolean;
  hasResult: boolean;
  starting: boolean;
  windowOpened: boolean;
}): boolean {
  if (input.inDuelWindow || input.playHere || input.mySeat == null || !input.windowOpened) return false;
  if (input.status === "active") return !input.hasResult;
  return input.status === "lobby" && input.starting;
}

export function startButtonLabel(starting: boolean): string {
  return starting ? "Starting duel…" : "Start duel";
}
