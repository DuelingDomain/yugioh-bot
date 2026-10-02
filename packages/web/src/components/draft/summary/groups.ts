import { isExtraDeckMonster, isSpell, isTrap, type CardSummary } from "@/lib/card-types";

export type CardKind = "monster" | "spell" | "trap" | "extra";

export interface PoolGroup {
  key: string;
  title: string;
  cards: CardSummary[];
}

export function cardKind(card: CardSummary): CardKind {
  if (isExtraDeckMonster(card)) return "extra";
  if (isSpell(card.type)) return "spell";
  if (isTrap(card.type)) return "trap";
  return "monster";
}

export function kindTally(cards: CardSummary[]): Record<CardKind, number> {
  const tally: Record<CardKind, number> = { monster: 0, spell: 0, trap: 0, extra: 0 };
  for (const card of cards) tally[cardKind(card)] += 1;
  return tally;
}

/** Cube drafts group by card kind; theme drafts split into main and Extra deck. Empty groups are dropped. */
export function groupPool(cards: CardSummary[], mode: "cube" | "theme"): PoolGroup[] {
  const by = (kinds: CardKind[]) => cards.filter((c) => kinds.includes(cardKind(c)));
  const groups: PoolGroup[] =
    mode === "theme"
      ? [
          { key: "main", title: "Main deck", cards: by(["monster", "spell", "trap"]) },
          { key: "extra", title: "Extra deck", cards: by(["extra"]) },
        ]
      : [
          { key: "monster", title: "Monsters", cards: by(["monster"]) },
          { key: "spell", title: "Spells", cards: by(["spell"]) },
          { key: "trap", title: "Traps", cards: by(["trap"]) },
          { key: "extra", title: "Extra deck", cards: by(["extra"]) },
        ];
  return groups.filter((g) => g.cards.length > 0);
}
