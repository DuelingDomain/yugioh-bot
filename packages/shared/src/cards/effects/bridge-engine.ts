import { ATTRIBUTES, MONSTER_TYPES, isBarredFromGenesys, isExtraDeckCard, type Card } from "./card.js";
import type { ArchetypeProfile } from "./synergy.js";
import type { Capability, CapabilityKey, CardCapability, BridgeFormat, BridgeGraphData, BridgeProgress, ArchetypeBridge, BridgeReason, BridgeReasonKey } from "./bridge-types.js";
import { REASON_CAPS } from "./bridge-types.js";
import { actionEvidence, allowedByLock, bridgeHash, canReceiveSummon, genericLinkOneMaterial, faceDownNeedEvidence, matchesBridgeFilter, mentionReachesCard, namedIn, particularFilter, positiveMention, printedText, quotedNames, sameName, sentences, sharedSmallWorldStats, trapMonsterEvidence, trapTurnSetEvidence, trapTurnSetAllows } from "./bridge-text.js";
import { bridgeMaterials } from "./bridge-materials.js";
import { groundBridgeGraph } from "./bridge-grounding.js";
import { narrowSetCapability, setReturnSummonEvidence, setAccessOrigin, extraDeckSetResources } from "./bridge-set-access.js";

export function bridgeLegal(card: Card, format: BridgeFormat): boolean {
  if (!card.formats.includes("TCG") || card.prerelease || card.subtypes.includes("token")) return false;
  return format === "advanced" ? card.banTcg !== "Forbidden"
    : !isBarredFromGenesys(card) && !/Must (?:first )?be Special Summoned[^.]*\b(?:Link|Pendulum)\b/i.test(card.text) && Number.isSafeInteger(card.genesysPoints) && card.genesysPoints! >= 0;
}

const edgeKeys = new Set<CapabilityKey>(["search", "special_summon", "normal_summon", "set_spell_trap", "place_on_field", "send_to_gy", "discard"]);
type Edge = { from: number; capability: Capability; targets: Set<number>; named: boolean; weight: number };
interface Context { name: string; ids: Set<number>; members: Set<number>; cards: Card[]; monsters: Card[]; discardRate: number; discardTriggerRate: number; edges: Edge[]; searchers: Edge[]; extras: { id: number; materials: number[]; weight: number }[] }
const round = (value: number) => Math.round(value * 100) / 100;
const wordIn = (word: string, name: string) => new RegExp(`(?:^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`, "i").test(name);
const availableMaterial = (card: Card): boolean => !/Cannot be Normal Summoned|Must (?:first )?be (?:Special|Ritual) Summoned/i.test(printedText(card))
  && ((card.level ?? 0) <= 4 || sentences(printedText(card)).some(text => /Special Summon this card[^.]*from your hand/i.test(text)));
const negatedEntry = (capability: Capability): boolean => {
  if (capability.from?.includes("hand") && /if you Special Summoned an Effect Monster from your GY by this effect, it cannot attack and its effects are negated/i.test(capability.evidence)) return false;
  return /negat(?:e|ing) (?:its|their) effects|(?:its|their) effects(?:\s+\(if any\))?\s+(?:(?:are|is)\s+)?negated/i.test(capability.evidence);
};
const costCanUse = (cost: Capability, card: Card): boolean => !!cost.filter && !cost.filter.this_card
  && particularFilter(cost.filter) && matchesBridgeFilter(cost.filter, card)
  && cost.evidence.includes(";") && !!actionEvidence({ ...card, text: cost.evidence.split(";")[0]!, pendulumText: undefined }, cost.key, cost.filter)
  && !/\bequipped to (?:this|that) card\b/i.test(cost.evidence.split(";")[0]!)
  && (!cost.evidence.includes(":") || /^(?:\(Quick Effect\)|Once per turn|During your Main Phase|(?:If|When) this card is (?:Normal|Normal or Special) Summoned)\s*:/i.test(cost.evidence))
  && !!cost.from?.some(zone => zone === "hand" || zone === "deck" ? !isExtraDeckCard(card)
    : zone === "extra_deck" ? isExtraDeckCard(card) : zone === "field" ? !isExtraDeckCard(card) && availableMaterial(card) : true);
const groupNames = new Map<string, (name: string) => boolean>();
function groupNameIn(card: Card, name: string, aliases: string[] = []): boolean {
  const key = JSON.stringify([name, aliases]);
  let matches = groupNames.get(key);
  if (!matches) {
    const normalized = name.normalize("NFKC").toLowerCase();
    const patterns = [normalized, ...aliases.map(alias => alias.toLowerCase())]
      .map(value => new RegExp(`(?:^|[^a-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:s|es)?(?:$|[^a-z0-9])`, "i"));
    matches = value => patterns.some(pattern => pattern.test(value));
    groupNames.set(key, matches);
  }
  return matches(card.name) || [name, ...aliases].some(value => !!card.archetype && sameName(card.archetype, value) && card.name.toLowerCase().includes(value.toLowerCase()));
}
function engineGroups(groups: Record<string, number[]>, rows: readonly CardCapability[], policies: BridgeGraphData["group_policies"] = {}): Record<string, number[]> {
  const cards = new Map(rows.map(row => [row.id, row.card]));
  return Object.fromEntries(Object.entries(groups).filter(([name, ids]) => {
    const policy = policies[name];
    const matches = (id: number) => cards.has(id) && groupNameIn(cards.get(id)!, name, policy?.aliases);
    const monsters = ids.filter(id => cards.get(id)?.kind === "monster" && !isExtraDeckCard(cards.get(id)!));
    const namedMonsters = monsters.filter(matches).length;
    return !policy?.excluded && ids.length >= 3 && (policy?.curated
      || ids.filter(matches).length >= ids.length / 2
      || namedMonsters >= 3 && namedMonsters >= monsters.length / 2);
  })
    .map(([name, ids]) => [name, [...new Set([...ids, ...rows.filter(row => groupNameIn(row.card, name, policies[name]?.aliases)).map(row => row.id)])].sort((a, b) => a - b)]));
}

export class BridgeEngine {
  readonly rows: ReadonlyMap<number, CardCapability>;
  readonly groups: ReadonlyMap<string, Set<number>>;
  private readonly legal = new Map<BridgeFormat, Map<number, CardCapability>>();
  private readonly contexts = new Map<BridgeFormat, Map<string, Context>>();
  private readonly edges = new Map<BridgeFormat, Edge[]>();
  private readonly edgesFrom = new Map<BridgeFormat, Map<number, Edge[]>>();
  private readonly mainMonsters = new Map<BridgeFormat, Card[]>();
  private readonly smallWorld = new Map<BridgeFormat, number>();
  private readonly pairCache = new Map<string, BridgeReason[]>();
  private readonly sameDeckPairs = new Map<string, boolean>();
  private readonly parentOrAliasPairs = new Map<string, boolean>();
  private readonly deckFamilies = new Map<string, Set<string>>();
  private readonly groupReferences = new Map<string, Set<string>>();
  private readonly discardSetups = new Map<string, number[] | undefined>();
  private readonly specificFilters = new Map<BridgeFormat, WeakMap<Capability, boolean>>();
  private readonly accessExtras = new Map<string, Context["extras"]>();
  private collectingOutlets?: Map<number, Map<BridgeReasonKey, Set<string>>>;
  private readonly names: string[];

  constructor(readonly data: BridgeGraphData, private readonly validationLegal?: (format: BridgeFormat) => ReadonlySet<number>) {
    data = groundBridgeGraph(data);
    this.data = data;
    this.rows = new Map(data.capabilities.map(row => [row.id, row]));
    this.groups = new Map(Object.entries(data.groups).map(([name, ids]) => [name, new Set(ids)]));
    this.names = [...this.groups.keys()].sort();
    for (const [name, ids] of this.groups) this.groupReferences.set(name, new Set([name, ...(data.group_policies?.[name]?.aliases ?? []),
      ...[...ids].flatMap(id => this.rows.has(id) ? [this.rows.get(id)!.card.name] : [])].map(value => value.normalize("NFKC").toLowerCase())));
  }

