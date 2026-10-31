import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { CardTags } from "./tags.js";
import { isExtraDeckCard } from "./card.js";
import type { BridgeGraphData, BridgeReason, CardCapability } from "./bridge-types.js";
import { actionEvidence, bridgeHash, matchesBridgeFilter, printedText, trapTurnSetAllows, trapTurnSetEvidence } from "./bridge-text.js";

export const MECHANICS = ["trap_set", "trap_activation", "gy", "banish", "fusion", "synchro", "xyz", "link", "ritual", "face_down", "discard"] as const;
export type Mechanic = typeof MECHANICS[number];
export interface MechanicProfile { engine: string; members: number; mechanics: Record<Mechanic, { count: number; share: number; cards: number[] }> }
export interface MechanicInteraction { key: "trap_activation" | "trap_trigger" | "gy_setup" | "discard_trigger"; provider: number; consumer: number; resource?: number }
interface MechanicTagFacts { gy: boolean; banished: boolean; discard: boolean; faceDown: boolean; summons: string[]; trapTrigger: boolean; gyAction: boolean }
let tags: Map<number, MechanicTagFacts> | undefined;
function cardTags(id: number): MechanicTagFacts | undefined {
  if (!tags) {
    try { tags = new Map(gunzipSync(readFileSync(new URL("../../../data/effects/tags.jsonl.gz", import.meta.url)), { maxOutputLength: 50_000_000 })
      .toString().trim().split("\n").map(line => {
        const row = JSON.parse(line) as {id:number;tags:CardTags}, effects=row.tags.effects;
        const events=effects.flatMap(effect=>[...effect.actions,...effect.costs,...effect.triggers]);
        return [row.id, { gy:events.some(event=>event.from.includes("gy")), banished:events.some(event=>event.from.includes("banished")),
          discard:events.some(event=>event.verb==="discard"), faceDown:effects.some(effect=>effect.conditions.some(condition=>/face-down|Set card/i.test(condition))),
          summons:[...new Set(events.flatMap(event=>event.what.subtypes))],
          trapTrigger:effects.some(effect=>effect.triggers.some(event=>event.verb==="activate" && event.player!=="opponent" && (event.what.kinds.includes("trap") || /Normal Trap/i.test(event.note)))),
          gyAction:effects.some(effect=>effect.location.includes("gy") && ["ignition","quick"].includes(effect.timing)) }];
      })); }
    catch { tags = new Map(); }
  }
  return tags.get(id);
}

/** Searchygo events seed the profile; printed clauses and grounded capabilities confirm it.
 * Type and Attribute are deliberately absent from the feature vocabulary. */
export function mechanicProfile(engine: string, members: readonly CardCapability[]): MechanicProfile {
  const mechanics = Object.fromEntries(MECHANICS.map(key => [key, { count: 0, share: 0, cards: [] as number[] }])) as MechanicProfile["mechanics"];
  for (const row of members) {
    const text = printedText(row.card), tagged = cardTags(row.id);
    const has = (key: string) => [...row.provides, ...row.needs].some(cap => cap.key === key);
    const flags: Record<Mechanic, boolean> = {
      trap_set: (row.card.kind === "trap" || has("set_spell_trap")) && /Trap|Set/i.test(text),
      trap_activation: /(?:activate[sd]?|activation)[^.\n]{0,100}(?:Normal )?Trap|(?:Normal )?Trap[^.\n]{0,100}(?:activate[sd]?|activation)/i.test(text),
      gy: !!(has("gy_effect") || has("send_to_gy") || tagged?.gy) && /GY|Graveyard/i.test(text),
      banish: !!(has("banish") || tagged?.banished) && /banish/i.test(text),
      face_down: !!(has("face_down_card") || tagged?.faceDown) && /face-down|Set card/i.test(text),
      discard: !!(has("discard") || tagged?.discard) && /discard/i.test(text),
      fusion: /Fusion/i.test(text) && (row.card.subtypes.includes("fusion") || tagged?.summons.includes("fusion") === true),
      synchro: /Synchro/i.test(text) && (row.card.subtypes.includes("synchro") || tagged?.summons.includes("synchro") === true),
      xyz: /Xyz/i.test(text) && (row.card.subtypes.includes("xyz") || tagged?.summons.includes("xyz") === true),
      link: /Link/i.test(text) && (row.card.subtypes.includes("link") || tagged?.summons.includes("link") === true),
      ritual: /Ritual/i.test(text) && (row.card.subtypes.includes("ritual") || tagged?.summons.includes("ritual") === true),
    };
    for (const key of MECHANICS) if (flags[key]) mechanics[key].cards.push(row.id);
  }
  for (const feature of Object.values(mechanics)) { feature.cards.sort((a,b)=>a-b); feature.count = feature.cards.length; feature.share = members.length ? feature.count / members.length : 0; }
  return { engine, members: members.length, mechanics };
}
const focused = (profile: MechanicProfile, key: Mechanic) => profile.mechanics[key].count >= 2 && profile.mechanics[key].share >= 0.2;
/** Weighted shared mechanics rank complementary effects, never nominate them alone. */
export function mechanicComplementarity(a: MechanicProfile, b: MechanicProfile): number {
  const weights: Record<Mechanic, number> = { trap_set: 3, trap_activation: 2, gy: 0.25, banish: 0.5,
    fusion: 1, synchro: 1, xyz: 1, link: 1, ritual: 1, face_down: 2, discard: 0.5 };
  return Math.round(MECHANICS.reduce((sum,key)=>sum+Math.min(a.mechanics[key].share,b.mechanics[key].share)*weights[key],0)*1000)/1000;
}

