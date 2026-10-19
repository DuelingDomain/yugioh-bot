import type { Card } from "./card.js";
import { matchCard, type MatchTags } from "./effect-match.js";
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

/** Describe an actually matching effect; read summaries only for the retained page. */
export function effectMatchReason(card: Card, tags: MatchTags | undefined, query: EffectQuery, summary = ""): string {
  const empty = { kinds: [], subtypes: [], types: [], attributes: [], archetypes: [] };
  const matched = tags?.effects.find(effect => matchCard(card, { ...tags, effects: [effect] }, query) !== null);
  const event = matched && (query.does ? [...matched.actions, ...matched.costs].find(value => query.does!.verbs.includes(value.verb))
    : query.reactsTo ? matched.triggers.find(value => query.reactsTo!.verbs.includes(value.verb)) : undefined);
  let text = "";
  if (event) {
    const chip = describe({ card: empty, roles: [], quick: false, text: "", does: {
      verbs: [event.verb], from: query.does?.from ?? query.reactsTo?.from ?? [],
      self: query.does?.self ?? query.reactsTo?.self ?? false,
      player: query.does?.player ?? query.reactsTo?.player,
      object: { ...empty, ...(query.does?.object ?? query.reactsTo?.object) },
    } })[0]!;
    text = chip.replace(/^Does: /, query.reactsTo && !query.does ? "Responds to " : "").replaceAll(" · ", " ");
    text = text[0]!.toUpperCase() + text.slice(1);
  }
  const location = matched?.location.find(zone => zone === "hand" || zone === "gy" || zone === "banished");
  if (!text) text = summary.split(/(?<=[.!?])\s/)[0] ?? "";
  if (!text) text = describe({ ...query, text: "" }).find(chip => !chip.startsWith("Sort:"))?.replace(/^(?:Role|Card is|Works with): /, "") ?? "Matches your search";
  const type = query.card.types[0];
  if (type && !text.includes(type)) text = `${type}: ${text}`;
  const suffix = location ? ` — from ${location === "gy" ? "the GY" : location === "hand" ? "the hand" : "banishment"}` : "";
  return shortReason(text.length + suffix.length <= 70 ? text + suffix : text);
}
