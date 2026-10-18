import type Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { deserialize } from "node:v8";
import { deckEngineDataDirectory } from "./card-artworks.js";
import { performance } from "node:perf_hooks";
import { isExtraDeckCard } from "../cards/effects/card.js";
import { matchCard } from "../cards/effects/effect-match.js";
import { compactEffectName, resolveEffectName } from "../cards/effects/name-match.js";
import { buildArchetypeMatcher, describe, interpret, type Interpretation } from "../cards/effects/query.js";
import { ArchetypeProfile, belongsTo, cardSynergy, filterReachesCard, hookQuery, prepareSynergyCandidates, type Candidate, type RankedInsightCard } from "../cards/effects/synergy.js";
import { NO_FILTER, type CardFilter, type CardTags, type GameEvent } from "../cards/effects/tags.js";
import { createInsightCatalog } from "./card-insight-catalog.js";

export interface CubeSeedIndex {
  readonly candidates: readonly Candidate[];
  readonly members: ReadonlyMap<string, readonly Candidate[]>;
  readonly roles: ReadonlyMap<string, readonly Candidate[]>;
  readonly preparationMs: number;
  canonical(code: number): number;
  readQuery(text: string): Interpretation | null;
  rankPartners(anchors: readonly Candidate[]): Map<number, RankedInsightCard>;
  warningsFor(anchors: readonly Candidate[]): string[];
}
interface TargetSet { indexes: Uint32Array; rules: Array<{ group: number; score: number }> }
interface DirectionGroup { source: number; rules: Array<{ set: number; score: number }> }
interface Stamp { effectRevision: number; catalogRevision: number; engineVersion: string }
interface Snapshot extends Stamp { index: CubeSeedIndex; refreshAfter: number }
// Share snapshots and single-flight preparation across Next server module graphs.
const snapshotKey = Symbol.for("yugidraft.cube-seed.snapshots.v2");
const runtime = globalThis as typeof globalThis & { [snapshotKey]?: {
  snapshots: WeakMap<Database.Database, Snapshot>; pending: WeakMap<Database.Database, Promise<CubeSeedIndex>>;
} };
const { snapshots, pending } = runtime[snapshotKey] ??= { snapshots: new WeakMap(), pending: new WeakMap() };
const stampOf = (db: Database.Database): Stamp => {
  const directory = deckEngineDataDirectory(db.name);
  const engineVersion = ["cards.cdb", "strings.conf", "card-remaps.json", "manifest.json"].map(file => {
    const path = join(directory, file);
    try { const stat = statSync(path); return `${path}:${stat.size}:${stat.mtimeMs}`; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return path; }
  }).join("|");
  return {
    effectRevision: (db.prepare("SELECT revision FROM card_effect_revision WHERE id=1").get() as { revision: number }).revision,
    catalogRevision: (db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get() as { revision: number }).revision,
    engineVersion,
  };
};
const sameEffects = (a: Stamp, b: Stamp) => a.effectRevision === b.effectRevision && a.engineVersion === b.engineVersion;
const profileKey = (archetype: string) => archetype.replace(/[A-Z]/g, letter => letter.toLowerCase());
const particular = (filter: CardFilter) => filter.names.length || filter.archetypes.length || filter.types.length || filter.attributes.length || filter.subtypes.length || filter.level_min || filter.level_max;
const reachable = (event: GameEvent, candidate: Candidate) => !event.from.length || event.from.some(zone => zone === "deck" ? !isExtraDeckCard(candidate.card) : zone === "extra_deck" ? isExtraDeckCard(candidate.card) : true);
const addMember = <T>(map: Map<string, T[]>, key: string, value: T) => { const values = map.get(key); if (values) values.push(value); else map.set(key, [value]); };

