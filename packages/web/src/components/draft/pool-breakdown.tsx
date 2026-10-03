"use client";

import { memo } from "react";
import type { CardSummary } from "@/lib/card-types";
import { attributeBreakdown, typeBreakdown, type BreakdownEntry } from "@/lib/pool-breakdown";
import { cn } from "@/lib/utils";
import { monsterTypeBreakdown } from "./summary/groups";
import styles from "./summary/chips.module.css";

const ATTRIBUTE_COLORS: Record<string, string> = {
  DARK: "#9b7eff", LIGHT: "#f2d16b", EARTH: "#c79a5b", WATER: "#5aa9e6",
  FIRE: "#ef7a45", WIND: "#5cc98a", DIVINE: "#e0b84e",
};

function Chip({ entry }: { entry: BreakdownEntry }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-bg-elevated px-2 py-0.5 text-xs text-text-secondary">
      {entry.label}
      <span className="font-semibold tabular-nums text-text-primary">{entry.count}</span>
    </span>
  );
}

function PoolBreakdownBase({ cards, variant = "default" }: { cards: CardSummary[]; variant?: "default" | "sheet" }) {
  const attrs = attributeBreakdown(cards);
  const types = typeBreakdown(cards);
  if (attrs.length === 0 && types.length === 0) return null;

  if (variant === "sheet") {
    const monsterTypes = monsterTypeBreakdown(cards);
    const list = (label: string, ariaLabel: string, entries: BreakdownEntry[], attribute = false) => (
      <div className={styles.row}>
        <span className={styles.label}>{label}</span>
        <ul aria-label={ariaLabel} className={cn(styles.list)}>
          {entries.map((e) => (
            <li key={e.label} className="chip">
              {attribute && <span className={styles.dot} style={{ backgroundColor: ATTRIBUTE_COLORS[e.label] }} aria-hidden="true" />}
              {attribute ? e.label.charAt(0).toUpperCase() + e.label.slice(1).toLowerCase() : e.label} <b>{e.count}</b>
            </li>
          ))}
        </ul>
      </div>
    );
    return (
      <>
        {attrs.length > 0 && list("Attribute", "Attributes drafted", attrs, true)}
        {monsterTypes.length > 0 && list("Monsters", "Monster kinds drafted", monsterTypes)}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {attrs.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Attributes drafted">
          {attrs.map((e) => (
            <Chip key={e.label} entry={e} />
          ))}
        </div>
      )}
      {types.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Types drafted">
          {types.map((e) => (
            <Chip key={e.label} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

export const PoolBreakdown = memo(PoolBreakdownBase);
