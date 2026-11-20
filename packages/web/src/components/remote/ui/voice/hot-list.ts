import { buildMatcher, matchPhasePhrase } from "./speech-matcher";

/**
 * Card-name matching against the hot list only: the cards on the table plus the registered decks, a few dozen names.
 * The whole catalog (14k names) costs hundreds of ms per utterance and turns ordinary table talk into card names.
 * The matcher is rebuilt only when the names change (about 5 ms for 60 names).
 */
export function createHotListMatcher() {
  let key = "";
  let matcher: ReturnType<typeof buildMatcher> | undefined;
  return {
    /** A canonical command line for the grammar: a phase word, "activate effect of <card>", or the heard text (LP and attack lines are grammar-parsed as spoken). */
    canonical(text: string, speechMs: number, names: readonly string[]): string {
      // The model writes "2,400" and "500lp"; the grammar would read the first as 2 and miss the second.
      const heard = text.trim().replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/(\d)(?=lp\b)/gi, "$1 ");
      if (!heard) return "";
      const phase = matchPhasePhrase(heard, speechMs);
      if (phase) return phase;
      const next = names.join("\n");
      if (!matcher || next !== key) { matcher = buildMatcher(names); key = next; }
      const found = matcher.match(heard, speechMs);
      // An ambiguous partial name stays as the spoken words, so the grammar asks which card.
      return found.canonical || heard;
    },
  };
}
