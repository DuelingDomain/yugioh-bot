import { DeckMark } from "@/components/sheet";
import type { DeckRegistrationMark } from "./api";

/** Where the tournament page for a registration lives: its web slug, or its id when it has none. */
export function tournamentHref(registration: DeckRegistrationMark): string {
  const { slug, id } = registration.tournament;
  return `/tournament/${slug ?? id}`;
}

/**
 * The one sentence the editor shows when a deck is locked in a tournament. The tournament keeps its own
 * copy of the deck, so edits stay possible here but never reach it. Null while the deck is not locked.
 */
export function lockedNote(registration: DeckRegistrationMark | null | undefined): string | null {
  if (!registration?.locked) return null;
  return `Locked since your first game started. Changes to this deck will not reach ${registration.tournament.name}.`;
}

/** "Deck in for <tournament>" in gold with the tournament as a link, plus "Locked" when it is. Nothing without a registration. */
export function RegistrationMark({ registration, className }: { registration: DeckRegistrationMark | null | undefined; className?: string }) {
  if (!registration) return null;
  return (
    <DeckMark
      state="in"
      locked={registration.locked}
      tournament={{ name: registration.tournament.name, href: tournamentHref(registration) }}
      className={className}
    />
  );
}
