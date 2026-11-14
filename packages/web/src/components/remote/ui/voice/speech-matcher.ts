import { doubleMetaphone } from "double-metaphone";
import { FIXED_PHRASES, PHASE_TURN_PHRASES, isBareSpoken, spokenForm } from "./phrases";

/**
 * Grammar matcher for speech-to-text output (Method B of the voice check). The whole utterance is matched against commands,
 * card names (full and distinctive partials) and "effect" forms, by letters and sound codes plus edit distance. Pure JS,
 * no model. Ported from the 2026-11-07 bake-off (data/briefs/remote-duels/voice-bakeoff-2026-11-07-matcher.mts).
 */

/** Edit distance (two-row dynamic programming). */
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

// ---- everyday English that must not become a one-word card partial (same list the keyword spotter uses) ----
const STOP = new Set(`ABOUT ABOVE AFTER AGAIN AGAINST ALONG AMONG ANOTHER BEFORE BEGIN BEING BELOW BETWEEN BOTH COULD DOING DURING EACH EVEN EVERY FIRST FOUND FROM GIVE GOING GREAT HAVE HERE INTO KNOW LARGE LATER LEAST LEAVE LITTLE MIGHT NEVER NEXT OFTEN OTHER OTHERS PLACE POINT RIGHT SHALL SHOULD SINCE SMALL STILL SUCH TAKE THAN THEIR THEM THEN THERE THESE THEY THING THINGS THINK THIS THOSE THREE THROUGH UNDER UNTIL UPON USING VERY WANT WELL WERE WHAT WHEN WHERE WHICH WHILE WHOSE WITH WITHIN WITHOUT WORLD WOULD YEARS YOUR
AGENT ANGEL BLACK BLOOD BLUE BREAK CHAOS CHAIN CHARGE CLOUD CRASH CRUSH DARK DEATH DEMON DESTINY DIVINE DOUBLE DRAGON DREAM EARTH ELDER ELEMENT ETERNAL EVIL FIEND FIRE FLAME FORCE GHOST GIANT GOLD GRAND GREEN HERO HOLY HUNTER IMPERIAL KING KNIGHT LEGEND LIGHT MAGIC MAGICIAN MASTER METAL MIRROR MONSTER NATURE NOBLE PRINCE PRINCESS PURE QUEEN RED SACRED SHADOW SILVER SOUL SPELL SPIRIT STAR STORM SWORD TRAP VENOM WARRIOR WATER WHITE WIND WITCH WOLF
ACTIVATE ATTACK ATTACKS BANISH BATTLE DEFENSE DIRECT EFFECT GRAVEYARD PHASE SUMMON STANDBY TRIBUTE UNDO`.split(/\s+/));
const FN = new Set(["A", "AN", "THE", "OF", "AND", "OR", "TO", "IN", "ON", "WITH", "FOR", "FROM", "BY", "AT", "AS", "S"]);

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const num = (n: number): string => n < 20 ? SMALL[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? " " + SMALL[n % 10] : "") : String(n).split("").map(d => SMALL[+d]).join(" ");

