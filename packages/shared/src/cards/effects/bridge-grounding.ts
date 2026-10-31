import { isExtraDeckCard } from "./card.js";
import { actionEvidence, alternativeFusionProcedure, matchesBridgeFilter, namedIn, printedText, sameName } from "./bridge-text.js";
import type { BridgeGraphData, Capability, CardCapability } from "./bridge-types.js";
import { groundedSetCapabilities } from "./bridge-set-access.js";

const grounded = new WeakMap<BridgeGraphData, BridgeGraphData>();
const checkedQualifiers = new Set(["non-Wyrm", 'except "Tearlaments Reinoheart"', "different names, up to 2, face-up in your Spell & Trap Zone",
  "except Field Spells, each with a different name, equal to the number of targeted face-down cards"]);

function checkedQualifier(row: CardCapability, capability: Capability): boolean {
  const other = capability.filter?.other.trim();
  if (!other || !checkedQualifiers.has(other) || !actionEvidence(row.card, capability.key, capability.filter)) return false;
  const text = printedText(row.card);
  if (other === "non-Wyrm") return /add 1 non-Wyrm ["“]Ashtra["”] monster from your Deck to your hand/i.test(text);
  if (other === 'except "Tearlaments Reinoheart"') return /send 1 ["“]Tearlaments["”] monster from your Deck to the GY, except ["“]Tearlaments Reinoheart["”]/i.test(text);
  if (other === "different names, up to 2, face-up in your Spell & Trap Zone") return /place up to 2 ["“]Argostars["”] Continuous Traps with different names from your hand and\/or Deck face-up in your Spell & Trap Zone/i.test(text);
  if (other === "except Field Spells, each with a different name, equal to the number of targeted face-down cards") return /add ["“]Ashtra["”] cards from your Deck to your hand with different names from each other, except Field Spells, equal to the number of those targeted cards that are still face-down/i.test(text);
  return false;
}

const compatibleZone = (capability: Capability, row: CardCapability) => !capability.from?.length || capability.from.some(zone =>
  zone === "deck" || zone === "hand" ? !isExtraDeckCard(row.card) : zone === "extra_deck" ? isExtraDeckCard(row.card) : true);

function blueEyesSupport(row: CardCapability): boolean {
  const action = (key: Capability["key"], target: string, archetype = false) => row.provides.some(capability => capability.key === key
    && capability.from?.includes("deck") && capability.filter && (archetype ? capability.filter.archetypes : capability.filter.names).some(name => sameName(name, target))
    && !!actionEvidence(row.card, key, capability.filter));
  switch (row.card.name) {
    case "Maiden of White": return action("place_on_field", "True Light") && namedIn(printedText(row.card), "Blue-Eyes White Dragon");
    case "Roar of the Blue-Eyed Dragons": return action("special_summon", "Blue-Eyes", true);
    case "Neo Kaiser Sea Horse": return action("send_to_gy", "Blue-Eyes", true);
    case "Kaibaman the Legend": return action("special_summon", "Blue-Eyes White Dragon") && /show 3 ["“]Blue-Eyes White Dragon["”]/i.test(printedText(row.card));
    default: return false;
  }
}

/**
 * Printed-text repairs layered over immutable artifact identities. Source hashes
 * remain the artifact hashes: existing valid bridge/judge cache entries stay valid.
 * Newly available paths still need their own ordinary independent reviews.
 */
export function groundBridgeGraph(data: BridgeGraphData): BridgeGraphData {
  const cached = grounded.get(data);
  if (cached) return cached;
  const capabilities = data.capabilities.map(row => {
    let changed = false;
    const provides = groundedSetCapabilities(row, data.capabilities).map(capability => {
      if (!checkedQualifier(row, capability)) return capability;
      changed = true;
      return { ...capability, targets: data.capabilities.filter(target => capability.filter && matchesBridgeFilter(capability.filter, target.card)
        && compatibleZone(capability, target)).map(target => target.id) };
    });
    const procedure = alternativeFusionProcedure(printedText(row.card));
    if (procedure) {
      const existing = provides.findIndex(capability => capability.key === "special_summon" && capability.from?.includes("extra_deck"));
      const capability: Capability = { key: "special_summon", filter: procedure.filter, from: ["extra_deck"], effect: existing >= 0 ? provides[existing]!.effect : 0,
        evidence: procedure.evidence, targets: data.capabilities.filter(target => matchesBridgeFilter(procedure.filter, target.card)).map(target => target.id) };
      if (existing >= 0) provides[existing] = capability;
      else {
        // A later GY revival can match the same Fusion identity. Prefer this
        // procedure when rendering/validating the printed Extra Deck access.
        const beforeRevival = provides.findIndex(entry => entry.key === "special_summon");
        provides.splice(beforeRevival >= 0 ? beforeRevival : provides.length, 0, capability);
      }
      changed = true;
    }
    return changed || provides.length !== row.provides.length || provides.some((entry, i) => entry !== row.provides[i]) ? { ...row, provides } : row;
  });
  const blueEyes = data.groups["Blue-Eyes"];
  const groups = blueEyes ? { ...data.groups, "Blue-Eyes": [...new Set([...blueEyes, ...capabilities.filter(blueEyesSupport).map(row => row.id)])].sort((a, b) => a - b) } : data.groups;
  const result = { ...data, capabilities, groups };
  grounded.set(data, result); grounded.set(result, result);
  return result;
}
