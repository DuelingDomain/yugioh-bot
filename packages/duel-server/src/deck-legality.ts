import { inspectDeck as sharedInspectDeck, deckSuggestionScope as sharedScope, DeckLegalityError, type InspectDeckOptions } from "@yugidraft/shared/deck-legality";
import type { DuelMode, DuelDeck, DuelSettings } from "@yugidraft/shared/duels";
import { loadCardBlockList } from "./card-block-list.js";
export { DeckLegalityError, ExtraDeckCardError, validateExtraDeckTypes, validateDeckMasterType } from "@yugidraft/shared/deck-legality";
export type { InspectDeckOptions, DeckSuggestionScope, MultiplayerTable } from "@yugidraft/shared/deck-legality";
export function inspectDeck(mode: DuelMode, deck: DuelDeck, directory: string, settings?: DuelSettings, options: InspectDeckOptions = {}) {
  return sharedInspectDeck(mode, deck, directory, settings, { ...options, cardBlocks: options.cardBlocks ?? loadCardBlockList(undefined, directory) });
}
export function validateDeck(mode: DuelMode, deck: DuelDeck, directory: string, settings?: DuelSettings, options: InspectDeckOptions = {}): void {
  const issue = inspectDeck(mode, deck, directory, settings, options).issues[0];
  if (issue) throw new DeckLegalityError(issue.message);
}
export function deckSuggestionScope(mode: DuelMode, directory: string, settings: DuelSettings, options: Parameters<typeof sharedScope>[3] = {}) {
  return sharedScope(mode, directory, settings, { ...options, cardBlocks: options.cardBlocks ?? loadCardBlockList(undefined, directory) });
}