/** Lower-case words; digits to words; no punctuation. */
export function norm(text: string): string[] {
  return text.toLowerCase().replace(/&/g, " and ").replace(/['’`]/g, "").replace(/(\d+)/g, (_m, d) => ` ${num(Number(d))} `).replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
}
const FILLER = new Set(["um", "uh", "erm", "hmm", "okay", "ok", "so", "alright", "well"]);

type Key = { words: string[]; letters: string; ph: string[] };
const phoneOf = (w: string): [string, string] => { const [a, b] = doubleMetaphone(w); return [a || w.toUpperCase(), b || a || w.toUpperCase()]; };
function keyOf(words: string[]): Key {
  const pairs = words.map(phoneOf);
  return { words, letters: words.join(""), ph: [pairs.map(p => p[0]).join(""), pairs.map(p => p[1]).join("")] };
}
/** Number of errors (edit distance) and the length it is measured against. Best of letters and sound codes. */
function dist(a: Key, b: Key, lettersOnly = false): { err: number; len: number } {
  let best = { err: Infinity, len: 1 };
  const consider = (x: string, y: string) => { const len = Math.max(x.length, y.length, 1); const err = lev(x, y); if (err / len < best.err / best.len) best = { err, len }; };
  consider(a.letters, b.letters);
  if (!lettersOnly) for (const x of a.ph) for (const y of b.ph) consider(x, y);
  return best;
}

/** Words speech models often write for a command word (sound-alikes). Used for commands only, never for card names. */
export const CONFUSIONS: Record<string, string> = { name: "main", mane: "main", and: "end", ant: "end", face: "phase", faze: "phase", fase: "phase", place: "phase", betel: "battle", bottle: "battle", past: "pass", term: "turn", stand: "standby" };
const commandWord = (word: string) => Object.hasOwn(CONFUSIONS, word) ? CONFUSIONS[word] : word;
export type Meaning = { kind: "cmd"; canonical: string } | { kind: "card"; names: string[] };
export type Entry = { key: Key; meaning: Meaning; bare: boolean };
/** `spoken` is the part of the utterance that named the card (the words the parser sees when the card is ambiguous). */
export type Result = { canonical: string; ambiguous: string[][]; score: number; runnerUp?: number; spoken?: string };

const VERB_PREFIX: [string, boolean][] = [["effect of", true], ["effect", true], ["activate effect of", true], ["activate effect", true], ["activate", true], ["use effect of", true], ["use", true]];
const VERB_SUFFIX: [string, boolean][] = [["effect", true], ["activation", true], ["effects", true]];

export type MatcherOptions = { cmdMin: number; nameMin: number; margin: number; verbMin: number; effNameMin: number; effMin: number; bareSound: boolean; relaxRuns: boolean; confusions: boolean; phasesAndTurnsOnly: boolean };
export const DEFAULTS: MatcherOptions = { cmdMin: 0.78, nameMin: 0.66, margin: 0.06, verbMin: 0.66, effNameMin: 0.65, effMin: 0.70, bareSound: false, relaxRuns: true, confusions: true, phasesAndTurnsOnly: false };

const PHASE_WORDS = new Set(["main", "battle", "standby", "draw", "end", "next", "turn", "phase", "one", "two"]);
const phaseCanonicals = new Set(PHASE_TURN_PHRASES.map(([, canonical]) => canonical));
const phaseEntries = PHASE_TURN_PHRASES.map(([spoken, canonical]) => ({ words: norm(spoken), canonical, bare: isBareSpoken(spoken) }));
const commandWords = (text: string) => {
  const words = norm(text.replace(/\bstand (?:by|bye)\b/gi, "standby"));
  while (FILLER.has(words[0])) words.shift();
  return words;
};

/**
 * Whole fixed phrases only. Bare words must be exact; longer phrases allow at most one substituted word, with all other
 * words exact. Phase substitutions require an explicit phase slot ("main place", never "name one"); turn phrases also
 * allow one substitution ("end term"). "stand by"/"stand bye" are normalized spellings of standby before matching.
 */
export function matchPhasePhrase(text: string, speechMs = 1200, confusions = true): string {
  if (text.length > 200) return "";
  // Short numeric zone codes belong to the move parser. Check before norm turns digits into spoken phase numbers.
  if (/\b[a-z]{1,3}\s*\d+\b/i.test(text)) return "";
  const words = commandWords(text);
  const matches = new Set<string>();
  for (const entry of phaseEntries) {
    if (words.length !== entry.words.length || (entry.bare && speechMs > 1200)) continue;
    let substitutions = 0;
    const fits = entry.words.every((target, index) => {
      const original = words[index];
      if (original === target) return true;
      if (words.length === 1 || entry.canonical === "go back a phase" || ++substitutions > 1) return false;
      if (entry.canonical !== "end turn" && !entry.words.includes("phase")) return false;
      const word = confusions ? commandWord(original) : original;
      if (word === target) return true;
      // Only domain words have fuzzy slots; a correction command needs exact evidence above.
      if (!PHASE_WORDS.has(target) || word.length < 3) return false;
      const d = dist(keyOf([word]), keyOf([target]));
      return d.err / d.len <= (target.length >= 7 ? 0.3 : 0.25);
    });
    if (fits) matches.add(entry.canonical);
  }
  return matches.size === 1 ? [...matches][0] : "";
}

/** Audio-clock gap between unmatched single-word fragments, independent of worker decoding time. */
export const PHASE_JOIN_GAP_MS = 1200;
type SpeechFragment = { text: string; speechMs: number; startedAt: number; endedAt: number };

export function buildMatcher(deck: readonly string[], opts: Partial<MatcherOptions> = {}) {
  const o = { ...DEFAULTS, ...opts };
  // commands
  const cmds: Entry[] = (o.phasesAndTurnsOnly ? PHASE_TURN_PHRASES : FIXED_PHRASES).map(([spoken, canonical]: [string, string]) => ({ key: keyOf(norm(spoken)), meaning: { kind: "cmd", canonical } as Meaning, bare: isBareSpoken(spoken) }));
  const otherCmds = cmds.filter(e => e.meaning.kind === "cmd" && !phaseCanonicals.has(e.meaning.canonical));
  // names: full + distinctive partials, same rules as the keyword spotter, shared partials carry every name
  const spokenMap = new Map<string, { names: Set<string>; full: boolean }>();
  const put = (spoken: string, name: string, full: boolean) => { const e = spokenMap.get(spoken) ?? { names: new Set<string>(), full }; e.names.add(name); e.full = e.full || full; spokenMap.set(spoken, e); };
  for (const name of new Set(o.phasesAndTurnsOnly ? [] : deck)) {
    const sp = spokenForm(name); if (!sp) continue;
    const forms = [sp.split(" ")]; if (/^THE /.test(sp) && forms[0].length > 2) forms.push(forms[0].slice(1));
    for (const words of forms) {
      put(words.join(" ").toLowerCase(), name, true);
      for (let from = 0; from < words.length; from++) {
        for (let count = 2; count <= 4 && from + count <= words.length; count++) {
          const run = words.slice(from, from + count);
          if (count === words.length || FN.has(run[0]) || FN.has(run[run.length - 1]) || (!o.relaxRuns && !run.some(w => !STOP.has(w) && !FN.has(w)))) continue;
          put(run.join(" ").toLowerCase(), name, false);
        }
        const w = words[from];
        if (words.length > 1 && w.length >= 5 && !STOP.has(w) && !FN.has(w)) put(w.toLowerCase(), name, false);
      }
    }
  }
  const names: Entry[] = [...spokenMap].map(([spoken, e]) => ({ key: keyOf(norm(spoken)), meaning: { kind: "card", names: [...e.names] } as Meaning, bare: !spoken.includes(" ") }));
  const verbPre = VERB_PREFIX.map(([t]) => keyOf(norm(t))); const verbSuf = VERB_SUFFIX.map(([t]) => keyOf(norm(t)));

  /** Best entries for the words `w` against `list`. */
  const scoreList = (w: string[], list: Entry[]) => {
    const k = keyOf(w); const out: { e: Entry; err: number; len: number }[] = [];
    for (const e of list) { const d = dist(k, e.key, e.bare && e.meaning.kind === "cmd" && !o.bareSound); out.push({ e, ...d }); }
    return out;
  };

  function match(text: string, speechMs: number): Result {
    const phase = matchPhasePhrase(text, speechMs, o.confusions);
    if (phase) return { canonical: phase, ambiguous: [], score: 1 };
    if (o.phasesAndTurnsOnly) return { canonical: "", ambiguous: [], score: 0 };
    let words = norm(text);
    while (words.length && FILLER.has(words[0])) words = words.slice(1);
    // "stand by" is heard as two words
    words = words.flatMap((w, i) => (w === "by" && words[i - 1] === "stand" ? [] : [w]));
    if (!words.length || words.length > 12) return { canonical: "", ambiguous: [], score: 0 };
    const bareOk = speechMs <= 1200;
    type Cand = { score: number; combined?: number; meaning: Meaning; effect: boolean; spoken: string };
    const cands: Cand[] = [];
    // 1. whole utterance as command or name
    const cmdWords = o.confusions ? words.map(commandWord) : words;
    for (const r of scoreList(cmdWords, otherCmds)) { const s = 1 - r.err / r.len; if (s >= o.cmdMin && (!r.e.bare || bareOk)) cands.push({ score: s, meaning: r.e.meaning, effect: false, spoken: words.join(" ") }); }
    const nameScores = scoreList(words, names);
    for (const r of nameScores) { const s = 1 - r.err / r.len; if (s >= o.nameMin && (!r.e.bare || bareOk)) cands.push({ score: s, meaning: r.e.meaning, effect: false, spoken: words.join(" ") }); }
    // 2. verb + name, either order. Cut the words at every boundary: verb part vs name part.
    const tryCut = (verbKeys: Key[], verbSide: "pre" | "suf") => {
      for (let cut = 1; cut < words.length; cut++) {
        const verbWords = verbSide === "pre" ? words.slice(0, cut) : words.slice(cut);
        const nameWords = verbSide === "pre" ? words.slice(cut) : words.slice(0, cut);
        const vk = keyOf(verbWords);
        let bestV = { err: Infinity, len: 1 };
        for (const k of verbKeys) { const d = dist(vk, k); if (d.err / d.len < bestV.err / bestV.len) bestV = d; }
        const vs = 1 - bestV.err / bestV.len; if (vs < o.verbMin) continue;
        for (const r of scoreList(nameWords, names)) {
          const ns = 1 - r.err / r.len;
          const sc = 0.75 * ns + 0.25 * vs;
          if (ns >= o.effNameMin && sc >= o.effMin) cands.push({ score: ns, combined: sc, meaning: r.e.meaning, effect: true, spoken: nameWords.join(" ") });
        }
      }
    };
    tryCut(verbPre, "pre"); tryCut(verbSuf, "suf");
    if (!cands.length) return { canonical: "", ambiguous: [], score: 0 };
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0];
    const near = cands.filter(c => best.score - c.score <= o.margin);
    // all near candidates must say the same thing; several cards with the same verb form merge into "ambiguous"
    const sameKind = near.every(c => c.meaning.kind === best.meaning.kind && c.effect === best.effect);
    const runner = cands.find(c => c !== best && JSON.stringify(c.meaning) !== JSON.stringify(best.meaning));
    if (best.meaning.kind === "cmd") {
      const canon = new Set(near.filter(c => c.meaning.kind === "cmd").map(c => (c.meaning as any).canonical));
      if (canon.size > 1 || near.some(c => c.meaning.kind === "card" && !best.effect)) {
        // command vs other: keep the command only when it is clearly ahead
        if (near.length > 1 && canon.size > 1) return { canonical: "", ambiguous: [], score: best.score };
      }
      return { canonical: (best.meaning as any).canonical, ambiguous: [], score: best.score, runnerUp: runner?.score };
    }
    const nameSet = new Set<string>(); for (const c of near) if (c.meaning.kind === "card" && c.effect === best.effect) for (const n of c.meaning.names) nameSet.add(n);
    // A full-name entry that is one name wins over a partial that shares: if the best is a single-name entry and the runner-up merges, keep the best when clearly ahead.
    const bestNames = (best.meaning as any).names as string[];
    const finalNames = near.length === 1 || sameKind === false ? bestNames : [...nameSet];
    if (finalNames.length > 1) {
      if (best.effect) return { canonical: `activate effect of ${best.spoken}`, ambiguous: [finalNames], score: best.score, spoken: best.spoken }; // effect of an ambiguous partial: ask which card
      return { canonical: best.spoken, ambiguous: [finalNames], score: best.score, spoken: best.spoken };
    }
    return { canonical: best.effect ? `activate effect of ${finalNames[0]}` : finalNames[0], ambiguous: [], score: best.score, runnerUp: runner?.score };
  }
  let pending: SpeechFragment | undefined;
  function matchUtterance(fragment: SpeechFragment): Result & { joinedText?: string } {
    const result = match(fragment.text, fragment.speechMs);
    const previous = pending;
    pending = undefined;
    if (result.canonical || result.ambiguous.length || norm(fragment.text).length !== 1 || fragment.speechMs > 1200) return result;
    if (previous) {
      const gap = fragment.startedAt - previous.endedAt;
      if (gap >= 0 && gap <= PHASE_JOIN_GAP_MS) {
        const joinedText = `${previous.text} ${fragment.text}`;
        const canonical = matchPhasePhrase(joinedText, previous.speechMs + fragment.speechMs, o.confusions);
        if (canonical) return { canonical, ambiguous: [], score: 1, joinedText };
      }
    }
    pending = fragment;
    return result;
  }
  return { match, matchUtterance, resetUtterances: () => { pending = undefined; }, counts: { cmds: cmds.length, names: names.length } };
}
