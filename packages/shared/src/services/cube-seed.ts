import type Database from "better-sqlite3";
import { ExpectedError } from "../observability/index.js";
import type { CubePool } from "../types/index.js";
import { isExtraDeckCard } from "../cards/effects/card.js";
import { matchCard } from "../cards/effects/effect-match.js";
import { compactEffectName } from "../cards/effects/name-match.js";
import type { Candidate } from "../cards/effects/synergy.js";
import { cardEraBoost, compareNewest, deriveCardEra, isCardEra, matchesReleased, type CardEra } from "../cards/effects/releases.js";
import type { Interpretation } from "../cards/effects/query.js";
import { readingArchetypes, type ArchetypeGuide } from "../cards/effects/guide.js";
import { readArchetypeGuide } from "./card-insight-profiles.js";
import { getCubeSeedIndex, type CubeSeedIndex } from "./cube-seed-index.js";
import { DEFAULT_CUBE_COPIES, MAX_CUBE_COPIES } from "./constants.js";

export interface CubeSeedOptions { phrase: string; targetCount?: number; maxCopies?: number; era?: CardEra }
export interface CubeSeedRow {
  id: number;
  name: string;
  copies: number;
  pool: CubePool;
  category: "archetype" | "phrase" | "partner" | "staple";
  reason: string;
  roles: string[];
}
const roles = ["searcher", "extender", "removal", "hand_trap"] as const;
type SeedRole = typeof roles[number];
export interface CubeSeedPreview {
  phrase: string;
  targetCount: number;
  maxCopies: number;
  reading: Interpretation | null;
  /** "How it plays" for the archetype the phrase names. */
  guide?: ArchetypeGuide;
  era?: CardEra;
  rows: CubeSeedRow[];
  roleQuotas: Record<SeedRole, { target: number; selected: number }>;
  warnings: string[];
}
type Choice = { candidate: Candidate; category: CubeSeedRow["category"]; reason: string; score: number; linked: number };
const compareDefault = (a: Choice, b: Choice) => b.linked - a.linked || b.score - a.score || b.candidate.card.views - a.candidate.card.views || a.candidate.card.id - b.candidate.card.id;
function retain(choices: Choice[], choice: Choice, limit: number, compare: (a: Choice, b: Choice) => number) {
  if (choices.length === limit && compare(choice, choices[choices.length - 1]!) >= 0) return;
  choices.push(choice);
  choices.sort(compare);
  if (choices.length > limit) choices.pop();
}

const PREVIEW_TTL_MS = 5 * 60_000, PREVIEW_CACHE_MAX = 64;
const previewCaches = new WeakMap<object, Map<string, { at: number; preview: CubeSeedPreview }>>();

// Artwork edits must apply immediately while expensive effect preparation refreshes.
const identitySnapshots = new WeakMap<CubeSeedIndex, { revision: number; canonical: (code: number) => number; candidates: readonly Candidate[] }>();
function currentIdentities(db: Database.Database, index: CubeSeedIndex) {
  const revision = (db.prepare("SELECT revision FROM card_catalog_revision WHERE id=1").get() as { revision: number }).revision;
  const cached = identitySnapshots.get(index);
  if (cached?.revision === revision) return cached;
  const artworks = new Map(db.prepare<[], { artwork_id: number; card_id: number }>("SELECT artwork_id,card_id FROM card_artworks").all().map(row => [row.artwork_id, row.card_id]));
  const canonical = (code: number): number => {
    let current = artworks.has(code) && artworks.get(code) !== code ? code : index.canonical(code);
    const seen = new Set<number>();
    while (artworks.has(current) && artworks.get(current) !== current && !seen.has(current)) {
      seen.add(current); current = artworks.get(current)!;
    }
    return current;
  };
  const seen = new Set<number>();
  const candidates = index.candidates.filter(candidate => {
    const code = canonical(candidate.card.id);
    if (seen.has(code)) return false;
    seen.add(code); return true;
  });
  const result = { revision, canonical, candidates };
  identitySnapshots.set(index, result);
  return result;
}

