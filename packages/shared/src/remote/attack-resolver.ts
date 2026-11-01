import type { RemoteActionProposal, TwinCard } from "./actions.js";
import type { RemoteState } from "./types.js";

export type AttackCardHint = {
  text?: string;
  cardRef?: string;
  slot?: number;
  side?: "left" | "middle" | "right";
};
export type AttackPlayer = { seat: number; displayName: string; nicknames?: readonly string[] };
export type AttackHints = {
  text?: string;
  attacker?: AttackCardHint;
  target?: AttackCardHint;
  targetSeat?: number;
  targetPlayer?: string;
  direct?: boolean;
  /** Current room names and optional local nicknames. Never copied into proposals/events. */
  players?: readonly AttackPlayer[];
};
export type ResolvedAttackCard = {
  seat: number; cardRef: string; name?: string; race?: string; zone: string; slot?: number;
};
export type AttackCandidate = {
  score: number;
  proposal: Extract<RemoteActionProposal, { type: "attack.declare" }>;
  attacker: ResolvedAttackCard;
  /** Absent only for an explicitly requested direct attack. */
  target?: ResolvedAttackCard;
};
export type AttackResolution = { status: "unique" | "ambiguous" | "none"; candidates: AttackCandidate[] };

type Reference = {
  words: string[]; owners?: number[]; ownership?: "actor" | "opponent";
  cardRef?: string; slot?: number; side?: AttackCardHint["side"]; extra: boolean; invalid: boolean;
};
const fieldZones = new Set(["monster", "extra-monster"]);
const filler = new Set(["a", "an", "the", "my", "our", "own", "his", "her", "their", "your", "opponent", "opponents", "enemy", "monster", "monsters", "card", "cards", "on", "in", "at", "with", "please"]);
const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const tokens = (text: string) => normalize(text).split(/\s+/).filter(Boolean);
const none = (): AttackResolution => ({ status: "none", candidates: [] });

// Vowel-initial words share a marker so STT homophones such as "eyes"/"ice" agree.
function phonetic(word: string): string {
  const letters = word.replace(/[^a-z]/g, "");
  if (!letters) return "";
  const codes: Record<string, string> = { b: "1", f: "1", p: "1", v: "1", c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2", d: "3", t: "3", l: "4", m: "5", n: "5", r: "6" };
  let key = /^[aeiou]/.test(letters) ? "a" : letters[0];
  let previous = codes[letters[0]] ?? "";
  for (const letter of letters.slice(1)) {
    if (letter === "h" || letter === "w") continue;
    const code = codes[letter] ?? "";
    if (code && code !== previous) key += code;
    previous = code;
  }
  return key.slice(0, 4).padEnd(4, "0");
}

// Optimal string alignment distance includes adjacent transpositions ("bule"/"blue").
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  rows[0] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
      rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}
