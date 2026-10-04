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
import type { ChainLinkState } from "./chain-state";

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

