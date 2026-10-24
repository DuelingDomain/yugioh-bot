/**
 * What a board card shows about its status: a rail of protection glyphs (edge rail), a stack of counter coins
 * (crest + stack) and the negated chip. A pure model of `DuelCard.hints / counters / negated`, shared by the board
 * layer (card-status.tsx) and the inspector lists, so both say the same thing. The glyph set, colours and legend
 * follow the owner-approved demo (2026-10-23).
 */
import {
  DUEL_COUNTER_FAMILIES,
  DUEL_COUNTER_GLYPHS,
  getDuelCounterMetadata,
  type DuelCard,
  type DuelCounterFamily,
  type DuelCounterGlyph,
  type DuelProtectionCategory,
} from "@yugidraft/shared/duels";
import { formatStat, TYPE_LINK } from "./constants";

/** Rail glyphs in the order they show (most important first). */
export type StatusKind = "neg" | "imM" | "imS" | "imT" | "imAll" | "noBD" | "noED" | "noTgt" | "noAtk" | "info";

export const STATUS_ORDER: readonly StatusKind[] = ["neg", "imM", "imS", "imT", "imAll", "noBD", "noED", "noTgt", "noAtk", "info"];

const KIND_OF: Record<DuelProtectionCategory, StatusKind> = {
  "unaffected-monsters": "imM",
  "unaffected-spells": "imS",
  "unaffected-traps": "imT",
  "unaffected-effects": "imAll",
  "cannot-be-destroyed-by-battle": "noBD",
  "cannot-be-destroyed-by-effects": "noED",
  "cannot-be-targeted": "noTgt",
  "cannot-be-attacked": "noAtk",
  status: "info",
};

/** The legend line of a glyph, for a kind with no engine text of its own. */
export const STATUS_LABEL: Record<StatusKind, string> = {
  neg: "Effects negated",
  imM: "Unaffected by Monsters effects",
  imS: "Unaffected by Spells effects",
  imT: "Unaffected by Traps effects",
  imAll: "Unaffected by other cards' effects",
  noBD: "Cannot be destroyed by battle",
  noED: "Cannot be destroyed by card effects",
  noTgt: "Cannot be targeted by card effects",
  noAtk: "Cannot be attacked",
  info: "Other engine hint",
};

/** One line of the drawer list: a glyph and the full engine text (qualifiers kept). */
export interface StatusLine {
  /** The glyphs of the line (a combined Spell/Trap hint has two). */
  kinds: StatusKind[];
  text: string;
  negated?: boolean;
}

export interface CounterBadge {
  type: number;
  count: number;
  name: string;
  family: DuelCounterFamily;
  color: string;
  glyph: DuelCounterGlyph;
  /** SVG interior (24 x 24, fill currentColor). */
  svg: string;
  /** Card-specific counters with no glyph of their own show the initials of the card name. */
  initials: string | null;
}

export interface CardStatusModel {
  /** Rail glyphs, deduplicated, in STATUS_ORDER. */
  rail: StatusKind[];
  /** Drawer lines: negated first, then each hint with its text. */
  lines: StatusLine[];
  counters: CounterBadge[];
  /** Sum of all counts. */
  total: number;
  /** A sentence per item for the zone's accessible name. Negated is left out (the name already says it). */
  summary: string[];
}

export const EMPTY_STATUS: CardStatusModel = { rail: [], lines: [], counters: [], total: 0, summary: [] };

/** "Counter ("Ancient City")" -> "AC". Null when the name holds no quoted card name. */
function initialsOf(name: string): string | null {
  const quoted = /"([^"]+)"/.exec(name)?.[1] ?? /\(([^)]+)\)/.exec(name)?.[1];
  if (!quoted) return null;
  const letters = quoted.split(/[\s\-:]+/).filter((word) => /[A-Za-z0-9]/.test(word)).map((word) => word.replace(/[^A-Za-z0-9]/g, "")[0]!.toUpperCase());
  return letters.slice(0, 2).join("") || null;
}

