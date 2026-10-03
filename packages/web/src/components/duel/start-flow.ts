/**
 * Decisions for the moment the organizer clicks Start duel. The server moves the table to active
 * before it answers, so a lobby that is still on screen must not treat that as a failure.
 */

/** Deck checks only make sense while decks can still change. */
export function shouldCheckDeck(sessionStatus: string): boolean {
  return sessionStatus === "lobby";
}

/**
 * True when the tab shows the "Duel is open in its own window" screen. That is any live duel for a
 * seated player outside the duel window, and also the lobby from the click on Start duel when the
 * pop-up opened (the request itself takes a moment; the pop-up already has the duel).
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
  if (input.inDuelWindow || input.playHere || input.mySeat == null) return false;
  if (input.status === "active") return !input.hasResult;
  return input.status === "lobby" && input.starting && input.windowOpened;
}

export function startButtonLabel(starting: boolean): string {
  return starting ? "Starting duel…" : "Start duel";
}