/** Read-only selection from prepared public metadata. Current cube identities remain excluded. */
export function previewCubeSeed(db: Database.Database, input: CubeSeedOptions, existingIds: readonly number[]): CubeSeedPreview {
  const { phrase, targetCount = 180, maxCopies = DEFAULT_CUBE_COPIES } = input;
  if (typeof phrase !== "string" || !phrase.trim() || phrase.length > 512) throw new ExpectedError("phrase must contain 1 to 512 characters", 400);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 500) throw new ExpectedError("targetCount must be a whole number from 1 to 500", 400);
  if (!Number.isInteger(maxCopies) || maxCopies < 1 || maxCopies > MAX_CUBE_COPIES) throw new ExpectedError(`maxCopies must be a whole number from 1 to ${MAX_CUBE_COPIES}`, 400);
  if (input.era !== undefined && !isCardEra(input.era)) throw new ExpectedError("era must contain a valid medianYear and spread", 400);
  const index = getCubeSeedIndex(db);
  const identities = currentIdentities(db, index);
  const existing = new Set(existingIds.map(identities.canonical));
  const dates = db.prepare<[number], { tcg_date: string | null; ocg_date: string | null }>("SELECT tcg_date,ocg_date FROM card_release WHERE passcode=?");
  const era = input.era ?? deriveCardEra([...existing].map(code => {
    const row = dates.get(code);
    return { tcgDate: row?.tcg_date ?? undefined, ocgDate: row?.ocg_date ?? undefined };
  }));
  const key = JSON.stringify([identities.revision, phrase.trim(), targetCount, maxCopies, era, [...existing].sort((a, b) => a - b), new Date().toISOString().slice(0, 7)]);
  let cache = previewCaches.get(index);
  if (!cache) previewCaches.set(index, cache = new Map());
  const now = Date.now(), hit = cache.get(key);
  if (hit && now - hit.at < PREVIEW_TTL_MS) return structuredClone(hit.preview);
  const finish = (preview: CubeSeedPreview) => {
    for (const [oldKey, value] of cache) if (now - value.at >= PREVIEW_TTL_MS) cache.delete(oldKey);
    if (cache.size >= PREVIEW_CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now, preview: structuredClone(preview) });
    return preview;
  };
  const fractions = { searcher: 0.12, extender: 0.18, removal: 0.12, hand_trap: 0.08 };
  const roleQuotas = Object.fromEntries(roles.map(role => [role, { target: Math.max(targetCount >= 4 ? 1 : 0, Math.floor(targetCount * fractions[role])), selected: 0 }])) as CubeSeedPreview["roleQuotas"];
  const reading = index.readQuery(phrase);
  const guide = reading ? readArchetypeGuide(db, readingArchetypes(reading)) : null;
  const preview: CubeSeedPreview = { phrase: phrase.trim(), targetCount, maxCopies, reading, ...(guide ? { guide } : {}), ...(era ? { era } : {}), rows: [], roleQuotas, warnings: [] };
  if (!reading) { preview.warnings.push("No cards matched this phrase. Try an archetype or an effect description."); return finish(preview); }

  const compare = (a: Choice, b: Choice) => (reading.query.sort === "newest"
    ? compareNewest(a.candidate.card, b.candidate.card, reading.query.released?.region) : 0) || compareDefault(a, b);
  {
    const names = new Set([...reading.query.card.archetypes, ...reading.query.supports?.archetypes ?? []].map(compactEffectName));
    const memberIds = new Set([...names].flatMap(name => (index.members.get(name) ?? []).map(candidate => candidate.card.id)));
    const words = reading.query.text.toLowerCase().split(/\s+/).filter(Boolean);
    const core: Choice[] = [];
    const coreMatched = new Set<number>();
    const anchorChoices: Choice[] = [];
    const quotaChoices = new Map<SeedRole, Choice[]>(roles.map(role => [role, []]));
    const considerRoles = (choice: Choice) => {
      if (existing.has(identities.canonical(choice.candidate.card.id))) return;
      for (const role of roles) if (choice.candidate.tags?.roles.includes(role)) {
        const choices = quotaChoices.get(role)!;
        // Core, partner and staple passes can reach the same public identity.
        if (!choices.some(entry => entry.candidate.card.id === choice.candidate.card.id)) retain(choices, choice, targetCount, compare);
      }
    };
    const coreChoice = (candidate: Candidate): Choice | undefined => {
      const { card, tags } = candidate;
      if (!matchesReleased(card, reading.query.released)) return undefined;
      const member = memberIds.has(card.id);
      const score = member ? 100 : matchCard(card, tags, reading.query);
      if (!member) {
        if (score === null) return undefined;
        if (words.length) {
          const printed = `${card.text} ${card.pendulumText ?? ""}`.toLowerCase();
          if (!words.every(word => printed.includes(word))) return undefined;
        }
      }
      return { candidate, category: member ? "archetype" : "phrase", reason: member ? `Archetype: ${card.archetype ?? card.name}` : `Matches: ${reading.chips.join("; ")}`, score: (member ? 100 : score ?? 0) + cardEraBoost(card, era), linked: 0 };
    };
    // Retain enough anchors even for a very small requested preview.
    // The catalog and hook matches are prepared before request selection.
    for (const candidate of identities.candidates) {
      const choice = coreChoice(candidate);
      if (!choice) continue;
      coreMatched.add(candidate.card.id);
      retain(anchorChoices, choice, 32, compare);
      if (!existing.has(identities.canonical(candidate.card.id))) retain(core, choice, targetCount, compare);
      considerRoles(choice);
    }
    if (!anchorChoices.length) { preview.warnings.push("No cards matched this phrase in the cached catalog."); return finish(preview); }

    const anchors = anchorChoices.map(choice => choice.candidate);
    preview.warnings.push(...index.warningsFor(anchors));
    const rankedPartners = index.rankPartners(anchors);
    const partners: Choice[] = [];
    const staples = new Map<SeedRole, Choice[]>(roles.map(role => [role, []]));
    for (const candidate of identities.candidates) {
      if (existing.has(identities.canonical(candidate.card.id)) || coreMatched.has(candidate.card.id) || !matchesReleased(candidate.card, reading.query.released)) continue;
      const result = rankedPartners.get(candidate.card.id);
      if (result && result.score > 0) {
        const choice: Choice = { candidate, category: "partner", reason: result.reason, score: result.score + cardEraBoost(candidate.card, era), linked: result.linkedCards };
        retain(partners, choice, targetCount, compare);
        considerRoles(choice);
      }
      // Broad staples must not depend on an unrelated archetype.
      if (candidate.card.archetype) continue;
      for (const role of roles) if (candidate.tags?.roles.includes(role)) {
        const choice: Choice = { candidate, category: "staple", reason: `Role quota: ${role.replaceAll("_", " ")}`, score: cardEraBoost(candidate.card, era), linked: 0 };
        retain(staples.get(role)!, choice, targetCount, compare);
        considerRoles(choice);
      }
    }

    const selected = new Set(existing);
    const add = (choice: Choice): boolean => {
      const { card, tags } = choice.candidate;
      if (selected.has(identities.canonical(card.id)) || preview.rows.length >= targetCount) return false;
      selected.add(identities.canonical(card.id));
      preview.rows.push({ id: identities.canonical(card.id), name: card.name, copies: maxCopies, pool: isExtraDeckCard(card) ? "extra" : "main", category: choice.category, reason: choice.reason, roles: [...tags?.roles ?? []] });
      for (const role of roles) if (tags?.roles.includes(role)) roleQuotas[role].selected++;
      return true;
    };
    // Keep room for unmet roles before spending the remaining category slots.
    // A first core card always anchors the seed, even if a tiny target cannot fit every role.
    const leavesQuotaSpace = (choice: Choice) => {
      const needed = roles.reduce((sum, role) => sum + Math.max(0, roleQuotas[role].target - roleQuotas[role].selected - (choice.candidate.tags?.roles.includes(role) ? 1 : 0)), 0);
      return preview.rows.length + 1 + needed <= targetCount;
    };
    for (const choice of core) {
      if (preview.rows.length >= Math.ceil(targetCount * 0.6)) break;
      if (!preview.rows.length || leavesQuotaSpace(choice)) add(choice);
    }
    for (const choice of partners) {
      if (preview.rows.length >= Math.ceil(targetCount * 0.8)) break;
      if (leavesQuotaSpace(choice)) add(choice);
    }
    for (const role of roles) for (const choice of quotaChoices.get(role)!) {
      if (roleQuotas[role].selected >= roleQuotas[role].target) break;
      add(choice);
    }
    // Fill unused category slots with remaining relevant cards, then role staples.
    for (const choice of [...core, ...partners]) add(choice);
    const remainingStaples = [...staples.values()].flat().sort(compare);
    for (const choice of remainingStaples) add(choice);
    if (preview.rows.length < targetCount) preview.warnings.push(`Only ${preview.rows.length} of ${targetCount} new cards are available in the cached catalog.`);
    for (const role of roles) if (roleQuotas[role].selected < roleQuotas[role].target) preview.warnings.push(`Role quota for ${role.replaceAll("_", " ")}: ${roleQuotas[role].selected} of ${roleQuotas[role].target}.`);
    return finish(preview);
  }
}
