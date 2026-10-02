"use client";

import { memo } from "react";
import type { CardSummary } from "@/lib/card-types";
import { attributeBreakdown, typeBreakdown, type BreakdownEntry } from "@/lib/pool-breakdown";
import { cn } from "@/lib/utils";
import styles from "./summary/chips.module.css";

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
    const list = (label: string, entries: BreakdownEntry[]) => (
      <ul aria-label={label} className={cn(styles.list)}>
        {entries.map((e) => (
          <li key={e.label} className="chip">
            {e.label} <b>{e.count}</b>
          </li>
        ))}
      </ul>
    );
    return (
      <>
        {attrs.length > 0 && list("Attributes drafted", attrs)}
        {types.length > 0 && list("Types drafted", types)}
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
