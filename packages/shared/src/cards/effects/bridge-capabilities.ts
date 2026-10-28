import { isExtraDeckCard, type Card } from "./card.js";
import { NO_FILTER, type CardTags } from "./tags.js";
import type { ArchetypeProfile } from "./synergy.js";
import type { Capability, CapabilityKey, CardCapability } from "./bridge-types.js";
import { actionEvidence, bridgeHash, extractSummonLocks, faceDownNeedEvidence, filterPrinted, printedText, trapMonsterEvidence, trapTurnSetEvidence } from "./bridge-text.js";

const verbKeys: Record<string, CapabilityKey> = {
  add_to_hand: "search", special_summon: "special_summon", normal_summon: "normal_summon", set_spell_trap: "set_spell_trap",
  place_on_field: "place_on_field", send_to_gy: "send_to_gy", discard: "discard", banish: "banish", tribute: "tribute",
  return_to_hand: "return_to_hand", return_to_deck: "return_to_deck", draw: "draw", destroy: "destroy", negate_effect: "negate", negate_activation: "negate",
};

export function extractCardCapabilities(card: Card, tags?: CardTags, profile?: ArchetypeProfile): CardCapability {
  const text = printedText(card), provides: Capability[] = [], needs: Capability[] = [];
  const identity = (key: CapabilityKey, value?: string | number) => { if (value !== undefined) provides.push({ key, value, evidence: card.name }); };
  identity(card.kind, card.kind); identity("name", card.name); identity("type", card.monsterType);
  identity("attribute", card.attribute); identity("level", card.level);
  for (const archetype of card.archetypes ?? []) identity("archetype", archetype);
  for (const subtype of card.subtypes) identity("subtype", subtype);
  if (card.kind === "trap") provides.push({ key: "set_trap", evidence: card.name }, { key: "face_down_card", evidence: card.name });
  for (const [effectIndex, effect] of (tags?.effects ?? []).entries()) {
    for (const field of ["actions", "costs", "triggers"] as const) for (const event of effect[field]) {
      if (event.player === "opponent") continue;
      const key = verbKeys[event.verb];
      if (!key) continue;
      const evidence = actionEvidence(card, key, event.what);
      if (!evidence) continue;
      const entry: Capability = { key, filter: event.what, from: event.from, effect: effectIndex, evidence };
      if (field === "actions") provides.push(entry);
      else needs.push(field === "triggers" ? { ...entry, key: "trigger", value: key } : entry);
      if (field === "costs" && event.what.this_card && effect.location.includes("field") && ["tribute", "banish", "send_to_gy", "return_to_hand", "return_to_deck"].includes(key)) provides.push({ ...entry, key: "self_removal" });
    }
    if (effect.location.includes("gy") && /(?:banish this card from your (?:GY|Graveyard)|if this card is (?:sent to|in) (?:the |your )?(?:GY|Graveyard)|while this card is in your (?:GY|Graveyard))/i.test(text)) provides.push({ key: "gy_effect", effect: effectIndex, evidence: text });
    for (const condition of effect.conditions) if (text.toLowerCase().includes(condition.toLowerCase())) needs.push({ key: "condition", effect: effectIndex, evidence: condition });
  }
  if (isExtraDeckCard(card)) for (const filter of tags?.materials ?? []) needs.push({ key: "material", filter, evidence: text.split("\n")[0]! });
  const enabler = trapTurnSetEvidence(card);
  if (enabler) provides.push({ key: "activate_trap_turn_set", value: /activate (?:up to )?(?:1|one) Trap/i.test(enabler) ? 1 : undefined, evidence: enabler });
  const faceDown = faceDownNeedEvidence(card);
  if (faceDown) needs.push({ key: "face_down_card", evidence: faceDown });
  const trapMonster = trapMonsterEvidence(card);
  if (trapMonster) {
    provides.push({ key: "trap_monster", evidence: trapMonster });
    needs.push({ key: "set_trap", evidence: trapMonster });
  }
  for (const hook of profile?.hooks ?? []) {
    if (!hook.card || hook.does || hook.reacts_to || hook.supports || hook.phrases.length) continue;
    const filter = { ...NO_FILTER, ...hook.card };
    if (filterPrinted(filter, text)) needs.push({ key: "condition", value: hook.label, filter, evidence: text });
  }
  // Temple's second effect needs Serket; it never establishes a free generic Summon edge.
  const locks = extractSummonLocks(card);
  for (const lock of locks) needs.push({ key: "summon_lock", value: lock.scope, filter: lock.allow, evidence: lock.evidence });
  if (!tags && card.kind === "monster" && !isExtraDeckCard(card)) needs.push({ key: "condition", filter: { ...NO_FILTER }, evidence: "Effect tags unavailable" });
  const textHash = bridgeHash(text);
  return { id: card.id, card, provides, needs, locks, text_hash: textHash,
    evidence_hash: bridgeHash({ id: card.id, textHash, provides, needs, locks, identity: [card.kind, card.monsterType, card.attribute, card.level, card.subtypes] }) };
}
