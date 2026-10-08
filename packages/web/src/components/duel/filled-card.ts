"use client";

import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { hasCardName, useDuelCardInfo } from "./card-info";
import { isHiddenCard } from "./constants";

/**
 * The card with its static text filled in: a card that came without a name or an effect text (a pile card, a log
 * entry) is looked up by passcode, while the live fields (ATK/DEF, counters, position) stay as the engine sent them.
 * The pile viewer uses it, with the same merge rules as the card panel, so it always shows the full effect text.
 */
export function useFilledCard<T extends DuelCard | DuelCardInfo>(liveCard: T): T {
  const code = liveCard.code;
  const hidden = isHiddenCard(liveCard) || code == null;
  const resolved = useDuelCardInfo(!hidden && (!hasCardName(liveCard) || !liveCard.description?.trim()) ? code : null);
  if (!resolved) return liveCard;
  return {
    ...resolved, ...liveCard,
    canonicalPasscode: liveCard.canonicalPasscode ?? resolved.canonicalPasscode,
    type: liveCard.type ?? resolved.type,
    attack: liveCard.attack ?? resolved.attack,
    defense: liveCard.defense ?? resolved.defense,
    level: liveCard.level ?? resolved.level,
    attribute: liveCard.attribute ?? resolved.attribute,
    race: liveCard.race ?? resolved.race,
    name: hasCardName(liveCard) ? liveCard.name : resolved.name,
    description: liveCard.description?.trim() ? liveCard.description : resolved.description,
  } as T;
}
