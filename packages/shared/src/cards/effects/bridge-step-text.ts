import { isExtraDeckCard, type Card } from "./card.js";
import type { BridgeJudgeEvidence, BridgeReviewStep } from "./bridge-judge.js";
import { actionEvidence, matchesBridgeFilter } from "./bridge-text.js";
import type { CapabilityKey, CardCapability } from "./bridge-types.js";

const zones: Record<string, string> = {
  deck: "Deck", hand: "hand", gy: "GY", banished: "banished cards", field: "field",
  extra_deck: "Extra Deck", attached: "attached materials", pendulum_zone: "Pendulum Zone",
};
function origin(from: readonly string[] = []): string {
  return from.length && from.every(zone => zones[zone]) ? ` from the ${from.map(zone => zones[zone]).join(" or ")}` : "";
}
function compatibleOrigins(from: readonly string[] = [], card: Card): string[] {
  return from.filter(zone => zone === "deck" || zone === "hand" ? !isExtraDeckCard(card)
    : zone === "extra_deck" ? isExtraDeckCard(card) : true);
}

/** Presentation only: never include these captions in judge evidence, prompts or cache identities. */
export function deterministicBridgeSteps(evidence: BridgeJudgeEvidence, line: readonly string[], capabilities: readonly CardCapability[]): BridgeReviewStep[] {
  const rows = new Map(capabilities.map(row => [row.id, row]));
  const present = new Set(line);
  const outgoing = new Map<string, string>(), incoming = new Map<string, string>();
  const add = (map: Map<string, string>, card: string, text: string) => {
    if (present.has(card) && text.length <= 500 && !map.has(card)) map.set(card, text);
  };
  const conditions = ", subject to its printed conditions.";
  const action = (source: string, target: string, key: string, from?: string[]) => {
    if (!present.has(source) || !present.has(target)) return;
    const zone = origin(from);
    const verbs: Partial<Record<CapabilityKey, [string, string]>> = {
      search: [`add ${target}${zone} to the hand`, `be added${zone} to the hand by ${source}`],
      special_summon: [`Special Summon ${target}${zone}`, `be Special Summoned${zone} by ${source}`],
      normal_summon: [`Normal Summon ${target}${zone}`, `be Normal Summoned${zone} by ${source}`],
      set_spell_trap: [`Set ${target}${zone}`, `be Set${zone} by ${source}`],
      place_on_field: [`place ${target}${zone} on the field`, `be placed${zone} on the field by ${source}`],
      send_to_gy: [`send ${target}${zone} to the GY`, `be sent${zone} to the GY by ${source}`],
      discard: [`discard ${target}${zone}`, `be discarded${zone} by ${source}`],
      banish: [`banish ${target}${zone}`, `be banished${zone} by ${source}`],
      tribute: [`Tribute ${target}${zone}`, `be Tributed${zone} by ${source}`],
      return_to_hand: [`return ${target}${zone} to the hand`, `be returned${zone} to the hand by ${source}`],
      return_to_deck: [`return ${target}${zone} to the Deck`, `be returned${zone} to the Deck by ${source}`],
    };
    const verb = verbs[key as CapabilityKey];
    if (!verb) return;
    add(outgoing, source, `can ${verb[0]}${conditions}`);
    add(incoming, target, `can ${verb[1]}${conditions}`);
  };
  // Primary reasons win over optional benefits; only describe relations between reviewed cards.
  for (const reason of [...evidence.reasons].sort((a, b) => Number(!!a.ancillary) - Number(!!b.ancillary))) {
    const cards = reason.cards.map(id => rows.get(id)).filter(row => row !== undefined);
    if (reason.cost) {
      const cost = reason.cost, consumer = rows.get(cost.card), using = rows.get(cost.using);
      const need = consumer?.needs.find(need => need.key === cost.capability && need.effect === cost.effect
        && using && need.filter && !need.filter.this_card && matchesBridgeFilter(need.filter, using.card)
        && (!need.from?.length || compatibleOrigins(need.from, using.card).length > 0));
      const verbs: Partial<Record<CapabilityKey, string>> = { discard: "discarded", tribute: "Tributed", banish: "banished", send_to_gy: "sent to the GY" };
      if (consumer && using && need && verbs[cost.capability] && present.has(consumer.card.name)) {
        add(outgoing, using.card.name, `can be ${verbs[cost.capability]}${origin(compatibleOrigins(need.from, using.card))} as cost for ${consumer.card.name}'s effect${conditions}`);
      }
    }
    const extra = cards.find(row => isExtraDeckCard(row.card));
    if (extra && present.has(extra.card.name)) for (const id of reason.materials ?? []) {
      const material = rows.get(id);
      if (material) add(outgoing, material.card.name, `can be used as material for ${extra.card.name}${conditions}`);
    }
    for (const step of reason.steps ?? []) {
      const source = rows.get(step.from), target = rows.get(step.to);
      if (!source || !target) continue;
      // These templates do not model rules that redirect an Extra Deck monster's destination.
      if (isExtraDeckCard(target.card) && ["search", "return_to_hand", "return_to_deck"].includes(step.capability)) continue;
      const capability = source.provides.find(capability => capability.key === step.capability && capability.filter
        && (reason.cost?.card !== source.id || capability.effect === reason.cost.effect)
        && (!capability.from?.length || compatibleOrigins(capability.from, target.card).length > 0)
        && matchesBridgeFilter(capability.filter, target.card) && actionEvidence(source.card, step.capability, capability.filter));
      if (capability) action(source.card.name, target.card.name, step.capability, compatibleOrigins(capability.from, target.card));
    }
    if (reason.key === "rule_enabler") {
      const enabler = cards[0], trap = cards[1];
      if (!enabler || trap?.card.kind !== "trap" || !present.has(enabler.card.name) || !present.has(trap.card.name)) continue;
      add(outgoing, enabler.card.name, `allows ${trap.card.name} to be activated the turn it is Set${conditions}`);
      add(outgoing, trap.card.name, `can be activated the turn it is Set under ${enabler.card.name}${conditions}`);
      // Strict permission reasons retain their engine's supporter without a separate access edge.
      for (const supporter of cards.slice(2)) {
        const setter = supporter.provides.find(capability => capability.key === "set_spell_trap" && capability.from?.includes("deck")
          && capability.filter && matchesBridgeFilter(capability.filter, trap.card)
          && actionEvidence(supporter.card, capability.key, capability.filter));
        if (setter) action(supporter.card.name, trap.card.name, setter.key, setter.from);
      }
    }
  }
  // These special actions are constructed by the checked shared-monster/control-condition path.
  for (const proposed of evidence.proposed_lines) for (const step of proposed.steps) {
    if (!step.target || !present.has(step.card) || !present.has(step.target)) continue;
    if (step.action === "satisfy_control_condition") {
      add(outgoing, step.card, `while controlled, satisfies the monster requirement for ${step.target}'s activation${conditions}`);
      add(incoming, step.target, `can use ${step.card} for its controlled-monster requirement${conditions}`);
    } else if (step.action === "special_summon" && step.card === step.target) {
      action(step.card, step.target, step.action, step.from_zones);
    }
  }
  return line.map(card => ({ card, text: outgoing.get(card) ?? incoming.get(card) ?? "" }));
}