function wordScore(query: string, word: string): number {
  if (query === word) return 1;
  if (query.length < 3 || word.length < 3) return 0;
  if (word.startsWith(query)) return 0.9;
  if (phonetic(query) && phonetic(query) === phonetic(word)) return 0.8;
  const similarity = 1 - distance(query, word) / Math.max(query.length, word.length);
  return similarity >= 0.65 ? 0.6 + similarity * 0.2 : 0;
}
function playerAliases(player: AttackPlayer): string[] {
  const name = normalize(player.displayName);
  return [...new Set([name, ...tokens(player.displayName), ...(player.nicknames ?? []).map(normalize)])].filter(Boolean);
}
function playerSeats(name: string, players: readonly AttackPlayer[]): number[] {
  const key = normalize(name);
  return players.filter(player => playerAliases(player).includes(key)).map(player => player.seat);
}
function readReference(raw: string, hint: AttackCardHint | undefined, players: readonly AttackPlayer[], allowBareOwner: boolean): Reference {
  let text = raw.toLowerCase().replace(/’/g, "'").trim();
  const ref: Reference = { words: [], cardRef: hint?.cardRef, slot: hint?.slot, side: hint?.side, extra: false, invalid: text.length > 500 };
  const possessive = /^(.+?)'s(?:\s+|$)/.exec(text);
  if (possessive) {
    const owners = playerSeats(possessive[1], players);
    if (owners.length) { ref.owners = owners; text = text.slice(possessive[0].length); }
  } else if (allowBareOwner) {
    // Only direct attacks consume bare names; ordinary card words may overlap player names.
    const folded = normalize(text);
    const aliases = players.flatMap(player => playerAliases(player)).sort((a, b) => b.length - a.length);
    const alias = aliases.find(name => folded === name || folded.startsWith(`${name} `));
    if (alias) { ref.owners = playerSeats(alias, players); text = folded.slice(alias.length).trim(); }
  }
  if (/\b(my|our)\b/.test(text)) ref.ownership = "actor";
  if (/\b(his|her|their|your|opponents?|enemy)\b/.test(text)) {
    if (ref.ownership) ref.invalid = true;
    ref.ownership = "opponent";
  }
  text = normalize(text);
  const numbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  text = text.replace(/\b(?:zone|slot)\s+(\w+)\b/g, (_match, value: string) => {
    const slot = numbers[value] ?? Number(value);
    if (!Number.isInteger(slot) || slot < 1 || slot > 5 || (ref.slot !== undefined && ref.slot !== slot)) ref.invalid = true;
    ref.slot = slot;
    return " ";
  });
  text = text.replace(/\b(leftmost|rightmost|left|middle|right|center|centre)\b/g, (_match, value: string) => {
    const side = value.startsWith("left") ? "left" : value.startsWith("right") ? "right" : "middle";
    if (ref.side && ref.side !== side) ref.invalid = true;
    ref.side = side;
    return " ";
  });
  ref.extra = /\bextra monster\b/.test(text);
  text = text.replace(/\bextra monster\b/g, " ");
  ref.words = text.split(/\s+/).filter(word => word && !filler.has(word));
  if (ref.slot !== undefined && (!Number.isInteger(ref.slot) || ref.slot < 1 || ref.slot > 5)) ref.invalid = true;
  return ref;
}
function readReferences(raw: string, hint: AttackCardHint | undefined, players: readonly AttackPlayer[], allowBareOwner = false): Reference[] {
  const refs = [readReference(raw, hint, players, allowBareOwner)];
  if (hint?.text !== undefined) refs.push(readReference(hint.text, hint, players, allowBareOwner));
  return refs;
}
function ownerFits(ref: Reference, seat: number, actorSeat: number): boolean {
  return !ref.invalid && (!ref.owners || ref.owners.includes(seat))
    && (ref.ownership !== "actor" || seat === actorSeat) && (ref.ownership !== "opponent" || seat !== actorSeat);
}
function cardScore(card: TwinCard, ref: Reference): number {
  if (!fieldZones.has(card.zone) || (ref.extra && card.zone !== "extra-monster") || (ref.cardRef !== undefined && ref.cardRef !== card.ref)) return 0;
  if (ref.slot !== undefined && ref.slot !== card.slot) return 0;
  if (ref.side) {
    const slot = ref.side === "left" ? 1 : ref.side === "right" ? (card.zone === "extra-monster" ? 2 : 5) : 3;
    if ((card.zone === "extra-monster" && ref.side === "middle") || card.slot !== slot) return 0;
  }
  if (!ref.words.length) return ref.cardRef ? 1 : ref.slot || ref.side ? 0.7 : 0.25;
  // Face-down identities must not participate even if a caller mistakenly supplies annotations.
  const name = card.faceUp ? tokens(card.name ?? "") : [];
  const race = card.faceUp ? tokens(card.race ?? "") : [];
  const scores = ref.words.map(query => Math.max(0, ...name.map(word => wordScore(query, word)), ...race.map(word => wordScore(query, word) * 0.9)));
  if (scores.some(score => score === 0)) return 0;
  const exact = ref.words.join(" ") === name.join(" ");
  return Math.min(1, scores.reduce((sum, score) => sum + score, 0) / scores.length * 0.85 + (exact ? 0.15 : 0));
}
function constrainedCardScore(card: TwinCard, refs: Reference[]): number {
  const scores = refs.map(ref => cardScore(card, ref));
  return scores.every(score => score > 0) ? Math.max(...scores) : 0;
}
function describeCard(seat: number, card: TwinCard): ResolvedAttackCard {
  return { seat, cardRef: card.ref, zone: card.zone, ...(card.slot === undefined ? {} : { slot: card.slot }),
    ...(card.faceUp && card.name ? { name: card.name } : {}), ...(card.faceUp && card.race ? { race: card.race } : {}) };
}

