import {readFormatQuery} from "./format-query.js";
import {readReleaseQuery} from "./release-query.js";
import type { Card } from "./card.js";
import type { MatchTags } from "./effect-match.js";
import { matchCard } from "./effect-match.js";
import { describe, isEmptyObject, type EffectQuery, type Interpretation } from "./query.js";
import { compactEffectName } from "./name-match.js";
import { belongsTo, hookQuery, type ArchetypeProfile } from "./synergy.js";
import { synergyHookMatcher, SYNERGY_SCORE_FLOOR } from "./synergy-search-hooks.js";
import { type CounterProfile, type Weakness } from "./counters.js";
import { shortReason } from "./search-reasons.js";

export const searchIntentTarget = (text: string): { kind: "similar" | "counters" | "outside"; target: string } | undefined => {
  const source = text.trim().replace(/[?.!]+$/, "");
  const outside = /^(?:outside(?:\s+of)?\s+(?:the\s+)?|non[- ]+)(.+?)(?:\s+cards?\s+that\s+(?:synergize|synergise|work)\s+with\s+(.+))?$/i.exec(source);
  if (outside) return { kind: "outside", target: (outside[2] ?? outside[1])!.trim() };
  const similar = /^(?:cards? like|similar to|budget(?: alternatives? (?:to|for))?)\s+(.+)$/i.exec(source);
  if (similar) return { kind: "similar", target: similar[1]!.trim() };
  const counter = /^(?:how to beat|counters? (?:to|for)|stop)\s+(.+)$/i.exec(source);
  return counter ? { kind: "counters", target: counter[1]!.trim() } : undefined;
};

export const synergyTarget = (text: string): string | undefined =>
  text.trim().replace(/[?.!]+$/, "").match(/^(?:cards?\s+that\s+)?(?:works?\s+(?:well\s+)?with|synerg(?:y|ies|izes?|ises?)\s+(?:with|for)|partners?\s+for)\s+(.+)$/i)?.[1];

export function intentReading(text: string, card: (name: string) => { id: number; name: string } | undefined, archetype: (name: string) => string | undefined): Interpretation | null {
  const format=readFormatQuery(text), release=readReleaseQuery(format.text);
  const facets={...(format.filter?{formatFilter:format.filter}:{}),...(release.released?{released:release.released,releaseLabel:release.releaseLabel}:{}),...(release.sort?{sort:release.sort}:{})};
  text=release.text;
  const synergy = synergyTarget(text) ?? text.trim().replace(/[?.!]+$/, "").match(/^(.+?)\s+(?:synerg(?:y|ies)|partners?|combos?)$/i)?.[1];
  if (synergy) {
    const targets = synergy.split(/\s+(?:and|&|\+)\s+|,\s*/i).map(name => name.trim());
    const resolved = targets.map(name => archetype(name));
    // An exact archetype wins over a fuzzy card name (Monarch vs. The First Monarch).
    // Other complete card names still take the individual-card path.
    if (resolved.every((name, at) => name && compactEffectName(name) === compactEffectName(targets[at]!))) {
      const empty = { kinds: [], subtypes: [], types: [], attributes: [], archetypes: [] };
      const query = { ...facets, card: empty, roles: [], quick: false, text: "", supports: { ...empty, archetypes: [...new Set(resolved as string[])] } };
      return { query, chips: describe(query) };
    }
  }
  if (!(release.released && /^hand[- ]?traps$/i.test(text.trim())) && /^(?:(?:best|format|generic|popular|current|tcg|domain|genesys)\s+)*(?:staples?|hand[- ]?traps)(?:\s+(?:for (?:this|the) format|this format))?[?.!]*$/i.test(text.trim())) {
    const query = { ...facets, intent: { kind: "staples" as const }, card: { kinds: [], subtypes: [], types: [], attributes: [], archetypes: [] }, roles: /hand[- ]?traps/i.test(text) ? ["hand_trap" as const] : [], quick: false, text: "" };
    return { query, chips: describe(query) };
  }
  const rolePhrase=/^(.+?)\s+(hand[- ]?traps?|staples?|removal|extenders?|board[- ]?breakers?|negation|searchers?)\s*[?.!]*$/i.exec(text.trim());
  if (rolePhrase) {
    const target=archetype(rolePhrase[1]!.replace(/\s+deck$/i,"")), roleWord=rolePhrase[2]!.toLowerCase().replace(/[- ]/g,"");
    const role: import("./archetype-roles.js").ArchetypeRole = roleWord.startsWith("handtrap")?"hand_trap":roleWord.startsWith("boardbreaker")?"board_breaker":roleWord.startsWith("extender")?"extender":roleWord.startsWith("searcher")?"searcher":roleWord.startsWith("staple")?"staples":roleWord === "removal"?"removal":"negation";
    if (target) {
      const query={...facets,intent:{kind:"archetype_role" as const,archetype:target,role},card:{kinds:[],subtypes:[],types:[],attributes:[],archetypes:[]},roles:role==="staples"?[]:[role],quick:false,text:""};
      return {query,chips:describe(query)};
    }
  }
  const parsed = searchIntentTarget(text);
  if (!parsed) return null;
  const anchor = parsed.kind === "similar" ? card(parsed.target) : undefined;
  const target = parsed.kind !== "similar" ? archetype(parsed.target) : undefined;
  const intent = anchor ? { kind: "similar" as const, passcode: anchor.id, name: anchor.name }
    : target ? parsed.kind === "outside" ? { kind: "outside" as const, archetype: target } : { kind: "counters" as const, archetype: target } : undefined;
  if (!intent) return null;
  const query = { ...facets, intent, card: { kinds: [], subtypes: [], types: [], attributes: [], archetypes: [] }, roles: [], quick: false, text: "" };
  return { query, chips: describe(query) };
}