  private prepare(format: BridgeFormat): void {
    if (this.legal.has(format)) return;
    const legal = new Map([...this.rows].filter(([, row]) => bridgeLegal(row.card, format)));
    const summonable = new Set([...legal].filter(([, row]) => canReceiveSummon(row.card, "Special Summon")).map(([id]) => id));
    const normalSummonable = new Set([...legal].filter(([, row]) => row.card.kind === "monster" && !isExtraDeckCard(row.card) && !/Cannot be Normal Summoned\/Set/i.test(row.card.text)).map(([id]) => id));
    const index = new Map<string, Set<number>>();
    const add = (key: string, id: number) => { if (!index.has(key)) index.set(key, new Set()); index.get(key)!.add(id); };
    for (const [id, { card }] of legal) {
      add(`kind:${card.kind}`, id); add(`type:${card.monsterType}`, id); add(`attribute:${card.attribute}`, id);
      add(`name:${card.name.toLowerCase()}`, id); add(`archetype:${card.archetype?.toLowerCase()}`, id);
      for (const subtype of card.subtypes) add(`subtype:${subtype}`, id);
    }
    const all = [...legal.keys()], edges: Edge[] = [];
    for (const [id, row] of legal) for (const capability of row.provides) {
      const f = capability.filter;
      if (!edgeKeys.has(capability.key) || !f || f.this_card || !particularFilter(f)) continue;
      let candidates = capability.targets;
      if (!candidates) {
        const pools = ([ ["kind", f.kinds], ["type", f.types], ["attribute", f.attributes], ["name", f.names] ] as const)
          .filter(([, values]) => values.length).map(([key, values]) => new Set(values.flatMap(value => [...(index.get(`${key}:${key === "name" ? value.toLowerCase() : value}`) ?? [])])));
        candidates = pools.length ? [...pools.sort((a, b) => a.size - b.size)[0]!] : all;
      }
      const targets = new Set(candidates.filter(target => target !== id && legal.has(target) && matchesBridgeFilter(f, legal.get(target)!.card)
        && (capability.key !== "special_summon" || summonable.has(target)
          || capability.from?.includes("extra_deck") && canReceiveSummon(legal.get(target)!.card, printedText(row.card)))
        && (capability.key !== "normal_summon" || normalSummonable.has(target))
        && (!capability.from?.length || capability.from.some(zone => zone === "deck" ? !isExtraDeckCard(legal.get(target)!.card) : zone === "extra_deck" ? isExtraDeckCard(legal.get(target)!.card) : true))));
      if (!targets.size) continue;
      const named = !!(f.names.length || f.archetypes.length);
      // Large generic effects are toolboxes, not evidence of an engine connection.
      if (!named && targets.size >= 300) continue;
      if (capability.key === "set_spell_trap" && !setAccessOrigin(capability)) continue;
      edges.push({ from: id, capability, targets, named, weight: named ? 6 : 2 });
    }
    const edgesFrom = new Map<number, Edge[]>(), searchersByTarget = new Map<number, Edge[]>();
    for (const edge of edges) {
      if (!edgesFrom.has(edge.from)) edgesFrom.set(edge.from, []);
      edgesFrom.get(edge.from)!.push(edge);
      if (edge.capability.key === "search" && !edge.named) for (const id of edge.targets) {
        if (!searchersByTarget.has(id)) searchersByTarget.set(id, []);
        searchersByTarget.get(id)!.push(edge);
      }
    }
    const mainMonsters = [...legal.values()].map(row => row.card).filter(card => card.kind === "monster" && !isExtraDeckCard(card));
    this.mainMonsters.set(format, mainMonsters);
    const smallWorld = [...legal.values()].find(row => row.card.name === "Small World");
    if (smallWorld) this.smallWorld.set(format, smallWorld.id);
    const contexts = new Map<string, Context>();
    for (const name of this.names) {
      const ids = new Set([...this.groups.get(name)!].filter(id => legal.has(id)));
      const cards = [...ids].map(id => legal.get(id)!.card);
      const monsters = cards.filter(card => card.kind === "monster" && !isExtraDeckCard(card));
      const main = cards.filter(card => !isExtraDeckCard(card));
      const discardRate = main.filter(card => this.discardsFromHand(legal.get(card.id)!)).length / Math.max(1, main.length);
      const allMonsters = cards.filter(card => card.kind === "monster");
      const discardTriggerRate = allMonsters.filter(card => legal.get(card.id)!.needs.some(need => need.key === "trigger" && need.value === "discard")).length / Math.max(1, allMonsters.length);
      const names = [name, ...(this.data.group_policies?.[name]?.aliases ?? [])];
      const byName = new Map(cards.map(card => [card.name.toLowerCase(), card.id]));
      const members = new Set<number>();
      for (const card of cards) for (const mentioned of quotedNames(printedText(card))) {
        if (sameName(mentioned, card.name)) continue;
        const other = byName.get(mentioned.toLowerCase());
        if (other !== undefined || names.some(name => sameName(name, mentioned))) members.add(card.id);
        if (other !== undefined) members.add(other);
      }
      contexts.set(name, { name, ids, members, cards, monsters, discardRate, discardTriggerRate, edges: cards.flatMap(card => edgesFrom.get(card.id) ?? []),
        searchers: [...new Set(monsters.flatMap(card => searchersByTarget.get(card.id) ?? []))].filter(edge => !ids.has(edge.from)), extras: [] });
    }
    const active = [...contexts.values()].filter(context => context.ids.size >= 3);
    if (Object.keys(this.data.materials?.[format] ?? {}).length) {
      for (const [name, extras] of Object.entries(this.data.materials![format])) if (contexts.has(name)) contexts.get(name)!.extras = extras;
    } else for (const [id, row] of legal) {
      if (!isExtraDeckCard(row.card)) continue;
      if (!edgesFrom.get(id)?.some(edge => edge.named && [...edge.targets].some(target => [...contexts.values()].some(context => context.ids.has(target))))) continue;
      // Multiple bodies need a summon setup line, not just matching material stats.
      const made = active.flatMap(context => { const materials = bridgeMaterials(row.card, context.monsters.filter(availableMaterial), format); return materials?.length === 1 ? [{ context, materials }] : []; });
      if (!made.length) continue;
      const rarity = Math.min(1, Math.log(active.length / made.length) / Math.log(Math.max(2, active.length / 10)));
      if (rarity <= 0) continue;
      const materialText = row.card.text.split(/[\r\n]/)[0]!;
      const specificMaterial = quotedNames(materialText).length || [...MONSTER_TYPES, ...ATTRIBUTES].some(value => materialText.includes(value));
      if (!specificMaterial && rarity < 0.6) continue;
      for (const { context, materials } of made) context.extras.push({ id, materials, weight: rarity });
    }
    this.legal.set(format, legal); this.edges.set(format, edges); this.edgesFrom.set(format, edgesFrom); this.contexts.set(format, contexts);
    this.data.materials ??= { advanced: {}, genesys: {} };
    this.data.materials[format] = Object.fromEntries([...contexts].map(([name, context]) => [name, context.extras]));
  }

  private resolve(name: string): string | undefined { return this.names.find(value => sameName(value, name.trim())); }

  private groupOverlap(a: string, b: string): number {
    const x = this.groups.get(a)!, y = this.groups.get(b)!;
    return [...x].filter(id => y.has(id)).length;
  }

  private sameDeckRelation(a: string, b: string): boolean {
    const key = JSON.stringify([a, b].sort());
    const cached = this.sameDeckPairs.get(key);
    if (cached !== undefined) return cached;
    const namingRate = (source: string, target: string) => {
      const onlySource = [...this.groups.get(source)!].filter(id => !this.groups.get(target)!.has(id));
      return onlySource.filter(id => quotedNames(printedText(this.rows.get(id)!.card))
        .some(name => this.groupReferences.get(target)!.has(name.normalize("NFKC").toLowerCase()))).length / Math.max(1, onlySource.length);
    };
    const rates = [namingRate(a, b), namingRate(b, a)];
    const same = wordIn(a, b) || wordIn(b, a) || this.groupOverlap(a, b) >= 0.3 * Math.min(this.groups.get(a)!.size, this.groups.get(b)!.size)
      || Math.max(...rates) >= 0.9 || Math.max(...rates) >= 0.33 && Math.min(...rates) >= 0.2;
    this.sameDeckPairs.set(key, same);
    return same;
  }

  private sameDeck(a: string, b: string): boolean {
    let family = this.deckFamilies.get(a);
    if (!family) {
      family = new Set([a]);
      // A shared subgroup (for example a named character) joins the same family.
      for (const member of family) for (const other of this.names) {
        if (!family.has(other) && this.sameDeckRelation(member, other)) family.add(other);
      }
      for (const member of family) this.deckFamilies.set(member, family);
    }
    return family.has(b);
  }

  relatedEngines(a: string, b: string): boolean {
    if (!this.groups.has(a) || !this.groups.has(b)) return true;
    return a === b || this.groupOverlap(a, b) >= 0.5 * Math.min(this.groups.get(a)!.size, this.groups.get(b)!.size) || this.sameDeck(a, b);
  }

  distinctTargets<T extends ArchetypeBridge>(rows: T[], limit = 25, distinctPrimary = limit <= 4, deep = false): T[] {
    const results: T[] = [];
    const primaryTargets = new Map<string, Set<number>>();
    const primaryMentions = new Map<string, Set<string>>();
    const nichePaths = new Set<string>();
    for (const row of [...rows].sort((a, b) => Number(a.tier === "niche") - Number(b.tier === "niche")
      || (a.tier === "niche" && b.tier === "niche" ? Number(b.two_way) - Number(a.two_way) : 0)
      || b.score - a.score || a.target.localeCompare(b.target))) {
      if (row.kind === "synergy" && (!deep || results.filter(row => row.kind === "synergy").length >= 2)) continue;
      if (row.tier === "niche" ? !deep : row.score < 4) continue;
      const reason = row.reasons[0], first = reason?.steps?.[0];
      const sourceCard = reason?.cost?.using ?? reason?.materials?.[0]
        ?? reason?.cards.find(id => this.groups.get(row.source)?.has(id));
      const entryCard = reason?.cost?.card ?? (first && (this.groups.get(row.source)?.has(first.from) ? first.to : first.from));
      const path = row.tier === "niche" && sourceCard !== undefined && entryCard !== undefined
        ? JSON.stringify([row.source, row.format, sourceCard, entryCard]) : undefined;
      if (path && nichePaths.has(path)) continue;
      if (results.some(higher => higher.target === row.target || this.groupOverlap(row.target, higher.target) >= 0.5 * this.groups.get(row.target)!.size)) continue;
      const card = row.reasons[0]?.cards.find(id => this.groups.get(row.source)?.has(id) && !isExtraDeckCard(this.rows.get(id)!.card));
      const primary = card === undefined ? undefined : JSON.stringify([row.source, card]);
      const targets = row.reasons[0]?.cards.filter(id => this.groups.get(row.target)?.has(id) && !this.groups.get(row.source)?.has(id)) ?? [];
      // Shared enablers can serve different engines. Mention alternatives in
      // one sentence still describe one line, even with different Y-side cards.
      if (distinctPrimary && primary && targets.some(id => primaryTargets.get(primary)?.has(id))) continue;
      const mention = row.reasons[0]?.key === "mention" ? row.reasons[0].cards[0] : undefined;
      const mentionPrimary = mention === undefined ? undefined : JSON.stringify([row.source, mention]);
      if (distinctPrimary && mentionPrimary && sentences(printedText(this.rows.get(mention!)!.card))
        .some(text => namedIn(text, row.target) && [...(primaryMentions.get(mentionPrimary) ?? [])].some(target => namedIn(text, target)))) continue;
      if (primary) primaryTargets.set(primary, new Set([...(primaryTargets.get(primary) ?? []), ...targets]));
      if (mentionPrimary) primaryMentions.set(mentionPrimary, new Set([...(primaryMentions.get(mentionPrimary) ?? []), row.target]));
      results.push(row);
      if (path) nichePaths.add(path);
      if (results.length >= limit) break;
    }
    return limit > 0 ? results : [];
  }

  deepTargets<T extends ArchetypeBridge>(rows: T[], limit = 10): T[] {
    return this.distinctTargets(rows, limit, false, true);
  }

