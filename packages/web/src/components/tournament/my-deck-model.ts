import type { DuelDeck } from "@yugidraft/shared/duels";

export interface DeckOption {
  id: number;
  name: string;
  mainCount: number | null;
}

/** `GET /api/tournaments/<slug>/deck`, reduced to what the panel reads. */
export interface MyDeckState {
  registration: { savedDeckId: number | null; deck: DuelDeck; lockedAt: string | null } | null;
  draft: { id: number; slug: string } | null;
  savedDeckOptions: DeckOption[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cardList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((code): code is number => typeof code === "number") : [];
}

/** Reads the deck response defensively; anything unusable gives null. */
export function parseMyDeckState(data: unknown): MyDeckState | null {
  if (!isRecord(data)) return null;
  let registration: MyDeckState["registration"] = null;
  if (isRecord(data.registration)) {
    const raw = data.registration;
    const deck = isRecord(raw.deck) ? raw.deck : {};
    registration = {
      savedDeckId: typeof raw.savedDeckId === "number" ? raw.savedDeckId : null,
      deck: { main: cardList(deck.main), extra: cardList(deck.extra), side: cardList(deck.side) },
      lockedAt: typeof raw.lockedAt === "string" ? raw.lockedAt : null,
    };
  }
  const draft =
    isRecord(data.draft) && typeof data.draft.id === "number" && typeof data.draft.slug === "string"
      ? { id: data.draft.id, slug: data.draft.slug }
      : null;
  const savedDeckOptions = Array.isArray(data.savedDeckOptions)
    ? data.savedDeckOptions.flatMap((option): DeckOption[] =>
        isRecord(option) && typeof option.id === "number"
          ? [
              {
                id: option.id,
                name: typeof option.name === "string" && option.name ? option.name : `Deck ${option.id}`,
                mainCount: typeof option.mainCount === "number" ? option.mainCount : null,
              },
            ]
          : [],
      )
    : [];
  return { registration, draft, savedDeckOptions };
}

/** "Name, 40 main, 15 extra, 15 side". */
export function deckSummaryText(name: string | null, deck: DuelDeck): string {
  const counts = `${deck.main.length} main, ${deck.extra.length} extra, ${deck.side.length} side`;
  return name ? `${name}, ${counts}` : counts;
}

/** Text for an API failure of the register call, with deck issues when the API sends them. */
export function registerErrorText(data: unknown, fallback: string): string {
  if (!isRecord(data)) return fallback;
  const message = typeof data.error === "string" && data.error ? data.error : fallback;
  const report = isRecord(data.report) ? data.report : null;
  const issues = report && Array.isArray(report.issues) ? report.issues : [];
  const details = issues
    .flatMap((issue) => (isRecord(issue) && typeof issue.message === "string" ? [issue.message] : []))
    .slice(0, 3);
  return details.length > 0 ? `${message} ${details.join(" ")}` : message;
}
