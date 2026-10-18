import { DUEL_BANLIST_OPTIONS, type DuelMode } from "@yugidraft/shared/duels";

/**
 * The deck formats the editor and the importers offer. A saved deck is a mode (Standard or Domain) plus an optional
 * Genesys tag, so there are four: Genesys on Standard is "Genesys", Genesys on Domain is "Genesys Domain".
 */
export type DeckFormat = "normal" | "domain" | "genesys" | "genesys-domain";

export const FORMAT_CHOICES = [
  { value: "normal" as const, label: "Standard" },
  { value: "domain" as const, label: "Domain" },
  { value: "genesys" as const, label: "Genesys" },
  { value: "genesys-domain" as const, label: "Genesys Domain" },
] satisfies ReadonlyArray<{ value: DeckFormat; label: string }>;

export function formatOf(mode: DuelMode, genesys: boolean): DeckFormat {
  if (genesys) return mode === "domain" ? "genesys-domain" : "genesys";
  return mode === "domain" ? "domain" : "normal";
}

export function formatParts(format: DeckFormat): { mode: DuelMode; genesys: boolean } {
  return { mode: format === "domain" || format === "genesys-domain" ? "domain" : "normal", genesys: format === "genesys" || format === "genesys-domain" };
}

/** The newest TCG list, taken from the options so a new list becomes the Standard default with no other change. */
const LATEST_TCG_BANLIST = DUEL_BANLIST_OPTIONS
  .filter((option) => option.region === "tcg")
  .reduce((latest, option) => ((option.effectiveFrom ?? "") > (latest.effectiveFrom ?? "") ? option : latest)).id;

/** Standard starts on the latest TCG banlist. Domain starts with none, and so do both Genesys formats (points replace the list). */
export function defaultBanlist(format: DeckFormat): string {
  return format === "normal" ? LATEST_TCG_BANLIST : "none";
}

/** Genesys formats have no banlist: the editor shows the select off and says why. */
export const GENESYS_NO_BANLIST_NOTE = "Genesys uses points, not a banlist";
