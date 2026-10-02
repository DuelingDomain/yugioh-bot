// One icon per log category, for lines that have no icon of their own (the Text log).
// The colour comes from the line's data-cat in CSS; the icon is the cue that does not depend on colour.
import { Ban, CircleDot, Download, Skull, Sparkles, SquareDashed, Swords, Zap, type LucideIcon } from "lucide-react";
import type { LogCategory } from "./log-category";

const GLYPH: Record<LogCategory, LucideIcon> = {
  summon: Sparkles,
  chain: Zap,
  battle: Swords,
  destroy: Skull,
  banish: Ban,
  set: SquareDashed,
  hand: Download,
  system: CircleDot,
};

export function LogCategoryGlyph({ category, className }: { category: LogCategory; className?: string }) {
  const Icon = GLYPH[category];
  return <Icon className={className} size={12} strokeWidth={2.25} aria-hidden />;
}
