import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Static gem art from Board 01's symbols; SVG colours deliberately live in the art.
const bodies: Record<string, { top: string; bottom: string; stroke: string; highlight: number; facets?: number }> = {
  Bronze: { top: "#e8c39e", bottom: "#b9824d", stroke: "#7a4d22", highlight: 0.5, facets: 0.22 },
  Silver: { top: "#f1f5f9", bottom: "#a9b5c6", stroke: "#6b7789", highlight: 0.55, facets: 0.3 },
  Gold: { top: "#ffe9a8", bottom: "#e2ad2e", stroke: "#7d5c12", highlight: 0.55, facets: 0.3 },
  Platinum: { top: "#d6f1ff", bottom: "#5cbde9", stroke: "#226a8f", highlight: 0.6, facets: 0.35 },
  none: { top: "#c7ccda", bottom: "#7c8296", stroke: "#4f5468", highlight: 0.4 },
};

const TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"];
const isTier = (tier: string) => TIERS.includes(tier);

export function RankGem({ tier, size = "sm", className }: {
  tier: string;
  size?: "sm" | "lg" | "xl";
  className?: string;
}) {
  const gradientId = `sheet-gem-${useId()}`;
  const body = Object.hasOwn(bodies, tier) ? bodies[tier] : bodies.none;
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("gem", size === "lg" && "lg", size === "xl" && "xl", className)}
      aria-hidden="true"
      focusable="false"
    >
      {tier === "Diamond" ? (
        <>
          <path d="M2 9h10v13Z" fill="#b7a3ff" />
          <path d="M22 9H12v13Z" fill="#dcd2ff" />
          <path d="M2 9l4-6 6 6Z" fill="#8fe3ff" />
          <path d="M22 9l-4-6-6 6Z" fill="#ffb8ee" />
          <path d="M6 3h12l-6 6Z" fill="#fff" />
          <path d="M6 3h12l4 6-10 13L2 9Z" fill="none" stroke="#6f62c4" strokeWidth="1" strokeLinejoin="round" />
          <path d="M20.6.4l.75 1.95 1.95.75-1.95.75-.75 1.95-.75-1.95-1.95-.75 1.95-.75Z" fill="#fff" stroke="#6f62c4" strokeWidth=".5" />
        </>
      ) : (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={body.top} />
              <stop offset="1" stopColor={body.bottom} />
            </linearGradient>
          </defs>
          <path d="M6 3h12l4 6-10 13L2 9Z" fill={`url(#${gradientId})`} stroke={body.stroke} strokeWidth="1" strokeLinejoin="round" />
          <path d="M6 3h12l-6 6Z" fill="#fff" fillOpacity={body.highlight} />
          {body.facets !== undefined && (
            <path d="M2 9h20M9 9l3 13 3-13" fill="none" stroke="#fff" strokeOpacity={body.facets} strokeWidth=".8" />
          )}
        </>
      )}
    </svg>
  );
}

export function TierName({ tier, gem = true, children, className }: {
  tier: string;
  gem?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const known = isTier(tier);
  const style: CSSProperties | undefined = known ? undefined : { color: "var(--t-none)" };
  return (
    <span className={cn("tier", className)} data-t={known ? tier : "none"} style={style}>
      {gem && <RankGem tier={tier} />}
      {children ?? tier}
    </span>
  );
}
