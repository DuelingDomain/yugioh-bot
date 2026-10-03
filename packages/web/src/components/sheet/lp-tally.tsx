import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type LpTallyItem = {
  key: string;
  label: ReactNode;
  aside?: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  was?: ReactNode;
  delta?: { text: string; dir: "up" | "down" | "flat" };
  sub?: ReactNode;
  tone?: "loss" | "tier";
  /** Tier name or key (bronze, silver, gold, platinum, diamond, none) for tone "tier". */
  tier?: string;
};

const TIER_VAR: Record<string, string> = { platinum: "plat", diamond: "dia" };
const tierVar = (tier: string) => {
  const k = tier.toLowerCase();
  return `var(--t-${TIER_VAR[k] ?? k})`;
};

/** Life-point readouts: the headline numbers of a screen. */
export function LpTally({ items, className }: { items: LpTallyItem[]; className?: string }) {
  return (
    <div className={cn("lps", className)} style={{ "--n": items.length } as CSSProperties}>
      {items.map((it) => (
        <div
          key={it.key}
          className="lp"
          data-tone={it.tone}
          style={it.tone === "tier" && it.tier ? ({ "--tier": tierVar(it.tier) } as CSSProperties) : undefined}
        >
          <p className="lp-k">
            {it.label}
            {it.aside != null && <small>{it.aside}</small>}
          </p>
          <p className="lp-v">
            <b>
              {it.value}
              {it.unit != null && <small>{it.unit}</small>}
            </b>
            {it.was != null && <s>{it.was}</s>}
            {it.delta && <span className={cn("lp-d", it.delta.dir)}>{it.delta.text}</span>}
          </p>
          {it.sub != null && <p className="lp-s">{it.sub}</p>}
        </div>
      ))}
    </div>
  );
}
