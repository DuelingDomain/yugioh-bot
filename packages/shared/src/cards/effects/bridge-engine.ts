import { ATTRIBUTES, MONSTER_TYPES, isBarredFromGenesys, isExtraDeckCard, type Card } from "./card.js";
import type { ArchetypeProfile } from "./synergy.js";
import type { Capability, CapabilityKey, CardCapability, BridgeFormat, BridgeGraphData, BridgeProgress, ArchetypeBridge, BridgeReason, BridgeReasonKey } from "./bridge-types.js";
import { REASON_CAPS } from "./bridge-types.js";
import { actionEvidence, allowedByLock, bridgeHash, canReceiveSummon, faceDownNeedEvidence, matchesBridgeFilter, mentionReachesCard, namedIn, particularFilter, positiveMention, printedText, quotedNames, sameName, sharedSmallWorldStats, trapMonsterEvidence, trapTurnSetEvidence } from "./bridge-text.js";
import { bridgeMaterials } from "./bridge-materials.js";

export function bridgeLegal(card: Card, format: BridgeFormat): boolean {
  if (!card.formats.includes("TCG") || card.prerelease || card.subtypes.includes("token")) return false;
  return format === "advanced" ? card.banTcg !== "Forbidden"
    : !isBarredFromGenesys(card) && !/Must (?:first )?be Special Summoned[^.]*\b(?:Link|Pendulum)\b/i.test(card.text) && Number.isSafeInteger(card.genesysPoints) && card.genesysPoints! >= 0;
}

