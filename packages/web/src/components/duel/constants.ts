import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";

export const LOCATION_DECK = 0x01;
export const LOCATION_HAND = 0x02;
export const LOCATION_MZONE = 0x04;
export const LOCATION_SZONE = 0x08;
export const LOCATION_GRAVE = 0x10;
export const LOCATION_REMOVED = 0x20;
export const LOCATION_EXTRA = 0x40;
export const LOCATION_OVERLAY = 0x80;
export const LOCATION_FZONE = 0x100;
export const LOCATION_PZONE = 0x200;
export const LOCATION_DMZONE = 0x4000;

export const POS_FACEUP_ATTACK = 0x1;
export const POS_FACEDOWN_ATTACK = 0x2;
export const POS_FACEUP_DEFENSE = 0x4;
export const POS_FACEDOWN_DEFENSE = 0x8;

export const TYPE_MONSTER = 0x1;
export const TYPE_SPELL = 0x2;
export const TYPE_TRAP = 0x4;
export const TYPE_NORMAL = 0x10;
export const TYPE_EFFECT = 0x20;
export const TYPE_FUSION = 0x40;
export const TYPE_RITUAL = 0x80;
export const TYPE_TRAPMONSTER = 0x100;
export const TYPE_SPIRIT = 0x200;
export const TYPE_UNION = 0x400;
export const TYPE_DUAL = 0x800;
export const TYPE_TUNER = 0x1000;
export const TYPE_SYNCHRO = 0x2000;
export const TYPE_TOKEN = 0x4000;
export const TYPE_QUICKPLAY = 0x10000;
export const TYPE_CONTINUOUS = 0x20000;
export const TYPE_EQUIP = 0x40000;
export const TYPE_FIELD = 0x80000;
export const TYPE_COUNTER = 0x100000;
export const TYPE_FLIP = 0x200000;
export const TYPE_TOON = 0x400000;
export const TYPE_XYZ = 0x800000;
export const TYPE_PENDULUM = 0x1000000;
export const TYPE_SPSUMMON = 0x2000000;
export const TYPE_LINK = 0x4000000;

export const MZ_COUNT = 5;
export const ST_COUNT = 5;

const PHASE_LABELS: Record<string, string> = {
  draw: "Draw",
  dp: "Draw",
  standby: "Standby",
  sp: "Standby",
  main1: "Main 1",
  m1: "Main 1",
  battle: "Battle",
  bp: "Battle",
  battle_start: "Battle",
  battle_step: "Battle",
  damage: "Damage",
  damage_cal: "Damage calculation",
  main2: "Main 2",
  m2: "Main 2",
  end: "End",
  ep: "End",
};

const ATTRIBUTES: Array<[number, string]> = [
  [0x01, "EARTH"],
  [0x02, "WATER"],
  [0x04, "FIRE"],
  [0x08, "WIND"],
  [0x10, "LIGHT"],
  [0x20, "DARK"],
  [0x40, "DIVINE"],
];

type CardLike = DuelCard | DuelCardInfo;

function isDuelCard(card: CardLike): card is DuelCard {
  return "controller" in card && "location" in card && "sequence" in card;
}

export function isHiddenCard(card: CardLike): boolean {
  return isDuelCard(card) && card.code == null;
}

export function phaseLabel(phase: string | number | null | undefined): string {
  if (phase == null || phase === "") return "—";
  const raw = String(phase).trim();
  const key = raw.toLowerCase().replace(/[\s-]+/g, "");
  return PHASE_LABELS[key] ?? PHASE_LABELS[raw.toLowerCase()] ?? raw;
}

/** Battle, Damage and Damage calculation all count as the Battle Phase (the board warms to ember). */
export function isBattlePhase(phase: string | number | null | undefined): boolean {
  const label = phaseLabel(phase);
  return label === "Battle" || label === "Damage" || label === "Damage calculation";
}

export function isFacedown(position: number | undefined): boolean {
  if (position == null) return false;
  return (position & POS_FACEDOWN_ATTACK) !== 0 || (position & POS_FACEDOWN_DEFENSE) !== 0;
}

export function isDefense(position: number | undefined): boolean {
  if (position == null) return false;
  return (position & POS_FACEUP_DEFENSE) !== 0 || (position & POS_FACEDOWN_DEFENSE) !== 0;
}

/**
 * Whether a card at this location is drawn sideways. Only a monster zone has Defense Position: a
 * Set Spell/Trap is POS_FACEDOWN (0xA) and turns face-up as POS_FACEUP (0x5), and both carry a
 * defense bit.
 */
export function isDefenseAt(location: number | undefined, position: number | undefined): boolean {
  return location === LOCATION_MZONE && isDefense(position);
}

export function zoneKey(controller: number, location: number, sequence: number): string {
  return `${controller}:${location}:${sequence}`;
}

export function cardArtUrl(code: number, size: "small" | "full" = "small"): string {
  return size === "small" ? `/api/cards/${code}/image?size=small` : `/api/cards/${code}/image`;
}

