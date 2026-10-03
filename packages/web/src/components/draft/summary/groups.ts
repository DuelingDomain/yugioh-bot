import { isExtraDeckMonster, isMonster, isSpell, isTrap, type CardSummary } from "@/lib/card-types";
import type { BreakdownEntry } from "@/lib/pool-breakdown";

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

/** Specific monster keywords take precedence over the generic Normal / Effect suffix. */
const MONSTER_LABELS = [
  "Fusion", "Synchro", "Xyz", "Link", "Ritual", "Pendulum", "Flip",
  "Tuner", "Toon", "Spirit", "Union", "Gemini", "Normal", "Effect",
];

/** Short monster types for the finished sheet. Each drafted card counts once. */
export function monsterTypeBreakdown(cards: CardSummary[]): BreakdownEntry[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (!isMonster(card.type) || isSpell(card.type) || isTrap(card.type) || /skill card/i.test(card.type)) continue;
    const type = card.type.trim().toLowerCase();
    const label = MONSTER_LABELS.find((name) => type.includes(name.toLowerCase()))
      ?? type.replace(/\s*monster\b/g, "").replace(/^./, (letter) => letter.toUpperCase()).trim();
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b))
    .map(([label, count]) => ({ label, count }));
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
