import type { Card } from "./card.js";
import { matchCard, type MatchEvent, type MatchTags } from "./effect-match.js";
import { describe, type EffectQuery } from "./query.js";

/** Unknown reader words are preferences, never additional requirements. */
export function softTextScore(card: Pick<Card, "name" | "text" | "pendulumText">, text: string): number {
  if (!text.trim()) return 0;
  const fold = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const words = [...new Set(fold(text).split(" ").filter(Boolean))];
  const name = fold(card.name), printed = fold(`${card.text} ${card.pendulumText ?? ""}`);
  return words.length ? words.reduce((score, word) => score + (name.includes(word) ? 2 : printed.includes(word) ? 1 : 0), 0) / words.length : 0;
}

export const shortReason = (text: string): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 70) return clean;
  const end = clean.slice(0, 67).replace(/\s+\S*$/, "");
  return `${end || clean.slice(0, 67)}…`;
};

const ACTS: Record<string, (target: string) => string> = {
  negate_effect: target => `Negates the effects of ${target}`,
  negate_activation: target => `Negates the activation of ${target}`,
  destroy: target => `Destroys ${target}`,
  banish: target => `Banishes ${target}`,
  return_to_hand: target => `Returns ${target} to the hand`,
  send_to_gy: target => `Sends ${target} to the GY`,
  take_control: target => `Takes control of ${target}`,
};

/** "an opponent's face-up Effect monster": what a tagged action touches, or "" when the tag names nothing in particular. */
/** Tag records keep `note` and `other`; the matcher's trimmed type does not name them. */
type ReasonEvent = MatchEvent & { note?: string; what: { other?: string } };

function targetPhrase(action: ReasonEvent): string {
  const what = action.what;
  const named = what.names[0] ?? what.archetypes[0] ?? "";
  if (!named && !what.kinds.length && !what.subtypes.length && !what.types.length && !what.attributes.length) return "";
  // The opponent is the default target of a disruption, so only "your" is worth the room.
  const owner = action.player === "you" ? "your" : "a";
  const condition = what.other && what.other.length <= 12 ? what.other : "";
  const noun = named ? (what.names[0] ? named : `"${named}" card`) : [what.attributes.join("/"), ...what.types, ...what.subtypes.map(value => value === "effect" ? "Effect" : value), what.kinds.join("/") || "card"].join(" ");
  const zone = action.from.length === 1 ? ({ gy: " in the GY", deck: " in the Deck", hand: " in the hand", banished: " that is banished" } as Record<string, string>)[action.from[0]!] ?? "" : "";
  return [owner, condition, noun].filter(Boolean).join(" ") + zone;
}

const thirdPerson = (word: string) => /s$/i.test(word) ? word : /(?:sh|ch|x|z)$/i.test(word) ? `${word}es` : /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;

/** The part of the tagged summary that starts at the matched verb, cut at the first comma or semicolon. "" when it would not stand alone. */
function summaryClause(summary: string, verb: string): string {
  const stem = verb.split("_")[0]!;
  const hit = new RegExp(`\\b${stem}\\w*`, "i").exec(summary);
  if (!hit) return "";
  let clause = summary.slice(hit.index).split(/(?<=[.!?])\s/)[0]!.replace(/[.!?]$/, "").replace(/;.*$/, "");
  const comma = clause.indexOf(", ");
  if (comma >= 25) clause = clause.slice(0, comma);
  if (clause.length < 18 || /^\S+\s+(?:it|its|their|them|this|that|these|those)\b/i.test(clause)) return "";
  if (/\bto $/.test(summary.slice(0, hit.index))) {
    // "... to negate X and destroy it": both verbs follow the card's own effect, so they read as "Negates X and destroys it".
    clause = clause.replace(hit[0], thirdPerson(hit[0])).replace(/ and ([a-z]+)\b/, (all, word: string) => /^(?:the|a|an|your|their|its|that|this|[a-z]*(?:ed|ing))$/.test(word) ? all : ` and ${thirdPerson(word)}`);
  }
  return clause[0]!.toUpperCase() + clause.slice(1);
}

/** Describe an actually matching effect, specific part first; read summaries only for the retained page. */
export function effectMatchReason(card: Card, tags: MatchTags | undefined, query: EffectQuery, summary = ""): string {
  const empty = { kinds: [], subtypes: [], types: [], attributes: [], archetypes: [] };
  const matched = tags?.effects.find(effect => matchCard(card, { ...tags, effects: [effect] }, query) !== null);
  const event = matched && (query.does ? [...matched.actions, ...matched.costs].find(value => query.does!.verbs.includes(value.verb))
    : query.reactsTo ? matched.triggers.find(value => query.reactsTo!.verbs.includes(value.verb)) : undefined);
  let text = "";
  if (event && query.does) {
    const target = targetPhrase(event as ReasonEvent), act = ACTS[event.verb];
    if (act && target) {
      text = act(target);
      if (/end of (?:this )?turn|for the turn/i.test((event as ReasonEvent).note ?? "") && text.length + 10 <= 70) text += " this turn";
    } else text = summaryClause(summary, event.verb);
  }
  const chipText = (): string => {
    if (!event) return "";
    const chip = describe({ card: empty, roles: [], quick: false, text: "", does: {
      verbs: [event.verb], from: query.does?.from ?? query.reactsTo?.from ?? [],
      self: query.does?.self ?? query.reactsTo?.self ?? false,
      player: query.does?.player ?? query.reactsTo?.player,
      object: { ...empty, ...(query.does?.object ?? query.reactsTo?.object) },
    } })[0]!;
    const words = chip.replace(/^Does: /, query.reactsTo && !query.does ? "Responds to " : "").replaceAll(" · ", " ");
    return words[0]!.toUpperCase() + words.slice(1);
  };
  const location = matched?.location.find(zone => zone === "hand" || zone === "gy" || zone === "banished");
  if (!text && !query.does) text = chipText();
  if (!text) text = summary.replace(/^[^.:]{1,20}:\s+/, "").split(/(?<=[.!?])\s/)[0] ?? "";
  if (text) text = text[0]!.toUpperCase() + text.slice(1);
  if (!text) text = chipText();
  if (!text) {
    text = describe({ ...query, text: "" }).find(chip => !chip.startsWith("Sort:"))?.replace(/^(?:Role|Card is|Works with): /, "") ?? "Matches your search";
    const type = query.card.types[0];
    if (type && !text.includes(type)) text = `${type}: ${text}`;
  }
  const generic = query.roles.includes("hand_trap") || query.worksFrom;
  const suffix = location && !generic ? ` — from ${location === "gy" ? "the GY" : location === "hand" ? "the hand" : "banishment"}` : "";
  return shortReason(text.length + suffix.length <= 70 ? text + suffix : text);
}
