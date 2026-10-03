// Pure helpers for the dashboard. Everything here works from data the dashboard's own
// queries already return.

const TIERS = ["Bronze", "Silver", "Gold", "Platinum", "Diamond"] as const;

export type TierProgress = {
  tier: string;
  /** Next tier's name, or null at the top. */
  nextTier: string | null;
  /** Elo still needed for the next tier, or null at the top. */
  toNext: number | null;
  /** 0 to 1 through the current tier. */
  fraction: number;
  /** Elo gained inside the tier, and the tier's width; null at the top. */
  into: number | null;
  span: number | null;
};

export function tierProgress(rating: number, rank: { name: string; min: number; nextAt: number | null }): TierProgress {
  const idx = TIERS.indexOf(rank.name as (typeof TIERS)[number]);
  const nextTier = rank.nextAt != null && idx >= 0 ? (TIERS[idx + 1] ?? null) : null;
  if (rank.nextAt == null || nextTier == null) {
    return { tier: rank.name, nextTier: null, toNext: null, fraction: 1, into: null, span: null };
  }
  const span = rank.nextAt - rank.min;
  const into = Math.max(0, Math.min(span, rating - rank.min));
  return {
    tier: rank.name,
    nextTier,
    toNext: Math.max(0, rank.nextAt - rating),
    fraction: span > 0 ? into / span : 0,
    into,
    span,
  };
}

export function winRatePercent(wins: number, losses: number): number {
  const total = wins + losses;
  return total > 0 ? Math.round((wins / total) * 100) : 0;
}

export function tournamentFormatLabel(format: string): string {
  if (format === "round_robin") return "Round robin";
  if (format === "single_elim") return "Single elimination";
  return format.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type DraftStage = { label: string; live: boolean };

/** Active drafts read as live; the rest say where they wait. */
export function draftStatus(status: string): DraftStage {
  return status === "active" ? { label: "Drafting", live: true } : { label: "In the lobby", live: false };
}

export function draftProgressLabel(status: string, round: number, step: number): string | null {
  return status === "active" ? `Pack ${round}, pick ${step}` : null;
}