const edgeKeys = new Set<CapabilityKey>(["search", "special_summon", "normal_summon", "set_spell_trap", "place_on_field", "send_to_gy", "discard"]);
type Edge = { from: number; capability: Capability; targets: Set<number>; named: boolean; weight: number };
interface Context { ids: Set<number>; cards: Card[]; monsters: Card[]; edges: Edge[]; searchers: Edge[]; extras: { id: number; materials: number[]; weight: number }[] }
const round = (value: number) => Math.round(value * 100) / 100;

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
  private readonly names: string[];

  constructor(readonly data: BridgeGraphData) {
    this.rows = new Map(data.capabilities.map(row => [row.id, row]));
    this.groups = new Map(Object.entries(data.groups).map(([name, ids]) => [name, new Set(ids)]));
    this.names = [...this.groups.keys()].sort();
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
      const targets = new Set(candidates.filter(target => target !== id && legal.has(target) && (capability.targets || matchesBridgeFilter(f, legal.get(target)!.card))
        && (capability.key !== "special_summon" || summonable.has(target))
        && (capability.key !== "normal_summon" || normalSummonable.has(target))
        && (!capability.from?.length || capability.from.some(zone => zone === "deck" ? !isExtraDeckCard(legal.get(target)!.card) : zone === "extra_deck" ? isExtraDeckCard(legal.get(target)!.card) : true))));
      if (!targets.size) continue;
      const named = !!(f.names.length || f.archetypes.length);
      // Large generic effects are toolboxes, not evidence of an engine connection.
      if (!named && targets.size >= 300) continue;
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
      contexts.set(name, { ids, cards, monsters, edges: cards.flatMap(card => edgesFrom.get(card.id) ?? []),
        searchers: [...new Set(monsters.flatMap(card => searchersByTarget.get(card.id) ?? []))].filter(edge => !ids.has(edge.from)), extras: [] });
    }
    const active = [...contexts.values()].filter(context => context.ids.size >= 3);
    if (Object.keys(this.data.materials?.[format] ?? {}).length) {
      for (const [name, extras] of Object.entries(this.data.materials![format])) if (contexts.has(name)) contexts.get(name)!.extras = extras;
    } else for (const [id, row] of legal) {
      if (!isExtraDeckCard(row.card)) continue;
      if (!edgesFrom.get(id)?.some(edge => edge.named && [...edge.targets].some(target => [...contexts.values()].some(context => context.ids.has(target))))) continue;
      const made = active.flatMap(context => { const materials = bridgeMaterials(row.card, context.monsters, format); return materials ? [{ context, materials }] : []; });
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

  reasons(source: string, target: string, format: BridgeFormat): BridgeReason[] {
    this.prepare(format);
    const cacheKey = `${format}:${source}:${target}`, cached = this.pairCache.get(cacheKey);
    if (cached) return cached;
    const contexts = this.contexts.get(format)!, x = contexts.get(source), y = contexts.get(target);
    if (!x || !y || x.ids.size < 3 || y.ids.size < 3 || source === target) return [];
    const onlyY = y.cards.filter(card => !x.ids.has(card.id));
    if (!onlyY.length) return [];
    const legal = this.legal.get(format)!, rows = this.rows, reasons: BridgeReason[] = [];
    const add = (key: BridgeReasonKey, weight: number, ids: number[], description: string, steps?: BridgeReason["steps"], materials?: number[]) => {
      const cards = [...new Set(ids)];
      const reason: BridgeReason = { key, weight: round(weight), cards,
        evidence: cards.map(id => printedText(rows.get(id)!.card) || rows.get(id)!.card.name), description, ...(steps ? { steps } : {}), ...(materials ? { materials } : {}) };
      if (this.validateReason(reason, format)) reasons.push(reason);
    };
    for (const card of x.cards) {
      for (const other of onlyY) {
        if (positiveMention(card, other.name) || mentionReachesCard(card, target, other)) add("mention", 6, [card.id, other.id], `${card.name} names ${positiveMention(card, other.name) ? other.name : target}`);
        // Reverse references establish a directed need for X, not a free reverse effect.
        if (positiveMention(other, card.name)) add("mention", 4, [card.id, other.id], `${other.name} needs or supports ${card.name}`);
      }
    }
    for (const edge of x.edges) {
      if (isExtraDeckCard(rows.get(edge.from)!.card)) continue;
      const hit = onlyY.filter(card => edge.targets.has(card.id));
      if (!hit.length) continue;
      const card = rows.get(edge.from)!.card, to = hit[0]!;
      add("reach", edge.weight * Math.min(1, hit.length / 3 + 0.4), [card.id, to.id], `${card.name}: ${edge.capability.key} → ${to.name}`, [{ from: card.id, to: to.id, capability: edge.capability.key }]);
      if (["send_to_gy", "discard"].includes(edge.capability.key) && rows.get(to.id)!.provides.some(capability => capability.key === "gy_effect")) add("gy_fuel", 3, [card.id, to.id], `${card.name} supplies the GY effect of ${to.name}`, [{ from: card.id, to: to.id, capability: edge.capability.key }]);
      if (!edge.named && (edge.capability.filter!.types.length || edge.capability.filter!.attributes.length || edge.capability.filter!.level_min || edge.capability.filter!.level_max)) add("type_support", Math.min(1.5, 1.5 * hit.length / Math.max(1, onlyY.filter(card => card.kind === "monster").length)), [card.id, to.id], `${card.name} supports the printed Type, Attribute or Level of ${to.name}`, [{ from: card.id, to: to.id, capability: edge.capability.key }]);
    }
    const enabler = x.cards.find(card => trapTurnSetEvidence(card));
    const traps = onlyY.filter(card => trapMonsterEvidence(card) && !/cannot (?:be )?activated? (?:the|this) turn/i.test(printedText(card)));
    if (enabler && traps.length) {
      const trap = traps[0]!;
      add("rule_enabler", Math.min(3, traps.length * 0.5) + Math.min(7, traps.length * 2.5), [enabler.id, trap.id], `${enabler.name} lets you activate a ${target} Trap the turn it is Set (${traps.length} compatible Traps)`);
    }
    const needs = onlyY.filter(card => faceDownNeedEvidence(card));
    const supplies = x.cards.filter(card => rows.get(card.id)!.provides.some(capability => capability.key === "set_spell_trap" && !capability.filter?.this_card && capability.from?.some(zone => zone === "deck" || zone === "gy")));
    if (needs.length && supplies.length) add("face_down", Math.min(8, 12 * needs.length / onlyY.length) * Math.min(1, supplies.length / 3), [supplies[0]!.id, needs[0]!.id], `${supplies[0]!.name} supplies a Set card used by ${needs[0]!.name}`);
    const discard = x.cards.find(card => rows.get(card.id)!.provides.some(capability => capability.key === "discard" && !capability.filter?.this_card && capability.from?.includes("hand")));
    const discardTriggers = onlyY.filter(card => rows.get(card.id)!.needs.some(capability => capability.key === "trigger" && capability.value === "discard")
      && /If this card is discarded[^.:]*(?:effect)?\s*:/i.test(card.text) && !/discarded[^.:]*opponent/i.test(card.text));
    if (discard && discardTriggers.length) add("gy_fuel", Math.min(6, discardTriggers.length * 2), [discard.id, discardTriggers[0]!.id], `${discard.name} can trigger ${discardTriggers[0]!.name} by discarding it as an effect`, [{ from: discard.id, to: discardTriggers[0]!.id, capability: "discard" }]);
    for (const extra of x.extras) {
      const card = legal.get(extra.id)!.card;
      const materialText = card.text.split(/[\r\n]/)[0]!;
      const specificMaterial = quotedNames(materialText).length || [...MONSTER_TYPES, ...ATTRIBUTES].some(value => materialText.includes(value));
      if (!specificMaterial && extra.weight < 0.6) continue;
      for (const edge of this.edgesFrom.get(format)!.get(extra.id) ?? []) {
        const hit = onlyY.filter(other => edge.targets.has(other.id));
        if (!hit.length || !edge.named) continue;
        const focus = Math.min(1, 2 * hit.length / edge.targets.size);
        add("extra_deck", 6 * extra.weight * focus, [...extra.materials, extra.id, hit[0]!.id], `${rows.get(extra.materials[0]!)!.card.name} → ${card.name} → ${hit[0]!.name}`, [{ from: extra.id, to: hit[0]!.id, capability: edge.capability.key }], extra.materials);
      }
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
      const identity = JSON.stringify([reason.key, reason.cards, reason.steps, reason.materials]);
      if (seen.has(identity)) return false;
      seen.add(identity); return true;
    });
    const retained = unique.some(reason => this.substantive(reason, y)) ? unique : [];
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
    if (reason.key === "mention") return cards.some((card, i) => cards.some((other, j) => i !== j && (positiveMention(card, other.name) || !!other.archetype && mentionReachesCard(card, other.archetype, other))));
    if (reason.key === "rule_enabler") return !!trapTurnSetEvidence(cards[0]!) && !!trapMonsterEvidence(cards[1]!);
    if (reason.key === "face_down") return (cards[0]!.kind === "trap" || !!actionEvidence(cards[0]!, "set_spell_trap")) && !!faceDownNeedEvidence(cards[1]!);
    if (reason.key === "small_world") return cards[0]!.name === "Small World" && /exactly 1/i.test(cards[0]!.text) && sharedSmallWorldStats(cards[1]!, cards[2]!) === 1 && sharedSmallWorldStats(cards[2]!, cards[3]!) === 1;
    if (reason.key === "extra_deck") {
      const extra = cards.find(isExtraDeckCard);
      if (extra && reason.materials?.some(id => this.rows.get(id)!.locks.some(lock => lock.scope === "while_face_up" && !allowedByLock(lock, extra)))) return false;
      return !!extra && !!bridgeMaterials(extra, cards.filter(card => card.id !== extra.id), format) && (!reason.steps?.length || reason.steps.every(step => {
        const from = this.rows.get(step.from)!.card, to = this.rows.get(step.to)!.card;
        return namedIn(printedText(from), to.name) || !!to.archetype && namedIn(printedText(from), to.archetype);
      }));
    }
    return !!reason.steps?.length;
  }

  private raw(reasons: BridgeReason[]): number {
    return Object.entries(REASON_CAPS).reduce((score, [key, cap]) => score + Math.min(cap, reasons.filter(reason => reason.key === key).reduce((sum, reason) => sum + reason.weight, 0)), 0);
  }

  private substantive(reason: BridgeReason, target: Context): boolean {
    if (["searcher", "small_world", "type_support"].includes(reason.key)) return false;
    if (reason.key === "reach") return !!reason.steps?.some(step => this.rows.get(step.from)!.provides.some(capability => capability.key === step.capability
      && capability.filter && matchesBridgeFilter(capability.filter, this.rows.get(step.to)!.card)
      && (capability.filter.names.length || capability.filter.archetypes.length || capability.from?.some(zone => zone !== "hand" && zone !== "field"))));
    if (reason.key === "extra_deck") {
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

  between(source: string, target: string, format: BridgeFormat = "advanced"): ArchetypeBridge | null {
    const x = this.resolve(source), y = this.resolve(target);
    if (!x || !y) return null;
    const reasons = this.reasons(x, y, format);
    if (!reasons.length) return null;
    const primary = reasons.find(reason => this.substantive(reason, this.contexts.get(format)!.get(y)!));
    if (!primary) return null;
    const otherReasons = reasons.filter(reason => reason.key !== primary.key);
    const selectedReasons = [primary, ...otherReasons.filter((reason, i, list) => list.findIndex(other => other.key === reason.key) === i)].slice(0, 4);
    const cards = [...new Set(selectedReasons.flatMap(reason => reason.cards))].sort((a, b) => a - b);
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
    const twoWay = this.raw(this.reasons(y, x, format)) >= 4;
    const raw = this.raw(reasons), mean = this.data.target_means[format][y] ?? 0;
    const score = round(Math.min(100, Math.max(0, raw - 0.6 * mean + (twoWay ? 2 : 0) - Math.min(20, penalty))));
    if (score <= 0) return null;
    const copies = new Map(cards.map(id => [id, Math.max(1, ...selectedReasons.map(reason => reason.materials?.filter(code => code === id).length ?? 0))]));
    const points = format === "genesys" ? cards.reduce((sum, id) => sum + this.rows.get(id)!.card.genesysPoints! * copies.get(id)!, 0) : null;
    warnings.add("Card text conditions and costs apply; the line has not been engine-verified");
    return { source: x, target: y, format, score, raw_score: round(raw), target_mean: round(mean), two_way: twoWay,
      grade: penalty >= 8 ? "Risky" : score >= 20 ? "Strong" : score >= 8 ? "Good" : "Niche",
      reasons: selectedReasons, cards, warnings: [...warnings], genesys_points: points,
      validation: "deterministic", judge: "pending", engine_status: "unverified",
      evidence_hash: bridgeHash({ cards: [...new Set(reasons.flatMap(reason => reason.cards))].sort((a, b) => a - b).map(id => [id, this.rows.get(id)!.text_hash, this.rows.get(id)!.evidence_hash]), reasons: reasons.map(reason => [reason.key, reason.cards, reason.steps, reason.materials]), format }) };
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
    return results.sort((a, b) => b.score - a.score || a.target.localeCompare(b.target));
  }

  rebuild(progress?: (progress: BridgeProgress) => void): ArchetypeBridge[] {
    const rows: ArchetypeBridge[] = [];
    for (const format of ["advanced", "genesys"] as const) {
      this.prepare(format);
      const totals = new Map<string, number>();
      const scores = new Map<string, Map<string, number>>();
      for (const [i, source] of this.names.entries()) {
        const values = new Map<string, number>();
        for (const target of this.names) {
          const score = this.raw(this.reasons(source, target, format));
          totals.set(target, (totals.get(target) ?? 0) + score); values.set(target, score);
        }
        scores.set(source, values);
        progress?.({ phase: "score", completed: i + 1, total: this.names.length });
      }
      this.data.target_means[format] = Object.fromEntries(this.names.map(name => [name, (totals.get(name) ?? 0) / Math.max(1, this.names.length - 1)]));
      for (const [i, source] of this.names.entries()) {
        const upperBounds = [...scores.get(source)!].filter(([, raw]) => raw > 0)
          .map(([target, raw]) => ({ target, bound: raw - 0.6 * this.data.target_means[format][target]! + 2 }))
          .sort((a, b) => b.bound - a.bound || a.target.localeCompare(b.target));
        const top: ArchetypeBridge[] = [];
        for (const { target, bound } of upperBounds) {
          if (top.length === 25 && round(bound) < top[24]!.score) break;
          const row = this.between(source, target, format);
          if (row && row.score > 0) {
            top.push(row); top.sort((a, b) => b.score - a.score || a.target.localeCompare(b.target));
            if (top.length > 25) top.pop();
          }
        }
        rows.push(...top);
        progress?.({ phase: "validate", completed: i + 1, total: this.names.length });
      }
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

export function bridgeGroups(capabilities: readonly CardCapability[], profiles: ReadonlyMap<string, ArchetypeProfile>): Record<string, number[]> {
  const groups: Record<string, number[]> = {};
  for (const { card } of capabilities) {
    if (card.archetype && profiles.has(card.archetype)) (groups[card.archetype] ??= []).push(card.id);
    if (sameName(card.name, "Temple of the Kings") || namedIn(printedText(card), "Temple of the Kings") || /\bApophis\b/i.test(card.name)) (groups.Odion ??= []).push(card.id);
  }
  const canonical = new Map<string, string>(), merged: Record<string, number[]> = {};
  for (const [name, ids] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
    const key = canonical.get(name.toLowerCase()) ?? name;
    canonical.set(name.toLowerCase(), key);
    merged[key] = [...new Set([...(merged[key] ?? []), ...ids])];
  }
  return Object.fromEntries(Object.entries(merged).filter(([, ids]) => ids.length >= 3).map(([name, ids]) => [name, ids.sort((a, b) => a - b)]));
}
