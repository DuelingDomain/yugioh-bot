import { capDeckSections, deckLeftOutMessages, routeDeckSections, type DeckCardType, type CardIdentityCatalog, type DuelDeck, type DuelMode } from "@yugidraft/shared/duels";
import { loadArtworkIdentityCatalog, type CardCatalogService } from "@yugidraft/shared/services";
import { resolveImportedCardList } from "./cube-list-import";
import { CardListError } from "./card-list-parser";

/** Read names, passcodes, YDK and YDKE with the server catalog. Use known card types to correct section labels. */
export async function resolveDeckImport(catalog: CardCatalogService, text: unknown, mode: unknown, engine: CardIdentityCatalog = loadArtworkIdentityCatalog(), find?: (code: number) => DeckCardType | undefined) {
  if (mode !== "normal" && mode !== "domain") throw new CardListError("Deck mode must be normal or domain.");
  const { resolved, unknown, corrected, lookupLimited } = await resolveImportedCardList(catalog, text, { keepDeckSections: true, engine, find });
  if (unknown.length && lookupLimited) throw new CardListError("The card lookup limit was reached. Try importing fewer cards at a time. No cards were imported.");
  if (unknown.length) throw new CardListError(`Could not resolve these cards: ${unknown.join(", ")}. No cards were imported.`);
  if (!resolved.length) throw new CardListError("No cards found. Add a deck file or paste a card list.");
  const raw: DuelDeck = { main: [], extra: [], side: [] };
  const cards = new Map(resolved.map(({ card }) => [card.ygoprodeckId, card]));
  for (const { entry, card, copies } of resolved) {
    const section = entry.section ?? entry.pool;
    if (section === "deckmaster") {
      if (raw.deckMaster !== undefined || copies !== 1) throw new CardListError("A deck must have at most one Deck Master.");
      raw.deckMaster = card.ygoprodeckId;
    } else {
      if (copies > 300 || raw[section].length + copies > 300) throw new CardListError("A deck section can contain at most 300 cards.");
      raw[section].push(...Array<number>(copies).fill(card.ygoprodeckId));
    }
  }
  const routed = routeDeckSections(raw, code => {
    const card = find?.(code) ?? engine.get(code) ?? cards.get(code);
    return card ? { ...card, name: card.name?.trim() || cards.get(code)?.name } : undefined;
  });
  if (routed.deck.main.length > 300 || routed.deck.extra.length > 300) throw new CardListError("A deck section can contain at most 300 cards after import. No cards were imported.");
  // A section never goes past its limit: the first cards load, and the report names what was left out.
  const capped = capDeckSections(routed.deck);
  const nameOf = (code: number) => (find?.(code) ?? engine.get(code) ?? cards.get(code))?.name?.trim() || undefined;
  const importMode: DuelMode = raw.deckMaster === undefined ? mode : "domain";
  return { mode: importMode, ...routed, deck: capped.deck, messages: [...routed.messages, ...deckLeftOutMessages(capped.leftOut, nameOf)], corrected };
}
