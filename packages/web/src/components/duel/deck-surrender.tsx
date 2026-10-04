"use client";

import { createContext, useContext } from "react";
import type { DuelPromptOption } from "@yugidraft/shared/duels";

/**
 * What the room tells the field about surrender: whose deck is the viewer's, whether surrender is open
 * (a live player, the duel not over, not already out), and what to do on "Surrender" (open the confirm).
 * The field reads it, so no prop passes through the shells and stages in between.
 */
export type DeckSurrenderValue = {
  /** The viewer's seat; null for a spectator. */
  seat: number | null;
  /** False once the duel is over, or when the viewer is out or only watches. */
  available: boolean;
  /** True while an action runs or the connection is down: Surrender stays visible but cannot be chosen. */
  busy: boolean;
  /** Opens the "Are you sure?" confirm. The confirm itself calls the existing surrender action. */
  onSurrender: () => void;
  /** Tells the room the menu is open, so the prompt keys and the right-click decline stay quiet meanwhile. */
  onMenuOpenChange?: (open: boolean) => void;
};

export const DeckSurrenderContext = createContext<DeckSurrenderValue | null>(null);

/** The surrender seam, or null when no room provides one. */
export function useDeckSurrender(): DeckSurrenderValue | null {
  return useContext(DeckSurrenderContext);
}

/** True when the deck of `ownerSeat` offers the Surrender menu: it is the viewer's own and surrender is open. */
export function deckOffersSurrender(surrender: DeckSurrenderValue | null, ownerSeat: number): boolean {
  return surrender != null && surrender.available && surrender.seat != null && surrender.seat === ownerSeat;
}

export const DECK_USE_ID = "deck_use";
export const DECK_SURRENDER_ID = "surrender";

/** Menu rows for your deck: its normal action first (when it has one), then Surrender. */
export function deckMenuOptions(hasAction: boolean): DuelPromptOption[] {
  const options: DuelPromptOption[] = [];
  if (hasAction) options.push({ id: DECK_USE_ID, label: "Use Main Deck" });
  options.push({ id: DECK_SURRENDER_ID, label: "Surrender" });
  return options;
}
