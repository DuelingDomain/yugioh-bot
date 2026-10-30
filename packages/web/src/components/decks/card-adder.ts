import { DECK_SECTION_LIMITS, cardLimit, deckSectionFullMessage, type DeckCardInfo, type DuelDeck, type DuelMode } from "@yugidraft/shared/duels";
import { GENESYS_FORBIDDEN_MESSAGE, genesysMark } from "./genesys";
import { defaultAddSection, type BanlistLimits } from "./model";

/** One card that "Add cards" will put in the deck, and where. */
export type PlannedAdd = { card: DeckCardInfo; section: "main" | "extra" };

/** What "Add cards" does for a list of cards: the ones it adds, and the ones it cannot add with the reason. */
export type AddPlan = { add: PlannedAdd[]; blocked: { card: DeckCardInfo; reason: string }[] };

/** What the deck editor gives a list so it can add several cards at once. `plan` changes nothing. `add` is one undo step. */
export type CardAdder = {
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
  /** Copies of this card (by name) the deck holds now. */
  deckCount: (card: DeckCardInfo) => number;
  /** The banlist in force. Null: no banlist. */
  limits: BanlistLimits | null;
  limitsPending: boolean;
  banlistName: string | null;
  /** Genesys is on. `pointsLeft` is the cap minus the known points of the deck; null when it is not known. */
  genesys: { pointsLeft: number | null } | null;
  /** A draft deck takes only what the player drafted: why a card has no copy left in the pool, or null. */
  poolBlock?: (card: DeckCardInfo) => string | null;
}

/**
 * The cards of a list that the deck lacks (no copy yet) and can take. It follows the same rules as one add from the
 * card list: the banlist, a Domain deck's single copy, the Genesys list and its point cap, and the room of each
 * section. Each card goes to Main or Extra by its type. A card that has a copy is not missing, so it is left out.
 */
export function planCardAdds(input: AddPlanInput): AddPlan {
  const { deck, mode, deckCount, limits, limitsPending, banlistName, genesys } = input;
  const size = { main: deck.main.length, extra: deck.extra.length };
  let pointsLeft = genesys?.pointsLeft ?? null;
  const plan: AddPlan = { add: [], blocked: [] };
  const taken = new Set<string>();
  const refuse = (card: DeckCardInfo, reason: string) => plan.blocked.push({ card, reason });
  for (const card of input.cards) {
    if (deckCount(card) > 0) continue;
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
    const section = defaultAddSection(card);
    if (size[section] >= DECK_SECTION_LIMITS[section]) { refuse(card, deckSectionFullMessage(section)); continue; }
    const points = mark?.kind === "points" ? mark.points : 0;
    if (pointsLeft != null && points > pointsLeft) {
      refuse(card, `it needs ${points} Genesys ${points === 1 ? "point" : "points"} and ${pointsLeft} ${pointsLeft === 1 ? "is" : "are"} left.`);
      continue;
    }
    if (pointsLeft != null) pointsLeft -= points;
    size[section] += 1;
    taken.add(key);
    plan.add.push({ card, section });
  }
  return plan;
}