export function counterBadge(type: number, count: number): CounterBadge {
  const meta = getDuelCounterMetadata(type);
  const family = DUEL_COUNTER_FAMILIES[meta.family] ?? DUEL_COUNTER_FAMILIES.loot;
  // An unknown glyph key (an older or newer wire) falls back to the generic family glyph, never to nothing.
  const svg = DUEL_COUNTER_GLYPHS[meta.glyph] ?? DUEL_COUNTER_GLYPHS[family.glyph];
  return {
    type,
    count,
    name: meta.name,
    family: meta.family,
    color: family.color,
    glyph: meta.glyph,
    svg,
    initials: meta.family === "named" && meta.glyph === "named" ? initialsOf(meta.name) : null,
  };
}

/** The status of a card as the board shows it. A card with no hint, counter or negation gives EMPTY_STATUS. Tolerant of a partial or odd payload. */
export function cardStatusModel(card: DuelCard | null | undefined): CardStatusModel {
  if (!card) return EMPTY_STATUS;
  const hints = Array.isArray(card.hints) ? card.hints : [];
  const counters = (Array.isArray(card.counters) ? card.counters : [])
    .filter((entry) => entry != null && Number.isFinite(entry.type) && Number.isFinite(entry.count) && entry.count > 0)
    .map((entry) => counterBadge(entry.type, entry.count));
  const negated = card.negated === true;
  if (!negated && hints.length === 0 && counters.length === 0) return EMPTY_STATUS;

  const present = new Set<StatusKind>();
  const lines: StatusLine[] = [];
  const summary: string[] = [];
  if (negated) {
    present.add("neg");
    lines.push({ kinds: ["neg"], text: STATUS_LABEL.neg, negated: true });
  }
  for (const hint of hints) {
    const categories = Array.isArray(hint.categories) && hint.categories.length > 0 ? hint.categories : (["status"] as DuelProtectionCategory[]);
    const kinds = [...new Set(categories.map((category) => KIND_OF[category] ?? "info"))].sort((a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b));
    for (const kind of kinds) present.add(kind);
    lines.push({ kinds, text: hint.text });
    summary.push(hint.text);
  }
  for (const badge of counters) summary.push(`${badge.name}: ${badge.count}`);
  return {
    rail: STATUS_ORDER.filter((kind) => present.has(kind)),
    lines,
    counters,
    total: counters.reduce((sum, badge) => sum + badge.count, 0),
    summary,
  };
}

/** The sentence for a zone's accessible name, or null. */
export function statusSentence(model: CardStatusModel): string | null {
  return model.summary.length > 0 ? model.summary.join(". ") : null;
}

/** "99+" past two digits, so a badge never grows. */
export function countText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** The printed ATK / DEF of a monster-zone card when the current values differ ("Base ATK 2500 / DEF 2000"), else null. `baseAttack` / `baseDefense` are optional on the wire. */
export function baseStatsText(card: DuelCard | null | undefined): string | null {
  if (!card) return null;
  const baseAtk = typeof card.baseAttack === "number" ? card.baseAttack : null;
  const baseDef = typeof card.baseDefense === "number" ? card.baseDefense : null;
  // A Link monster has no DEF.
  const link = ((card.type ?? 0) & TYPE_LINK) !== 0;
  const atkDiffers = baseAtk != null && baseAtk !== card.attack;
  const defDiffers = !link && baseDef != null && baseDef !== card.defense;
  if (!atkDiffers && !defDiffers) return null;
  const parts: string[] = [];
  if (baseAtk != null) parts.push(`ATK ${formatStat(baseAtk)}`);
  if (baseDef != null && !link) parts.push(`DEF ${formatStat(baseDef)}`);
  return `Base ${parts.join(" / ")}`;
}

/** Rows of the status list: the negated line first, then each hint, then each counter. */
export function statusListRows(model: CardStatusModel): number {
  return model.lines.length + model.counters.length;
}

/**
 * The height the status list and the base line take, in px: the inspector art gives it up (capped, so the art never vanishes). A row is
 * one 26px line, and a long engine text wraps (about 34 characters to a line in the drawer), each wrapped line adding 19px.
 */
export function statusReservePx(model: CardStatusModel, baseLine: boolean): number {
  const lines = model.lines.reduce((sum, line) => sum + 26 + 19 * (Math.ceil(line.text.length / 34) - 1), 0);
  return Math.min(480, lines + model.counters.length * 26 + (baseLine ? 22 : 0));
}
