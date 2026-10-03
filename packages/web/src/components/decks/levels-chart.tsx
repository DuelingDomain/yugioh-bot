import type { CSSProperties } from "react";
import { TYPE_LINK, TYPE_MONSTER } from "@/components/duel/constants";
import type { CardCatalog } from "./model";
import styles from "./editor.module.css";

export function mainMonsterLevels(codes: readonly number[], catalog: CardCatalog): number[] {
  const levels = Array<number>(8).fill(0);
  for (const code of codes) {
    const card = catalog.get(code);
    if (!card || !(card.type & TYPE_MONSTER) || (card.type & TYPE_LINK) || card.level < 1) continue;
    const index = Math.min(8, Math.floor(card.level)) - 1;
    levels[index] = (levels[index] ?? 0) + 1;
  }
  return levels;
}

export function MonsterLevelsChart({ codes, catalog }: { codes: readonly number[]; catalog: CardCatalog }) {
  const levels = mainMonsterLevels(codes, catalog);
  const groups = [
    { label: "No tribute", start: 0, end: 4 },
    { label: "1 tribute", start: 4, end: 6 },
    { label: "2 tributes", start: 6, end: 8 },
  ];
  const totals = groups.map(({ start, end }) => levels.slice(start, end).reduce((sum, count) => sum + count, 0));
  const peak = Math.max(1, ...levels);
  const label = `Main Deck monsters by level: ${totals[0]} need no tribute, ${totals[1]} need one tribute, ${totals[2]} need two tributes. ${levels.map((count, index) => `Level ${index === 7 ? "8+" : index + 1}: ${count}`).join(". ")}.`;
  return (
    <div className={styles["df-lv"]} role="img" aria-label={label}>
      <p className={styles["df-lv-h"]}><span>Monster levels</span><small>Main deck, by stars</small></p>
      <div className={styles["df-lv-c"]} aria-hidden="true">
        {groups.map((group, groupIndex) => (
          <div key={group.label} className={styles["df-band"]} data-t={groupIndex || undefined} style={{ "--cols": group.end - group.start } as CSSProperties}>
            <span className={styles["df-bars"]}>
              {levels.slice(group.start, group.end).map((count, index) => <span key={index} data-zero={count === 0 ? "" : undefined} style={{ "--h": count / peak } as CSSProperties}><b>{count}</b><small>{group.start + index === 7 ? "8+" : group.start + index + 1}</small></span>)}
            </span>
            <span className={styles["df-bt"]}>{group.label} <b>{totals[groupIndex]}</b></span>
          </div>
        ))}
      </div>
      <ul className={styles["df-totals"]} aria-hidden="true">
        {groups.map((group, index) => <li key={group.label}>{group.label} <b>{totals[index]}</b></li>)}
      </ul>
    </div>
  );
}
