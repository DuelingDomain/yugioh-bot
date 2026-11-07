import type { SentencePiece } from "./sentencepiece";

/**
 * Phrase list for the keyword spotter. A phrase is spoken words; the spotter answers with its tag (a single word, so the
 * tag is an id) and this module maps the tag to the canonical text that `parsePhaseCommand` and `ygoModule.parseCommand`
 * accept. The parser stays strict: bare "battle" is not a phase there, so the tag for "battle" carries "battle phase".
 */
export type PhraseMeaning =
  | { kind: "fixed"; canonical: string; spoken: string }
  /** A word that completes the previous hit ("phase", "one", "two", "turn"); alone it adds nothing. */
  | { kind: "joiner"; word: "phase" | "one" | "two" | "turn"; spoken: string }
  /** One or more cards. More than one is ambiguous: the text keeps what was said and the UI asks. */
  | { kind: "card"; names: string[]; spoken: string };

export type PhraseSet = {
  /** Keyword lines: `TOKENS :boost #threshold @tag`. */
  lines: string[];
  meanings: Map<string, PhraseMeaning>;
  counts: { fixed: number; fullNames: number; runs: number; words: number; ambiguous: number; skipped: string[] };
};

type Fixed = [spoken: string, canonical: string];
/** Phases first. "draw" alone stays a card draw (command-parser.ts); the phase needs the word "phase". */
export const FIXED_PHRASES: readonly Fixed[] = [
  ["DRAW PHASE", "draw phase"],
  ["STANDBY", "standby phase"], ["STANDBY PHASE", "standby phase"],
  ["MAIN", "main phase"], ["MAIN PHASE", "main phase"],
  ["MAIN ONE", "main phase one"], ["MAIN PHASE ONE", "main phase one"],
  ["MAIN TWO", "main phase two"], ["MAIN PHASE TWO", "main phase two"],
  ["BATTLE", "battle phase"], ["BATTLE PHASE", "battle phase"],
  ["END", "end phase"], ["END PHASE", "end phase"], ["END TURN", "end turn"],
  ["NEXT PHASE", "next phase"], ["GO BACK A PHASE", "go back a phase"],
  ["UNDO", "undo"], ["UNDO THAT", "undo"],
  ["EFFECT", "effect"], ["ACTIVATE", "activate"], ["ACTIVATE EFFECT", "activate effect"],
  ["ATTACK", "attack"], ["ATTACKS", "attacks"], ["ATTACK WITH", "attack with"], ["DIRECT ATTACK", "direct attack"],
  ["DRAW", "draw"],
];
const JOINERS: readonly (readonly [string, "phase" | "one" | "two" | "turn"])[] = [["PHASE", "phase"], ["ONE", "one"], ["TWO", "two"], ["TURN", "turn"]];

// A one-word partial must have 5+ letters and may not be here. Ordinary English first, then words the table commands use.
const STOP = new Set(`ABOUT ABOVE AFTER AGAIN AGAINST ALONG AMONG ANOTHER BEFORE BEGIN BEING BELOW BETWEEN BOTH COULD DOING DURING EACH EVEN EVERY FIRST FOUND FROM GIVE GOING GREAT HAVE HERE INTO KNOW LARGE LATER LEAST LEAVE LITTLE MIGHT NEVER NEXT OFTEN OTHER OTHERS PLACE POINT RIGHT SHALL SHOULD SINCE SMALL STILL SUCH TAKE THAN THEIR THEM THEN THERE THESE THEY THING THINGS THINK THIS THOSE THREE THROUGH UNDER UNTIL UPON USING VERY WANT WELL WERE WHAT WHEN WHERE WHICH WHILE WHOSE WITH WITHIN WITHOUT WORLD WOULD YEARS YOUR
AGENT ANGEL BLACK BLOOD BLUE BREAK CHAOS CHAIN CHARGE CLOUD CRASH CRUSH DARK DEATH DEMON DESTINY DIVINE DOUBLE DRAGON DREAM EARTH ELDER ELEMENT ETERNAL EVIL FIEND FIRE FLAME FORCE GHOST GIANT GOLD GRAND GREEN HERO HOLY HUNTER IMPERIAL KING KNIGHT LEGEND LIGHT MAGIC MAGICIAN MASTER METAL MIRROR MONSTER NATURE NOBLE PRINCE PRINCESS PURE QUEEN RED SACRED SHADOW SILVER SOUL SPELL SPIRIT STAR STORM SWORD TRAP VENOM WARRIOR WATER WHITE WIND WITCH WOLF
ACTIVATE ATTACK ATTACKS BANISH BATTLE DEFENSE DIRECT EFFECT GRAVEYARD PHASE SUMMON STANDBY TRIBUTE UNDO`.split(/\s+/));
const FUNCTION_WORDS = new Set(["A", "AN", "THE", "OF", "AND", "OR", "TO", "IN", "ON", "WITH", "FOR", "FROM", "BY", "AT", "AS", "S"]);
const SMALL = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

