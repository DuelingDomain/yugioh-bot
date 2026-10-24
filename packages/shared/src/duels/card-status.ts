/** Glyph categories in the approved card-status legend. Text retains any qualifiers. */
export type DuelProtectionCategory =
  | "unaffected-monsters"
  | "unaffected-spells"
  | "unaffected-traps"
  | "unaffected-effects"
  | "cannot-be-destroyed-by-battle"
  | "cannot-be-destroyed-by-effects"
  | "cannot-be-targeted"
  | "cannot-be-attacked"
  | "status";

/** Public, currently registered on-field engine hint; duplicate descriptions display once. */
export interface DuelCardHint {
  /** Unsigned engine descriptor as a decimal string: preserves all 64 bits in JSON. */
  descriptionId: string;
  /** Resolved strings.conf/CDB text, or a readable fallback for an unknown descriptor. */
  text: string;
  /** Multiple categories for e.g. Spell/Trap immunity or battle/effect destruction protection. */
  categories: DuelProtectionCategory[];
}
