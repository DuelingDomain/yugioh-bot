import { doubleMetaphone } from './phonetics.js';

// Keep these rules aligned with services/stt/stt/matcher.py.
const STAPLES = {
  'Ash Blossom & Joyous Spring': ['ash', 'ash blossom'],
  'Infinite Impermanence': ['imperm'], 'Nibiru, the Primal Being': ['nib', 'nibiru'],
  'Called by the Grave': ['called by'], 'Maxx "C"': ['maxx c', 'max c'],
  'Effect Veiler': ['veiler'], 'Droll & Lock Bird': ['droll', 'droll and lock bird'],
  'Ghost Belle & Haunted Mansion': ['ghost belle'], 'Crossout Designator': ['crossout'],
  "Harpie's Feather Duster": ['feather duster'], 'Monster Reborn': [], 'Raigeki': [],
  'Pot of Prosperity': [], 'Triple Tactics Talent': ['talents'],
};
const CUES = new Set('activate activation summon summoning chain set play with send discard tribute banish target attack attacks'.split(' '));
const BOUNDARIES = new Set([...CUES, ...'i my your to the directly phase damage take moving'.split(' ')]);
const INTERNAL = new Set([...CUES, 'phase', 'damage', 'directly']);
export const clean = text => (text.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toLowerCase().replaceAll('&', ' and ').match(/[a-z0-9]+/g) ?? []).join(' ');

// RapidFuzz fuzz.ratio is normalized Indel similarity: 2*LCS/(len(a)+len(b)).
function ratio(a, b) {
  if (a === b) return 100;
  if (!a.length || !b.length) return 0;
  const row = new Uint16Array(b.length + 1);
  for (let i = 0; i < a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = a[i] === b[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
      diagonal = previous;
    }
  }
  return 200 * row[b.length] / (a.length + b.length);
}

function extract(phrase, pool) {
  const hits = [];
  for (const [name, entry] of pool) {
    // Length bound cannot exclude any result above RapidFuzz's 70 cutoff.
    if (200 * Math.min(name.length, phrase.length) / (name.length + phrase.length) < 70) continue;
    const lexical = ratio(phrase, name);
    if (lexical < 70) continue;
    const at = hits.findIndex(hit => hit.lexical < lexical);
    hits.splice(at === -1 ? hits.length : at, 0, { name, entry, lexical });
    if (hits.length > 3) hits.pop();
  }
  return hits;
}

export class CardMatcher {
  constructor(cards) {
    this.cards = new Map();
    for (const c of [...cards].sort((a, b) => (b.passcode ?? b.id) - (a.passcode ?? a.id))) {
      this.cards.set(clean(c.name), { name: c.name, passcode: Number(c.passcode ?? c.id) });
    }
    this.full = new Map([...this.cards].map(([key, card]) => [key, { card, priority: false }]));
    this.staples = new Map();
    this.phones = new Map();
    for (const [name, aliases] of Object.entries(STAPLES)) {
      const card = this.cards.get(clean(name));
      if (card) for (const alias of [name, ...aliases]) this.staples.set(clean(alias), { card, priority: true });
    }
    for (const name of this.full.keys()) this.phonetic(name);
  }

  phonetic(text) {
    if (!this.phones.has(text)) {
      if (this.phones.size >= 32768) this.phones.clear();
      this.phones.set(text, [...new Set(doubleMetaphone(text).filter(Boolean))]);
    }
    return this.phones.get(text);
  }

  match(text, hotwords = []) {
    const preferred = new Map(this.staples);
    for (const word of hotwords) {
      const name = clean(word);
      if (this.cards.has(name)) preferred.set(name, { card: this.cards.get(name), priority: true });
    }
    const tokens = [...text.matchAll(/[\p{L}\p{N}_]+(?:['’][\p{L}\p{N}_]+)?|&/gu)];
    const candidates = [];
    for (let start = 0; start < tokens.length; start++) {
      const cue = CUES.has(start ? clean(tokens[start - 1][0]) : '');
      for (let size = Math.min(12, tokens.length - start); size > 0; size--) {
        const end = start + size;
        const span = [tokens[start].index, tokens[end - 1].index + tokens[end - 1][0].length];
        const phrase = clean(text.slice(...span));
        const words = phrase ? phrase.split(' ') : [];
        const exact = this.full.has(phrase) || preferred.has(phrase);
        if (!words.length || (!exact && (BOUNDARIES.has(words[0]) || BOUNDARIES.has(words.at(-1))))) continue;
        if (!exact && words.some(w => INTERNAL.has(w))) continue;
        if (words.length === 1 && !cue && !preferred.has(phrase)) continue;
        const pools = [[preferred, 0.83]];
        if (cue || words.length >= 2) pools.push([this.full, 0.93]);
        for (const [pool, threshold] of pools) {
          for (const { name, lexical, entry: { card, priority } } of extract(phrase, pool)) {
            const canonical = clean(card.name);
            if (name !== canonical && end < tokens.length && !BOUNDARIES.has(clean(tokens[end][0])) && !/[,.;!?]/.test(text.slice(span[1], tokens[end].index))) continue;
            if (Math.abs(name.split(' ').length - words.length) > 1) continue;
            const a = this.phonetic(phrase), b = this.phonetic(name);
            const samePhone = a.some(x => b.includes(x));
            const phone = samePhone ? 100 : Math.max(0, ...a.flatMap(x => b.map(y => ratio(x, y))));
            let score = (0.82 * lexical + 0.18 * phone) / 100;
            if (priority && words.length >= 2 && samePhone) score = Math.max(score, 0.88);
            if (score < threshold || (words.length === 1 && lexical < 85)) continue;
            candidates.push({ span, card, score, size, exact: phrase === canonical, rank: score + (priority ? 0.015 : 0) });
          }
        }
      }
    }
    candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || (b.exact ? b.size - a.size : 0) || b.rank - a.rank || b.size - a.size);
    const selected = [];
    for (const c of candidates) {
      if (!selected.some(s => c.span[0] < s.span[1] && s.span[0] < c.span[1])) selected.push(c);
    }
    selected.sort((a, b) => a.span[0] - b.span[0]);
    let normalizedText = text;
    for (const { span: [a, b], card } of [...selected].reverse()) normalizedText = normalizedText.slice(0, a) + card.name + normalizedText.slice(b);
    return { text, normalizedText, cardMatches: selected.map(({ card, score, span }) => ({
      ...card, score: Math.round(score * 10000) / 10000,
      // Python offsets count Unicode code points, not JS UTF-16 code units.
      span: span.map(index => Array.from(text.slice(0, index)).length),
    })) };
  }
}