  private discardSetup(source: CardCapability, target: Card, format: BridgeFormat): number[] | undefined {
    const requirement = source.provides.find(capability => capability.key === "send_to_gy" && capability.from?.includes("extra_deck") && /same Type as the revealed monster/i.test(capability.filter?.other ?? ""));
    if (!requirement) return [];
    if (target.kind !== "monster") return undefined;
    if (!this.legal.has(format)) this.prepare(format);
    const key = `${format}:${source.id}:${target.monsterType}`;
    if (this.discardSetups.has(key)) return this.discardSetups.get(key);
    const filter = requirement.filter!, stat = /^same Type as the revealed monster, with (\d+) ATK or DEF$/i.exec(filter.other);
    const evidence = actionEvidence(source.card, "send_to_gy", filter);
    const candidates = stat && filter.subtypes.includes("fusion") && evidence && /same Type/i.test(evidence) && new RegExp(`\\b${stat[1]} ATK or DEF\\b`, "i").test(evidence)
      ? [...this.legal.get(format)!.values()].map(row => row.card).filter(card => card.monsterType === target.monsterType
        && matchesBridgeFilter({ ...filter, other: "" }, card) && (card.atk === +stat[1]! || card.def === +stat[1]!)) : [];
    candidates.sort((a, b) => Number(namedIn(printedText(b), "Fallen of Albaz")) - Number(namedIn(printedText(a), "Fallen of Albaz"))
      || (format === "genesys" ? a.genesysPoints! - b.genesysPoints! : 0) || a.id - b.id);
    const setup = candidates.length ? [candidates[0]!.id] : undefined;
    this.discardSetups.set(key, setup);
    return setup;
  }

