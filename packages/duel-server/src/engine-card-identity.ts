export type EngineRow = {
  id: number;
  ot: number;
  alias: number;
  type: number;
  name: string;
};

const TYPE_TOKEN = 0x4000;
const TYPE_MAXIMUM = 0x8000;
const TYPE_SKILL = 0x8000000;
const TYPE_ACTION = 0x10000000;
const TYPE_PLUS = 0x20000000;
const TYPE_MINUS = 0x40000000;
const TYPE_ARMOR = 0x80000000;
const UNPLAYABLE_TYPES = TYPE_TOKEN | TYPE_SKILL | TYPE_ACTION | TYPE_MAXIMUM | TYPE_PLUS | TYPE_MINUS | TYPE_ARMOR;

const OT_OCG = 0x1;
const OT_TCG = 0x2;
const OT_ILLEGAL = 0x8;
const OT_VIDEO_GAME = 0x10;
const OT_CUSTOM = 0x20;
const OT_RUSH = 0x200;
const OT_HIDDEN = 0x1000;

export function isPlayable(card: EngineRow): boolean {
  if ((card.type & UNPLAYABLE_TYPES) !== 0) return false;
  if ((card.ot & (OT_OCG | OT_TCG)) === 0) return false;
  if ((card.ot & OT_RUSH) !== 0) return false;
  if ((card.ot & (OT_ILLEGAL | OT_VIDEO_GAME | OT_CUSTOM | OT_HIDDEN)) !== 0) return false;
  return true;
}

/** Ignore case, accents, spacing and punctuation, without guessing renamed cards. */
export function normalizeArtworkName(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
}