function numberWords(value: number): string {
  if (value < 20) return SMALL[value];
  if (value < 100) return TENS[Math.floor(value / 10)] + (value % 10 ? ` ${SMALL[value % 10]}` : "");
  if (value < 1000) return `${SMALL[Math.floor(value / 100)]} HUNDRED${value % 100 ? ` ${numberWords(value % 100)}` : ""}`;
  return String(value).split("").map(digit => SMALL[Number(digit)]).join(" ");
}

/** What a player says for a card name: upper case letters, apostrophe and spaces only (the model has no digits or symbols). */
export function spokenForm(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/&/g, " AND ").replace(/(\w)\.(?=\w)/g, "$1").replace(/[’‘`]/g, "'")
    .replace(/\d+/g, digits => ` ${numberWords(Number(digits))} `)
    .replace(/[^A-Z' ]+/g, " ").replace(/\s+/g, " ").trim();
}

function thresholdFor(words: number, boost: number, shift: number) {
  // Short phrases are easier to hit by accident, so they need more evidence (starting values, tuned in the voice check).
  const base = words === 1 ? 0.4 : words === 2 ? 0.3 : 0.25;
  return { boost: Math.round((words === 1 ? boost + 0.5 : boost) * 100) / 100, threshold: Math.min(0.95, Math.round((base + shift) * 100) / 100) };
}

export function buildPhrases(names: readonly string[], sp: SentencePiece, options: { boost?: number; thresholdShift?: number } = {}): PhraseSet {
  const boost = options.boost ?? 1.5; const shift = options.thresholdShift ?? 0;
  const meanings = new Map<string, PhraseMeaning>();
  const lines: string[] = [];
  const skipped: string[] = [];
  const reserved = new Set<string>();
  const tokens = (spoken: string) => { const pieces = sp.encode(spoken); return pieces.length && pieces.every(piece => piece !== "<unk>") ? pieces : null; };
  const add = (spoken: string, meaning: PhraseMeaning, words = spoken.split(" ").length) => {
    const pieces = tokens(spoken);
    if (!pieces) { skipped.push(spoken); return null; }
    const tag = `${meaning.kind === "card" ? "C" : meaning.kind === "fixed" ? "F" : "J"}${meanings.size}`;
    const { boost: b, threshold } = thresholdFor(words, boost, shift);
    meanings.set(tag, meaning);
    lines.push(`${pieces.join(" ")} :${b} #${threshold} @${tag}`);
    return tag;
  };

  for (const [spoken, canonical] of FIXED_PHRASES) { reserved.add(spoken); add(spoken, { kind: "fixed", canonical, spoken }); }
  for (const [spoken, word] of JOINERS) { reserved.add(spoken); add(spoken, { kind: "joiner", word, spoken }); }
  const fixed = meanings.size;

  // spoken phrase -> the card names that can be meant by it
  const full = new Map<string, Set<string>>(); const runs = new Map<string, Set<string>>(); const single = new Map<string, Set<string>>();
  const put = (map: Map<string, Set<string>>, spoken: string, name: string) => { if (!map.has(spoken)) map.set(spoken, new Set()); map.get(spoken)!.add(name); };
  for (const name of new Set(names.map(value => value.trim()).filter(Boolean))) {
    const spoken = spokenForm(name);
    if (!spoken) { skipped.push(name); continue; }
    // "The Winged Dragon of Ra" is said without "The" as often as with it.
    const forms = [spoken.split(" ")]; if (/^THE /.test(spoken) && forms[0].length > 2) forms.push(forms[0].slice(1));
    for (const words of forms) {
      put(full, words.join(" "), name);
      for (let count = 2; count < words.length; count++) {
        if (FUNCTION_WORDS.has(words[count - 1])) continue;
        put(runs, words.slice(0, count).join(" "), name);
      }
      const first = words[0];
      if (words.length > 1 && first.length >= 5 && !STOP.has(first) && !FUNCTION_WORDS.has(first)) put(single, first, name);
    }
  }
  let ambiguous = 0; const seen = new Set<string>();
  const emit = (map: Map<string, Set<string>>) => {
    let count = 0;
    for (const [spoken, set] of map) {
      if (reserved.has(spoken) || seen.has(spoken)) continue;
      seen.add(spoken);
      const list = [...set]; if (list.length > 1) ambiguous++;
      if (add(spoken, { kind: "card", names: list, spoken: spoken.toLowerCase() })) count++;
    }
    return count;
  };
  // A full name wins over a run or a word that another card shares: emit in that order.
  const fullNames = emit(full); const runCount = emit(runs); const words = emit(single);
  return { lines, meanings, counts: { fixed, fullNames, runs: runCount, words, ambiguous, skipped } };
}

