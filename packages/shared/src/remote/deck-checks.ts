import { DuelSettingsError, normalizeDuelSettings, PINNED_TCG_BANLIST_ID, type DuelSettings, type DuelSettingsMode } from "../duels/settings.js";
import type { DuelDeck, DuelDeckValidation } from "../duels/index.js";
import type { CardInsightFormat } from "../services/card-insights.js";
import { remoteAssert, RemoteDuelError } from "./actions.js";
import type { RemoteState } from "./types.js";

export type RemoteFormat = { id: CardInsightFormat; mode: DuelSettingsMode; settings: DuelSettings };
export const REMOTE_FORMATS = [
  { value: "normal", label: "Advanced" }, { value: "domain", label: "Domain" },
  { value: "genesys", label: "Genesys" }, { value: "genesys-domain", label: "Genesys Domain" },
] as const;
/** The same mode, banlist defaults and Genesys normalizer used by ordinary tables. */
export function normalizeRemoteFormat(id: unknown = "normal", rules?: unknown): RemoteFormat {
  remoteAssert(REMOTE_FORMATS.some(f => f.value === id), "Unknown duel format");
  const format = id as CardInsightFormat;
  const mode = format.includes("domain") ? "domain" : "normal";
  remoteAssert(rules === undefined || (!!rules && typeof rules === "object" && !Array.isArray(rules)), "Invalid rules");
  const raw = (rules ?? {}) as Record<string, unknown>;
  try {
    const settings = normalizeDuelSettings(mode, {
      ...raw, validateDeck: true,
      banlist: raw.banlist ?? (format === "normal" ? PINNED_TCG_BANLIST_ID : "none"),
      genesys: format.includes("genesys") ? raw.genesys ?? {} : null,
    });
    return { id: format, mode, settings };
  } catch (error) {
    if (error instanceof DuelSettingsError) throw new RemoteDuelError(error.message);
    throw error;
  }
}
export type RemoteDeckRegistration = { savedDeckId: number; name: string; deck: DuelDeck; validation: DuelDeckValidation };
export type RemoteCardFact = { code: number; copyKey: number; name: string; limit: number; section: "main" | "extra" };
export type RemoteCardFacts = Record<number, RemoteCardFact>;
export type RemoteCardInstance = {
  id: string; seat: number; code: number; copyKey: number; name: string; limit: number;
  refs: string[]; zone?: string; slot?: number; public: boolean; anchored: boolean;
};
export type RemoteDeckFlag = {
  id: string; seat: number; copyKey: number; count: number; limit: number; message: string;
  instanceIds: string[]; proof: string[]; dismissed: boolean; reason?: string;
};
export type RemoteDeckChecks = {
  format: RemoteFormat; registrations: Record<number, RemoteDeckRegistration | null>;
  instances: RemoteCardInstance[]; flags: RemoteDeckFlag[];
};
/** Server-resolved facts are persisted beside the command, never accepted from a client. */
export type RemoteReductionContext = {
  facts?: RemoteCardFacts; registration?: RemoteDeckRegistration;
  identified?: { notInDecklist: boolean; addErrors: string[] };
};
export function initialDeckChecks(format = normalizeRemoteFormat()): RemoteDeckChecks {
  return { format, registrations: {}, instances: [], flags: [] };
}
export function applyRemoteFormat(input: RemoteState, format: RemoteFormat): RemoteState {
  const state = structuredClone(input);
  state.deckChecks ??= initialDeckChecks();
  state.deckChecks.format = structuredClone(format);
  for (const seat of state.seats) seat.resources.lp = format.settings.startingLP;
  state.undo = null;
  return state;
}
/** Full-validator callback must be deterministic for the supplied catalog/points snapshot. */
export function proposeRemoteDeckAddition(
  registration: RemoteDeckRegistration, fact: RemoteCardFact, inspect: (deck: DuelDeck) => DuelDeckValidation,
): RemoteDeckRegistration {
  const deck = structuredClone(registration.deck);
  deck[fact.section].push(fact.code);
  return { ...structuredClone(registration), deck, validation: inspect(deck) };
}
export function isInRemoteDeck(deck: DuelDeck, fact: RemoteCardFact, facts: RemoteCardFacts): boolean {
  return [...deck.main, ...deck.extra, ...deck.side, ...(deck.deckMaster ? [deck.deckMaster] : [])]
    .some(code => code === fact.code || facts[code]?.copyKey === fact.copyKey);
}
export function remotePublicZone(zone?: string, faceUp = true): boolean {
  return faceUp && !!zone && ["monster", "spell-trap", "extra-monster", "field", "graveyard", "banished", "extra", "pendulum"].includes(zone);
}
export function instanceLocation(instance: Pick<RemoteCardInstance, "zone" | "slot">): string {
  const name = instance.zone === "monster" ? "field" : instance.zone === "graveyard" ? "GY" : instance.zone ?? "revealed card";
  return name + (instance.slot ? " zone " + instance.slot : "");
}
type Sighting = { seat: number; fact: RemoteCardFact; zone?: string; slot?: number; ref?: string; faceUp?: boolean; observationId?: string };
/** Pure. Unlocated/repeated sightings cannot prove new copies. */
export function observeRemoteCard(input: RemoteDeckChecks, sight: Sighting, actionId: string, used: ReadonlySet<string> = new Set()): { checks: RemoteDeckChecks; instance: RemoteCardInstance } {
  const checks = structuredClone(input);
  const { fact, seat, zone, slot, ref } = sight;
  const same = checks.instances.filter(i => i.seat === seat && i.copyKey === fact.copyKey);
  const publicView = remotePublicZone(zone, sight.faceUp);
  const samePlace = (i: RemoteCardInstance) => publicView && i.public && i.zone === zone && i.slot === slot;
  const pinned = ref ? checks.instances.find(i => i.seat === seat && i.refs.includes(ref)) : undefined;
  // A batch's distinct physical regions exclude already-used instances; a repeated coordinate does not.
  const atPlace = same.find(i => samePlace(i) && (slot !== undefined || !used.has(i.id)));
  let instance = pinned ?? atPlace ?? same.find(i => !i.public && !used.has(i.id));
  if (!instance && sight.observationId && (!publicView || zone === undefined))
    instance = same.find(i => !used.has(i.id));
  if (!instance && !sight.observationId && !publicView) instance = same[0];
  if (!instance && !sight.observationId && publicView && !ref) {
    // Only an anchored twin in another public place supplies cross-event proof.
    const anchor = same.find(i => i.public && i.anchored && (i.zone !== zone || (slot !== undefined && i.slot !== slot)));
    if (!anchor) instance = same[0];
  }
  if (!instance && !sight.observationId && publicView && ref) {
    // Two unspecified positions in one row/pile are not proof of two different places.
    instance = same.find(i => i.public && i.zone === zone && (slot === undefined || i.slot === undefined));
  }
  if (!instance) {
    instance = { id: "instance:" + actionId + ":" + checks.instances.length, seat, ...fact, refs: [], public: false, anchored: false };
    checks.instances.push(instance);
  }
  // A known ref can be corrected by recognition; its identity is never a second instance.
  Object.assign(instance, fact);
  if (ref && !instance.refs.includes(ref)) instance.refs.push(ref);
  if (zone !== undefined) {
    instance.zone = zone; instance.slot = slot;
    instance.public = publicView;
    instance.anchored = publicView && !!ref;
  }
  return { checks, instance };
}
/** Only concurrent known locations count; lifetime scans and hidden instances never accumulate. */
export function flagRemoteCopies(input: RemoteDeckChecks, seen: RemoteCardInstance[], actionId: string, batch = false): RemoteDeckChecks {
  const checks = structuredClone(input);
  const groups = new Map<string, RemoteCardInstance[]>();
  for (const instance of seen) {
    const key = instance.seat + ":" + instance.copyKey;
    if (!groups.has(key)) groups.set(key, []);
    const group = groups.get(key)!;
    if (!group.some(i => i.id === instance.id)) group.push(instance);
  }
  for (const observed of groups.values()) {
    const lead = observed[0];
    const places = new Set<string>();
    const concurrent = checks.instances.filter(i => {
      if (i.seat !== lead.seat || i.copyKey !== lead.copyKey || !i.public) return false;
      const place = i.zone + ":" + (i.slot ?? "");
      if (places.has(place)) return false;
      places.add(place); return true;
    });
    if (batch) for (const i of observed) if (!concurrent.some(c => c.id === i.id)) concurrent.push(i);
    const count = Math.max(1, concurrent.length);
    if (count <= lead.limit) continue;
    const ids = (concurrent.length ? concurrent : [lead]).map(i => i.id).sort();
    if (checks.flags.some(f => f.seat === lead.seat && f.copyKey === lead.copyKey && f.count >= count &&
      (f.limit === 0 || ids.every(id => f.instanceIds.includes(id))))) continue;
    const label = checks.format.mode === "domain" ? checks.format.id === "genesys-domain" ? "Genesys Domain" : "Domain" : checks.format.id === "genesys" ? "Genesys" : "Advanced";
    const proof = (concurrent.length ? concurrent : [lead]).map(i => instanceLocation(i));
    if (batch) proof.push("same recognition batch");
    const message = "Deck no longer valid: " + count + " " + (count === 1 ? "copy" : "copies") + " of " + lead.name +
      " seen (" + label + " allows " + lead.limit + "). " +
      (count > 1 ? count + " copies of " + lead.name + " seen at the same time: " : "Seen: ") + proof.join(" and ");
    checks.flags.push({ id: "flag:" + actionId + ":" + checks.flags.length, seat: lead.seat, copyKey: lead.copyKey,
      count, limit: lead.limit, message, instanceIds: ids, proof, dismissed: false });
  }
  return checks;
}