function trapTrigger(row: CardCapability): boolean {
  return cardTags(row.id)?.trapTrigger === true
    && /(?:Normal Trap Card|Normal Trap)[^.\n]{0,80}(?:is activated|activated this turn)/i.test(printedText(row.card));
}

/** Nomination requires complementary printed effects. Shared GY or Summon families alone never suffice. */
export function mechanicSynergyReason(source: MechanicProfile, target: MechanicProfile, from: readonly CardCapability[], to: readonly CardCapability[]): BridgeReason | null {
  const make = (mechanic: MechanicInteraction, description: string): BridgeReason => {
    const cards = [...new Set([mechanic.provider, mechanic.consumer, ...(mechanic.resource === undefined ? [] : [mechanic.resource])])];
    return { key: "synergy", weight: Math.min(3, 1 + mechanicComplementarity(source,target)), cards, evidence: cards.map(id => printedText([...from,...to].find(row=>row.id===id)!.card)), description, mechanic };
  };
  if (focused(source, "trap_set") && focused(target, "trap_set")) {
    // A Normal Trap from the source can feed the target's explicitly generic trigger.
    const consumer = [...to].sort((a,b)=>Number(b.card.kind === "monster")-Number(a.card.kind === "monster") || a.id-b.id).find(trapTrigger);
    const resource = to.find(row => row.card.kind === "trap" && row.card.subtypes.includes("normal"));
    const permission = from.find(row => trapTurnSetEvidence(row.card) && resource && trapTurnSetAllows(row.card, resource.card));
    if (permission && resource && consumer) return make({ key: "trap_activation", provider: permission.id, consumer: consumer.id, resource: resource.id },
      `Shared Normal Trap activation/Set mechanic: ${permission.card.name} permits ${resource.card.name} to activate the turn it was Set; ${consumer.card.name} responds to Normal Trap activation. Printed conditions and once-per-turn limits still apply; both engines must be available.`);
    const trap = from.find(row => row.card.kind === "trap" && row.card.subtypes.includes("normal"));
    if (trap && consumer) return make({ key: "trap_trigger", provider: trap.id, consumer: consumer.id },
      `Shared Normal Trap activation mechanic: activating ${trap.card.name} can feed ${consumer.card.name}'s printed Normal Trap activation trigger. Meet the Trap's conditions and all timing limits; this does not access the other engine.`);
  }
  for (const [feature, key, action] of [["gy", "gy_setup", "send_to_gy"], ["discard", "discard_trigger", "discard"]] as const) {
    if (!focused(source, feature) || !focused(target, feature)) continue;
    for (const provider of from) for (const cap of provider.provides.filter(cap => cap.key === action && cap.filter && !cap.filter.this_card
      && (key !== "gy_setup" || cap.from?.includes("deck")))) {
      const consumer = to.find(row => !from.some(other => other.id === row.id) && !isExtraDeckCard(row.card)
        && (!cap.targets || cap.targets.includes(row.id)) && matchesBridgeFilter(cap.filter!, row.card)
        && !/excavat|\btop\b|random/i.test(cap.evidence)
        && actionEvidence(provider.card, action, cap.filter) && (key === "gy_setup" ? row.provides.some(cap => cap.key === "gy_effect")
          && cardTags(row.id)?.gyAction
          : row.needs.some(need => need.key === "trigger" && need.value === "discard" && need.filter?.this_card && /discard/i.test(need.evidence))));
      if (consumer) return make({ key, provider: provider.id, consumer: consumer.id },
        `Complementary ${feature === "gy" ? "GY setup" : "discard trigger"} mechanic: ${provider.card.name}'s printed ${action} effect can use ${consumer.card.name}, whose printed ${feature === "gy" ? "GY effect" : "discard trigger"} supplies the payoff. All printed costs, zones, locks and timing apply.`);
    }
  }
  return null;
}

/** Recompute from current members, tags and printed effects at the two-judge boundary. */
export function validateMechanicSynergy(reason: BridgeReason, source: string, target: string, data: BridgeGraphData, legal: (row: CardCapability) => boolean): boolean {
  if (!reason.mechanic || reason.setup || reason.steps?.length || reason.cost || reason.materials?.length) return false;
  const members = (engine: string) => data.capabilities.filter(row => data.groups[engine]?.includes(row.id) && legal(row)).sort((a,b)=>a.id-b.id);
  const from = members(source), to = members(target);
  const expected = mechanicSynergyReason(mechanicProfile(source, from), mechanicProfile(target, to), from, to);
  return expected !== null && bridgeHash(expected) === bridgeHash(reason);
}
