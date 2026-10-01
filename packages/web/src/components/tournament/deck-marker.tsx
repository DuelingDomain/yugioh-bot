import type { Participant } from "./types";

/** Small "Deck registered" / "No deck" tag for the organizer; nothing for payloads without deck data. */
export function DeckMarker({ participant }: { participant: Pick<Participant, "playerId" | "deckRegistered"> }) {
  if (participant.deckRegistered === undefined) return null;
  return (
    <span
      data-testid={`player-deck-marker-${participant.playerId}`}
      className={`rounded-sm px-1 py-px font-mono text-[10px] uppercase tracking-wider ${
        participant.deckRegistered ? "bg-accent-success/15 text-accent-success" : "bg-accent-gold/15 text-accent-gold"
      }`}
    >
      {participant.deckRegistered ? "Deck registered" : "No deck"}
    </span>
  );
}