export function formatLp(lp: number): string {
  return lp.toLocaleString("en-US");
}

export function formatStat(value: number | null | undefined): string {
  if (value == null || value < 0) return "?";
  return String(value);
}

export function attributeLabel(attribute: number | null | undefined): string {
  if (attribute == null || attribute === 0) return "";
  return ATTRIBUTES.filter(([bit]) => (attribute & bit) !== 0)
    .map(([, name]) => name)
    .join("/");
}

function cardAttribute(card: CardLike): number | undefined {
  if ("attribute" in card && typeof card.attribute === "number") return card.attribute;
  return undefined;
}

function cardRace(card: CardLike): string {
  if ("race" in card && typeof card.race === "string") {
    if (card.race === "beast_warrior") return "Beast-Warrior";
    return card.race.replaceAll("_", " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }
  return "";
}

function monsterRankLine(card: CardLike, type: number): string {
  const link = "linkRating" in card && typeof card.linkRating === "number" ? card.linkRating : undefined;
  const rank = "rank" in card && typeof card.rank === "number" ? card.rank : undefined;
  if ((type & TYPE_LINK) !== 0) {
    const rating = link || card.level;
    return rating && rating > 0 ? `Link ${rating}` : "Link";
  }
  if ((type & TYPE_XYZ) !== 0) {
    const rating = rank || card.level;
    return rating && rating > 0 ? `Rank ${rating}` : "Rank";
  }
  if (card.level && card.level > 0) return `Level ${card.level}`;
  return "";
}

function spellKind(type: number): string {
  if (type & TYPE_QUICKPLAY) return "Quick-Play";
  if (type & TYPE_CONTINUOUS) return "Continuous";
  if (type & TYPE_EQUIP) return "Equip";
  if (type & TYPE_FIELD) return "Field";
  if (type & TYPE_RITUAL) return "Ritual";
  return "Normal";
}

function trapKind(type: number): string {
  if (type & TYPE_CONTINUOUS) return "Continuous";
  if (type & TYPE_COUNTER) return "Counter";
  return "Normal";
}

export function cardStatsText(card: CardLike): string | null {
  if (isHiddenCard(card)) return null;
  const type = card.type;
  if (type == null || (type & TYPE_MONSTER) === 0) return null;
  const atk = formatStat(card.attack);
  if ((type & TYPE_LINK) !== 0) return atk;
  return `${atk} / ${formatStat(card.defense)}`;
}

export function cardDetailsText(card: CardLike): string {
  if (isHiddenCard(card)) return "";
  const type = card.type ?? 0;
  const race = cardRace(card);
  const attr = attributeLabel(cardAttribute(card));
  if (type & TYPE_MONSTER) {
    const rank = monsterRankLine(card, type);
    const identity = [race, attr].filter(Boolean).join(" / ");
    return [rank, identity].filter(Boolean).join(" · ");
  }
  if (type & TYPE_SPELL) return `Spell / ${spellKind(type)}`;
  if (type & TYPE_TRAP) return `Trap / ${trapKind(type)}`;
  return "";
}

export function cardKindText(card: CardLike): string {
  if (isHiddenCard(card)) return "";
  const type = card.type ?? 0;
  if (type & TYPE_SPELL) return `Spell / ${spellKind(type)}`;
  if (type & TYPE_TRAP) return `Trap / ${trapKind(type)}`;
  if (!(type & TYPE_MONSTER)) return "";
  const tags: string[] = [];
  if (type & TYPE_TOKEN) tags.push("Token");
  if (type & TYPE_FUSION) tags.push("Fusion");
  if (type & TYPE_SYNCHRO) tags.push("Synchro");
  if (type & TYPE_XYZ) tags.push("Xyz");
  if (type & TYPE_LINK) tags.push("Link");
  if (type & TYPE_PENDULUM) tags.push("Pendulum");
  if (type & TYPE_RITUAL) tags.push("Ritual");
  if (type & TYPE_TOON) tags.push("Toon");
  if (type & TYPE_SPIRIT) tags.push("Spirit");
  if (type & TYPE_UNION) tags.push("Union");
  if (type & TYPE_DUAL) tags.push("Gemini");
  if (type & TYPE_TUNER) tags.push("Tuner");
  if (type & TYPE_FLIP) tags.push("Flip");
  if (type & TYPE_SPSUMMON) tags.push("Special Summon");
  if (type & TYPE_NORMAL) tags.push("Normal");
  else if (type & TYPE_EFFECT) tags.push("Effect");
  const race = cardRace(card);
  return [race, tags.join(" ")].filter(Boolean).join(" / ");
}

export function cardCombatText(card: CardLike): string | null {
  if (isHiddenCard(card)) return null;
  const type = card.type;
  if (type == null || (type & TYPE_MONSTER) === 0) return null;
  if ((type & TYPE_LINK) !== 0) return `ATK ${formatStat(card.attack)}`;
  return `ATK ${formatStat(card.attack)} / DEF ${formatStat(card.defense)}`;
}
