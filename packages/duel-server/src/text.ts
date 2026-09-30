import { OcgLocation } from "ocgcore-wasm";

/** Same value as views.ts LOCATION_DECKMASTER; repeated here to keep this module dependency-free. */
const LOCATION_DECKMASTER = 0x4000;

/**
 * Printf-style placeholders used by strings.conf and card strings. The core never fills them:
 * the client is expected to substitute the card name, its location, and any numbers.
 */
const PLACEHOLDER = /%(?:ls|lu|ld|s|d|u|i)/g;

export type TemplateValue = string | number | undefined | null;

export function hasPlaceholders(text: string | undefined): boolean {
  if (!text) return false;
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}

/**
 * Fill printf placeholders left to right with `values`. String and number placeholders draw from the
 * same queue in order, so a caller passes values in the order the template names them
 * (for the core's strings that is: card name, location, number).
 *
 * Missing values remove the placeholder, and the decoration around it is tidied so the sentence
 * still reads: empty quotes `""`, empty brackets `[]` / `()` and a dangling "from" are dropped.
 */
export function fillPlaceholders(template: string, values: readonly TemplateValue[] = []): string {
  if (!template) return template;
  let index = 0;
  let missing = false;
  let text = template.replace(/%%/g, "\u0000").replace(PLACEHOLDER, () => {
    const value = values[index];
    index += 1;
    if (value == null) missing = true;
    return value == null ? "" : String(value);
  });
  text = text.replace(/\u0000/g, "%");
  if (missing) {
    text = text
      .replace(/\s*[“"]\s*[”"]/g, "")
      .replace(/\s*\(\s*\)/g, "")
      .replace(/\s*\[\s*\]/g, "")
      .replace(/\s+from\s*([?.!,]|$)/g, "$1")
      .replace(/\s+of\s*([?.!,]|$)/g, "$1");
  }
  return text.replace(/\s{2,}/g, " ").replace(/\s+([?.!,:])/g, "$1").trim();
}

const LOCATION_LABELS: ReadonlyArray<[number, string]> = [
  [OcgLocation.DECK, "Deck"],
  [OcgLocation.HAND, "hand"],
  [OcgLocation.MZONE, "Monster Zone"],
  [OcgLocation.SZONE, "Spell & Trap Zone"],
  [OcgLocation.GRAVE, "Graveyard"],
  [OcgLocation.REMOVED, "banished"],
  [OcgLocation.EXTRA, "Extra Deck"],
  [OcgLocation.OVERLAY, "Xyz Material"],
  [OcgLocation.FZONE, "Field Zone"],
  [OcgLocation.PZONE, "Pendulum Zone"],
  [LOCATION_DECKMASTER, "Deck Master Zone"],
];

/**
 * Human label for a location bitmask, the way the core's `[%ls]` placeholder expects it.
 * Spell & Trap sequence 5 is the Field Zone and 6-7 are the Pendulum Zones; Monster sequence 5-6
 * are the Extra Monster Zones.
 */
export function locationLabel(location: number, sequence?: number): string {
  if (location === OcgLocation.SZONE && sequence != null) {
    if (sequence === 5) return "Field Zone";
    if (sequence >= 6) return "Pendulum Zone";
  }
  if (location === OcgLocation.MZONE && sequence != null && sequence >= 5) return "Extra Monster Zone";
  for (const [bit, label] of LOCATION_LABELS) if (location === bit) return label;
  const parts = LOCATION_LABELS.filter(([bit]) => (location & bit) !== 0).map(([, label]) => label);
  return parts.length > 0 ? parts.join(" / ") : "field";
}

const POSITION_LABELS: Record<number, string> = {
  0x1: "Face-up Attack",
  0x2: "Face-down Attack",
  0x4: "Face-up Defense",
  0x8: "Face-down Defense",
  0x3: "Attack",
  0xc: "Defense",
  0x5: "Face-up",
  0xa: "Face-down",
};

export function positionLabel(position: number): string {
  return POSITION_LABELS[position] ?? `Position ${position}`;
}

const ATTRIBUTE_LABELS = ["EARTH", "WATER", "FIRE", "WIND", "LIGHT", "DARK", "DIVINE"];

export function attributeName(attribute: number): string {
  const index = Math.log2(attribute);
  return Number.isInteger(index) && ATTRIBUTE_LABELS[index] ? ATTRIBUTE_LABELS[index] : String(attribute);
}

const RACE_LABELS = [
  "Warrior", "Spellcaster", "Fairy", "Fiend", "Zombie", "Machine", "Aqua", "Pyro", "Rock", "Winged Beast",
  "Plant", "Insect", "Thunder", "Dragon", "Beast", "Beast-Warrior", "Dinosaur", "Fish", "Sea Serpent", "Reptile",
  "Psychic", "Divine-Beast", "Creator God", "Wyrm", "Cyberse", "Illusion", "Cyborg", "Magical Knight", "High Dragon",
  "Omega Psychic", "Celestial Warrior", "Galaxy",
];

export function raceName(race: bigint | number): string {
  const value = typeof race === "bigint" ? race : BigInt(race);
  if (value <= 0n) return value.toString();
  const index = value.toString(2).length - 1;
  if (1n << BigInt(index) !== value) return value.toString();
  return RACE_LABELS[index] ?? value.toString();
}