/** Seed matching does not consume annotation prose. Share immutable schema defaults/filters. */
function compactSeedTags(candidates: readonly Candidate[]): void {
  const lists = new Map<string, string[]>(), filters = new Map<string, CardFilter>();
  const events = new Map<string, GameEvent>(), supports = new Map<string, CardTags["supports"]>();
  const list = <T extends string>(values: T[]): T[] => {
    const key = JSON.stringify(values), known = lists.get(key);
    if (known) return known as T[];
    lists.set(key, values); return values;
  };
  const filter = (value: CardFilter): CardFilter => {
    value.kinds = list(value.kinds); value.subtypes = list(value.subtypes); value.types = list(value.types);
    value.attributes = list(value.attributes); value.names = list(value.names); value.archetypes = list(value.archetypes);
    const key = JSON.stringify(value), known = filters.get(key);
    if (known) return known;
    filters.set(key, value); return value;
  };
  const event = (value: GameEvent): GameEvent => {
    value.note = ""; value.from = list(value.from); value.what = filter(value.what);
    const key = JSON.stringify(value), known = events.get(key);
    if (known) return known;
    events.set(key, value); return value;
  };
  for (const { card, tags } of candidates) {
    card.subtypes = list(card.subtypes); card.formats = list(card.formats);
    if (!tags) continue;
    tags.summary = ""; tags.keywords = list([]); tags.roles = list(tags.roles);
    for (const effect of tags.effects) {
      effect.conditions = list([]); effect.location = list(effect.location);
      effect.actions = effect.actions.map(event); effect.costs = effect.costs.map(event); effect.triggers = effect.triggers.map(event);
    }
    const materialSeen = new Set<CardFilter>();
    tags.materials = tags.materials.map(value => {
      const shared = filter(value);
      // Synchro feasibility excludes one material requirement by object identity.
      // Two equal printed requirements must remain separate entries within that card.
      if (materialSeen.has(shared)) return { ...shared };
      materialSeen.add(shared); return shared;
    });
    tags.supports.archetypes = list(tags.supports.archetypes); tags.supports.names = list(tags.supports.names);
    tags.supports.types = list(tags.supports.types); tags.supports.attributes = list(tags.supports.attributes); tags.supports.subtypes = list(tags.supports.subtypes);
    const key = JSON.stringify(tags.supports), known = supports.get(key);
    if (known) tags.supports = known;
    else supports.set(key, tags.supports);
  }
}

/** Serializable preparation runs outside the web event loop for disk databases. */
export function buildCubeSeedData(db: Database.Database) {
  const stamp = stampOf(db), started = performance.now();
  const catalog = createInsightCatalog(db);
  let candidates: Candidate[];
  const canonicalCodes = new Map<number, number>();
  try {
    candidates = [...catalog.candidates()];
    for (const { ygoprodeck_id } of db.prepare<[], { ygoprodeck_id: number }>("SELECT ygoprodeck_id FROM card_catalog").iterate()) canonicalCodes.set(ygoprodeck_id, catalog.canonical(ygoprodeck_id));
    for (const { artwork_id, card_id } of db.prepare<[], { artwork_id: number; card_id: number }>("SELECT artwork_id,card_id FROM card_artworks").iterate()) canonicalCodes.set(artwork_id, catalog.canonical(card_id));
    for (const code of catalog.identityPasscodes()) canonicalCodes.set(code, catalog.canonical(code));
  } finally { catalog.close(); }
  const state = buildCubeSeedState(db, candidates);
  return { stamp, candidates, canonicalCodes, state, preparationMs: performance.now() - started };
}
function install(db: Database.Database, data: ReturnType<typeof buildCubeSeedData>) {
  const index = createSeedIndex(data.candidates, data.canonicalCodes, data.state, data.preparationMs);
  snapshots.set(db, { ...data.stamp, index, refreshAfter: 0 });
  return index;
}

/** Synchronous API for in-memory callers. Web preview routes await initialization. */
export function prepareCubeSeedIndex(db: Database.Database): CubeSeedIndex {
  const stamp = stampOf(db), cached = snapshots.get(db);
  if (cached && sameEffects(cached, stamp) && cached.catalogRevision === stamp.catalogRevision) return cached.index;
  return install(db, db.transaction(() => buildCubeSeedData(db)).deferred());
}

