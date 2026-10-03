// One icon per log category, for lines that have no icon of their own (the Text log).
// The colour comes from the line's data-cat in CSS; the icon is the cue that does not depend on colour.
import { Ban, CircleDot, Combine, createLucideIcon, Download, Skull, Sparkles, SquareDashed, Swords, Zap, type LucideIcon } from "lucide-react";
import type { LogCategory } from "./log-category";

// A rounded headstone on a ground line, using the same strokes as the Lucide glyphs.
const Graveyard = createLucideIcon("Graveyard", [
  ["path", { d: "M7 21V8a5 5 0 0 1 10 0v13", key: "stone" }],
  ["path", { d: "M4 21h16M10 10h4", key: "lines" }],
]);

const GLYPH: Record<LogCategory, LucideIcon> = {
  summon: Sparkles,
  chain: Zap,
  battle: Swords,
  destroy: Skull,
  graveyard: Graveyard,
  material: Combine,
  banish: Ban,
  set: SquareDashed,
  hand: Download,
  system: CircleDot,
};

export function LogCategoryGlyph({ category, className }: { category: LogCategory; className?: string }) {
  const Icon = GLYPH[category];
  return <Icon className={className} size={12} strokeWidth={2.25} aria-hidden />;
}
