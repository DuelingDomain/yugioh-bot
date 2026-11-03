import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { deckEngineDataDirectory } from "./card-artworks.js";

/**
 * Card facts from the EDOPro engine database (cards.cdb). They are the first source for the card type:
 * our catalog rows can miss the Spell/Trap subtype (race) for older or newer cards.
 */
export type EngineCardFacts = { type: number; level: number; def: number };
const TYPE = { monster: 0x1, spell: 0x2, trap: 0x4, ritual: 0x80, quickPlay: 0x10000, continuous: 0x20000, equip: 0x40000, field: 0x80000, counter: 0x100000, pendulum: 0x1000000, link: 0x4000000 } as const;
const cache = new Map<string, { mtime: number; cards: ReadonlyMap<number, EngineCardFacts> }>();

/** Engine facts by passcode (cached until cards.cdb changes). Empty when the engine data is not installed. */
export function loadEngineCardFacts(dataDirectory = deckEngineDataDirectory()): ReadonlyMap<number, EngineCardFacts> {
  const path = resolve(dataDirectory, "cards.cdb");
  if (!existsSync(path)) return new Map();
  const mtime = statSync(path).mtimeMs, cached = cache.get(path);
  if (cached?.mtime === mtime) return cached.cards;
  const engine = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = engine.prepare("select id, type, level, def from datas").all() as Array<{ id: number; type: number; level: number; def: number }>;
    const cards = new Map(rows.map(row => [row.id, { type: row.type, level: row.level, def: row.def }]));
    cache.set(path, { mtime, cards });
    return cards;
  } finally { engine.close(); }
}

type CardTypeFields = { type: string; frameType: string; race?: string; level?: number };
/**
 * Engine type bits win over the catalog: Spell/Trap subtype (race), Trap Monster (a Trap with a Level),
 * Link Monster frame and rating. Other catalog fields stay as they are.
 */
export function applyEngineCardFacts<T extends CardTypeFields>(card: T, engine: EngineCardFacts | undefined): T {
  if (!engine) return card;
  const bits = engine.type, stars = engine.level & 0xff;
  if (bits & TYPE.spell) {
    const race = bits & TYPE.field ? "Field" : bits & TYPE.equip ? "Equip" : bits & TYPE.continuous ? "Continuous" : bits & TYPE.quickPlay ? "Quick-Play" : bits & TYPE.ritual ? "Ritual" : "Normal";
    return { ...card, race, ...(/spell/i.test(card.type) ? {} : { type: "Spell Card" }) };
  }
  if (bits & TYPE.trap) {
    const race = bits & TYPE.continuous ? "Continuous" : bits & TYPE.counter ? "Counter" : "Normal";
    return { ...card, race, ...(/trap/i.test(card.type) ? {} : { type: "Trap Card" }), ...(stars > 0 ? { level: stars } : {}) };
  }
  if (bits & TYPE.link) return { ...card, frameType: "link", ...(/link/i.test(card.type) ? {} : { type: "Link Monster" }), level: card.level ?? stars };
  return card;
}
