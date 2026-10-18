/** Adapted from LorenzoWhite/searchygo scripts/profile-archetypes.ts, commit
 * 9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c. See NOTICE for attribution.
 * Selection and reply validation only; the shared Batch runner owns all spend. */
import { createHash } from "node:crypto";
import { ArchetypeProfile, readProfile, type Card } from "@yugidraft/shared/cards/effects";
import { renderCard } from "./tagging-prompt.js";
import { MAX_CARDS_SHOWN, SYNERGY_EXAMPLES } from "./synergy-prompt.js";

export interface StoredProfile { archetype: string; cards: number; model: string; profile: ArchetypeProfile; inputHash?: string }
export function profileInputHash(archetype: string, cards: Card[]): string {
  return createHash("sha256").update(JSON.stringify([archetype, [...cards].sort((a,b) => a.id-b.id).map(renderCard)])).digest("hex");
}
export function profileCandidates(cards: Card[], stored: StoredProfile[], taggedIds?: ReadonlySet<number>) {
  const groups = new Map<string, Card[]>(), prior = new Map(stored.map(row => [row.archetype, row]));
  for (const card of cards) if (card.archetype && !card.subtypes.includes("token")) groups.set(card.archetype, [...(groups.get(card.archetype) ?? []), card]);
  return [...groups].filter(([, members]) => members.length >= 3).map(([archetype, members]) => {
    // Keep new members in the prompt even when they have no popularity yet.
    const ordered = [...members].sort((a,b) => Number(taggedIds?.has(a.id) ?? true)-Number(taggedIds?.has(b.id) ?? true) || b.views-a.views || a.id-b.id);
    return { archetype, members, cards: ordered.slice(0, MAX_CARDS_SHOWN), inputHash: profileInputHash(archetype, members) };
  }).filter(row => {
    const old = prior.get(row.archetype);
    if (old?.model === "hand-written" || SYNERGY_EXAMPLES.some(example => example.archetype === row.archetype)) return false;
    return !old || (old.inputHash ? old.inputHash !== row.inputHash : row.members.length > old.cards);
  }).sort((a,b) => b.members.reduce((sum,c) => sum+c.views,0)-a.members.reduce((sum,c) => sum+c.views,0) || a.archetype.localeCompare(b.archetype));
}
export function validateProfileReply(value: unknown, archetype: string): ArchetypeProfile {
  const raw = ArchetypeProfile.parse(value), parsed = readProfile(raw, archetype);
  if (!parsed || parsed.dropped.length) throw new Error("Invalid or unusable archetype hooks");
  return ArchetypeProfile.parse(parsed.profile);
}
