import {
  DEFAULT_GENESYS_POINT_CAP,
  MAX_GENESYS_POINT_CAP,
  genesysDeckPoints,
  isGenesysForbiddenType,
  type DeckCardInfo,
  type DuelDeck,
  type DuelDeckCardRef,
  type DuelMode,
  type GenesysCard,
  type GenesysSettings,
} from "@yugidraft/shared/duels";
import { modeLabel } from "./model";

export { DEFAULT_GENESYS_POINT_CAP, MAX_GENESYS_POINT_CAP };

export const GENESYS_FORBIDDEN_MESSAGE = "Link and Pendulum Monsters are not allowed in Genesys.";

/** The name a format has in lists and menus: Genesys is a points rule that sits on top of Standard or Domain. */
export function formatLabel(mode: DuelMode, genesys: GenesysSettings | null | undefined): string {
  if (!genesys) return modeLabel(mode);
  return mode === "domain" ? "Genesys Domain" : "Genesys";
}

/** The point cap typed in a field: a whole number from 0 to the maximum, or null. */
export function parsePointCap(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= MAX_GENESYS_POINT_CAP ? value : null;
}

/** What a card tile shows: points when there are some, a ban sign for Link and Pendulum, "?" when points are not known. */
export type GenesysMark =
  | { kind: "points"; points: number }
  | { kind: "forbidden" }
  | { kind: "unknown" };

export function genesysMark(card: Pick<DeckCardInfo, "type" | "genesysPoints"> | null | undefined): GenesysMark | null {
  if (!card) return null;
  if (isGenesysForbiddenType(card)) return { kind: "forbidden" };
  const points = card.genesysPoints;
  if (typeof points !== "number" || !Number.isSafeInteger(points) || points < 0) return { kind: "unknown" };
  return points > 0 ? { kind: "points", points } : null;
}

/** The words for a mark, for a title or a screen reader. */
export function genesysMarkText(mark: GenesysMark): string {
  if (mark.kind === "forbidden") return "Not allowed in Genesys";
  if (mark.kind === "unknown") return "Genesys points unknown";
  return `${mark.points} Genesys ${mark.points === 1 ? "point" : "points"}`;
}

/** The long form for the card panel; a card with no points says so. */
export function genesysCardLine(card: Pick<DeckCardInfo, "type" | "genesysPoints">): string {
  if (isGenesysForbiddenType(card)) return "Not allowed in Genesys";
  const mark = genesysMark(card);
  if (mark == null) return "0 Genesys points";
  return genesysMarkText(mark);
}

export type GenesysPointsState = "ok" | "over" | "unknown" | "pending";

export interface GenesysSummary {
  cap: number;
  /** null while any copy has unknown points. */
  total: number | null;
  /** The points of the copies that are known. */
  known: number;
  /** Points above the cap, counted from the known copies. */
  over: number;
  /** Copies whose points the card data does not give. */
  unknownCount: number;
  /** Copies whose card details have not loaded yet. */
  pendingCount: number;
  /** Link and Pendulum copies, the Deck Master included. */
  forbidden: DuelDeckCardRef[];
  /** Copies the points of which are not known (not loading). */
  unknownCards: DuelDeckCardRef[];
  state: GenesysPointsState;
}

/**
 * The Genesys figures of a deck. Every copy counts, in Main, Extra and Side, and so does the Deck Master of a
 * Domain deck. A card that is still loading is "pending", so a loading deck never shows a small total as final.
 * `settled` holds the codes a lookup has answered for without a card (unknown or failed).
 */
export function summarizeGenesys(
  deck: DuelDeck,
  mode: DuelMode,
  catalog: ReadonlyMap<number, GenesysCard>,
  settings: GenesysSettings,
  settled: ReadonlySet<number> = new Set(),
): GenesysSummary {
  const counted: DuelDeck = mode === "domain" || deck.deckMaster == null
    ? deck
    : { main: deck.main, extra: deck.extra, side: deck.side };
  const { totalPoints, knownPoints, unknownCards } = genesysDeckPoints(counted, catalog);
  const isPending = (code: number): boolean => {
    if (settled.has(code)) return false;
    const card = catalog.get(code);
    if (!card) return true;
    return card.alias != null && card.alias > 0 && !catalog.has(card.alias) && !settled.has(card.alias);
  };
  const pending = unknownCards.filter((ref) => isPending(ref.code));
  const unknownOnly = unknownCards.filter((ref) => !isPending(ref.code));
  const forbidden: DuelDeckCardRef[] = [];
  for (const section of ["main", "extra", "side", "deckMaster"] as const) {
    const codes = section === "deckMaster" ? (counted.deckMaster == null ? [] : [counted.deckMaster]) : counted[section];
    codes.forEach((code, index) => {
      const card = catalog.get(code);
      if (isGenesysForbiddenType(card)) forbidden.push({ section, index, code, ...(card ? { name: card.name } : {}) });
    });
  }
  const over = Math.max(0, knownPoints - settings.pointCap);
  const state: GenesysPointsState = over > 0 ? "over" : unknownOnly.length > 0 ? "unknown" : pending.length > 0 ? "pending" : "ok";
  return {
    cap: settings.pointCap,
    total: totalPoints,
    known: knownPoints,
    over,
    unknownCount: unknownOnly.length,
    pendingCount: pending.length,
    forbidden,
    unknownCards: unknownOnly,
    state,
  };
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export interface GenesysVerdict {
  tone: "bad" | "warn" | "ok";
  /** One line for the deck check. Not allowed cards come first, then the cap, then missing data. */
  flag: string;
}

export function genesysVerdict(summary: GenesysSummary): GenesysVerdict {
  const forbidden = summary.forbidden.length;
  if (forbidden > 0) {
    return { tone: "bad", flag: `${forbidden} ${plural(forbidden, "card is", "cards are")} not allowed in Genesys` };
  }
  if (summary.over > 0) {
    return { tone: "bad", flag: `${summary.over} ${plural(summary.over, "point", "points")} over the Genesys cap` };
  }
  if (summary.unknownCount > 0) {
    return { tone: "warn", flag: `Genesys points are unknown for ${summary.unknownCount} ${plural(summary.unknownCount, "card", "cards")}` };
  }
  if (summary.pendingCount > 0) return { tone: "warn", flag: "Counting Genesys points…" };
  return { tone: "ok", flag: `Genesys: ${summary.known} of ${summary.cap} points` };
}

/** "87" for a full count, "87+" while some copies have no points yet. */
export function genesysTotalText(summary: GenesysSummary): string {
  return summary.total != null ? String(summary.total) : `${summary.known}+`;
}

/** The first card with this code in each place the summary lists, one entry per distinct card. */
export function distinctRefs(refs: readonly DuelDeckCardRef[]): { ref: DuelDeckCardRef; count: number }[] {
  const byCode = new Map<number, { ref: DuelDeckCardRef; count: number }>();
  for (const ref of refs) {
    const found = byCode.get(ref.code);
    if (found) found.count += 1;
    else byCode.set(ref.code, { ref, count: 1 });
  }
  return [...byCode.values()];
}
