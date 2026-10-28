import { createHash } from "node:crypto";
import { ATTRIBUTES, MONSTER_TYPES, isExtraDeckCard, matchesSubtypes, type Card } from "./card.js";
import { NO_FILTER, type CardFilter } from "./tags.js";
import type { CapabilityKey, SummonLock } from "./bridge-types.js";

export const bridgeHash = (value: unknown): string => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const texts = new WeakMap<Card, string>();
export const printedText = (card: Card): string => {
  let text = texts.get(card);
  if (text === undefined) { text = [card.pendulumText, card.text].filter(Boolean).join("\n").replace(/\r\n?/g, "\n").trim(); texts.set(card, text); }
  return text;
};
export const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+|[\r\n]+/).map(part => part.trim()).filter(Boolean);
const names = new Map<string, string[]>();
export const quotedNames = (text: string): string[] => {
  let values = names.get(text);
  if (!values) { values = [...text.matchAll(/["“]([^"”]+)["”]/g)].map(match => match[1]!); names.set(text, values); }
  return values;
};
const words = new Map<string, RegExp>();
const word = (text: string, value: string) => {
  let regex = words.get(value);
  if (!regex) { regex = new RegExp(`(?:^|[^a-zA-Z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("_", "[- ]")}(?:s|es)?(?:$|[^a-zA-Z0-9])`, /[a-z]/.test(value) ? "i" : ""); words.set(value, regex); }
  return regex.test(text);
};
const typePattern = new RegExp(`(?<![a-z-])(${[...MONSTER_TYPES].sort((a, b) => b.length - a.length).map(type => type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?:s)?(?![a-z-])`, "gi");
const printedTypes = (text: string) => new Set([...text.replace(/-Type\b/gi, "").matchAll(typePattern)].map(match => match[1]!.toLowerCase()));
export const sameName = (a: string, b: string): boolean => a.normalize("NFKC").toLowerCase() === b.normalize("NFKC").toLowerCase();
export const namedIn = (text: string, name: string): boolean => quotedNames(text).some(value => sameName(value, name));
const positiveNames = new WeakMap<Card, Set<string>>();
export function positiveMention(card: Card, name: string): boolean {
  let values = positiveNames.get(card);
  if (!values) {
    values = new Set(sentences(printedText(card)).filter(text => !/cannot|you can only|must (?:first )?be|for the rest|\bexcept\b/i.test(text)
      && /add|Summon|Set|place|treated|name becomes|Tribute|send|banish|gain|control/i.test(text)).flatMap(quotedNames).map(name => name.toLowerCase()));
    positiveNames.set(card, values);
  }
  return values.has(name.toLowerCase());
}
export function mentionReachesCard(card: Card, name: string, target: Card): boolean {
  if (!positiveMention(card, name)) return false;
  return sentences(printedText(card)).some(text => {
    if (!namedIn(text, name) || /cannot|you can only|must (?:first )?be|for the rest|\bexcept\b/i.test(text)) return false;
    const quoted = quotedNames(text).find(value => sameName(value, name));
    if (!quoted) return false;
    const after = text.slice(text.indexOf(quoted) + quoted.length + 1);
    const requirement = /^(?:\s+or\s+["“][^"”]+["”])*\s*(?:(Normal|Effect|Ritual|Fusion|Synchro|Xyz|Link|Pendulum|Continuous|Field)\s+)?(monster|Spell|Trap)/i.exec(after);
    return !requirement || target.kind === requirement[2]!.toLowerCase()
      && (!requirement[1] || target.subtypes.includes(requirement[1].toLowerCase() as typeof target.subtypes[number]));
  });
}
export const particularFilter = (filter: CardFilter): boolean => Boolean(filter.names.length || filter.archetypes.length || filter.types.length || filter.attributes.length || filter.subtypes.length || filter.level_min || filter.level_max);

/** Unsupported tag qualifiers must never silently widen a bridge edge. */
export function matchesBridgeFilter(filter: CardFilter, card: Card): boolean {
  if (filter.this_card) return false;
  if (filter.kinds.length && !filter.kinds.includes(card.kind)) return false;
  if (!matchesSubtypes(card, filter.subtypes)) return false;
  if (filter.types.length && !filter.types.includes(card.monsterType as typeof filter.types[number])) return false;
  if (filter.attributes.length && !filter.attributes.includes(card.attribute!)) return false;
  if (filter.names.length && !filter.names.some(name => sameName(name, card.name))) return false;
  if (filter.archetypes.length && !filter.archetypes.some(name => card.archetypes?.some(member => sameName(member, name)) || word(card.name, name)
    || [...card.text.matchAll(/always treated as (?:an? )?["“]([^"”]+)["”]/gi)].some(match => word(match[1]!, name)))) return false;
  if ((filter.level_min || filter.level_max) && (card.level === undefined || filter.level_min && card.level < filter.level_min || filter.level_max && card.level > filter.level_max)) return false;
  const other = filter.other.trim();
  if (other && !/^(?:face[- ]up|face[- ]down|you control|in your (?:GY|hand|Deck)|except this card|other than this card|on the field|with a different name)$/i.test(other)) {
    const stat = /^(\d+) (?:or (less|more) )?(ATK|DEF)$/i.exec(other);
    if (!stat) return false;
    const value = stat[3]!.toUpperCase() === "ATK" ? card.atk : card.def;
    if (value == null || (stat[2] === "less" ? value > +stat[1]! : stat[2] === "more" ? value < +stat[1]! : value !== +stat[1]!)) return false;
  }
  return true;
}

export function filterPrinted(filter: CardFilter, text: string): boolean {
  if (!particularFilter(filter)) return false;
  if (![...filter.names, ...filter.archetypes].every(name => namedIn(text, name))) return false;
  if (!filter.types.every(value => printedTypes(text).has(value.toLowerCase()))) return false;
  if (![...filter.attributes, ...filter.subtypes].every(value => word(text, value))) return false;
  if ([...filter.types, ...filter.attributes].some(value => new RegExp(`\\bnon[- ]${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))) return false;
  if (filter.level_min || filter.level_max) {
    const levels = [...text.matchAll(/Level\s+(\d+)(?:\s*(?:to|[-–])\s*(\d+))?\s*(or (?:lower|less|higher|more))?/gi)];
    if (!levels.some(match => {
      const n = +match[1]!, upper = /lower|less/.test(match[3] ?? ""), lower = /higher|more/.test(match[3] ?? "");
      return upper ? filter.level_max === n && !filter.level_min : lower ? filter.level_min === n && !filter.level_max
        : match[2] ? filter.level_min === n && filter.level_max === +match[2] : filter.level_min === n && filter.level_max === n;
    })) return false;
  }
  return true;
}

const actionText: Partial<Record<CapabilityKey, RegExp>> = {
  search: /(?:add|take)[\s\S]*?(?:to your hand|add it to your hand)/i,
  special_summon: /Special Summon/i, normal_summon: /Normal Summon/i,
  set_spell_trap: /\bSet\b/i, place_on_field: /place[\s\S]*?face-up/i,
  send_to_gy: /send[\s\S]*?(?:GY|Graveyard)/i, discard: /discard/i,
  banish: /banish/i, tribute: /tribute/i, return_to_hand: /return[\s\S]*?hand/i,
  return_to_deck: /(?:return|shuffle)[\s\S]*?Deck/i, draw: /draw/i,
  negate: /negate/i, destroy: /destroy/i,
};
export function actionEvidence(card: Card, key: CapabilityKey, filter?: CardFilter): string | undefined {
  const regex = actionText[key];
  return regex ? sentences(printedText(card)).find(text => regex.test(text) && (!filter || !particularFilter(filter) || filterPrinted(filter, text))) : undefined;
}

export function trapTurnSetEvidence(card: Card): string | undefined {
  // A permission on a single Trap just Set by an effect (Fierce Parthe) is not a global rule.
  return sentences(printedText(card)).find(text => /(?:you can activate|trap cards? can be activated)\s*(?:up to )?(?:1 |one )?(?:trap cards?\s*)?(?:the turn (?:it|they) (?:was|were|is|are) set)/i.test(text)
    && /trap card/i.test(text) && !/this card|that card|those cards/i.test(text));
}
export function faceDownNeedEvidence(card: Card): string | undefined {
  return sentences(printedText(card)).find(text => /(?:face-down cards?|set (?:trap )?cards?)/i.test(text)
    && /(?:reveal|return)[^.]*face-down cards?[^.]*(?:you control|your (?:field|hand))|(?:if|while)[^.]*(?:\d+|two|three) or more (?:face-down|Set) cards?[^.]*(?:you control|your field|on the field)/i.test(text)
    && !/this Set card|cannot Set|destroy[^.]*Set card|Set card[^.]*destroy|opponent.*?(?:controls?|set)|\bor\b[^.]*Trap in your GY/i.test(text));
}
export function canReceiveSummon(card: Card, evidence: string): boolean {
  if (isExtraDeckCard(card)) return false;
  if (/cannot be (?:Normal Summoned\/Set|Special Summoned)(?:\.|,|\s+except)/i.test(card.text)) return false;
  if (/must (?:first )?be (?:Special|Fusion|Synchro|Xyz|Link|Ritual) Summoned|cannot be Special Summoned by other ways/i.test(card.text)) return false;
  return /Special Summon/i.test(evidence);
}
export function trapMonsterEvidence(card: Card): string | undefined {
  return card.kind === "trap" ? sentences(printedText(card)).find(text => /Special Summon this card as an? (?:Effect |Normal |Tuner )*Monster/i.test(text)) : undefined;
}

export function extractSummonLocks(card: Card): SummonLock[] {
  const text = printedText(card);
  const selfRemoval = /(?:Tribute|banish|send|return) this (?:face-up )?card(?: you control)?\s*(?:;|to the (?:GY|Graveyard|hand|Deck))/i.test(text);
  return sentences(text).filter(sentence => (/\byou cannot (?:Special )?Summon/i.test(sentence)
    || /(?:neither player can|no player can|players cannot) (?:Special )?Summon/i.test(sentence)
    || /you can only Special Summon/i.test(sentence) && /rest of (?:this|the) turn|the turn you activate/i.test(sentence))
    && !/cannot be (?:Special )?Summoned/i.test(sentence)).map(sentence => {
    const whole = /(?:the|during the) turn you (?:activate|use|(?:Special |Normal )?Summon)/i.test(sentence);
    const after = /rest of (?:this|the) turn|until the end of (?:this|the) turn|after (?:this|that).*?resolves|for the rest/i.test(sentence);
    const whileFaceUp = /while .*?(?:face-up|control)|while this card/i.test(sentence) || !whole && !after && (/^You cannot Special Summon, except /i.test(sentence)
      || /(?:neither player can|no player can|players cannot) (?:Special )?Summon/i.test(sentence));
    const allowedText = /except\s+(.+?)(?:\.(?:\s|$)|$)/i.exec(sentence)?.[1]
      ?? /you can only Special Summon\s+([^.;]+)/i.exec(sentence)?.[1] ?? "";
    const types = MONSTER_TYPES.filter(type => printedTypes(allowedText).has(type.toLowerCase()));
    const attributes = ATTRIBUTES.filter(attribute => word(allowedText, attribute));
    const archetypes = quotedNames(allowedText);
    const level = /(?:Level(?:\/Rank)?(?:\/Link)?|Rank|Link)[- ](\d+)(?: or (higher|lower))?/i.exec(allowedText);
    const subtypes = (["fusion", "synchro", "xyz", "link", "ritual", "pendulum"] as const).filter(type => word(allowedText, type) && !(type === "link" && /Level\/Rank\/Link/i.test(allowedText)));
    if (/\bRank[- ]\d/i.test(allowedText) && !/Level\/Rank/i.test(allowedText) && !subtypes.includes("xyz")) subtypes.push("xyz");
    const unresolved = !allowedText || !types.length && !attributes.length && !archetypes.length && !subtypes.length && !level
      || /\bor\b/.test(allowedText) && (Number(!!types.length) + Number(!!attributes.length) + Number(!!subtypes.length) + Number(!!archetypes.length) > 1);
    return {
      scope: whole ? "whole_turn_cost" : after ? "rest_of_turn_after_activation" : whileFaceUp ? "while_face_up" : "none",
      allow: { ...NO_FILTER, kinds: ["monster"], types: [...types], attributes: [...attributes], archetypes, subtypes: [...subtypes],
        level_min: level && level[2] !== "lower" ? +level[1]! : 0, level_max: level && level[2] !== "higher" ? +level[1]! : 0 },
      extra_deck_only: /(?:cannot|can only) Special Summon[^.]*from the Extra Deck/i.test(sentence),
      self_removal: selfRemoval, unresolved: unresolved || !whole && !after && !whileFaceUp, evidence: sentence,
    };
  });
}

export function allowedByLock(lock: SummonLock, card: Card): boolean {
  const rating = /Level\/Rank\/Link/i.test(lock.evidence) ? card.level ?? card.rank ?? card.linkRating
    : /Level\/Rank|\bRank /i.test(lock.evidence) ? card.level ?? card.rank
    : /\bLink[- ]\d/i.test(lock.evidence) ? card.linkRating : card.level;
  const identity = { ...card, level: rating };
  return lock.extra_deck_only && !isExtraDeckCard(card) || !lock.unresolved && matchesBridgeFilter(lock.allow, identity);
}

export function sharedSmallWorldStats(a: Card, b: Card): number {
  return ["monsterType", "attribute", "level", "atk", "def"].filter(key => {
    const field = key as "level" | "atk" | "def" | "monsterType" | "attribute";
    return a[field] != null && a[field] === b[field];
  }).length;
}

/** Unnamed, one-body Link-1 access is ancillary evidence, even with typed material. */
export function genericLinkOneMaterial(card: Pick<Card, "linkRating" | "text">, materials?: readonly number[]): boolean {
  return materials?.length === 1 && card.linkRating === 1 && quotedNames(card.text.split(/[\r\n]/)[0]!).length === 0;
}