/** Compile specific engine hooks once for either search entry point.
 * Multi-target searches require an independently qualified hook into every target. */
export function archetypeSupportMatcher(query: EffectQuery, profiles: ReadonlyMap<string, ArchetypeProfile>) {
  if (query.intent || !query.supports?.archetypes.length) return undefined;
  const support = { ...query.supports, archetypes: [] };
  const base = { ...query, supports: isEmptyObject(support) ? undefined : support };
  const targets = query.supports.archetypes.map(archetype => ({
    archetype,
    hooks: synergyHookMatcher(profiles.get(archetype), archetype),
  }));
  return (candidate: { card: Card; tags?: MatchTags }): { score: number; reason: string } | null => {
    const baseScore = matchCard(candidate.card, candidate.tags, base);
    if (baseScore === null) return null;
    const matches: Array<{ score: number; label: string }> = [];
    for (const target of targets) {
      const named = candidate.tags && [...candidate.tags.supports.archetypes, ...candidate.tags.supports.names]
        .some(name => compactEffectName(name) === compactEffectName(target.archetype));
      const member = belongsTo(candidate.card, target.archetype);
      const match = member || named ? { score: 300, label: `Supports ${target.archetype}` } : target.hooks(candidate);
      if (!match || match.score < SYNERGY_SCORE_FLOOR) return null;
      matches.push(match);
    }
    return {
      // The weakest connection controls a multi-target match. Hook counts cannot inflate it.
      score: Math.min(...matches.map(match => match.score)) + Math.min(9, baseScore),
      reason: shortReason(matches.length > 1 ? `Works with ${targets.map(target => target.archetype).join(" + ")}`
        : matches[0]!.score >= 280 ? matches[0]!.label : `${matches[0]!.label} for ${targets[0]!.archetype}`),
    };
  };
}

