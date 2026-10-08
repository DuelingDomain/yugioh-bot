// The words a chain link shows for what it does: the engine's description of the activation, else the card's printed
// text. Pure and dependency free, so the chain state and the panel can both use it.
import {
  TYPE_CONTINUOUS,
  TYPE_COUNTER,
  TYPE_EFFECT,
  TYPE_EQUIP,
  TYPE_FIELD,
  TYPE_MONSTER,
  TYPE_QUICKPLAY,
  TYPE_RITUAL,
  TYPE_SPELL,
  TYPE_TRAP,
} from "./constants";
import type { ChainLinkState, ChosenOption } from "./chain-state";

export interface EffectText {
  text: string;
  /** "Effect": the engine's own words for this activation. "Card text": the printed text of the card. */
  caption: "Effect" | "Card text";
}

/** The engine sends the card's own name, or a bare "Activate", when it has nothing more specific to say. */
const GENERIC_DESCRIPTION = /^(activate|activate this card|activate effect|activate its effect|effect|this card's effect)[.!]?$/i;

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isGeneric(description: string, name: string | null): boolean {
  if (description === "") return true;
  if (name != null && description.toLowerCase() === name.trim().toLowerCase()) return true;
  return GENERIC_DESCRIPTION.test(description);
}

/**
 * A Spell or Trap states its condition, then a colon, then what it does ("When your opponent Normal Summons a monster:
 * Destroy it."). The panel is about what it does. Text without a colon is the effect already.
 */
function printedEffect(text: string, type: number | null): string {
  const flat = normalise(text);
  if (type != null && (type & (TYPE_SPELL | TYPE_TRAP)) !== 0) {
    const colon = flat.indexOf(": ");
    if (colon > 0 && colon < flat.length - 2) return flat.slice(colon + 2).trim();
  }
  return flat;
}

/**
 * What a link does, in the order the engine is most specific:
 *  1. the engine's description of this activation (when it is not the card's name or a bare "Activate");
 *  2. the card's printed text (a Spell/Trap from after its first colon);
 *  3. nothing. A card the client does not know says no text, and never a passcode.
 */
export function chainEffectText(link: Pick<ChainLinkState, "name" | "description" | "text" | "cardType">): EffectText | null {
  const name = link.name?.trim() ? link.name.trim() : null;
  // An unknown card has no text to show, whatever the link carries.
  if (name == null) return null;
  const engine = normalise(link.description ?? "");
  if (!isGeneric(engine, name)) return { text: engine, caption: "Effect" };
  const printed = normalise(link.text ?? "");
  if (printed !== "") {
    const text = printedEffect(printed, link.cardType);
    if (text !== "") return { text, caption: "Card text" };
  }
  return null;
}

/** One line of a card's printed text. An "option" is a bullet line ("● Add 1 ... to your hand."). */
export interface CardTextLine {
  kind: "text" | "option";
  text: string;
  /** An option line the link's player chose. */
  chosen?: true;
}

/** The card's text in full, for the panel: the engine's own words (when they say more than the printed text) and every printed line. */
export interface FullEffectText {
  /** The engine's description of this activation, or null when it is generic or already part of the printed text. */
  lead: string | null;
  lines: CardTextLine[];
}

const BULLET = /^[●•◆◇■]\s*/;

/** The printed text split by line, with each bullet marked as an option. Blank lines go. */
export function cardTextLines(text: string): CardTextLine[] {
  const lines: CardTextLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const flat = normalise(raw);
    if (flat === "") continue;
    if (BULLET.test(flat)) lines.push({ kind: "option", text: flat.replace(BULLET, "") });
    else lines.push({ kind: "text", text: flat });
  }
  return lines;
}

const squash = (text: string): string => normalise(text).replace(/[.!\s]+$/, "").toLowerCase();

/** Quotes and dashes in either style, so a prompt label and the printed text compare as equal. */
const fold = (text: string): string =>
  squash(text).replace(/[\u2018\u2019\u201b]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-");
/** Shortest text that may match a bullet by containment: a one-word choice must not light an unrelated bullet. */
const MIN_PARTIAL = 8;

/**
 * Marks the option lines the link's player chose, by text only (equal, or one holds the other). The prompt option index
 * is no guide: the engine hides options whose condition is false, so it need not be the position of a printed bullet, and
 * a wrong mark is worse than none. An equal bullet beats a partial one; when no bullet is equal and two fit partly,
 * nothing is marked. A bullet is marked once, and a choice that matches nothing marks nothing (the "Chose" line
 * still names it).
 */
export function markChosenLines(lines: readonly CardTextLine[], chosen: readonly ChosenOption[] | undefined): CardTextLine[] {
  if (!chosen?.length) return lines.map((line) => ({ ...line }));
  const optionAt = lines.flatMap((line, at) => (line.kind === "option" ? [at] : []));
  const marked = new Set<number>();
  for (const choice of chosen) {
    const want = fold(choice.text);
    if (want === "") continue;
    const free = optionAt.filter((at) => !marked.has(at));
    // An equal bullet wins. Without one, a partial match counts only when exactly one bullet fits: two fits are a guess.
    const exact = free.find((at) => fold(lines[at].text) === want);
    if (exact != null) { marked.add(exact); continue; }
    if (want.length < MIN_PARTIAL) continue;
    const partial = free.filter((at) => {
      const have = fold(lines[at].text);
      return have.includes(want) || (have.length >= MIN_PARTIAL && want.includes(have));
    });
    if (partial.length === 1) marked.add(partial[0]);
  }
  return lines.map((line, at) => (marked.has(at) ? { ...line, chosen: true } : { ...line }));
}

/**
 * Everything the panel can say about what a link does. Every seat sees the same words: the text of a card that
 * is on the chain is public. An unknown card (no name) has none, and never a passcode.
 */
export function chainFullText(link: Pick<ChainLinkState, "name" | "description" | "text" | "cardType" | "chosenOptions">): FullEffectText | null {
  const name = link.name?.trim() ? link.name.trim() : null;
  if (name == null) return null;
  const lines = markChosenLines(cardTextLines(link.text ?? ""), link.chosenOptions);
  const engine = normalise(link.description ?? "");
  const specific = !isGeneric(engine, name);
  const printed = squash(lines.map((line) => line.text).join(" "));
  const lead = specific && !printed.includes(squash(engine)) ? engine : null;
  if (lead == null && lines.length === 0) return specific ? { lead: engine, lines } : null;
  return { lead, lines };
}

/** "Normal Trap", "Quick-Play Spell", "Effect Monster": the second half of the hero's byline. */
export function chainKindLabel(type: number | null): string | null {
  if (type == null || type <= 0) return null;
  if ((type & TYPE_SPELL) !== 0) {
    if (type & TYPE_QUICKPLAY) return "Quick-Play Spell";
    if (type & TYPE_CONTINUOUS) return "Continuous Spell";
    if (type & TYPE_EQUIP) return "Equip Spell";
    if (type & TYPE_FIELD) return "Field Spell";
    if (type & TYPE_RITUAL) return "Ritual Spell";
    return "Normal Spell";
  }
  if ((type & TYPE_TRAP) !== 0) {
    if (type & TYPE_COUNTER) return "Counter Trap";
    if (type & TYPE_CONTINUOUS) return "Continuous Trap";
    return "Normal Trap";
  }
  if ((type & TYPE_MONSTER) !== 0) return (type & TYPE_EFFECT) !== 0 ? "Effect Monster" : "Monster";
  return null;
}

