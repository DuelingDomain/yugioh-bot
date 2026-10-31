import type { Card } from "./card.js";
import { NO_FILTER, type CardFilter } from "./tags.js";
import type { Capability, CardCapability } from "./bridge-types.js";
import { actionEvidence, matchesBridgeFilter, printedText, sameName, sentences } from "./bridge-text.js";

/** A subtype is a real recipient restriction; an unrestricted Spell/Trap pool is not. */
export function narrowSetCapability(capability: Capability): boolean {
  const f = capability.filter;
  return capability.key === "set_spell_trap" && !!f && !f.this_card
    && !!(f.names.length || f.archetypes.length || f.kinds.length && f.kinds.every(kind => kind === "spell" || kind === "trap") && f.subtypes.length);
}

/** Preserve constraints which older tags omitted instead of trusting their wide target index. */
export function groundedSetCapabilities(row: CardCapability, universe: readonly CardCapability[]): Capability[] {
  const provides = row.provides.map(capability => {
    if (capability.key !== "set_spell_trap" || capability.filter?.this_card || !capability.filter) return capability;
    const evidence = actionEvidence(row.card, capability.key, capability.filter);
    if (!evidence) return { ...capability, targets: [] };
    let other = capability.filter.other;
    if (/Set[^.]*with an effect that Special Summons itself as a monster/i.test(evidence)) other = "with an effect that Special Summons itself as a monster";
    if (/Set[^.]*that can only be activated when an attack is declared/i.test(evidence)) other = "that can only be activated when an attack is declared";
    const exclusion = /\bSet\b[^.]*?\bexcept (["“][^"”]+["”])/i.exec(evidence);
    if (exclusion) other = !other || /^with a different name$/i.test(other) ? `except ${exclusion[1]}`
      : other === `except ${exclusion[1]}` ? other : `${other}; except ${exclusion[1]}`;
    const recipient = /\bSet\s+(?:(?:(?:up to )?\d+|an?)\s+)?(?:(?:non-)?["“][^"”]+["”]\s+)?(?:(Normal|Continuous|Counter|Quick-Play|Field|Ritual)\s+)?(Spell\/Trap|Spell(?: Card)?|Trap(?: Card)?)/i.exec(evidence);
    const revealedNormal = /reveal 3 Normal Traps from your Deck[^.]*randomly chooses 1 for you to Set on your field/i.test(evidence);
    const filter = { ...capability.filter, other,
      ...(revealedNormal ? { kinds: ["trap"] as CardFilter["kinds"], subtypes: ["normal"] as CardFilter["subtypes"] } : {}),
      ...(!capability.filter.kinds.length && recipient ? { kinds: /Spell\/Trap/i.test(recipient[2]!) ? ["spell", "trap"] as CardFilter["kinds"] : /Trap/i.test(recipient[2]!) ? ["trap"] as CardFilter["kinds"] : ["spell"] as CardFilter["kinds"] } : {}) };
    const newQualifier = /^(?:non-["“]|with an effect that Special Summons itself as a monster$|that can only be activated when an attack is declared$)/i.test(other);
    return JSON.stringify(filter) === JSON.stringify(capability.filter) && !newQualifier ? capability : { ...capability, filter, evidence,
      targets: universe.filter(target => matchesBridgeFilter(filter, target.card)).map(target => target.id) };
  });
  // Recover ordinary explicit Set recipients even if effect tags are missing.
  for (const evidence of sentences(printedText(row.card))) {
    const match = /\bSet\s+(?:(?:up to )?\d+|an?)\s+((?:["“][^"”]+["”](?:\s+(?:(?:Normal|Continuous|Counter|Quick-Play|Field|Ritual)\s+)?(?:Spell\/Trap|Spell(?: Card)?|Trap(?: Card)?))?|(?:(?:Normal|Continuous|Counter|Quick-Play|Field|Ritual)\s+)?(?:Spell\/Trap|Spell(?: Card)?|Trap(?: Card)?)))\s+(?:directly\s+)?from your (Deck|hand|GY|Graveyard|banishment)/i.exec(evidence);
    if (!match || provides.some(cap => cap.key === "set_spell_trap" && cap.evidence === evidence)) continue;
    // Only the explicit recipient grammar above is understood. Other conditions
    // stay on the printed evidence; unsupported recipient suffixes fail closed.
    const suffix = evidence.slice(match.index + match[0].length);
    const exclusion = /^\s*,?\s*except (["“][^"”]+["”])\s*\.$/i.exec(suffix);
    if (/^\s*,?\s*(?:that|with|except|other than)\b/i.test(suffix) && !exclusion) continue;
    const recipient = match[1]!, quoted = /["“]([^"”]+)["”]/.exec(recipient)?.[1];
    const type = recipient.replace(/["“][^"”]+["”]/g, "");
    const identity = quoted && !/Spell|Trap/i.test(type) ? universe.find(target => sameName(target.card.name, quoted))?.card : undefined;
    if (!identity && !/Spell|Trap/i.test(type)) continue;
    const subtype = /\b(Normal|Continuous|Counter|Quick-Play|Field|Ritual)\b/i.exec(type)?.[1]?.toLowerCase().replace("-", "_");
    const filter: CardFilter = { ...NO_FILTER, kinds: identity ? [identity.kind] : /Spell\/Trap/i.test(type) ? ["spell", "trap"] : /Trap/i.test(type) ? ["trap"] : ["spell"],
      subtypes: subtype ? [subtype as CardFilter["subtypes"][number]] : [], archetypes: quoted && !identity ? [quoted] : [], names: identity ? [identity.name] : [],
      other: exclusion ? `except ${exclusion[1]}` : "" };
    const from = [({ Deck: "deck", hand: "hand", GY: "gy", Graveyard: "gy", banishment: "banished" } as Record<string, string>)[match[2]!]!];
    const capability: Capability = { key: "set_spell_trap", filter, from, evidence };
    if (narrowSetCapability(capability)) provides.push({ ...capability,
      targets: universe.filter(target => matchesBridgeFilter(filter, target.card)).map(target => target.id) });
  }
  // Toy Box Sets only original-name Toy monsters with their own printed hand-Set
  // procedure. In particular, this never grants it access to an Ashtra Trap.
  const toy = sentences(printedText(row.card)).find(text => /choose up to 2 monsters with ["“]Toy["”] in their original names that can Set themselves from the hand as a Spell, and Set them in your Spell & Trap Zone as Spells/i.test(text));
  if (toy && !provides.some(cap => cap.key === "set_spell_trap" && cap.evidence === toy)) {
    const targets = universe.filter(target => target.card.kind === "monster" && /Toy/i.test(target.card.name)
      && /You can Set this card from your hand to your Spell & Trap Zone as a Spell\./i.test(printedText(target.card)));
    if (targets.length) provides.push({ key: "set_spell_trap", filter: { ...NO_FILTER, kinds: ["monster"], archetypes: ["Toy"], other: "can Set themselves from hand as Spells" },
      from: ["hand", "deck", "field", "gy"], evidence: toy, targets: targets.map(target => target.id) });
  }
  return provides;
}

/** A printed, usable hand Summon consuming a Set card, rather than mere shared setup. */
export function setReturnSummonEvidence(card: Card): string | undefined {
  return sentences(printedText(card)).find(text => /You can Special Summon this card \(from your hand\) by revealing 1 face-down card you control and returning it to the hand\/Extra Deck\./i.test(text));
}

export function setResourceCanReturn(capability: Capability): boolean {
  return !/(?:banish|place[^.]*bottom of the Deck|shuffle[^.]*Deck)[^.]*when (?:it|they) leave(?:s)? the field/i.test(capability.evidence);
}

/** Scoped permission applies only to the card just Set by this effect. */
export function setActivationEvidence(source: Card, target: Card, capability: Capability): string | undefined {
  const text = printedText(source), evidence = capability.evidence;
  const start = text.indexOf(evidence);
  if (start < 0 || target.kind !== "trap" || !matchesBridgeFilter(capability.filter!, target)) return undefined;
  const following = text.slice(start + evidence.length).trim();
  const permission = /^(?:It|The Set (?:Normal |Continuous )?Trap) can be activated this turn\./i.exec(following)?.[0];
  return permission && !/cannot be activated this turn|cannot activate it/i.test(evidence) ? permission : undefined;
}
