import { z } from "zod";
import type { ArchetypeBridge } from "./bridge-types.js";

const cardId = z.number().int().positive().max(0xffffffff);
/** Shared by host projections and the web response validator. */
export const BridgePackageSchema = z.object({
  cards: z.array(cardId).max(300),
  missing: z.array(cardId).max(300),
  alreadyInDeck: z.boolean(),
}).refine(value => new Set(value.cards).size === value.cards.length
  && value.missing.every(id => value.cards.includes(id))
  && value.alreadyInDeck === (value.cards.length > 0 && value.missing.length === 0),
{ message: "Package ownership must agree with its missing cards" });

export type BridgePackage = z.infer<typeof BridgePackageSchema>;

/** Count shared cards once at their largest required material multiplicity. */
export function bridgePackage(rows: readonly ArchetypeBridge[], deckCards: readonly number[] = []): BridgePackage {
  const required = new Map<number, number>();
  for (const row of rows) for (const id of row.cards) required.set(id, Math.max(required.get(id) ?? 0, 1,
    ...row.reasons.map(reason => reason.materials?.filter(code => code === id).length ?? 0)));
  const cards = [...required.keys()].sort((a, b) => a - b), missing: number[] = [];
  for (const id of cards) {
    const count = Math.max(0, required.get(id)! - deckCards.filter(code => code === id).length);
    for (let i = 0; i < count; i++) missing.push(id);
  }
  return BridgePackageSchema.parse({ cards, missing, alreadyInDeck: cards.length > 0 && missing.length === 0 });
}
