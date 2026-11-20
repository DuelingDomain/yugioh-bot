import { buildMatcher, matchPhasePhrase } from "./speech-matcher";

/** An effect line is only taken when the player said an effect word and the name match is strong. */
const EFFECT_WORD = /\b(?:activate|activates|effect|effects|use)\b/i;
const STRONG_NAME = 0.85;
// Attack lines keep their verb words around the card name, so "Dark Magician attack" and "attack with Dark Magician" still parse.
const HEAD = /^((?:i |my )?attack(?:s)?(?: with| using)? )/i;
const TAIL = /( (?:direct )?attacks?\b.*)$/i;

/**
 * Card-name matching against the hot list only: the cards on the table plus the registered decks, a few dozen names.
 * The whole catalog (14k names) costs hundreds of ms per utterance and turns ordinary table talk into card names.
 * The matcher is rebuilt only when the set of names changes (about 5 ms for 60 names).
 */
export function createHotListMatcher() {
  let key = "";
  let matcher: ReturnType<typeof buildMatcher> | undefined;
  const find = (text: string, speechMs: number, names: readonly string[]) => {
    const next = [...names].sort().join("\n");
    if (!matcher || next !== key) { matcher = buildMatcher(names); key = next; }
    return matcher.match(text, speechMs);
  };
  return {
    /** A canonical command line for the grammar: a phase word, "activate effect of <card>", an attack line with the name fixed, or the heard text (LP lines are grammar-parsed as spoken). */
    canonical(text: string, speechMs: number, names: readonly string[]): string {
      // The model writes "2,400" and "500lp"; the grammar would read the first as 2 and miss the second.
      const heard = text.trim().replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/(\d)(?=lp\b)/gi, "$1 ");
      if (!heard) return "";
      const phase = matchPhasePhrase(heard, speechMs);
      if (phase) return phase;
      const head = HEAD.exec(heard)?.[1] ?? "";
      const tailMatch = head ? null : TAIL.exec(heard);
      if (head || tailMatch) {
        const tail = tailMatch?.[1] ?? "";
        const name = heard.slice(head.length, heard.length - tail.length).trim().replace(/[.,!?]+$/, "");
        const found = name ? find(name, speechMs, names) : undefined;
        // Only a plain card name is put back; the grammar resolves it to the attacker on the speaker's field.
        if (found && found.canonical && !found.ambiguous.length && !found.canonical.startsWith("activate effect of ")) return `${head}${found.canonical}${tail}`.trim();
        return heard;
      }
      const found = find(heard, speechMs, names);
      if (found.canonical.startsWith("activate effect of ")) return found.score >= STRONG_NAME && EFFECT_WORD.test(heard) && !found.ambiguous.length ? found.canonical : heard;
      // An ambiguous partial name stays as the spoken words, so the grammar asks which card.
      return found.canonical || heard;
    },
  };
}
