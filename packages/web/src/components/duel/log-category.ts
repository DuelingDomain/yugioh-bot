// Colour categories for the duel log. Pure, no React, no DOM.
//
// Both log surfaces colour an entry by what kind of action it was, so the log can be scanned at a glance:
//   summon   Normal, Tribute, Flip and Special Summons. The badge fill names the method (see summonMethodForIcon).
//   chain    activations and chain links (gold, the chain colour everywhere in the duel).
//   battle   attacks, direct attacks, damage and LP paid.
//   destroy  destroyed, sent to the Graveyard, discarded, Tributed or used as material.
//   banish   banished.
//   set      Set face-down.
//   hand     drawn, added to hand, or returned to the hand, Deck or Extra Deck.
//   system   LP gained, position changes, flips face-up, reveals and confirms, coin tosses, shuffles.
//
// Colour is never the only cue: every category comes with its own icon and the entry keeps its text label.
// The category is read only from what the entry already shows (its icon kind, or the log text the viewer
// was sent), never from the card, so colour can never say more about a hidden card than the text does.
import type { HistoryIconKind } from "./history-entries";

export type LogCategory = "summon" | "chain" | "battle" | "destroy" | "banish" | "set" | "hand" | "system";

/** Which card frame the summon badge echoes. "monster" covers Normal, Tribute, Flip and plain Special Summons. */
export type SummonMethod = "monster" | "fusion" | "synchro" | "xyz" | "link" | "ritual" | "pendulum";

export const LOG_CATEGORIES: readonly LogCategory[] = ["summon", "chain", "battle", "destroy", "banish", "set", "hand", "system"];

export const LOG_CATEGORY_LABEL: Record<LogCategory, string> = {
  summon: "Summon",
  chain: "Activation and chain",
  battle: "Battle and damage",
  destroy: "Destroyed or sent to the Graveyard",
  banish: "Banished",
  set: "Set face-down",
  hand: "Draw, add to hand or return",
  system: "Life Points, position and game",
};

/**
 * The category of a history-list entry, from its icon kind.
 *
 * The switch is exhaustive: a new icon kind (an "add to hand" search or a reveal/confirm event, say) fails
 * typecheck here until it is given a category. Add to hand belongs in "hand"; a reveal or confirm in "system".
 */
export function categoryForIcon(icon: HistoryIconKind): LogCategory {
  switch (icon) {
    case "normal":
    case "tribute":
    case "special":
    case "flip":
    case "fusion":
    case "synchro":
    case "xyz":
    case "link":
    case "ritual":
    case "pendulum":
      return "summon";
    case "activate":
    case "chain":
      return "chain";
    case "attack":
    case "direct":
    case "lp-loss":
      return "battle";
    case "destroy":
    case "grave":
      return "destroy";
    case "banish":
      return "banish";
    case "set":
      return "set";
    case "draw":
    case "hand":
    case "deck":
      return "hand";
    case "lp-gain":
    case "position":
    case "flip-up":
      return "system";
    default: {
      const unmapped: never = icon;
      void unmapped;
      return "system";
    }
  }
}

/** The card frame a summon badge echoes, or null when the entry is not a summon. */
export function summonMethodForIcon(icon: HistoryIconKind): SummonMethod | null {
  switch (icon) {
    case "fusion":
    case "synchro":
    case "xyz":
    case "link":
    case "ritual":
    case "pendulum":
      return icon;
    case "normal":
    case "tribute":
    case "special":
    case "flip":
      return "monster";
    default:
      return null;
  }
}

// Text log lines come from the engine's fixed sentence templates (duel-server engine.ts appendLog). Match them on
// the raw text, before "Player N" becomes a display name, and anchor each pattern so a card name or an effect
// hint cannot pass for another template.
const TEXT_RULES: ReadonlyArray<readonly [RegExp, LogCategory]> = [
  [/^Player \d+ (Normal|Special|Flip) Summons /, "summon"],
  [/^Player \d+ Sets a card$/, "set"],
  [/^Player \d+ drew \d+ card\(s\)$/, "hand"],
  [/^You drew /, "hand"],
  [/ is activating$/, "chain"],
  [/^A chain link was negated$/, "chain"],
  [/^Chain ended$/, "chain"],
  [/^A monster declares (an|a direct) attack$/, "battle"],
  [/^Player \d+ takes \d+ damage$/, "battle"],
  [/^Player \d+ pays \d+ LP$/, "battle"],
  [/^Player \d+ gains \d+ LP$/, "system"],
  // "<card> moved" is logged for both the Graveyard and a face-up banish, so it cannot say which: neutral.
  [/ moved$/, "system"],
  [/^Player \d+ shuffled their (deck|hand)$/, "system"],
  [/^(Confirmed|Excavated) /, "system"],
  [/^(Coin toss|Dice roll): /, "system"],
];

/**
 * The category of a raw engine log line, or null for lines that have their own look (turn headers, phases,
 * the result) and for free-text effect hints.
 */
export function categoryForLogText(text: string): LogCategory | null {
  for (const [pattern, category] of TEXT_RULES) {
    if (pattern.test(text)) return category;
  }
  return null;
}
