import { TOKEN_MAKERS } from "./token-makers";

/**
 * The typical next step after a card was activated or placed, read from its card text. A suggestion only: the table never acts by itself.
 * `give`: the card itself goes to the opponent's field (a Kaiju, Lava Golem). `tokens`: tokens go on a field (the player clicks the zone).
 */
export type NextStep =
  | { kind: "give"; label: string }
  | { kind: "tokens"; label: string; token: { name: string; atk: number; def: number; count: number; position: "attack" | "defense"; opponent: boolean; ask: boolean; artId?: number } };

const COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
/** This card is Special Summoned to the opponent's field: "Special Summon this card (from your hand) to your opponent's field", "Must first be Special Summoned (from your hand) to your opponent's field". */
const SELF_GIVE = /Special Summon this card\s*(?:\([^)]*\)\s*)?to your opponent's field|Must first be Special Summoned\s*(?:\([^)]*\)\s*)?to your opponent's field/i;
/** `Special Summon 4 "Sheep Tokens" (Beast/EARTH/Level 1/ATK 0/DEF 0) in Defense Position`, or `1 Token (…)`. Groups: count, name, stats, tail. */
const TOKENS = /Special Summon (\d+|an?|one|two|three|four|five|six) (?:"([^"]*?Tokens?)"|(Tokens?))\s*(?:\(([^)]*)\))?([^.;]*)/i;
/** The cards whose tokens the table already makes by itself when they are played (token-ui.tsx): no chip, so the player is not asked twice. */
const MADE_BY_TABLE = new Set(Object.entries(TOKEN_MAKERS).filter(([, maker]) => maker.auto).map(([name]) => name));
/** Explicit entries: cards whose text is too indirect for the patterns. Lower-case name. */
const EXPLICIT: Record<string, NextStep> = {};

const stat = (text: string | undefined) => text === undefined || text === "?" ? null : Number(text);

/** One suggestion for a card, or null when its text has no typical follow-up. `name` is the card name, `text` its effect text. */
export function nextStep(name: string, text: string | undefined): NextStep | null {
  const key = name.trim().toLowerCase();
  if (MADE_BY_TABLE.has(key)) return null;
  if (EXPLICIT[key]) return EXPLICIT[key];
  if (!text) return null;
  const tokens = TOKENS.exec(text);
  if (tokens) {
    const count = /^\d+$/.test(tokens[1]) ? Number(tokens[1]) : COUNTS[tokens[1].toLowerCase()];
    const tokenName = (tokens[2] ?? tokens[3] ?? "Token").replace(/s$/i, "");
    const atk = /ATK\s*(\d+|\?)/i.exec(tokens[4] ?? ""), def = /DEF\s*(\d+|\?)/i.exec(tokens[4] ?? "");
    const known = TOKEN_MAKERS[key];
    const opponent = /to your opponent's field/i.test(tokens[5] ?? "");
    if (count >= 1 && count <= 6) {
      const ask = !known && (!atk || !def || stat(atk[1]) === null || stat(def[1]) === null);
      const where = opponent ? " for the opponent" : "";
      return { kind: "tokens", label: `Add ${count === 1 ? `${/^[aeiou]/i.test(tokenName) ? "an" : "a"} ${tokenName}` : `${count} ${tokenName}s`}${where}`,
        token: { name: tokenName, atk: known?.atk ?? stat(atk?.[1]) ?? 0, def: known?.def ?? stat(def?.[1]) ?? 0, count: known?.count ?? count, position: known?.position ?? (/Defense Position/i.test(tokens[5] ?? "") ? "defense" : "attack"), opponent: known?.opponent ?? opponent, ask, ...(known ? { artId: known.id } : {}) } };
    }
  }
  if (SELF_GIVE.test(text)) return { kind: "give", label: "Place on opponent's field" };
  return null;
}