const PREPARE_PROCESS = `
(async () => {
  const [{default: Database}, {buildCubeSeedData}] = await Promise.all([import(process.argv[3]), import(process.argv[1])]);
  const db = new Database(process.argv[2], {readonly: true, fileMustExist: true});
  let data;
  try { data = db.transaction(() => buildCubeSeedData(db)).deferred(); } finally { db.close(); }
  require('node:fs').writeFileSync(3, require('node:v8').serialize(data));
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

/** One disposable preparation process per database. Catalog refresh keeps serving old data. */
export function initializeCubeSeedIndex(db: Database.Database): Promise<CubeSeedIndex> {
  const running = pending.get(db);
  if (running) return running;
  const stamp = stampOf(db), cached = snapshots.get(db);
  if (cached && sameEffects(cached, stamp) && cached.catalogRevision === stamp.catalogRevision) return Promise.resolve(cached.index);
  if (!db.name || db.name === ":memory:" || db.inTransaction) return Promise.resolve(prepareCubeSeedIndex(db));
  const prepare = async () => {
    const directory = mkdtempSync(join(tmpdir(), "cube-seed-")), path = join(directory, "snapshot");
    const fd = openSync(path, "w", 0o600);
    try {
      // Resolve the unbundled shared entry in development and standalone Next output alike.
      const require = createRequire(join(process.cwd(), "package.json"));
      const module = pathToFileURL(require.resolve("@yugidraft/shared/services/cube-seed-index")).href;
      const sqlite = pathToFileURL(require.resolve("better-sqlite3")).href;
      await new Promise<void>((complete, reject) => {
        let stderr = "";
        const child = spawn(process.execPath, ["--max-old-space-size=256", "--input-type=commonjs", "-e", PREPARE_PROCESS, module, resolve(db.name), sqlite], {
          stdio: ["ignore", "ignore", "pipe", fd], env: { ...process.env, NODE_OPTIONS: "" },
        });
        child.stderr!.setEncoding("utf8");
        child.stderr!.on("data", value => { if (stderr.length < 16384) stderr += value; });
        child.once("error", reject);
        child.once("close", code => code === 0 ? complete() : reject(new Error(`Cube seed preparation failed (${code}): ${stderr}`)));
      });
      const data = deserialize(readFileSync(path)) as ReturnType<typeof buildCubeSeedData>;
      // V8 can back typed views with the entire serialized file. Copy the compact
      // numeric lists so the large input buffer can be collected after installation.
      for (const targets of data.state.targetSets) targets.indexes = Uint32Array.from(targets.indexes);
      data.state.targetMemberships = data.state.targetMemberships.map(values => Uint32Array.from(values));
      // An effect publication during preparation must never install obsolete tags or releases.
      if (!sameEffects(data.stamp, stampOf(db))) return prepare();
      return install(db, data);
    } finally { closeSync(fd); rmSync(directory, { recursive: true, force: true }); }
  };
  const result = prepare().finally(() => { pending.delete(db); });
  pending.set(db, result);
  return result;
}

/** Await only cold/effect-data preparation; display metadata refresh is asynchronous. */
export function ensureCubeSeedIndex(db: Database.Database): Promise<CubeSeedIndex> {
  const cached = snapshots.get(db);
  return cached && sameEffects(cached, stampOf(db)) ? Promise.resolve(getCubeSeedIndex(db)) : initializeCubeSeedIndex(db);
}

/** Construction helpers deliberately live outside the retained snapshot's lexical scope. */
function buildCubeSeedState(db: Database.Database, candidates: Candidate[]) {
  compactSeedTags(candidates);
  prepareSynergyCandidates(candidates);
  const byId = new Map(candidates.map((candidate, index) => [candidate.card.id, index]));
  const members = new Map<string, Candidate[]>(), roles = new Map<string, Candidate[]>();
  const names = new Set<string>();
  const byName = new Map<string, number[]>(), byArchetype = new Map<string, number[]>();
  const fields = new Map<string, number[]>();
  const triggers = new Map<string, Set<number>>();
  const effectVerbs = new Map<string, number[]>();
  const supportTerms = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const { card, tags } = candidate;
    if (card.archetype) { names.add(card.archetype); addMember(members, compactEffectName(card.archetype), candidate); addMember(byArchetype, compactEffectName(card.archetype), index); }
    // An exact card name can also anchor a seed (e.g. "partners for Dark Magician").
    const key = compactEffectName(card.name);
    if (!members.get(key)?.includes(candidate)) addMember(members, key, candidate);
    addMember(byName, key, index);
    for (const role of new Set(tags?.roles ?? [])) addMember(roles, role, candidate);
    for (const [field, values] of [["kind", [card.kind]], ["type", [card.monsterType]], ["attribute", [card.attribute]], ["subtype", card.subtypes]] as const) {
      for (const value of values) if (value) addMember(fields, `${field}:${value}`, index);
    }
    for (const verb of new Set(tags?.effects.flatMap(effect => [...effect.actions, ...effect.costs].map(event => event.verb)) ?? [])) addMember(effectVerbs, `does:${verb}`, index);
    for (const verb of new Set(tags?.effects.flatMap(effect => effect.triggers.map(event => event.verb)) ?? [])) addMember(effectVerbs, `reacts:${verb}`, index);
    for (const type of new Set(tags?.supports.types ?? [])) addMember(supportTerms, `type:${type}`, index);
    for (const attribute of new Set(tags?.supports.attributes ?? [])) addMember(supportTerms, `attribute:${attribute}`, index);
    for (const effect of tags?.effects ?? []) for (const trigger of effect.triggers) if (trigger.what.this_card) {
      const indexes = triggers.get(trigger.verb) ?? new Set<number>(); indexes.add(index); triggers.set(trigger.verb, indexes);
    }
  });
  const profiles = new Map<string, ArchetypeProfile>(), corrupt = new Set<string>(), seenProfiles = new Set<string>();
  for (const row of db.prepare<[], { archetype: string; plan: string; hooks_json: string }>("SELECT archetype,plan,hooks_json FROM card_tag_profiles").iterate()) {
    names.add(row.archetype);
    const key = profileKey(row.archetype);
    // Match the first row selected by the existing NOCASE lookup when old data has
    // two differently cased primary keys (the pinned catalog includes Roid/roid).
    if (seenProfiles.has(key)) continue;
    seenProfiles.add(key);
    try { profiles.set(key, ArchetypeProfile.parse({ plan: row.plan, hooks: JSON.parse(row.hooks_json) })); }
    catch { corrupt.add(key); }
  }
  for (const row of db.prepare<[], { name: string }>("SELECT name FROM archetypes").iterate()) names.add(row.name);


  // Filters are resolved once against metadata indexes. Repeated generic filters share one list.
  const all = candidates.map((_, index) => index);
  const printed = candidates.map(({ card }) => card.text.toLowerCase());
  const belonging = new Map<string, number[]>();
  const archetypeTargets = (value: string) => {
    const key = value.toLowerCase();
    let indexes = belonging.get(key);
    if (!indexes) { indexes = all.filter(index => belongsTo(candidates[index]!.card, value)); belonging.set(key, indexes); }
    return indexes;
  };
  const union = (lists: readonly (readonly number[])[]) => lists.length === 1 ? lists[0]! : [...new Set(lists.flat())];
  const filterKeys = new WeakMap<CardFilter, string>();
  const filterKey = (filter: CardFilter): string => {
    const known = filterKeys.get(filter);
    if (known) return known;
    const key = JSON.stringify([filter.this_card, [...filter.kinds].sort(), [...filter.subtypes].sort(), [...filter.types].sort(), [...filter.attributes].sort(),
      filter.archetypes.map(value => value.toLowerCase()).sort(), filter.names.map(compactEffectName).sort(), filter.level_min, filter.level_max,
      /non[- ]tuner/i.test(filter.other), filter.other.match(/(\d+)\s*(?:or less|or lower)\s*atk/i)?.[1] ?? null]);
    filterKeys.set(filter, key); return key;
  };
  const filtered = new Map<string, readonly number[]>();
  const filterTargets = (filter: CardFilter): readonly number[] => {
    if (filter.this_card) return [];
    const key = filterKey(filter), cachedTargets = filtered.get(key);
    if (cachedTargets) return cachedTargets;
    let smallest: readonly number[] = all;
    const consider = (values: readonly number[]) => { if (values.length < smallest.length) smallest = values; };
    for (const [field, values] of [["kind", filter.kinds], ["type", filter.types], ["attribute", filter.attributes], ["subtype", filter.subtypes]] as const) {
      if (values.length) consider(union(values.map(value => fields.get(`${field}:${value}`) ?? [])));
    }
    if (filter.names.length) consider(union(filter.names.map(name => byName.get(compactEffectName(name)) ?? [])));
    if (filter.archetypes.length) consider(union(filter.archetypes.map(archetypeTargets)));
    const targets = smallest.filter(index => filterReachesCard(filter, candidates[index]!.card));
    filtered.set(key, targets);
    return targets;
  };
  // Many thousands of cards repeat the same Type/Attribute/material restriction. Keep
  // one target set per distinct result, then index those sets instead of catalog pairs.
  const targetSets: TargetSet[] = [], groups: DirectionGroup[] = [];
  const sourceGroups: number[][] = candidates.map(() => []);
  const targetBuckets = new Map<string, number[]>();
  const setCache = new Map<string, number>();
  const targetSet = (indexes: readonly number[]): number => {
    // Hash buckets are verified element-by-element, so collisions cannot widen a relation.
    const sorted = [...new Set(indexes)].sort((a, b) => a - b);
    let hash = 2166136261;
    for (const index of sorted) hash = Math.imul(hash ^ index, 16777619);
    const key = `${sorted.length}:${hash >>> 0}`, bucket = targetBuckets.get(key) ?? [];
    for (const at of bucket) {
      const previous = targetSets[at]!.indexes;
      if (sorted.every((value, index) => previous[index] === value)) return at;
    }
    const at = targetSets.length;
    targetSets.push({ indexes: Uint32Array.from(sorted), rules: [] });
    bucket.push(at); targetBuckets.set(key, bucket);
    return at;
  };
  const cachedSet = (key: string, get: () => readonly number[]) => {
    const previous = setCache.get(key);
    if (previous !== undefined) return previous;
    const at = targetSet(get()); setCache.set(key, at); return at;
  };
  const direction = (source: number, rules: Array<{ set: number; score: number }>) => {
    const distinct = new Map<number, number>();
    for (const rule of rules) if (targetSets[rule.set]!.indexes.length) distinct.set(rule.set, Math.max(rule.score, distinct.get(rule.set) ?? 0));
    if (!distinct.size) return;
    const at = groups.length, group = { source, rules: [...distinct].map(([set, score]) => ({ set, score })) };
    groups.push(group); sourceGroups[source]!.push(at);
    for (const rule of group.rules) targetSets[rule.set]!.rules.push({ group: at, score: rule.score });
  };
  const eventSet = (event: GameEvent, trigger: boolean) => {
    const from = [...new Set(event.from)].sort();
    const zone = !from.length || from.some(value => value !== "deck" && value !== "extra_deck") || from.length > 1 ? "any" : from[0];
    const key = `event:${filterKey(event.what)}:${trigger ? from.join(",") : zone}:${trigger ? event.verb : ""}`;
    return cachedSet(key, () => filterTargets(event.what).filter(target => {
      const candidate = candidates[target]!;
      if (!reachable(event, candidate)) return false;
      return !trigger || candidate.tags?.effects.some(effect => effect.triggers.some(value => value.what.this_card
        && value.verb === event.verb && (!value.from.length || value.from.some(zone => event.from.includes(zone))))) === true;
    }));
  };
  candidates.forEach((candidate, source) => {
    const { card, tags } = candidate;
    if (!tags) return;
    const events = tags.effects.flatMap(effect => [...effect.actions, ...effect.costs]);
    const named = [...tags.supports.names, ...[...events, ...tags.effects.flatMap(effect => effect.triggers)].flatMap(event => event.what.names), ...tags.materials.flatMap(filter => filter.names),
      ...[...`${card.pendulumText ?? ""}\n${card.text}`.matchAll(/["“]([^"”]+)["”]/g)].map(match => match[1]!)];
    direction(source, [{ set: cachedSet(`names:${[...new Set(named.map(compactEffectName))].sort().join("\0")}`, () => union(named.map(name => byName.get(compactEffectName(name)) ?? []))), score: 12 }]);
    const materialRules: Array<{ set: number; score: number }> = [];
    for (const filter of tags.materials) if (particular(filter)) {
      const synchro = card.subtypes.includes("synchro");
      const other = synchro ? tags.materials.filter(value => value !== filter).reduce((sum, value) => sum + Math.max(1, value.level_min), 0) : 0;
      const maxLevel = synchro ? card.level === undefined ? -1 : card.level - Math.max(1, other) : undefined;
      const xyzLevel = card.subtypes.includes("xyz") && card.rank != null && !filter.level_min && !filter.level_max && !filter.names.length && !filter.archetypes.length ? card.rank : undefined;
      const set = cachedSet(`material:${filterKey(filter)}:${maxLevel}:${xyzLevel}`, () => filterTargets(filter).filter(target => {
        const level = candidates[target]!.card.level;
        return (maxLevel === undefined || level !== undefined && level <= maxLevel) && (xyzLevel === undefined || level === xyzLevel);
      }));
      materialRules.push({ set, score: 4 });
    }
    direction(source, materialRules);
    const eventRules = new Map<string, Array<{ set: number; score: number }>>();
    for (const event of events) if (event.player !== "opponent" && particular(event.what)) {
      const rules = eventRules.get(event.verb) ?? [];
      rules.push({ set: eventSet(event, false), score: event.what.names.length || event.what.archetypes.length ? 6 : 2 }); eventRules.set(event.verb, rules);
    }
    for (const rules of eventRules.values()) direction(source, rules);
    const archetypeIndexes = union(tags.supports.archetypes.map(archetypeTargets));
    direction(source, [{ set: cachedSet(`support-archetypes:${[...tags.supports.archetypes].sort().join("\0")}`, () => archetypeIndexes), score: 5 }]);
    if (tags.supports.types.length || tags.supports.attributes.length || tags.supports.subtypes.length) {
      const filter = { ...NO_FILTER, types: tags.supports.types, attributes: tags.supports.attributes, subtypes: tags.supports.subtypes };
      const summary = [...tags.supports.types, ...tags.supports.attributes, ...tags.supports.subtypes].join("/");
      // The original explanation map merges an archetype reason with an identical Type reason.
      const collisions = new Set(archetypeIndexes.filter(target => (candidates[target]!.card.archetype ?? candidates[target]!.card.name) === summary));
      direction(source, [{ set: cachedSet(`support:${filterKey(filter)}:${[...collisions].join(",")}`, () => filterTargets(filter).filter(target => !collisions.has(target))), score: 2 }]);
    }
    const triggerRules = new Map<string, Array<{ set: number; score: number }>>();
    for (const effect of tags.effects) for (const event of effect.actions) if (event.player !== "opponent" && triggers.has(event.verb)) {
      const rules = triggerRules.get(event.verb) ?? [];
      rules.push({ set: eventSet(event, true), score: 4 }); triggerRules.set(event.verb, rules);
    }
    for (const rules of triggerRules.values()) direction(source, rules);
  });
  const memberships: number[][] = candidates.map(() => []);
  targetSets.forEach(({ indexes }, at) => { for (const target of indexes) memberships[target]!.push(at); });
  const targetMemberships = memberships.map(values => Uint32Array.from(values));
  const sameNames = new Map<string, number[]>();
  candidates.forEach(({ card }, at) => addMember(sameNames, card.name, at));

  const hookMatches = new Map<string, Array<{ reason: string; targets: readonly number[] }>>();
  const hookTargets = new Map<string, readonly number[]>();
  for (const [archetype, profile] of profiles) {
    hookMatches.set(archetype, profile.hooks.map(hook => {
      const query = hookQuery(hook, archetype), phrases = hook.phrases.map(phrase => phrase.toLowerCase());
      const key = JSON.stringify([query, phrases]);
      let matches = hookTargets.get(key);
      if (!matches) {
        let shortlist = filterTargets({ ...NO_FILTER, kinds: query.card.kinds, subtypes: query.card.subtypes, types: hook.card?.types ?? [], attributes: query.card.attributes });
        const consider = (values: readonly number[]) => { if (values.length < shortlist.length) shortlist = values; };
        if (query.does) consider(union(query.does.verbs.map(verb => effectVerbs.get(`does:${verb}`) ?? [])));
        if (query.reactsTo) consider(union(query.reactsTo.verbs.map(verb => effectVerbs.get(`reacts:${verb}`) ?? [])));
        for (const type of query.supports?.types ?? []) consider(supportTerms.get(`type:${type}`) ?? []);
        for (const attribute of query.supports?.attributes ?? []) consider(supportTerms.get(`attribute:${attribute}`) ?? []);
        matches = shortlist.filter(index => phrases.every(phrase => printed[index]!.includes(phrase)) && matchCard(candidates[index]!.card, candidates[index]!.tags, query) !== null);
        hookTargets.set(key, matches);
      }
      return { reason: `${hook.label}: ${hook.why}`, targets: matches.filter(index => !belongsTo(candidates[index]!.card, archetype)) };
    }));
  }
  return { members, roles, byId, byName, byArchetype, names, corrupt, groups, sourceGroups, targetSets, targetMemberships, sameNames, hookMatches };
}

function createSeedIndex(candidates: Candidate[], canonicalCodes: ReadonlyMap<number, number>, state: ReturnType<typeof buildCubeSeedState>, preparationMs: number): CubeSeedIndex {
  const { members, roles, byId, byName, byArchetype, names, corrupt, groups, sourceGroups, targetSets, targetMemberships, sameNames, hookMatches } = state;
  const matcher = buildArchetypeMatcher(names);
  const index: CubeSeedIndex = {
    candidates, members, roles, preparationMs,
    canonical: code => canonicalCodes.get(code) ?? code,
    readQuery(text) {
      const target = text.trim().match(/^(?:cards?\s+that\s+)?(?:works?\s+(?:well\s+)?with|synerg(?:y|ies|izes?)\s+(?:with|for)|partners?\s+for)\s+(.+?)\s*[?.!]?$/i)?.[1];
      if (!target) return interpret(text, matcher);
      const exact = byName.get(compactEffectName(target))?.[0];
      const named = exact === undefined ? resolveEffectName(candidates.map(({ card }) => card), target) : candidates[exact]!.card;
      if (!named) return interpret(`${target} support`, matcher);
      const query = { card: { kinds: [], subtypes: [], types: [], attributes: [], archetypes: [] }, roles: [], quick: false, text: "", supports: { kinds: [], subtypes: [], types: [], attributes: [], archetypes: [named.name] } };
      return { query, chips: describe(query) };
    },
    warningsFor(anchors) { return [...new Set(anchors.flatMap(({ card }) => card.archetype && corrupt.has(profileKey(card.archetype)) ? [`Skipped unreadable synergy profile for ${card.archetype}.`] : []))]; },
    rankPartners(anchors) {
      const scores = new Float64Array(candidates.length), linked = new Uint32Array(candidates.length), best = new Float64Array(candidates.length);
      const bestAnchor = new Int32Array(candidates.length); bestAnchor.fill(-1);
      const fallback: Array<string | undefined> = [];
      const seen = new Set<number>(), seenProfiles = new Set<string>();
      const pairScores = new Float64Array(candidates.length), targetScores = new Uint8Array(candidates.length), groupScores = new Uint8Array(groups.length);
      anchors.forEach((anchor, anchorAt) => {
        if (seen.has(anchor.card.id)) return;
        seen.add(anchor.card.id);
        pairScores.fill(0);
        const source = byId.get(anchor.card.id);
        if (source === undefined) candidates.forEach((candidate, target) => { pairScores[target] = cardSynergy(anchor, candidate).score; });
        else {
          // Outgoing links share one maximum contribution per explanation, even when
          // several effects/material restrictions can reach the same target.
          for (const at of sourceGroups[source]!) {
            targetScores.fill(0);
            for (const { set, score } of groups[at]!.rules) for (const target of targetSets[set]!.indexes) {
              if (score <= targetScores[target]!) continue;
              pairScores[target] += score - targetScores[target]!; targetScores[target] = score;
            }
          }
          // Incoming links visit shared filter memberships rather than every card's effects.
          groupScores.fill(0);
          for (const set of targetMemberships[source]!) for (const { group, score } of targetSets[set]!.rules) {
            if (score <= groupScores[group]!) continue;
            pairScores[groups[group]!.source] += score - groupScores[group]!; groupScores[group] = score;
          }
          if (anchor.card.archetype) for (const target of byArchetype.get(compactEffectName(anchor.card.archetype)) ?? []) pairScores[target] += 5;
          // Different public identities may share a printed name; the explanation map
          // deduplicates their two directions, so resolve those rare pairs directly.
          for (const target of sameNames.get(anchor.card.name) ?? []) pairScores[target] = cardSynergy(anchor, candidates[target]!).score;
          pairScores[source] = 0;
        }
        pairScores.forEach((score, target) => {
          if (score <= 0) return;
          scores[target] += score; linked[target]++;
          if (score > best[target]!) { best[target] = score; bestAnchor[target] = anchorAt; }
        });
        const archetype = anchor.card.archetype;
        if (!archetype || seenProfiles.has(archetype)) return;
        seenProfiles.add(archetype);
        for (const hook of hookMatches.get(profileKey(archetype)) ?? []) for (const target of hook.targets) {
          scores[target]++;
          if (bestAnchor[target] === -1 && !fallback[target]) { fallback[target] = hook.reason; best[target] = 1; }
        }
      });
      const ranked = new Map<number, RankedInsightCard>();
      candidates.forEach((candidate, at) => {
        if (scores[at]! <= 0) return;
        const anchorAt = bestAnchor[at]!;
        ranked.set(candidate.card.id, { passcode: candidate.card.id, name: candidate.card.name, score: scores[at]!, linkedCards: linked[at]!, reason: anchorAt < 0 ? fallback[at] ?? "" : cardSynergy(anchors[anchorAt]!, candidate).reason });
      });
      return ranked;
    },
  };
  return index;
}

/** Effect updates invalidate immediately. Display catalog writes refresh at most once a minute. */
export function getCubeSeedIndex(db: Database.Database): CubeSeedIndex {
  const stamp = stampOf(db), cached = snapshots.get(db);
  if (!cached || !sameEffects(cached, stamp)) return prepareCubeSeedIndex(db);
  if (cached.catalogRevision !== stamp.catalogRevision && Date.now() >= cached.refreshAfter && !pending.has(db)) {
    cached.refreshAfter = Date.now() + 60_000;
    void initializeCubeSeedIndex(db).then(() => {
      const refreshed = snapshots.get(db);
      if (refreshed) refreshed.refreshAfter = Date.now() + 60_000;
    }).catch(error => { console.warn("Cube seed refresh failed", error); });
  }
  return cached.index;
}