/** A keyword that never fires, for the spotter's own list (streams carry the real phrases). */
export function placeholderLine(sp: SentencePiece): string {
  return `${sp.encode("ZZ").join(" ")} :0.1 #0.95 @_`;
}

export type VoiceHit = { keyword: string; startTime?: number };
export type Combined = { canonical: string; tags: string[]; heard: string[]; ambiguous: { spoken: string; names: string[] }[] };

/**
 * One utterance, in order. The spotter resets after every hit, so "main" can fire before "two" is said: the joiners
 * put the text back together ("main phase" + "two" = "main phase two", "end phase" + "turn" = "end turn").
 */
export function combineHits(hits: readonly VoiceHit[], meanings: ReadonlyMap<string, PhraseMeaning>): Combined {
  const parts: string[] = []; const tags: string[] = []; const heard: string[] = []; const ambiguous: Combined["ambiguous"] = [];
  for (const hit of hits) {
    const meaning = meanings.get(hit.keyword);
    if (!meaning) continue;
    tags.push(hit.keyword); heard.push(meaning.spoken.toLowerCase());
    const last = parts.length - 1;
    if (meaning.kind === "fixed") parts.push(meaning.canonical);
    else if (meaning.kind === "card") {
      if (meaning.names.length > 1) { ambiguous.push({ spoken: meaning.spoken, names: meaning.names }); parts.push(meaning.spoken); } else parts.push(meaning.names[0]);
    } else if (meaning.word === "phase") { if (last < 0 || !/\bphase$/.test(parts[last])) parts.push("phase"); }
    else if (meaning.word === "turn") { if (parts[last] === "end phase") parts[last] = "end turn"; else parts.push("turn"); }
    else if (last >= 0 && /^main phase$/.test(parts[last])) parts[last] = `main phase ${meaning.word}`;
    else parts.push(meaning.word);
  }
  return { canonical: parts.join(" "), tags, heard, ambiguous };
}

/** A bare one-word phase ("battle", "end") counts only as a short, isolated utterance. Longer chatter that contains it is ignored. */
export const BARE_WORD_MAX_MS = 1200;
export function isChatter(combined: Combined, meanings: ReadonlyMap<string, PhraseMeaning>, speechMs: number): boolean {
  if (combined.tags.length !== 1) return false;
  const meaning = meanings.get(combined.tags[0]);
  return meaning?.kind === "fixed" && !meaning.spoken.includes(" ") && speechMs > BARE_WORD_MAX_MS;
}
