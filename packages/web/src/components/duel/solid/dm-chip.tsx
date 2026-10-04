import type { DuelSeatView } from "@yugidraft/shared/duels";
import docks from "./docks.module.css";

/**
 * The Deck Master chip on a mobile rail (domain duels only). Tapping it opens the Deck Masters sheet.
 * Stub from the foundation: the docks worker styles it and adds the Summon button.
 */
export function DmChip({ seat, view, mine, onOpen }: { seat: number; view: DuelSeatView | undefined; mine: boolean; onOpen: () => void }) {
  const card = view?.deckMaster?.card;
  if (!card) return null;
  return (
    <button type="button" className={docks.dmChip} data-sv-dm-chip={seat} data-side={mine ? "you" : "opp"} onClick={onOpen}
      aria-label={`${mine ? "Your" : "Opponent"} Deck Master, ${card.name}`}>
      {card.name}
    </button>
  );
}
