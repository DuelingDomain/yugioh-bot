import { DeckMark } from "@/components/sheet";
import type { Participant } from "./types";

/** "Deck in" (gold) or "No deck yet" for the organizer; nothing for payloads without deck data. */
export function DeckMarker({ participant }: { participant: Pick<Participant, "playerId" | "deckRegistered" | "deckLocked"> }) {
  if (participant.deckRegistered === undefined) return null;
  return (
    <span data-testid={`player-deck-marker-${participant.playerId}`}>
      <DeckMark state={participant.deckRegistered ? "in" : "none"} locked={participant.deckLocked === true} />
    </span>
  );
}
