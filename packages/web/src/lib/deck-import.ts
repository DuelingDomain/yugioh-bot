import { routeDeckSections, type CardIdentityCatalog, type DuelDeck, type DuelMode } from "@yugidraft/shared/duels";
import { loadArtworkIdentityCatalog, type CardCatalogService } from "@yugidraft/shared/services";
import { resolveImportedCardList } from "./cube-list-import";
import { CardListError } from "./card-list-parser";

/** Read names, passcodes, YDK and YDKE with the server catalog. Never trust section labels. */
export async function resolveDeckImport(catalog: CardCatalogService, text: unknown, mode: unknown, engine: CardIdentityCatalog = loadArtworkIdentityCatalog()) {
  if (mode !== "normal" && mode !== "domain") throw new CardListError("Deck mode must be normal or domain.");
  const { resolved, unknown, corrected } = await resolveImportedCardList(catalog, text, { keepDeckSections: true });
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
  const routed = routeDeckSections(raw, code => engine.get(code) ?? cards.get(code));
  if (routed.deck.main.length > 300 || routed.deck.extra.length > 300) throw new CardListError("A deck section can contain at most 300 cards after import. No cards were imported.");
  const importMode: DuelMode = raw.deckMaster === undefined ? mode : "domain";
  return { mode: importMode, ...routed, corrected };
}