/** Pure, browser-safe suggestions against the public board twin. Does not validate turn/phase or execute actions. */
export function resolveAttack(state: RemoteState, input: string | AttackHints, actorSeat: number): AttackResolution {
  const actor = state.seats.find(seat => seat.seat === actorSeat);
  if (!actor || actor.eliminated || state.ended) return none();
  const hints: AttackHints = typeof input === "string" ? { text: input } : input;
  const players = hints.players ?? [];
  let attackerText = "", targetText = "";
  let direct = hints.direct === true;
  if (hints.text !== undefined) {
    if (hints.text.length > 500) return none();
    const command = /^(.*?)\battacks?\b(.*)$/i.exec(hints.text.trim());
    if (!command) return none();
    attackerText = command[1].trim(); targetText = command[2].trim();
    const withAttacker = /^(.*?)\bwith\b(.+)$/i.exec(targetText);
    if (!attackerText && withAttacker) { targetText = withAttacker[1]; attackerText = withAttacker[2]; }
    if (/\bdirectly\b|\bdirect attack\b/i.test(targetText)) {
      if (hints.direct === false) return none();
      direct = true; targetText = targetText.replace(/\bdirectly\b|\bdirect attack\b/gi, " ").trim();
    }
  } else if (!hints.attacker && !hints.target && hints.targetSeat === undefined && !hints.targetPlayer && !direct) return none();
  const attackerRefs = readReferences(attackerText, hints.attacker, players);
  const targetRefs = readReferences(targetText, hints.target, players, direct);
  if (!attackerRefs.every(ref => ownerFits(ref, actorSeat, actorSeat)) || targetRefs.some(ref => ref.invalid)) return none();
  // Direct speech must not discard a contradictory target card/slot/name hint.
  if (direct && targetRefs.some(ref => ref.words.length || ref.cardRef !== undefined || ref.slot !== undefined || ref.side || ref.extra)) return none();
  const namedSeats = hints.targetPlayer === undefined ? undefined : playerSeats(hints.targetPlayer, players);
  const attackers = actor.twin.map(card => ({ card, score: constrainedCardScore(card, attackerRefs) })).filter(item => item.score > 0);
  const candidates: AttackCandidate[] = [];
  for (const seat of state.seats) {
    if (seat.seat === actorSeat || seat.eliminated || !targetRefs.every(ref => ownerFits(ref, seat.seat, actorSeat))) continue;
    if (hints.targetSeat !== undefined && seat.seat !== hints.targetSeat) continue;
    if (namedSeats && !namedSeats.includes(seat.seat)) continue;
    const targets = direct ? [{ card: undefined, score: 1 }] : seat.twin.map(card => ({ card, score: constrainedCardScore(card, targetRefs) })).filter(item => item.score > 0);
    for (const attacker of attackers) for (const target of targets) {
      candidates.push({
        score: Math.round((attacker.score + target.score) / 2 * 10_000) / 10_000,
        proposal: { type: "attack.declare", actorSeat, attackerSeat: actorSeat, attackerCardRef: attacker.card.ref, targetSeat: seat.seat,
          ...(target.card ? { targetCardRef: target.card.ref } : { direct: true }) },
        attacker: describeCard(actorSeat, attacker.card), ...(target.card ? { target: describeCard(seat.seat, target.card) } : {}),
      });
    }
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  candidates.sort((a, b) => b.score - a.score || a.proposal.targetSeat - b.proposal.targetSeat
    || compare(a.attacker.cardRef, b.attacker.cardRef) || compare(a.target?.cardRef ?? "", b.target?.cardRef ?? ""));
  return { status: candidates.length === 0 ? "none" : candidates.length === 1 ? "unique" : "ambiguous", candidates };
}
