import type { DuelCard } from "@yugidraft/shared/duels";
import { zoneKey } from "./constants";

/**
 * Whether an open pile viewer must close when a new prompt arrives. The viewer is a modal sheet over the
 * board, so a prompt that wants cards on the field (summon materials, targets) cannot be answered while it
 * stays open. A legal card in the pile always keeps it open (picking GY cards one at a time).
 * `answered`: the player answered the last prompt while the viewer was open (e.g. an Extra Deck summon). The
 * viewer then closes unless the new prompt is theirs and wants a card in the pile. Otherwise a prompt that
 * is not theirs or has no card choices leaves a pile they are only browsing alone.
 */
export function shouldClosePileForPrompt(
  pileCards: DuelCard[],
  legalKeys: Set<string>,
  promptMine: boolean,
  answered = false,
): boolean {
  const wantsPile = promptMine && pileCards.some((card) => legalKeys.has(zoneKey(card.controller, card.location, card.sequence)));
  if (wantsPile) return false;
  if (answered) return true;
  return promptMine && legalKeys.size > 0;
}