  reasons(source: string, target: string, format: BridgeFormat, access = false): BridgeReason[] {
    this.prepare(format);
    const cacheKey = `${format}:${source}:${target}:${access}`, cached = this.pairCache.get(cacheKey);
    if (cached) return cached;
    const contexts = this.contexts.get(format)!, x = contexts.get(source), y = contexts.get(target);
    if (!x || !y || x.ids.size < 3 || y.ids.size < 3 || source === target || this.sameDeck(source, target)) return [];
    const onlyY = y.cards.filter(card => !x.ids.has(card.id));
    if (!onlyY.length) return [];
    const legal = this.legal.get(format)!, rows = this.rows, reasons: BridgeReason[] = [];
    const add = (key: BridgeReasonKey, weight: number, ids: number[], description: string, steps?: BridgeReason["steps"], materials?: number[], alternative = false) => {
      const cards = [...new Set(ids)];
      const reason: BridgeReason = { key, weight: round(weight * this.frequencyScale(target, key, format)), cards,
        evidence: cards.map(id => printedText(rows.get(id)!.card) || rows.get(id)!.card.name), description, ...(steps ? { steps } : {}), ...(materials ? { materials } : {}), ...(alternative ? { alternative: true as const } : {}) };
      if (this.statOutlet(reason) && this.data.ancillary_outlets?.[format]?.[this.outlet(reason)]?.includes(key)) {
        reason.ancillary = true;
        reason.weight = Math.min(1, reason.weight);
      }
      if (this.validateReason(reason, format)) {
        reasons.push(reason);
        if (this.collectingOutlets && this.statOutlet(reason) && (key === "gy_fuel" || key === "reach" && this.substantive(reason, y, x, format))) {
          const id = this.outlet(reason);
          if (!this.collectingOutlets.has(id)) this.collectingOutlets.set(id, new Map());
          const keys = this.collectingOutlets.get(id)!;
          if (!keys.has(key)) keys.set(key, new Set());
          keys.get(key)!.add(target);
        }
        return true;
      }
      return false;
    };
    for (const card of x.cards) {
      for (const other of onlyY) {
        if (positiveMention(card, other.name) || mentionReachesCard(card, target, other)) add("mention", 6, [card.id, other.id], `${card.name} names ${positiveMention(card, other.name) ? other.name : target}`);
        // Reverse references establish a directed need for X, not a free reverse effect.
        if (positiveMention(other, card.name)) add("mention", 4, [card.id, other.id], `${other.name} needs or supports ${card.name}`);
      }
    }
    const namedConnection = reasons.some(reason => reason.key === "mention") || x.edges.some(edge => edge.named && onlyY.some(card => edge.targets.has(card.id)));
    for (const edge of x.edges) {
      if (isExtraDeckCard(rows.get(edge.from)!.card)) continue;
      const hit = onlyY.filter(card => edge.targets.has(card.id) && this.engineMember(card, y, edge.capability, x));
      if (!hit.length) continue;
      const card = rows.get(edge.from)!.card, to = hit[0]!;
      const negated = ["special_summon", "normal_summon"].includes(edge.capability.key) && negatedEntry(edge.capability);
      // GY/banished extenders need setup before they can enter another engine.
      const freshEntry = ["search", "special_summon", "normal_summon"].includes(edge.capability.key)
        && edge.capability.from?.some(zone => zone === "deck" || zone === "hand");
      const entry = (negated || !freshEntry ? [] : hit).flatMap(card => y.edges.filter(next => next.from === card.id && next.named && next.capability.from?.includes("deck")
        && /If this card is (?:Normal|Special|Normal or Special) Summoned\s*:/i.test(next.capability.evidence))
        .flatMap(next => onlyY.filter(other => next.targets.has(other.id)).sort((a, b) =>
          Number(y.edges.some(edge => edge.from === b.id && edge.named && edge.capability.from?.includes("deck")))
          - Number(y.edges.some(edge => edge.from === a.id && edge.named && edge.capability.from?.includes("deck"))))
          .slice(0, 1).map(other => ({ card, next, other })))).at(0);
      const coversEngine = y.monsters.length > 0 && y.monsters.filter(card => !x.ids.has(card.id) && edge.targets.has(card.id)).length >= y.monsters.length / 3;
      const reach = edge.named || coversEngine || namedConnection;
      add(reach ? "reach" : "type_support", (reach ? edge.weight : Math.min(1, edge.weight)) * Math.min(1, hit.length / 3 + 0.4), [card.id, to.id], `${card.name}: ${edge.capability.key} → ${to.name}`, [{ from: card.id, to: to.id, capability: edge.capability.key }]);
      let alternatives = 0;
      for (const other of hit.slice(1)) if (add(reach ? "reach" : "type_support", (reach ? edge.weight : Math.min(1, edge.weight)) * Math.min(1, hit.length / 3 + 0.4),
        [card.id, other.id], `${card.name}: ${edge.capability.key} → ${other.name}`, [{ from: card.id, to: other.id, capability: edge.capability.key }], undefined, true)
        && ++alternatives >= 3) break;
      if (!edge.named && entry) add("reach", 6, [card.id, entry.card.id, entry.other.id], `${card.name} → ${entry.card.name} → ${entry.other.name}`,
        [{ from: card.id, to: entry.card.id, capability: edge.capability.key }, { from: entry.card.id, to: entry.other.id, capability: entry.next.capability.key }]);
      if (["send_to_gy", "discard"].includes(edge.capability.key) && rows.get(to.id)!.provides.some(capability => capability.key === "gy_effect")) add("gy_fuel", 3, [card.id, to.id], `${card.name} supplies the GY effect of ${to.name}`, [{ from: card.id, to: to.id, capability: edge.capability.key }]);
      if (!edge.named && (edge.capability.filter!.types.length || edge.capability.filter!.attributes.length || edge.capability.filter!.level_min || edge.capability.filter!.level_max)) add("type_support", Math.min(1.5, 1.5 * hit.length / Math.max(1, onlyY.filter(card => card.kind === "monster").length)), [card.id, to.id], `${card.name} supports the printed Type, Attribute or Level of ${to.name}`, [{ from: card.id, to: to.id, capability: edge.capability.key }]);
    }
    if (access) for (const edge of x.edges) {
      if (!narrowSetCapability(edge.capability) || !setAccessOrigin(edge.capability) || isExtraDeckCard(rows.get(edge.from)!.card)) continue;
      for (const to of onlyY.filter(card => (card.kind === "spell" || card.kind === "trap") && edge.targets.has(card.id) && this.engineMember(card, y, edge.capability, x))) {
        add("access", 3, [edge.from, to.id], `${rows.get(edge.from)!.card.name} Sets ${to.name} using its printed recipient filter`,
          [{ from: edge.from, to: to.id, capability: "set_spell_trap" }]);
      }
    }
    // A resource interaction must name both its provider and its consumer.
    // Tokens and Normal Monsters can enable effects requiring a non-Effect body.
    const nonEffect = x.cards.find(card => this.providesNonEffect(card));
    const resourceReach = x.edges.flatMap(edge => onlyY.filter(card => edge.targets.has(card.id) && this.requiresNonEffect(card)).map(card => ({ edge, card })))[0];
    if (nonEffect && resourceReach) {
      const { edge, card: consumer } = resourceReach;
      add("profile", 4, [nonEffect.id, consumer.id, edge.from], `${nonEffect.name} supplies the non-Effect monster required by ${consumer.name}; ${rows.get(edge.from)!.card.name} can also reach it when its printed conditions are met`,
        [{ from: edge.from, to: consumer.id, capability: edge.capability.key }]);
    }
    for (const enabler of x.cards.filter(card => trapTurnSetEvidence(card))) {
      // Effect-based permissions have costs/conditions; admit them through the
      // checked deep access line rather than inflate the historical strict score.
      if (!access && enabler.kind !== "spell") continue;
      const monsters = onlyY.filter(card => trapMonsterEvidence(card));
      const traps = onlyY.filter(card => trapTurnSetAllows(enabler, card) && (trapMonsterEvidence(card) || access && !monsters.length && card.kind === "trap"
        && y.edges.some(edge => edge.capability.key === "set_spell_trap" && narrowSetCapability(edge.capability) && edge.targets.has(card.id)))
        && !/in (?:your|the) (?:GY|Graveyard)/i.test(trapMonsterEvidence(card) ?? "")
        && !/cannot (?:be )?activated? (?:the|this) turn/i.test(printedText(card)));
      if (enabler && traps.length) {
        const trap = traps[0]!;
        const setter = y.monsters.find(card => rows.get(card.id)!.provides.some(capability => capability.key === "set_spell_trap" && capability.from?.includes("deck")
          && capability.filter && traps.some(trap => matchesBridgeFilter(capability.filter!, trap)) && actionEvidence(card, "set_spell_trap")));
        const continuousSupport = y.monsters.find(card => rows.get(card.id)!.provides.some(capability => ["set_spell_trap", "place_on_field"].includes(capability.key)
          && capability.filter?.subtypes.includes("continuous") && traps.some(trap => matchesBridgeFilter({ ...capability.filter!,
            other: capability.filter!.archetypes.length || capability.filter!.names.length ? "" : capability.filter!.other }, trap)) && actionEvidence(card, capability.key)));
        const need = onlyY.find(card => faceDownNeedEvidence(card));
        const specific = setter ?? need ?? continuousSupport;
        const weight = setter || need ? Math.min(3, traps.length * 0.5) + Math.min(7, traps.length * 2.5)
          : continuousSupport ? Math.min(8, 2 + traps.length * 2) : Math.min(2, traps.length * 0.5);
        const set = access && setter ? y.edges.find(edge => edge.from === setter.id && narrowSetCapability(edge.capability) && edge.capability.from?.includes("deck") && edge.targets.has(trap.id)) : undefined;
        add("rule_enabler", weight, [enabler.id, trap.id, ...(specific ? [specific.id] : [])], `${enabler.name} lets you activate a ${target} Trap the turn it is Set (${traps.length} compatible Traps)${specific ? `; ${specific.name} supports this Trap engine` : ""}`,
          set ? [{ from: setter!.id, to: trap.id, capability: "set_spell_trap" }] : undefined);
      }
    }
    const needs = onlyY.filter(card => faceDownNeedEvidence(card));
    const supplies = x.cards.filter(card => rows.get(card.id)!.provides.some(capability => capability.key === "set_spell_trap" && !capability.filter?.this_card && capability.from?.some(zone => zone === "deck" || zone === "gy")));
    if (needs.length && supplies.length) add("face_down", Math.min(1.5, 12 * needs.length / onlyY.length) * Math.min(1, supplies.length / 3), [supplies[0]!.id, needs[0]!.id], `${supplies[0]!.name} supplies a Set card used by ${needs[0]!.name}`);
    const discards = x.cards.filter(card => this.discardsFromHand(rows.get(card.id)!));
    const discardTriggers = onlyY.filter(card => rows.get(card.id)!.needs.some(capability => capability.key === "trigger" && capability.value === "discard")
      && sentences(printedText(card)).some(text => /If this card is discarded[^.:]*(?:effect)?\s*:/i.test(text)
        && !/discarded[^.:]*opponent|your opponent|opponent['’]s field|target[^.]*in your (?:GY|Graveyard)/i.test(text))
      && discards.some(discard => this.discardSetup(rows.get(discard.id)!, card, format) !== undefined
        && rows.get(discard.id)!.provides.some(capability => capability.key === "discard" && capability.from?.includes("hand")
          && capability.filter && matchesBridgeFilter(capability.filter, card))))
      .sort((a, b) => Number(/:\s*(?:You can )?(?:Draw\b|Special Summon this card)/i.test(printedText(b))) - Number(/:\s*(?:You can )?(?:Draw\b|Special Summon this card)/i.test(printedText(a))));
    const discard = discards.find(discard => discardTriggers.some(card => this.discardSetup(rows.get(discard.id)!, card, format) !== undefined
      && rows.get(discard.id)!.provides.some(capability => capability.key === "discard" && capability.from?.includes("hand")
        && capability.filter && matchesBridgeFilter(capability.filter, card))));
    if (discard && discardTriggers.length) {
      const trigger = discardTriggers.find(card => this.discardSetup(rows.get(discard.id)!, card, format) !== undefined
        && rows.get(discard.id)!.provides.some(capability => capability.key === "discard" && capability.from?.includes("hand")
          && capability.filter && matchesBridgeFilter(capability.filter, card)))!;
      const setup = this.discardSetup(rows.get(discard.id)!, trigger, format)!;
      add("gy_fuel", Math.min(6, discardTriggers.length * 2), [discard.id, trigger.id, ...setup], `${discard.name} can trigger ${trigger.name} by discarding it as an effect${setup.length ? `; send ${rows.get(setup[0]!)!.card.name} to meet its matching-Type Fusion requirement` : ""}`, [{ from: discard.id, to: trigger.id, capability: "discard" }]);
    }
    for (const extra of access ? this.accessMaterials(x, format) : x.extras) {
      const card = legal.get(extra.id)!.card;
      const materialText = card.text.split(/[\r\n]/)[0]!;
      const specificMaterial = quotedNames(materialText).length || [...MONSTER_TYPES, ...ATTRIBUTES].some(value => materialText.includes(value));
      if (!access && !specificMaterial && extra.weight < 0.6) continue;
      for (const edge of this.edgesFrom.get(format)!.get(extra.id) ?? []) {
        const hit = onlyY.filter(other => edge.targets.has(other.id)
          && (!access || edge.capability.key !== "special_summon" || !negatedEntry(edge.capability) || other.subtypes.includes("normal")))
          .sort((a, b) => /if you Special Summoned an Effect Monster from your GY by this effect/i.test(edge.capability.evidence)
            ? Number(b.subtypes.includes("normal")) - Number(a.subtypes.includes("normal")) : 0);
        if (!hit.length || !edge.named) continue;
        if (edge.capability.from?.length && edge.capability.from.every(zone => zone === "gy" || zone === "banished")) continue;
        if (["send_to_gy", "discard"].includes(edge.capability.key) || /(?:If|When)[^:;]*(?:destroyed|leaves the field|sent[^:;]*(?:GY|Graveyard)|Tributed|banished|battle damage|opponent activates)/i.test(edge.capability.evidence)) continue;
        const focus = Math.min(1, 2 * hit.length / edge.targets.size);
        add("extra_deck", 6 * extra.weight * focus, [...extra.materials, extra.id, hit[0]!.id], `${rows.get(extra.materials[0]!)!.card.name} → ${card.name} → ${hit[0]!.name}`, [{ from: extra.id, to: hit[0]!.id, capability: edge.capability.key }], extra.materials);
        let alternatives = 0;
        for (const other of hit.slice(1)) if (add("extra_deck", 6 * extra.weight * focus, [...extra.materials, extra.id, other.id],
          `${rows.get(extra.materials[0]!)!.card.name} → ${card.name} → ${other.name}`, [{ from: extra.id, to: other.id, capability: edge.capability.key }], extra.materials, true)
          && ++alternatives >= 3) break;
      }
    }
    if (access) for (const edge of this.edges.get(format)!) {
      const consumer = rows.get(edge.from)!;
      if (!edge.named || isExtraDeckCard(consumer.card) || consumer.card.kind === "monster" && !availableMaterial(consumer.card)) continue;
      const to = onlyY.find(card => edge.targets.has(card.id) && this.engineMember(card, y, edge.capability, x));
      if (!to) continue;
      const cost = consumer.needs.find(need => ["tribute", "send_to_gy", "banish", "discard"].includes(need.key)
        && need.effect !== undefined && need.effect === edge.capability.effect
        && x.cards.some(card => costCanUse(need, card)));
      const using = cost && x.cards.find(card => costCanUse(cost, card));
      if (!cost || !using) continue;
      const cards = [...new Set([using.id, consumer.id, to.id])];
      const reason: BridgeReason = { key: "access", weight: 3, cards, evidence: cards.map(id => printedText(rows.get(id)!.card)),
        description: `${using.name} pays ${consumer.card.name}'s ${cost.key} cost → ${to.name}`,
        cost: { card: consumer.id, using: using.id, capability: cost.key, effect: cost.effect! },
        steps: [{ from: consumer.id, to: to.id, capability: edge.capability.key }] };
      if (this.validateReason(reason, format)) reasons.push(reason);
    }
    for (const edge of x.searchers) {
      if (edge.capability.key !== "search" || edge.named || x.ids.has(edge.from) || y.ids.has(edge.from) || edge.targets.size > 600) continue;
      const a = x.monsters.find(card => edge.targets.has(card.id)), b = y.monsters.find(card => edge.targets.has(card.id) && !x.ids.has(card.id));
      if (a && b) add("searcher", edge.targets.size < 100 ? 1 : 0.3, [edge.from, a.id, b.id], `${rows.get(edge.from)!.card.name} searches a monster from each engine`, [{ from: edge.from, to: a.id, capability: "search" }, { from: edge.from, to: b.id, capability: "search" }]);
    }
    const sw = this.smallWorld.get(format);
    if (sw) {
      let found = false;
      for (const a of x.monsters) {
        for (const b of y.monsters.filter(card => !x.ids.has(card.id))) {
          const middle = this.mainMonsters.get(format)!.find(card => card.id !== a.id && card.id !== b.id && sharedSmallWorldStats(a, card) === 1 && sharedSmallWorldStats(card, b) === 1);
          if (middle) { add("small_world", 1, [sw, a.id, middle.id, b.id], `Small World: ${a.name} → ${middle.name} → ${b.name}`); found = true; break; }
        }
        if (found) break;
      }
    }
    // Ancillary search overlap alone is not an engine bridge.
    const seen = new Set<string>();
    const unique = reasons.sort((a, b) => b.weight - a.weight || a.description.localeCompare(b.description)).filter(reason => {
      const identity = JSON.stringify([reason.key, reason.cards, reason.steps, reason.materials, reason.cost, reason.setup]);
      if (seen.has(identity)) return false;
      seen.add(identity); return true;
    });
    const retained = access ? unique.some(reason => this.accessPath(reason, x, y, format)) ? unique : []
      : unique.some(reason => this.substantive(reason, y, x, format)) ? unique : [];
    for (const reason of retained) if (access ? !this.accessPath(reason, x, y, format) : !this.substantive(reason, y, x, format)) {
      reason.ancillary = true;
      if (reason.key === "gy_fuel" && reason.steps?.[0]?.capability === "discard") reason.weight = Math.min(1, reason.weight);
    }
    // Only a source-sized cache is retained during live scans.
    if (this.pairCache.size > this.names.length * 2) this.pairCache.clear();
    this.pairCache.set(cacheKey, retained);
    return retained;
  }

  validateReason(reason: BridgeReason, format: BridgeFormat): boolean {
    if (!Object.hasOwn(REASON_CAPS, reason.key) || !Number.isFinite(reason.weight) || reason.weight <= 0) return false;
    if (reason.steps?.some(step => !reason.cards.includes(step.from) || !reason.cards.includes(step.to)) || reason.materials?.some(id => !reason.cards.includes(id))) return false;
    if (!reason.cards.length || reason.cards.some(id => !this.rows.has(id) || !bridgeLegal(this.rows.get(id)!.card, format))) return false;
    if (reason.evidence.length !== reason.cards.length || reason.cards.some((id, i) => reason.evidence[i] !== (printedText(this.rows.get(id)!.card) || this.rows.get(id)!.card.name))) return false;
    const cards = reason.cards.map(id => this.rows.get(id)!.card);
    if (reason.setup) {
      const setup = reason.setup, step = reason.steps?.[0], consumer = this.rows.get(setup.card);
      if (reason.key !== "synergy" || setup.capability !== "face_down_card" || !consumer || !reason.cards.includes(setup.card) || !reason.cards.includes(setup.using)
        || !setReturnSummonEvidence(consumer.card) || reason.steps?.length !== 1 || step?.capability !== "set_spell_trap" || step.to !== setup.using
        || !this.rows.get(step.from)!.provides.some(capability => extraDeckSetResources(capability)
          && matchesBridgeFilter(capability.filter!, this.rows.get(setup.using)!.card))) return false;
    }
    if (reason.key === "synergy" && !reason.setup) return false;
    if (reason.cost) {
      const cost = reason.cost, consumer = this.rows.get(cost.card), using = this.rows.get(cost.using);
      if (!consumer || !using || !reason.cards.includes(cost.card) || !reason.cards.includes(cost.using)
        || !consumer.needs.some(need => need.key === cost.capability && need.effect === cost.effect && need.filter
          && !need.filter.this_card && costCanUse(need, using.card) && actionEvidence(consumer.card, need.key, need.filter))
        || !reason.steps?.some(step => step.from === cost.card && consumer.provides.some(capability => capability.key === step.capability
          && capability.effect === cost.effect && capability.filter && matchesBridgeFilter(capability.filter, this.rows.get(step.to)!.card)))) return false;
    }
    if (reason.steps?.some(step => {
      if (!["special_summon", "normal_summon"].includes(step.capability)) return false;
      const from = this.rows.get(step.from)!, target = this.rows.get(step.to)!.card;
      if (step.capability === "special_summon" && !canReceiveSummon(target, printedText(from.card))) return true;
      if (step.capability === "normal_summon" && (isExtraDeckCard(target) || /Cannot be Normal Summoned\/Set/i.test(target.text))) return true;
      return from.locks.some(lock => {
        if (allowedByLock(lock, target)) return false;
        const effect = from.provides.find(capability => capability.key === step.capability && capability.filter && matchesBridgeFilter(capability.filter, target));
        const leavesBeforeResolution = lock.scope === "while_face_up" && from.provides.some(capability => capability.key === "self_removal" && capability.effect === effect?.effect);
        return !leavesBeforeResolution;
      });
    })) return false;
    if (reason.steps?.some(step => !this.rows.get(step.from)?.provides.some(capability => capability.key === step.capability && capability.filter && matchesBridgeFilter(capability.filter, this.rows.get(step.to)!.card) && actionEvidence(this.rows.get(step.from)!.card, step.capability, capability.filter)))) return false;
    if (reason.steps?.some(step => {
      if (step.capability !== "discard") return false;
      const setup = this.discardSetup(this.rows.get(step.from)!, this.rows.get(step.to)!.card, format);
      return !setup || setup.some(id => !reason.cards.includes(id));
    })) return false;
    if (reason.key === "profile") return cards.length >= 2 && this.providesNonEffect(cards[0]!) && this.requiresNonEffect(cards[1]!) && !!reason.steps?.some(step => step.to === cards[1]!.id);
    if (reason.key === "mention") return cards.some((card, i) => cards.some((other, j) => i !== j && (positiveMention(card, other.name) || !!other.archetype && mentionReachesCard(card, other.archetype, other))));
    if (reason.key === "rule_enabler") return trapTurnSetAllows(cards[0]!, cards[1]!) && (!!trapMonsterEvidence(cards[1]!)
      || cards[1]!.kind === "trap" && !!reason.steps?.some(step => step.to === cards[1]!.id && step.capability === "set_spell_trap"));
    if (reason.key === "face_down") return (cards[0]!.kind === "trap" || !!actionEvidence(cards[0]!, "set_spell_trap")) && !!faceDownNeedEvidence(cards[1]!);
    if (reason.key === "small_world") return cards[0]!.name === "Small World" && /exactly 1/i.test(cards[0]!.text) && sharedSmallWorldStats(cards[1]!, cards[2]!) === 1 && sharedSmallWorldStats(cards[2]!, cards[3]!) === 1;
    if (reason.key === "extra_deck") {
      const extra = cards.find(isExtraDeckCard);
      if (reason.materials?.length !== 1) return false;
      if (reason.materials?.some(id => !availableMaterial(this.rows.get(id)!.card))) return false;
      if (extra && reason.materials?.some(id => this.rows.get(id)!.locks.some(lock => lock.scope === "while_face_up" && !allowedByLock(lock, extra)))) return false;
      return !!extra && !!bridgeMaterials(extra, cards.filter(card => card.id !== extra.id), format) && (!reason.steps?.length || reason.steps.every(step => {
        const from = this.rows.get(step.from)!.card, to = this.rows.get(step.to)!.card;
        return namedIn(printedText(from), to.name) || !!to.archetype && namedIn(printedText(from), to.archetype);
      }));
    }
    return !!reason.steps?.length;
  }

  private providesNonEffect(card: Card): boolean {
    return card.kind === "monster" && !isExtraDeckCard(card) && availableMaterial(card) && (card.subtypes.includes("normal")
      || sentences(printedText(card)).some(text => /^If this card is (?:Normal|Normal or Special) Summoned\s*:/i.test(text) && /Special Summon[^.]*\bToken\b/i.test(text)));
  }

  private requiresNonEffect(card: Card): boolean {
    return /If you control a (?:face-up )?non-Effect Monster/i.test(printedText(card));
  }

  private discardsFromHand(row: CardCapability): boolean {
    return row.provides.some(capability => capability.key === "discard" && !capability.filter?.this_card && capability.from?.includes("hand"));
  }

  private frequencyScale(target: string, key: BridgeReasonKey, format: BridgeFormat): number {
    const frequency = this.data.reason_frequencies?.[format]?.[target]?.[key] ?? 0;
    return frequency > 0.05 ? 0.05 / frequency : 1;
  }

  private genericLinkOne(reason: BridgeReason): boolean {
    if (reason.key !== "extra_deck" || reason.materials?.length !== 1) return false;
    const extra = reason.cards.map(id => this.rows.get(id)!.card).find(isExtraDeckCard);
    return !!extra && genericLinkOneMaterial(extra, reason.materials);
  }

  /** Material availability is checked independently of strict outlet rarity. */
  private accessMaterials(source: Context, format: BridgeFormat): Context["extras"] {
    const key = `${format}:${source.name}`, cached = this.accessExtras.get(key);
    if (cached) return cached;
    const extras = [...source.extras];
    for (const [id, edges] of this.edgesFrom.get(format)!) {
      const card = this.rows.get(id)!.card;
      if (!isExtraDeckCard(card) || extras.some(extra => extra.id === id) || !edges.some(edge => edge.named)) continue;
      const materials = bridgeMaterials(card, source.monsters.filter(availableMaterial), format);
      if (materials?.length === 1) extras.push({ id, materials, weight: 0.25 });
    }
    this.accessExtras.set(key, extras);
    return extras;
  }

  /** A printed action must physically reach an engine member; shared setup alone cannot. */
  private accessPath(reason: BridgeReason, source: Context, target: Context, format: BridgeFormat): boolean {
    const steps = reason.steps;
    if (!steps?.length || ["searcher", "small_world", "face_down"].includes(reason.key)) return false;
    const edges = steps.map(step => this.edgesFrom.get(format)!.get(step.from)?.find(edge => edge.capability.key === step.capability && edge.targets.has(step.to)));
    if (edges.some(edge => !edge)) return false;
    const first = steps[0]!, last = steps.at(-1)!, landing = this.rows.get(last.to)!.card;
    if (reason.setup || reason.key === "synergy") return false;
    if (edges.some(edge => edge!.capability.key === "set_spell_trap" && (!setAccessOrigin(edge!.capability) || !narrowSetCapability(edge!.capability)))) return false;
    if (!target.ids.has(last.to) || source.ids.has(last.to) || !this.engineMember(landing, target, edges.at(-1)!.capability, source)) return false;
    if (steps.some((step, i) => i > 0 && steps[i - 1]!.to !== step.from)) return false;
    if (edges.some((edge, i) => ["special_summon", "normal_summon"].includes(edge!.capability.key)
      && negatedEntry(edge!.capability)
      && !this.rows.get(steps[i]!.to)!.card.subtypes.includes("normal"))) return false;
    if (reason.key === "rule_enabler") {
      return source.ids.has(reason.cards[0]!) && !!trapTurnSetEvidence(this.rows.get(reason.cards[0]!)!.card)
        && target.ids.has(first.from) && narrowSetCapability(edges[0]!.capability) && first.capability === "set_spell_trap"
        && !!edges[0]!.capability.from?.includes("deck") && landing.kind === "trap";
    }
    // A generic Tuner requirement cannot fan a named search out through hybrid
    // search results into unrelated engines. The named search package owns it.
    const search = edges[0]!.capability, filter = search.filter;
    const tunerCost = reason.cost && this.rows.get(reason.cost.card)!.needs.find(need => need.key === reason.cost!.capability
      && need.effect === reason.cost!.effect && costCanUse(need, this.rows.get(reason.cost!.using)!.card))?.filter;
    const genericTuner = [filter, tunerCost].some(value => value?.subtypes.includes("tuner") && !value.names.length && !value.archetypes.length);
    if (first.capability === "search" && search.from?.includes("deck") && genericTuner
      && !filter?.archetypes.some(name => [target.name, ...(this.data.group_policies?.[target.name]?.aliases ?? [])].some(alias => sameName(name, alias)))) return false;
    // An untyped discard or stat-only filter is never physical engine entry.
    if (first.capability === "discard" || !this.specificCapability(edges[0]!.capability, format)
      || !edges.some(edge => edge!.named || narrowSetCapability(edge!.capability))) return false;
    if (reason.materials?.length) return reason.materials.every(id => source.ids.has(id)) && this.validateReason(reason, format)
      && !edges.some(edge => /\b(?:if|while)[^:;]*\bequipped\b/i.test(edge!.capability.evidence));
    if (reason.cost) return source.ids.has(reason.cost.using) && this.validateReason(reason, format);
    return source.ids.has(first.from) && !isExtraDeckCard(this.rows.get(first.from)!.card);
  }

  validateAccessPath(reason: BridgeReason, source: string, target: string, format: BridgeFormat): boolean {
    this.prepare(format);
    const x = this.contexts.get(format)!.get(source), y = this.contexts.get(format)!.get(target);
    return !!x && !!y && !this.sameDeck(source, target) && this.validateReason(reason, format) && this.accessPath(reason, x, y, format);
  }

  validateSynergy(reason: BridgeReason, source: string, target: string, format: BridgeFormat): boolean {
    const from = this.groups.get(source), to = this.groups.get(target), step = reason.steps?.[0], setup = reason.setup;
    if (!from || !to || !step || !setup || !this.validateReason(reason, format) || reason.key !== "synergy"
      || !from.has(step.from) || !from.has(setup.using) || !to.has(setup.card) || from.has(setup.card)) return false;
    return this.rows.get(step.from)!.provides.some(capability => extraDeckSetResources(capability)
      && capability.targets?.includes(setup.using) && capability.targets.filter(id => from.has(id)).length >= 2);
  }

  private specificCapability(capability: Capability, format: BridgeFormat): boolean {
    const filter = capability.filter;
    if (!filter || filter.this_card) return false;
    if (capability.key === "set_spell_trap") return setAccessOrigin(capability) && narrowSetCapability(capability);
    if (filter.names.length || filter.archetypes.length) return true;
    if (!particularFilter(filter)) return false;
    if (!filter.level_min && !filter.level_max && !filter.subtypes.length && !filter.other
      && filter.types.length + filter.attributes.length <= 1) return false;
    let cache = this.specificFilters.get(format);
    if (!cache) this.specificFilters.set(format, cache = new WeakMap());
    if (!cache.has(capability)) {
      const legal = this.legal.get(format)!;
      const globalLegal = this.validationLegal?.(format);
      const matches = capability.targets ? capability.targets.filter(id => (globalLegal ?? legal).has(id)).length
        : globalLegal ? Infinity : [...legal.values()].filter(row => matchesBridgeFilter(filter, row.card)).length;
      cache.set(capability, matches <= (globalLegal ?? legal).size * 0.015);
    }
    return cache.get(capability)!;
  }

  private raw(reasons: BridgeReason[]): number {
    return Object.entries(REASON_CAPS).reduce((score, [key, cap]) => score + Math.min(cap, reasons.filter(reason => reason.key === key && !reason.alternative).reduce((sum, reason) => sum + reason.weight, 0)), 0);
  }

  private outlet(reason: BridgeReason): number {
    return reason.steps?.[0]?.from ?? reason.cards[0]!;
  }

  private statOutlet(reason: BridgeReason): boolean {
    const entry = reason.steps?.[0];
    if (!entry) return false;
    const capabilities = this.rows.get(entry.from)!.provides.filter(capability => capability.key === entry.capability
      && capability.filter && matchesBridgeFilter(capability.filter, this.rows.get(entry.to)!.card));
    return capabilities.some(capability => particularFilter(capability.filter!))
      && !capabilities.some(capability => capability.filter!.names.length || capability.filter!.archetypes.length);
  }

  private parentOrAliasFamily(a: string, b: string): boolean {
    const key = JSON.stringify([a, b].sort()), cached = this.parentOrAliasPairs.get(key);
    if (cached !== undefined) return cached;
    const names = (name: string) => [name, ...Object.entries(this.data.group_policies ?? {}).flatMap(([canonical, policy]) => {
      const aliases = [canonical, ...(policy.aliases ?? [])];
      return aliases.some(alias => sameName(alias, name)) ? aliases : [];
    })];
    const x = this.groups.get(a), y = this.groups.get(b);
    const left = names(a), right = names(b);
    // Parent/alias identity uses names and shared membership, including a
    // shared named parent (HERO for its subgroups), not the
    // two-way naming rates used to merge complete deck families.
    const same = !!x && !!y && this.groupOverlap(a, b) >= 0.5 * Math.min(x.size, y.size)
      || left.some(a => right.some(b => wordIn(a, b) || wordIn(b, a)))
      || this.names.some(parent => left.some(name => wordIn(parent, name)) && right.some(name => wordIn(parent, name)));
    this.parentOrAliasPairs.set(key, same);
    return same;
  }

  private engineMember(card: Card, target: Context, via?: Capability, source?: Context): boolean {
    // A source-family card cannot establish a second engine through its name
    // or printed references, even when it is in the target's member index.
    if (source && card.archetype && this.parentOrAliasFamily(source.name, card.archetype)) return false;
    if (target.members.has(card.id)) return true;
    const names = [target.name, ...(this.data.group_policies?.[target.name]?.aliases ?? [])];
    if (!card.archetype || !via?.filter?.archetypes.some(name => !this.data.group_policies?.[name]?.excluded
      && sameName(name, card.archetype!)) || !groupNameIn(card, target.name, names.slice(1))) return false;
    return names.some(name => sameName(name, card.archetype!))
      || !!source;
  }

  private substantive(reason: BridgeReason, target: Context, source: Context, format: BridgeFormat): boolean {
    if (reason.ancillary) return false;
    if (reason.setup || ["searcher", "small_world", "type_support", "face_down", "synergy"].includes(reason.key)) return false;
    // Access to a Toon version of another engine's monster needs evidence
    // supplying its named field setup, rather than just the shared name.
    const toonNeeds = reason.cards.map(id => this.rows.get(id)!.card)
      .filter(card => target.ids.has(card.id) && !source.ids.has(card.id) && card.subtypes.includes("toon"))
      .flatMap(card => [...printedText(card).matchAll(/\b(?:if|while) you control ["“]([^"”]+)["”]/gi)].map(match => match[1]!));
    if (toonNeeds.length && !reason.cards.some(id => {
      const row = this.rows.get(id)!;
      if (row.card.subtypes.includes("toon")) return false;
      return toonNeeds.some(name => sameName(row.card.name, name) || sentences(printedText(row.card))
        .some(text => /name becomes|treated as/i.test(text) && namedIn(text, name)))
        || row.provides.some(capability => ["search", "place_on_field", "set_spell_trap"].includes(capability.key)
          && capability.from?.includes("deck") && capability.filter && actionEvidence(row.card, capability.key, capability.filter)
          && target.cards.some(card => toonNeeds.some(name => sameName(card.name, name)) && matchesBridgeFilter(capability.filter!, card)));
    })) return false;
    if (reason.key === "rule_enabler") return reason.weight > 2 && reason.cards.length >= 3;
    if (reason.key === "mention") {
      // API labels alone can put unrelated support in a name bucket. A
      // mention outlet must also have a printed connection to either engine.
      const outlet = this.outlet(reason);
      if (!this.data.group_policies?.[source.name]?.curated && !source.members.has(outlet) && !target.members.has(outlet)) return false;
      return reason.cards.some(id => target.ids.has(id) && !source.ids.has(id)
        && this.engineMember(this.rows.get(id)!.card, target, undefined, source));
    }
    if (reason.key === "reach" || reason.key === "gy_fuel") {
      const entry = reason.steps?.[0];
      if (reason.key === "gy_fuel" && entry?.capability === "discard") {
        return source.discardRate >= 0.2 && target.discardTriggerRate >= 1 / 3
          && source.cards.filter(card => this.discardsFromHand(this.rows.get(card.id)!)).length >= 3;
      }
      const capability = entry && this.rows.get(entry.from)!.provides.find(capability => capability.key === entry.capability
        && capability.filter && matchesBridgeFilter(capability.filter, this.rows.get(entry.to)!.card)
        && this.specificCapability(capability, format));
      if (!capability) return false;
      if (reason.key === "reach") {
        const landing = reason.steps!.at(-1)!;
        const card = this.rows.get(landing.to)!.card;
        const via = this.rows.get(landing.from)!.provides.find(capability => capability.key === landing.capability
          && capability.filter && matchesBridgeFilter(capability.filter, card));
        if (!target.ids.has(card.id) || !this.engineMember(card, target, via, source)) return false;
      }
      if (reason.key === "gy_fuel") return true;
      // A narrow stat search still needs engine entry or a concrete payoff.
      const namedEntry = reason.steps!.some(step => this.rows.get(step.from)!.provides.some(capability => capability.key === step.capability
        && capability.filter && matchesBridgeFilter(capability.filter, this.rows.get(step.to)!.card)
        && (capability.filter.names.length || capability.filter.archetypes.length)));
      const discardPayoff = this.rows.get(entry!.from)!.provides.some(other => other.key === "discard" && other.effect === capability.effect && other.from?.includes("hand"))
        && target.cards.some(card => this.rows.get(card.id)!.needs.some(need => need.key === "trigger" && need.value === "discard"));
      return namedEntry || discardPayoff;
    }
    if (reason.key === "extra_deck") {
      if (this.genericLinkOne(reason)) return false;
      const extra = reason.cards.map(id => this.rows.get(id)!.card).find(isExtraDeckCard);
      const materialText = extra?.text.split(/[\r\n]/)[0] ?? "";
      if (/\bor\b/i.test(materialText)) {
        const types = new Map<string, number>();
        for (const card of target.monsters) if (card.monsterType) types.set(card.monsterType, (types.get(card.monsterType) ?? 0) + 1);
        const dominant = [...types].sort((a, b) => b[1] - a[1])[0];
        if (dominant && dominant[1] > target.monsters.length / 2 && reason.materials?.every(id => this.rows.get(id)!.card.monsterType === dominant[0])) return false;
      }
    }
    return true;
  }

  between(source: string, target: string, format: BridgeFormat = "advanced", access = false): ArchetypeBridge | null {
    const x = this.resolve(source), y = this.resolve(target);
    if (!x || !y) return null;
    const reasons = this.reasons(x, y, format, access);
    if (!reasons.length) return null;
    const sourceContext = this.contexts.get(format)!.get(x)!, targetContext = this.contexts.get(format)!.get(y)!;
    const qualifications = new Map<BridgeReason, boolean>();
    const qualifies = (reason: BridgeReason) => {
      if (!qualifications.has(reason)) qualifications.set(reason, access ? this.accessPath(reason, sourceContext, targetContext, format)
        : this.substantive(reason, targetContext, sourceContext, format));
      return qualifications.get(reason)!;
    };
    const practicality = (reason: BridgeReason) => {
      if (!qualifies(reason)) return 20;
      if (reason.materials?.length || reason.cost) return 6;
      if (reason.key === "rule_enabler") return 2;
      const step = reason.steps?.[0];
      if (!step) return 10;
      const capability = this.rows.get(step.from)!.provides.find(cap => cap.key === step.capability && cap.filter && matchesBridgeFilter(cap.filter, this.rows.get(step.to)!.card));
      return ["search", "set_spell_trap", "special_summon", "normal_summon", "place_on_field"].includes(step.capability)
        ? capability?.from?.includes("deck") ? 0 : 1 : 5;
    };
    const ordered = reasons.map(reason => ({ reason, rank: practicality(reason) })).sort((a, b) => a.rank - b.rank
      || b.reason.weight - a.reason.weight || Number(!!a.reason.alternative) - Number(!!b.reason.alternative)
      || a.reason.description.localeCompare(b.reason.description)).map(entry => entry.reason);
    const primary = ordered.find(qualifies);
    if (!primary) return null;
    const otherReasons = ordered.filter(reason => reason !== primary && !["searcher", "small_world"].includes(reason.key) && (!this.genericLinkOne(reason) || access)
      && (reason.key !== "type_support" || reason.cards.every(id => primary.cards.includes(id))));
    const selectedReasons = [primary];
    const outletsSeen = new Set([this.outlet(primary)]);
    // First give distinct practical outlets a slot, then distinct recipients of
    // those outlets. A redundant naming reason cannot crowd out a physical path.
    const physical = otherReasons.filter(reason => qualifies(reason) && reason.steps?.length);
    for (const pool of [physical, otherReasons.filter(reason => !physical.includes(reason))]) for (const distinctOutlet of [true, false]) for (const reason of pool) {
      if (selectedReasons.length >= 4 || selectedReasons.includes(reason)) continue;
      const identity = (value: BridgeReason) => JSON.stringify([value.steps ?? [value.key, value.cards], value.materials, value.cost, value.setup]);
      const samePath = selectedReasons.some(other => identity(other) === identity(reason));
      if (samePath || distinctOutlet && outletsSeen.has(this.outlet(reason))) continue;
      selectedReasons.push(reason); outletsSeen.add(this.outlet(reason));
    }
    const cards = [...new Set(selectedReasons.flatMap(reason => reason.cards))].sort((a, b) => a - b);
    const sourcePolicy = this.data.group_policies?.[x];
    if (!sourcePolicy?.curated && !cards.some(id => {
      const archetype = this.rows.get(id)!.card.archetype;
      return archetype && [x, ...(sourcePolicy?.aliases ?? [])].some(name => sameName(name, archetype));
    })) return null;
    // API group labels can include thematic outsiders (for example a named
    // story card). Evidence must reach an actual member of the target engine.
    const targetCards = this.contexts.get(format)!.get(y)!.cards;
    const namedMembers = targetCards.filter(card => groupNameIn(card, y, this.data.group_policies?.[y]?.aliases));
    const members = new Set((namedMembers.length ? namedMembers : targetCards).map(card => card.id));
    if (!cards.some(id => members.has(id))) return null;
    const warnings = new Set<string>();
    let penalty = 0;
    const reviewedLocks = new Set<string>();
    for (const id of primary.cards) for (const lock of this.rows.get(id)!.locks) {
      const reason = primary;
      const lockKey = `${id}:${lock.evidence}`;
      if (reviewedLocks.has(lockKey)) continue;
      const activated = selectedReasons.some(reason => reason.steps?.some(step => step.from === id))
        || reason.key === "rule_enabler" && reason.cards[0] === id
        || reason.key === "face_down" && reason.cards[0] === id;
      const summonedUnderWholeTurnCondition = lock.scope === "whole_turn_cost" && /turn you (?:Special |Normal )?Summon/i.test(lock.evidence)
        && reason.steps?.some(step => step.to === id);
      if (!activated && !summonedUnderWholeTurnCondition) continue;
      reviewedLocks.add(lockKey);
      const summoned = reason.cards.filter(other => other !== id && this.rows.get(other)!.card.kind === "monster");
      const blocked = summoned.some(other => !allowedByLock(lock, this.rows.get(other)!.card));
      if (lock.unresolved) { warnings.add(`${this.rows.get(id)!.card.name}: unresolved Summon restriction`); penalty += 8; }
      else if (lock.scope === "while_face_up" && lock.self_removal) warnings.add(`${this.rows.get(id)!.card.name}: restriction applies while face-up; its self-removal ends it`);
      else if (blocked) {
        // Rest-of-turn restrictions permit the other engine to play first.
        penalty += lock.scope === "whole_turn_cost" ? 12 : lock.scope === "while_face_up" ? 6 : 0;
        warnings.add(`${this.rows.get(id)!.card.name}: ${lock.scope === "rest_of_turn_after_activation" ? "use the other engine before activating this restriction" : lock.evidence}`);
      }
    }
    const reverseReach = access ? this.reasons(y, x, format, true).some(reason => this.accessPath(reason, this.contexts.get(format)!.get(y)!, this.contexts.get(format)!.get(x)!, format))
      : this.raw(this.reasons(y, x, format)) >= 4;
    const raw = this.raw(reasons), mean = this.data.target_means[format][y] ?? 0;
    const score = round(Math.min(100, Math.max(0, raw - 0.6 * mean + (reverseReach ? 2 : 0) - Math.min(20, penalty))));
    if (!access && score < 4) return null;
    // Multiple mentions and actions from one hybrid card are still one outlet.
    const outlets = new Set(selectedReasons.filter(reason => !reason.ancillary).map(reason => this.outlet(reason)));
    const copies = new Map(cards.map(id => [id, Math.max(1, ...selectedReasons.map(reason => reason.materials?.filter(code => code === id).length ?? 0))]));
    const points = format === "genesys" ? cards.reduce((sum, id) => sum + this.rows.get(id)!.card.genesysPoints! * copies.get(id)!, 0) : null;
    warnings.add("Card text conditions and costs apply; the line has not been engine-verified");
    return { source: x, target: y, format, score, raw_score: round(raw), target_mean: round(mean), two_way: access && reverseReach,
      ...(access ? { tier: "niche" as const } : {}),
      grade: access ? "Niche" : penalty >= 8 ? "Risky" : score >= 20 && outlets.size >= 2 ? "Strong" : score >= 8 ? "Good" : "Niche",
      reasons: selectedReasons, cards, warnings: [...warnings], genesys_points: points,
      validation: "deterministic", judge: "pending", engine_status: "unverified",
      evidence_hash: bridgeHash({ cards: [...new Set(reasons.flatMap(reason => reason.cards))].sort((a, b) => a - b).map(id => [id, this.rows.get(id)!.text_hash, this.rows.get(id)!.evidence_hash]), reasons: reasons.map(reason => [reason.key, reason.cards, reason.steps, reason.materials]), format,
        ...(access ? { tier: "niche", costs: reasons.map(reason => reason.cost) } : {}),
        ...(reasons.some(reason => reason.setup) ? { setups: reasons.map(reason => reason.setup) } : {}) }) };
  }

  deepBetween(source: string, target: string, format: BridgeFormat = "advanced"): ArchetypeBridge | null {
    return this.between(source, target, format) ?? this.between(source, target, format, true);
  }

  /** Resource generation helps the target's printed procedure without reaching its engine. */
  synergyBetween(source: string, target: string, format: BridgeFormat = "advanced"): ArchetypeBridge | null {
    const x = this.resolve(source), y = this.resolve(target);
    if (!x || !y || x === y || this.sameDeck(x, y)) return null;
    this.prepare(format);
    const from = this.contexts.get(format)!.get(x), to = this.contexts.get(format)!.get(y);
    if (!from || !to) return null;
    for (const edge of from.edges.filter(edge => extraDeckSetResources(edge.capability))) {
      const resources = from.cards.filter(card => edge.targets.has(card.id));
      // At least two distinct source resources can be produced by the same effect.
      if (resources.length < 2) continue;
      const consumer = to.cards.find(card => !from.ids.has(card.id) && setReturnSummonEvidence(card) && this.engineMember(card, to, undefined, from));
      if (!consumer) continue;
      const using = resources[0]!, cards = [...new Set([edge.from, ...resources.slice(0, 2).map(card => card.id), consumer.id])];
      const reason: BridgeReason = { key: "synergy", weight: 3, cards,
        evidence: cards.map(id => printedText(this.rows.get(id)!.card)),
        description: `${this.rows.get(edge.from)!.card.name} generates extra Set cards from Deck; reveal and return ${using.name} to Special Summon ${consumer.name} from hand`,
        steps: [{ from: edge.from, to: using.id, capability: "set_spell_trap" }],
        setup: { card: consumer.id, using: using.id, capability: "face_down_card" } };
      if (!this.validateReason(reason, format)) continue;
      return { kind: "synergy", tier: "niche", source: x, target: y, format, score: 3, raw_score: 3, target_mean: 0,
        two_way: false, grade: "Niche", reasons: [reason], cards, warnings: ["Requires a target card in hand; this resource interaction does not access the target engine."],
        genesys_points: format === "genesys" ? cards.reduce((sum, id) => sum + this.rows.get(id)!.card.genesysPoints!, 0) : null,
        validation: "deterministic", judge: "pending", engine_status: "unverified",
        evidence_hash: bridgeHash({ kind: "synergy", source: x, target: y, format, reason,
          cards: cards.map(id => [id, this.rows.get(id)!.text_hash, this.rows.get(id)!.evidence_hash]) }) };
    }
    return null;
  }

  deepCandidates(source: string, format: BridgeFormat = "advanced", progress?: (progress: BridgeProgress) => void, distinct = true): ArchetypeBridge[] {
    this.prepare(format);
    const results: ArchetypeBridge[] = [];
    for (const [i, target] of this.names.entries()) {
      const row = this.deepBetween(source, target, format) ?? this.synergyBetween(source, target, format);
      if (row) results.push(row);
      if (i % 20 === 0) progress?.({ phase: "score", completed: i, total: this.names.length });
    }
    progress?.({ phase: "done", completed: this.names.length, total: this.names.length });
    return distinct ? this.deepTargets(results, results.length) : results;
  }

  deepInto(target: string, format: BridgeFormat = "advanced", progress?: (progress: BridgeProgress) => void): ArchetypeBridge[] {
    this.prepare(format);
    const results: ArchetypeBridge[] = [];
    for (const [i, source] of this.names.entries()) {
      const row = this.deepBetween(source, target, format) ?? this.synergyBetween(source, target, format);
      if (row) results.push(row);
      if (i % 20 === 0) progress?.({ phase: "score", completed: i, total: this.names.length });
    }
    progress?.({ phase: "done", completed: this.names.length, total: this.names.length });
    return results;
  }

  liveCandidates(source: string, format: BridgeFormat = "advanced", progress?: (progress: BridgeProgress) => void): ArchetypeBridge[] {
    progress?.({ phase: "index", completed: 0, total: this.names.length });
    this.prepare(format);
    const results: ArchetypeBridge[] = [];
    for (const [i, target] of this.names.entries()) {
      const row = this.between(source, target, format);
      if (row && row.score > 0) results.push(row);
      if (i % 20 === 0) progress?.({ phase: "score", completed: i, total: this.names.length });
    }
    progress?.({ phase: "done", completed: this.names.length, total: this.names.length });
    return this.distinctTargets(results, results.length, false);
  }

  rebuild(progress?: (progress: BridgeProgress) => void): ArchetypeBridge[] {
    const rows: ArchetypeBridge[] = [];
    for (const format of ["advanced", "genesys"] as const) {
      this.prepare(format);
      this.data.reason_frequencies ??= { advanced: {}, genesys: {} };
      this.data.reason_frequencies[format] = {};
      this.data.ancillary_outlets ??= { advanced: {}, genesys: {} };
      this.data.ancillary_outlets[format] = {};
      this.pairCache.clear();
      const counts: Record<string, Partial<Record<BridgeReasonKey, number>>> = {};
      const outletTargets = this.collectingOutlets = new Map<number, Map<BridgeReasonKey, Set<string>>>();
      const contributions = new Map<string, Map<string, BridgeReason[]>>();
      for (const [i, source] of this.names.entries()) {
        const values = new Map<string, BridgeReason[]>();
        for (const target of this.names) {
          const reasons = this.reasons(source, target, format);
          if (!reasons.length) continue;
          values.set(target, reasons);
        }
        contributions.set(source, values);
        progress?.({ phase: "score", completed: i + 1, total: this.names.length });
      }
      this.collectingOutlets = undefined;
      this.data.ancillary_outlets[format] = Object.fromEntries([...outletTargets].map(([id, keys]) =>
        [id, [...keys].filter(([, targets]) => targets.size >= 3).map(([key]) => key)]).filter(([, keys]) => (keys as BridgeReasonKey[]).length));
      for (const [source, targets] of contributions) for (const [target, reasons] of targets) {
        for (const reason of reasons) if (this.statOutlet(reason) && this.data.ancillary_outlets[format][this.outlet(reason)]?.includes(reason.key)) {
          reason.ancillary = true;
        }
        const contexts = this.contexts.get(format)!;
        if (!reasons.some(reason => this.substantive(reason, contexts.get(target)!, contexts.get(source)!, format))) { targets.delete(target); continue; }
        for (const key of new Set(reasons.map(reason => reason.key))) {
          const frequency = counts[target] ??= {};
          frequency[key] = (frequency[key] ?? 0) + 1;
        }
      }
      this.data.reason_frequencies[format] = Object.fromEntries(Object.entries(counts).map(([target, keys]) => [target,
        Object.fromEntries(Object.entries(keys).map(([key, count]) => [key, count / Math.max(1, this.names.length - 1)]))]));
      this.pairCache.clear();
      const totals = new Map<string, number>();
      const scores = new Map([...contributions].map(([source, targets]) => [source, new Map([...targets].map(([target, reasons]) => {
        const score = this.raw(reasons.map(reason => {
          const weight = round(reason.weight * this.frequencyScale(target, reason.key, format));
          return { ...reason, weight: this.statOutlet(reason) && this.data.ancillary_outlets![format][this.outlet(reason)]?.includes(reason.key) ? Math.min(1, weight) : weight };
        }));
        totals.set(target, (totals.get(target) ?? 0) + score);
        return [target, score] as const;
      }))]));
      this.data.target_means[format] = Object.fromEntries(this.names.map(name => [name, (totals.get(name) ?? 0) / Math.max(1, this.names.length - 1)]));
      for (const [i, source] of this.names.entries()) {
        const upperBounds = [...scores.get(source)!].filter(([, raw]) => raw > 0)
          .map(([target, raw]) => ({ target, bound: raw - 0.6 * this.data.target_means[format][target]! + 2 }))
          .sort((a, b) => b.bound - a.bound || a.target.localeCompare(b.target));
        const candidates: ArchetypeBridge[] = [];
        let top: ArchetypeBridge[] = [];
        for (const { target, bound } of upperBounds) {
          if (top.length === 25 && round(bound) < top[24]!.score) break;
          const row = this.between(source, target, format);
          if (row && row.score > 0) {
            candidates.push(row);
            top = this.distinctTargets(candidates);
          }
        }
        rows.push(...top);
        progress?.({ phase: "validate", completed: i + 1, total: this.names.length });
      }
    }
    // Strict normalization above deliberately never sees deep-only evidence.
    const strict = [...rows];
    for (const format of ["advanced", "genesys"] as const) for (const [i, source] of this.names.entries()) {
      const existing = strict.filter(row => row.source === source && row.format === format);
      rows.push(...this.deepTargets([...existing, ...this.deepCandidates(source, format).filter(row => row.tier === "niche")], 25)
        .filter(row => row.tier === "niche"));
      progress?.({ phase: "validate", completed: i + 1, total: this.names.length });
    }
    return rows;
  }
}

/** Shared reach index over the complete legal-identity universe, before format exclusions. */
export function indexBridgeCapabilities(rows: CardCapability[]): void {
  const indexes = new Map<string, Card[]>(), byName = new Map<string, Card[]>();
  const add = (key: string, card: Card) => { if (!indexes.has(key)) indexes.set(key, []); indexes.get(key)!.push(card); };
  for (const { card } of rows) {
    add(`kind:${card.kind}`, card); add(`type:${card.monsterType}`, card); add(`attribute:${card.attribute}`, card);
    byName.set(card.name.toLowerCase(), [card]);
  }
  const all = rows.map(row => row.card), cache = new Map<string, number[]>();
  for (const row of rows) for (const capability of row.provides) {
    const filter = capability.filter;
    if (!filter || filter.this_card || !edgeKeys.has(capability.key) || !particularFilter(filter)) continue;
    const key = JSON.stringify(filter);
    let targets = cache.get(key);
    if (!targets) {
      const pools = [filter.names.length ? filter.names.flatMap(name => byName.get(name.toLowerCase()) ?? []) : all,
        filter.types.length ? filter.types.flatMap(type => indexes.get(`type:${type}`) ?? []) : all,
        filter.attributes.length ? filter.attributes.flatMap(attribute => indexes.get(`attribute:${attribute}`) ?? []) : all,
        filter.kinds.length ? filter.kinds.flatMap(kind => indexes.get(`kind:${kind}`) ?? []) : all];
      targets = pools.sort((a, b) => a.length - b.length)[0]!.filter(card => matchesBridgeFilter(filter, card)).map(card => card.id);
      cache.set(key, targets);
    }
    capability.targets = targets;
  }
}

export function bridgeGroups(capabilities: readonly CardCapability[], profiles: ReadonlyMap<string, ArchetypeProfile>, policies: BridgeGraphData["group_policies"] = {}): Record<string, number[]> {
  const groups: Record<string, number[]> = {};
  for (const { card } of capabilities) {
    if (card.archetype && profiles.has(card.archetype)) (groups[card.archetype] ??= []).push(card.id);
    for (const [name, policy] of Object.entries(policies)) {
      const include = policy.include;
      if (include?.names?.some(value => sameName(card.name, value)) || include?.mentions?.some(value => namedIn(printedText(card), value))
        || include?.name_patterns?.some(pattern => new RegExp(pattern, "i").test(card.name))) (groups[name] ??= []).push(card.id);
    }
  }
  const canonical = new Map<string, string>(), merged: Record<string, number[]> = {};
  for (const [name, ids] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
    const key = canonical.get(name.toLowerCase()) ?? name;
    canonical.set(name.toLowerCase(), key);
    merged[key] = [...new Set([...(merged[key] ?? []), ...ids])];
  }
  for (const [name, policy] of Object.entries(policies)) for (const alias of policy.aliases ?? []) {
    if (merged[alias]) {
      merged[name] = [...new Set([...(merged[name] ?? []), ...merged[alias]!])];
      delete merged[alias];
    }
  }
  return groundBridgeGraph({ groups: engineGroups(merged, capabilities, policies), capabilities: [...capabilities], target_means: { advanced: {}, genesys: {} } }).groups;
}