/** Weighted Jaccard, emphasizing role and action overlap over kind and zones. */
export function cardSimilarity(anchor: { card: Card; tags?: MatchTags }, candidate: { card: Card; tags?: MatchTags }): number | null {
  if (anchor.card.id === candidate.card.id || !anchor.tags || !candidate.tags) return null;
  const features = ({ card, tags }: typeof anchor) => {
    const result = new Map<string, number>([[`kind:${card.kind}`, 1]]);
    for (const role of tags!.roles) result.set(`role:${role}`, 4);
    for (const effect of tags!.effects) {
      for (const zone of effect.location) result.set(`location:${zone}`, 1);
      for (const action of effect.actions) {
        result.set(`does:${action.verb}`, 3);
        for (const zone of action.from) result.set(`zone:${action.verb}:${zone}`, 1);
      }
    }
    return result;
  };
  const left = features(anchor), right = features(candidate);
  let shared = 0, total = 0, mechanical = false;
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const weight = left.get(key) ?? right.get(key)!;
    total += weight;
    if (left.has(key) && right.has(key)) {
      shared += weight;
      if (key.startsWith("role:") || key.startsWith("does:")) mechanical = true;
    }
  }
  return mechanical ? 10 * shared / total : null;
}

/** Derive opposing queries from the published reliance hooks, without another model. */
export function counterProfileFromHooks(profile: ArchetypeProfile): CounterProfile {
  const weaknesses: Weakness[] = [];
  const things = { kinds: [], subtypes: [], types: [], attributes: [], level_min: 0, level_max: 0 };
  const add = (label: string, why: string, roles: Weakness["roles"], verbs: NonNullable<Weakness["does"]>["verbs"] = [], from: NonNullable<Weakness["does"]>["from"] = []) => {
    if (weaknesses.some(value => value.label === label)) return;
    weaknesses.push({ label, why, roles, when: "either", does: verbs.length ? { verbs, from, player: "opponent", self: false, what: things } : null,
      reacts_to: null, card: null, supports: null, phrases: [] });
  };
  for (const hook of profile.hooks) {
    const events = [hook.does, hook.reacts_to].filter(value => value !== null);
    if (events.some(event => event.from.includes("gy") || event.verbs.includes("send_to_gy"))) {
      add("Disrupts graveyard resources", "Disrupts the GY resources this plan relies on", ["gy_hate"]);
    }
    if (events.some(event => event.verbs.some(verb => ["special_summon", "add_to_hand", "fusion_summon"].includes(verb)))) {
      add("Interrupts the engine", "Negates the searches or summons that start this plan", ["disruption"], ["negate_activation", "negate_effect"]);
      add("Stops Special Summons", "Restricts the Special Summons this plan relies on", [], ["restrict_summon", "negate_summon"]);
    }
    if (hook.phrases.some(phrase => /rank|xyz/i.test(phrase)) || hook.card?.subtypes.includes("xyz")) {
      add("Tributes the Xyz board", "Tributes a boss before its Xyz board can lock zones", [], ["tribute"], ["field"]);
      add("Turns off Xyz bosses", "Turns the Xyz boss face-down to stop its effects", [], ["change_position"], ["field"]);
    }
  }
  return { plan: profile.plan, weaknesses: weaknesses.slice(0, 6), answers: [] };
}

/** Streaming counterpart of the credited findCounters matcher; no catalog snapshot. */
export function counterLink(profile: CounterProfile, archetype: string, candidate: { card: Card; tags?: MatchTags }): { score: number; reason: string } | null {
  if (belongsTo(candidate.card, archetype)) return null;
  const printed = `${candidate.card.text}\n${candidate.card.pendulumText ?? ""}`.toLowerCase();
  const stops = profile.weaknesses.filter(weakness => weakness.roles.every(role => candidate.tags?.roles.includes(role))
    && weakness.phrases.every(phrase => printed.includes(phrase.toLowerCase()))
    && matchCard(candidate.card, candidate.tags, hookQuery(weakness, archetype)) !== null);
  const answer = profile.answers.find(value => value.name === candidate.card.name);
  if (!answer && !stops.length) return null;
  return { score: (answer ? 100 : 0) + stops.length * 4, reason: shortReason(answer?.why ?? `${stops[0]!.label} against ${archetype}`) };
}
