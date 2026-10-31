import { DECK_SECTION_LIMITS, cardLimit, deckSectionFullMessage, type DeckCardInfo, type DuelDeck, type DuelMode } from "@yugidraft/shared/duels";
import { GENESYS_FORBIDDEN_MESSAGE, genesysMark } from "./genesys";
import { defaultAddSection, type BanlistLimits } from "./model";

/** One card that "Add cards" will put in the deck, and where. */
export type PlannedAdd = { card: DeckCardInfo; section: "main" | "extra" };

/** What "Add cards" does for a list of cards: the ones it adds, and the ones it cannot add with the reason. */
export type AddPlan = {
  add: PlannedAdd[];
  blocked: { card: DeckCardInfo; reason: string }[];
  /** Cards of `add` whose Genesys points the catalog does not know. They are added, and the screen says so. */
  unknownPoints: DeckCardInfo[];
};

/** What the deck editor gives a list so it can add several cards at once. `plan` changes nothing. `add` is one undo step. */
export type CardAdder = {
  /** Copies of a card in Main and Extra. The Side Deck does not count, so a Side copy is still "missing" for a path. */
  held: (card: DeckCardInfo) => number;
  plan: (cards: readonly DeckCardInfo[]) => AddPlan;
  add: (cards: readonly DeckCardInfo[]) => void;
};

export const DOMAIN_ONE_COPY = "Domain decks hold one copy of each card.";

/** "is Forbidden" or "allows 2 copies": the banlist words of a copy limit. */
export function copiesText(max: number): string {
  if (max === 0) return "is Forbidden";
  return `allows ${max} ${max === 1 ? "copy" : "copies"}`;
}

export interface AddPlanInput {
  cards: readonly DeckCardInfo[];
  deck: DuelDeck;
  mode: DuelMode;
  /** Copies of this card (by name) the deck holds now, in any section. They count toward a copy limit. */
  deckCount: (card: DeckCardInfo) => number;
  /** Copies in Main and Extra only. A card with one is not missing. */
  held: (card: DeckCardInfo) => number;
  /** The banlist in force. Null: no banlist. */
  limits: BanlistLimits | null;
  limitsPending: boolean;
  banlistName: string | null;
  /** Genesys is on. Like one add from the card list, points are not a limit here: only a forbidden card is refused. */
  genesys: boolean;
  /** A draft deck takes only what the player drafted: why a card has no copy left in the pool, or null. */
  poolBlock?: (card: DeckCardInfo) => string | null;
}

/**
 * The cards of a list that the deck lacks (no copy yet) and can take. It follows the same rules as one add from the
 * card list: the banlist, a Domain deck's single copy, the Genesys forbidden list, and the room of each
 * section. Each card goes to Main or Extra by its type. A card that has a copy is not missing, so it is left out.
 */
export function planCardAdds(input: AddPlanInput): AddPlan {
  const { deck, mode, deckCount, held, limits, limitsPending, banlistName, genesys } = input;
  const size = { main: deck.main.length, extra: deck.extra.length };
  const plan: AddPlan = { add: [], blocked: [], unknownPoints: [] };
  const taken = new Set<string>();
  const refuse = (card: DeckCardInfo, reason: string) => plan.blocked.push({ card, reason });
  for (const card of input.cards) {
    if (held(card) > 0) continue;
    const key = card.name;
    // Two arts of one card are one card: the second would be a second copy.
    if (taken.has(key)) continue;
    if (card.unavailableReason) { refuse(card, `unavailable: ${card.unavailableReason}`); continue; }
    const mark = genesys ? genesysMark(card) : null;
    if (mark?.kind === "forbidden") { refuse(card, GENESYS_FORBIDDEN_MESSAGE); continue; }
    const fromPool = input.poolBlock?.(card);
    if (fromPool) { refuse(card, fromPool); continue; }
    if (!input.poolBlock && limitsPending) { refuse(card, "the banlist is still loading."); continue; }
    const listed = limits ? cardLimit(limits, card) : 3;
    const max = mode === "domain" ? Math.min(1, listed) : listed;
    if (max < 1) { refuse(card, `${banlistName ?? "the banlist"} ${copiesText(0)}.`); continue; }
    // A copy in the Side Deck counts toward the limit, as it does for one add from the card list.
    if (deckCount(card) >= max) { refuse(card, mode === "domain" ? DOMAIN_ONE_COPY : `you already have ${deckCount(card)} ${deckCount(card) === 1 ? "copy" : "copies"}.`); continue; }
    const section = defaultAddSection(card);
    if (size[section] >= DECK_SECTION_LIMITS[section]) { refuse(card, deckSectionFullMessage(section)); continue; }
    size[section] += 1;
    taken.add(key);
    if (mark?.kind === "unknown") plan.unknownPoints.push(card);
    plan.add.push({ card, section });
  }
  return plan;
}
