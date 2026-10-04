import type { BugFormat } from "../bug-report";

/**
 * Problems the team already knows. The report dialog shows a match ("This is already known") before the final send;
 * the player can still go on with "My bug is different". Add an entry here when a known problem starts to get reports,
 * and remove it when the fix ships.
 */
export interface KnownLimit {
  id: string;
  title: string;
  explanation: string;
  /** The text matches when ANY of these matches (description and expected, case-insensitive). */
  patterns: readonly RegExp[];
  /** Only for these duel formats. A report with no duel (a page report) still matches on the text. */
  formats?: readonly BugFormat[];
  duelModes?: ReadonlyArray<"normal" | "domain">;
}

export type PublicKnownLimit = Pick<KnownLimit, "id" | "title" | "explanation">;

export const KNOWN_LIMITS: readonly KnownLimit[] = [
  {
    id: "eliminated-card-wrong-graveyard",
    title: "A card of an eliminated player in an open chain can go to the wrong Graveyard",
    explanation:
      "When a player is eliminated while a chain is open, a card of that player that is still on the chain can end up in another player's Graveyard. This is a known problem in 3-way and 4-way duels.",
    patterns: [
      /(eliminat|knocked out|left the duel|dropped out|is out)[^.\n]*(graveyard|\bgy\b|\bgrave\b)/i,
      /(graveyard|\bgy\b|\bgrave\b)[^.\n]*(eliminat|knocked out|left the duel|dropped out)/i,
    ],
    formats: ["ffa3", "ffa4"],
  },
  {
    id: "tag-extra-monster-zone",
    title: "Tag duels: the Extra Monster Zone rules are wrong",
    explanation:
      "The Extra Monster Zone rules in Tag (2v2) duels are not right yet, for example which team may use the zone. The team knows about it and works on it.",
    patterns: [/\bextra monster zones?\b/i, /\bemz\b/i, /\bextra zone\b/i],
    formats: ["tag"],
  },
];

/** Known limits that match the report text and, when the report names a duel, its format and rules. */
export function matchKnownLimits(
  text: string,
  context: { format?: BugFormat; duelMode?: "normal" | "domain" } = {},
  limits: readonly KnownLimit[] = KNOWN_LIMITS,
): PublicKnownLimit[] {
  const out: PublicKnownLimit[] = [];
  for (const limit of limits) {
    if (context.format && limit.formats && !limit.formats.includes(context.format)) continue;
    if (context.duelMode && limit.duelModes && !limit.duelModes.includes(context.duelMode)) continue;
    if (limit.patterns.some((pattern) => pattern.test(text))) out.push({ id: limit.id, title: limit.title, explanation: limit.explanation });
  }
  return out;
}
