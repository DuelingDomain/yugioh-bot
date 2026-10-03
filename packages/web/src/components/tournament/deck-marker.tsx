import type { Participant } from "./types";

/** Small "Deck registered" / "No deck" tag for the organizer; nothing for payloads without deck data. */
export function DeckMarker({ participant }: { participant: Pick<Participant, "playerId" | "deckRegistered"> }) {
  if (participant.deckRegistered === undefined) return null;
  return (
    <span data-testid={`player-deck-marker-${participant.playerId}`} className={`deckst ${participant.deckRegistered ? "ok" : "no"}`}>
      {participant.deckRegistered ? "Deck registered" : "No deck"}
    </span>
  );
}
