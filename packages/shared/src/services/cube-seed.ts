import type Database from "better-sqlite3";
import { ExpectedError } from "../observability/index.js";
import type { CubePool } from "../types/index.js";
import { isExtraDeckCard } from "../cards/effects/card.js";
import { matchCard } from "../cards/effects/effect-match.js";
import { compactEffectName } from "../cards/effects/name-match.js";
import { scoreForDeck, type ArchetypeProfile, type Candidate } from "../cards/effects/synergy.js";
import type { Interpretation } from "../cards/effects/query.js";
import { createInsightCatalog } from "./card-insight-catalog.js";
import { createCardInsightService } from "./card-insights.js";
import { DEFAULT_CUBE_COPIES, MAX_CUBE_COPIES } from "./constants.js";

export interface CubeSeedOptions { phrase: string; targetCount?: number; maxCopies?: number }
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
  rows: CubeSeedRow[];
  roleQuotas: Record<SeedRole, { target: number; selected: number }>;
  warnings: string[];
}
type Choice = { candidate: Candidate; category: CubeSeedRow["category"]; reason: string; score: number; linked: number };
const compare = (a: Choice, b: Choice) => b.linked - a.linked || b.score - a.score || b.candidate.card.views - a.candidate.card.views || a.candidate.card.id - b.candidate.card.id;
function retain(choices: Choice[], choice: Choice, limit: number) {
  if (choices.length === limit && compare(choice, choices[choices.length - 1]!) >= 0) return;
  choices.push(choice);
  choices.sort(compare);
  if (choices.length > limit) choices.pop();
}

/** Read-only, bounded selection from the cached catalog. No cube or catalog writes. */
export function previewCubeSeed(db: Database.Database, input: CubeSeedOptions, existingIds: readonly number[]): CubeSeedPreview {
  const { phrase, targetCount = 180, maxCopies = DEFAULT_CUBE_COPIES } = input;
  if (typeof phrase !== "string" || !phrase.trim() || phrase.length > 512) throw new ExpectedError("phrase must contain 1 to 512 characters", 400);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 500) throw new ExpectedError("targetCount must be a whole number from 1 to 500", 400);
  if (!Number.isInteger(maxCopies) || maxCopies < 1 || maxCopies > MAX_CUBE_COPIES) throw new ExpectedError(`maxCopies must be a whole number from 1 to ${MAX_CUBE_COPIES}`, 400);
  const fractions = { searcher: 0.12, extender: 0.18, removal: 0.12, hand_trap: 0.08 };
  const roleQuotas = Object.fromEntries(roles.map(role => [role, { target: Math.max(targetCount >= 4 ? 1 : 0, Math.floor(targetCount * fractions[role])), selected: 0 }])) as CubeSeedPreview["roleQuotas"];
  const reading = createCardInsightService(db).readQuery(phrase);
  const preview: CubeSeedPreview = { phrase: phrase.trim(), targetCount, maxCopies, reading, rows: [], roleQuotas, warnings: [] };
  if (!reading) { preview.warnings.push("No cards matched this phrase. Try an archetype or an effect description."); return preview; }

  const catalog = createInsightCatalog(db);
  try {
    const existing = new Set(existingIds.map(catalog.canonical));
    const names = new Set([...reading.query.card.archetypes, ...reading.query.supports?.archetypes ?? []].map(compactEffectName));
    const words = reading.query.text.toLowerCase().split(/\s+/).filter(Boolean);
    const core: Choice[] = [];
    // Retain enough anchors even for a very small requested preview.
    for (const candidate of catalog.candidates()) {
      const { card, tags } = candidate;
      const member = names.has(compactEffectName(card.archetype ?? "")) || names.has(compactEffectName(card.name));
      const score = matchCard(card, tags, reading.query);
      const printed = `${card.text} ${card.pendulumText ?? ""}`.toLowerCase();
      if (!member && (score === null || !words.every(word => printed.includes(word)))) continue;
      retain(core, { candidate, category: member ? "archetype" : "phrase", reason: member ? `Archetype: ${card.archetype ?? card.name}` : `Matches: ${reading.chips.join("; ")}`, score: member ? 100 : score ?? 0, linked: 0 }, Math.max(targetCount + existing.size, 32));
    }
    if (!core.length) { preview.warnings.push("No cards matched this phrase in the cached catalog."); return preview; }

    const anchors = core.slice(0, 32).map(choice => choice.candidate);
    const profiles = new Map<string, ArchetypeProfile>();
    const findProfile = db.prepare<[string], { plan: string; hooks_json: string }>("SELECT plan,hooks_json FROM card_tag_profiles WHERE archetype=? COLLATE NOCASE");
    for (const { card } of anchors) {
      if (!card.archetype || profiles.has(card.archetype)) continue;
      const row = findProfile.get(card.archetype);
      if (row) profiles.set(card.archetype, { plan: row.plan, hooks: JSON.parse(row.hooks_json) as ArchetypeProfile["hooks"] });
    }
    const coreIds = new Set(core.map(choice => choice.candidate.card.id));
    const partners: Choice[] = [];
    const staples = new Map<SeedRole, Choice[]>(roles.map(role => [role, []]));
    for (const candidate of catalog.candidates()) {
      if (existing.has(candidate.card.id) || coreIds.has(candidate.card.id)) continue;
      const result = scoreForDeck(candidate, anchors, profiles);
      if (result.score > 0) retain(partners, { candidate, category: "partner", reason: result.reason, score: result.score, linked: result.linkedCards }, targetCount);
      // Broad staples must not depend on an unrelated archetype.
      if (candidate.card.archetype) continue;
      for (const role of roles) if (candidate.tags?.roles.includes(role)) {
        retain(staples.get(role)!, { candidate, category: "staple", reason: `Role quota: ${role.replaceAll("_", " ")}`, score: 0, linked: 0 }, targetCount);
      }
    }

    const selected = new Set(existing);
    const add = (choice: Choice): boolean => {
      const { card, tags } = choice.candidate;
      if (selected.has(card.id) || preview.rows.length >= targetCount) return false;
      selected.add(card.id);
      preview.rows.push({ id: card.id, name: card.name, copies: maxCopies, pool: isExtraDeckCard(card) ? "extra" : "main", category: choice.category, reason: choice.reason, roles: tags?.roles ?? [] });
      for (const role of roles) if (tags?.roles.includes(role)) roleQuotas[role].selected++;
      return true;
    };
    for (const choice of core) { if (preview.rows.length >= Math.ceil(targetCount * 0.6)) break; add(choice); }
    for (const choice of partners) { if (preview.rows.length >= Math.ceil(targetCount * 0.8)) break; add(choice); }
    for (const role of roles) for (const choice of staples.get(role)!) {
      if (roleQuotas[role].selected >= roleQuotas[role].target) break;
      add(choice);
    }
    // Fill unused category slots with remaining relevant cards, then role staples.
    for (const choice of [...core, ...partners]) add(choice);
    const remainingStaples = [...staples.values()].flat().sort(compare);
    for (const choice of remainingStaples) add(choice);
    if (preview.rows.length < targetCount) preview.warnings.push(`Only ${preview.rows.length} of ${targetCount} new cards are available in the cached catalog.`);
    for (const role of roles) if (roleQuotas[role].selected < roleQuotas[role].target) preview.warnings.push(`Role quota for ${role.replaceAll("_", " ")}: ${roleQuotas[role].selected} of ${roleQuotas[role].target}.`);
    return preview;
  } finally { catalog.close(); }
}
