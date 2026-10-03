/**
 * Pure logic for the draft room: card kinds, level bands, filters, pass direction,
 * seat pack sizes, step/deal bookkeeping and the edge-clock geometry.
 * Nothing in here touches the DOM, so all of it is unit tested.
 */
import type { DraftCardDetail } from "@/lib/stores/draft-store";
import { isExtraDeckMonster, isSpell, isTrap } from "@/lib/card-types";

export type RoomCard = DraftCardDetail;

/* ---------- kinds ---------- */

export type Kind = "monster" | "spell" | "trap" | "extra";
export const KINDS: Kind[] = ["monster", "spell", "trap", "extra"];
export const KIND_LABEL: Record<Kind, string> = {
  monster: "Monsters",
  spell: "Spells",
  trap: "Traps",
  extra: "Extra deck",
};
export const KIND_ONE: Record<Kind, string> = {
  monster: "Monster",
  spell: "Spell",
  trap: "Trap",
  extra: "Extra deck",
};

export function kindOf(card: Pick<RoomCard, "type" | "frameType">): Kind {
  const frame = card.frameType.trim().toLowerCase();
  if (frame === "spell" || isSpell(card.type)) return "spell";
  if (frame === "trap" || isTrap(card.type)) return "trap";
  if (isExtraDeckMonster(card)) return "extra";
  return "monster";
}

export type KindCounts = Record<Kind, number>;

export function emptyCounts(): KindCounts {
  return { monster: 0, spell: 0, trap: 0, extra: 0 };
}

export function countKinds(cards: Array<Pick<RoomCard, "type" | "frameType">>): KindCounts {
  const counts = emptyCounts();
  for (const card of cards) counts[kindOf(card)] += 1;
  return counts;
}

/* ---------- the per-player copy limit ---------- */

/** Why a pack card cannot be picked: the player already holds the maximum copies of it. */
export function blockedLabel(card: Pick<RoomCard, "held">): string {
  return `You have ${card.held ?? 0}`;
}

/* ---------- card text ---------- */

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
export { titleCase };

/**
 * Type, attribute, monster type and level. The monster type and the spell or trap kind come from the
 * duel engine; when the engine could not be reached they are missing and the line is just "Spell" or "Trap".
 */
export function typeParts(card: RoomCard): string[] {
  const kind = kindOf(card);
  if (kind === "spell") return [card.spellTrapType ? `${card.spellTrapType} Spell` : "Spell"];
  if (kind === "trap") return [card.spellTrapType ? `${card.spellTrapType} Trap` : "Trap"];
  const parts = [card.type.replace(/ Card$/, "")];
  if (card.attribute) parts.push(card.attribute);
  if (card.race) parts.push(raceLabel(card.race));
  const frame = card.frameType.trim().toLowerCase();
  if (card.level) {
    if (frame.startsWith("xyz")) parts.push(`Rank ${card.level}`);
    else if (frame === "link") parts.push(`Link ${card.level}`);
    else parts.push(`Level ${card.level}`);
  }
  return parts;
}

function stat(v: number | undefined): string {
  return v == null ? "" : v < 0 ? "?" : String(v);
}

export function statParts(card: RoomCard): Array<[string, string]> | null {
  const kind = kindOf(card);
  if (kind === "spell" || kind === "trap") return null;
  if (card.atk == null && card.def == null) return null;
  if (card.frameType.trim().toLowerCase() === "link") return [["ATK", stat(card.atk)]];
  return [
    ["ATK", stat(card.atk)],
    ["DEF", stat(card.def)],
  ];
}

export function cardText(card: RoomCard): string {
  return (card.effectText ?? "").replace(/\r\n/g, "\n");
}

/** Light colours by attribute (the duel's attack tints). Each is an "r g b" triplet. */
const TINT: Record<string, [string, string, string]> = {
  EARTH: ["255 241 214", "226 168 96", "138 90 34"],
  WATER: ["234 250 255", "95 192 255", "26 79 156"],
  FIRE: ["255 243 208", "255 122 58", "154 30 10"],
  WIND: ["240 255 244", "126 230 168", "31 122 74"],
  LIGHT: ["255 255 255", "255 224 138", "180 138 30"],
  DARK: ["243 234 255", "168 107 255", "61 26 134"],
  DIVINE: ["255 251 230", "255 210 74", "168 114 12"],
  spell: ["226 255 247", "82 195 169", "20 88 74"],
  trap: ["255 230 246", "214 132 189", "94 35 80"],
  none: ["255 244 220", "244 214 144", "107 84 32"],
};

export function tint(card: RoomCard): { hi: string; main: string; deep: string } {
  const kind = kindOf(card);
  const key = kind === "spell" || kind === "trap" ? kind : (card.attribute ?? "").toUpperCase();
  const t = TINT[key] ?? TINT.none;
  return { hi: t[0], main: t[1], deep: t[2] };
}

export function attributeTint(attribute: string): string {
  return (TINT[attribute.toUpperCase()] ?? TINT.none)[1];
}

/* ---------- names ---------- */

export function hue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const caps = name.match(/[A-Z]/g) ?? [];
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (caps.length > 1) return caps[0] + caps[1];
  return name.slice(0, 2).replace(/^./, (c) => c.toUpperCase());
}

export function joinNames(list: string[]): string {
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.length} players`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------- pass direction, seats ---------- */

/** Mirrors drafts.ts: even pack rounds pass the other way when alternating. 1 = left, -1 = right. */
export function passDirection(packRound: number, alternatePassDirection: boolean | undefined): 1 | -1 {
  return packRound % 2 === 0 && (alternatePassDirection ?? true) ? -1 : 1;
}

export function passLabel(direction: 1 | -1): string {
  return direction > 0 ? "Passing left" : "Passing right";
}

/** Cards left in a seat's pack: nobody's pack changes size until the step advances. */
export function seatPackSize(opts: { packSize: number; pickStep: number; hasPicked: boolean }): number {
  return Math.max(0, opts.packSize - (opts.pickStep - 1) - (opts.hasPicked ? 1 : 0));
}

export interface SeatLike {
  seatIndex: number;
  playerId: number;
  displayName: string;
  hasPicked: boolean;
  isCurrentPlayer: boolean;
}

export interface TableSeat {
  /** Position at the table: 0 is you (or a placeholder for a spectator). */
  index: number;
  seat: SeatLike | null;
  isMe: boolean;
}

/**
 * You sit at the near edge; friends go on from your left in seat order.
 * A spectator has no seat, so index 0 is an empty placeholder and everyone else is a friend.
 */
export function orderSeats(seats: SeatLike[]): TableSeat[] {
  const sorted = [...seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const meAt = sorted.findIndex((s) => s.isCurrentPlayer);
  if (meAt < 0) {
    return [{ index: 0, seat: null, isMe: true }, ...sorted.map((seat, i) => ({ index: i + 1, seat, isMe: false }))];
  }
  const rotated = [...sorted.slice(meAt), ...sorted.slice(0, meAt)];
  return rotated.map((seat, i) => ({ index: i, seat, isMe: i === 0 }));
}

/** Offscreen phone seats, ignoring up to one pixel of scroll rounding at either edge. */
export function stripEdges(scrollLeft: number, scrollWidth: number, clientWidth: number): "start" | "end" | "both" | undefined {
  if (scrollWidth - clientWidth <= 1) return undefined;
  const start = scrollLeft > 1;
  const end = scrollWidth - clientWidth - scrollLeft > 1;
  return start && end ? "both" : start ? "start" : end ? "end" : undefined;
}

export type SeatState = "picking" | "picked" | "passing";

export type Turn = "picking" | "waiting" | "settling" | "done";

export function turnState(opts: {
  completed: boolean;
  isMyTurn: boolean;
  isParticipant: boolean;
  seats: SeatLike[];
}): Turn {
  if (opts.completed) return "done";
  if (opts.isMyTurn) return "picking";
  const allIn = opts.seats.length > 0 && opts.seats.every((s) => s.hasPicked);
  if (allIn) return "settling";
  return "waiting";
}

export function urgencyFor(seconds: number, turn: Turn): "" | "low" | "out" {
  if (turn !== "picking") return "";
  if (seconds <= 5) return "out";
  if (seconds <= 10) return "low";
  return "";
}

/* ---------- table anchors for friends ---------- */

export interface Pt {
  x: number;
  y: number;
}

/** Share the desktop row counts between the anchors and the upright seat boxes. */
export function seatLayout(n: number): { side: number; far: number } {
  const others = Math.max(0, n - 1);
  const side = others <= 3 ? 0 : others <= 6 ? 1 : Math.max(1, Math.min(3, Math.ceil((others - 5) / 2)));
  return { side, far: others - 2 * side };
}

/** Where friend `i` sits, in table pixels. Index 0 is you at the near edge; friends go clockwise from your left. */
export function anchorPoint(i: number, n: number, tw: number, th: number): Pt {
  if (i === 0) return { x: tw / 2, y: th + 30 };
  const { side, far } = seatLayout(n);
  if (side > 0) {
    if (i <= side) {
      const y = side === 1 ? 0.56 : 0.78 - (0.48 * (i - 1)) / (side - 1);
      return { x: -46, y: th * y };
    }
    if (i > side + far) {
      const y = side === 1 ? 0.56 : 0.30 + (0.48 * (i - side - far - 1)) / (side - 1);
      return { x: tw + 46, y: th * y };
    }
    const start = n >= 8 ? 0.10 : 0.12;
    const span = n >= 8 ? 0.80 : 0.76;
    const t = far === 1 ? 0.5 : start + (span * (i - side - 1)) / (far - 1);
    return { x: tw * t, y: -14 };
  }
  const t = far <= 1 ? 0.5 : (i - 1) / (far - 1);
  return { x: tw * (0.03 + 0.94 * t), y: -14 };
}

/* ---------- levels ---------- */

export type TierKey = "low" | "mid" | "high";
export const BANDS: Array<{ key: TierKey; label: string; lo: number; hi: number }> = [
  { key: "low", label: "No tribute", lo: 1, hi: 4 },
  { key: "mid", label: "1 tribute", lo: 5, hi: 6 },
  { key: "high", label: "2 tributes", lo: 7, hi: 12 },
];
export const TIER_RANGE: Record<TierKey, string> = { low: "1–4", mid: "5–6", high: "7+" };

export function tierMatches(key: TierKey, level: number): boolean {
  const band = BANDS.find((b) => b.key === key);
  if (!band) return false;
  if (key === "high") return level >= 7;
  return level >= band.lo && level <= band.hi;
}

export const EX_KINDS: Array<[string, string]> = [
  ["fusion", "Fusion"],
  ["synchro", "Synchro"],
  ["xyz", "Xyz"],
  ["link", "Link"],
];

export interface LevelBand {
  key: TierKey;
  label: string;
  lo: number;
  hi: number;
  total: number;
  bars: Array<{ level: number; n: number; h: number }>;
}

export interface LevelsModel {
  empty: boolean;
  bands: LevelBand[];
  extra: Array<{ name: string; n: number }>;
}

/** One bar per star level for main deck monsters. Xyz ranks and Link ratings are counted by kind instead. */
export function levelsModel(cards: RoomCard[]): LevelsModel {
  const mons = cards.filter((c) => kindOf(c) === "monster");
  const ex = cards.filter((c) => kindOf(c) === "extra");
  if (!mons.length && !ex.length) return { empty: true, bands: [], extra: [] };
  const by = new Array<number>(13).fill(0);
  for (const c of mons) {
    const l = Math.min(12, c.level ?? 0);
    if (l >= 1) by[l] += 1;
  }
  const max = Math.max(1, ...by);
  const bands = BANDS.map((b) => {
    let total = 0;
    const bars: LevelBand["bars"] = [];
    for (let l = b.lo; l <= b.hi; l++) {
      total += by[l];
      bars.push({ level: l, n: by[l], h: by[l] / max });
    }
    return { ...b, total, bars };
  });
  const extra = EX_KINDS.map(([f, name]) => ({
    name,
    n: ex.filter((c) => c.frameType.trim().toLowerCase().startsWith(f)).length,
  })).filter((e) => e.n > 0);
  return { empty: false, bands, extra };
}

/* ---------- the filter: one lens for the binder and the table ---------- */

export type MonsterSubtype = "all" | "effect" | "normal";

export interface RoomFilter {
  kinds: ReadonlySet<Kind>;
  /** Applies only when Monster is the sole selected kind. Omitted means all. */
  monsterSubtype?: MonsterSubtype;
  q: string;
  lvl: ReadonlySet<TierKey>;
  attr: ReadonlySet<string>;
  /** Archetype names, as the card catalog spells them. */
  arch: ReadonlySet<string>;
  /** Monster types, and spell and trap kinds, as `monster:Dragon`, `spell:Quick-Play`, `trap:Counter`. */
  type: ReadonlySet<string>;
}

export const EMPTY_FILTER: RoomFilter = {
  kinds: new Set(),
  q: "",
  lvl: new Set(),
  attr: new Set(),
  arch: new Set(),
  type: new Set(),
};

export function isFiltering(f: RoomFilter): boolean {
  return f.kinds.size > 0 || f.q !== "" || f.lvl.size > 0 || f.attr.size > 0 || f.arch.size > 0 || f.type.size > 0;
}

export function facetCount(f: RoomFilter): number {
  return f.lvl.size + f.attr.size + f.arch.size + f.type.size;
}

export type TypeRow = "monster" | "spell" | "trap";

/** The chip key for a card's monster type or spell/trap kind, or null when the engine did not say. */
export function typeKey(card: RoomCard): string | null {
  const kind = kindOf(card);
  if (kind === "spell") return card.spellTrapType ? `spell:${card.spellTrapType}` : null;
  if (kind === "trap") return card.spellTrapType ? `trap:${card.spellTrapType}` : null;
  return card.race ? `monster:${card.race}` : null;
}

/** The engine names monster types as keys ("winged_beast"). These are the printed names. */
const RACE_LABELS: Record<string, string> = {
  warrior: "Warrior",
  spellcaster: "Spellcaster",
  fairy: "Fairy",
  fiend: "Fiend",
  zombie: "Zombie",
  machine: "Machine",
  aqua: "Aqua",
  pyro: "Pyro",
  rock: "Rock",
  winged_beast: "Winged Beast",
  windbeast: "Winged Beast",
  plant: "Plant",
  insect: "Insect",
  thunder: "Thunder",
  dragon: "Dragon",
  beast: "Beast",
  beast_warrior: "Beast-Warrior",
  dinosaur: "Dinosaur",
  fish: "Fish",
  sea_serpent: "Sea Serpent",
  reptile: "Reptile",
  psychic: "Psychic",
  divine_beast: "Divine-Beast",
  divine: "Divine-Beast",
  creator_god: "Creator God",
  creatorgod: "Creator God",
  wyrm: "Wyrm",
  cyberse: "Cyberse",
  illusion: "Illusion",
  cyborg: "Cyborg",
  magical_knight: "Magical Knight",
  high_dragon: "High Dragon",
  omega_psychic: "Omega Psychic",
  celestial_warrior: "Celestial Warrior",
  galaxy: "Galaxy",
};

/** A monster type key or name as it is printed: "beast_warrior" and "Beast-Warrior" both read "Beast-Warrior". */
export function raceLabel(race: string): string {
  const raw = race.trim();
  if (!raw) return "";
  const known = RACE_LABELS[raw.toLowerCase().replace(/[\s-]+/g, "_")];
  if (known) return known;
  return raw
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)(\S)/g, (_, gap: string, ch: string) => gap + ch.toUpperCase());
}

/** "monster:winged_beast" reads as Winged Beast; "spell:Quick-Play" as Quick-Play. */
export function typeKeyName(key: string): string {
  const name = key.slice(key.indexOf(":") + 1);
  return key.startsWith("monster:") ? raceLabel(name) : name;
}

function typeKeyWords(key: string): string {
  const name = typeKeyName(key);
  return key.startsWith("spell:") ? `${name} Spell` : key.startsWith("trap:") ? `${name} Trap` : name;
}

export function haystack(card: RoomCard): string {
  return [card.name, card.effectText, card.type, card.attribute, card.race, card.race ? raceLabel(card.race).replace(/-/g, " ") : null, card.archetype, KIND_ONE[kindOf(card)], ...typeParts(card)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesFilter(card: RoomCard, f: RoomFilter): boolean {
  const kind = kindOf(card);
  if (f.kinds.size && !f.kinds.has(kind)) return false;
  if (f.kinds.size === 1 && f.kinds.has("monster") && f.monsterSubtype && f.monsterSubtype !== "all") {
    const frame = card.frameType.trim().toLowerCase();
    if (frame !== f.monsterSubtype && frame !== `${f.monsterSubtype}_pendulum`) return false;
  }
  if (f.q) {
    const h = haystack(card);
    if (!f.q.split(/\s+/).every((w) => h.includes(w))) return false;
  }
  if (f.lvl.size) {
    if (kind !== "monster") return false;
    const level = card.level ?? 0;
    if (![...f.lvl].some((k) => tierMatches(k, level))) return false;
  }
  if (f.type.size) {
    const key = typeKey(card);
    if (!key || !f.type.has(key)) return false;
  }
  if (f.attr.size && !(card.attribute && f.attr.has(card.attribute))) return false;
  if (f.arch.size && !(card.archetype && f.arch.has(card.archetype))) return false;
  return true;
}

export function filterWords(f: RoomFilter): string {
  const parts: string[] = [];
  if (f.kinds.size) {
    const subtype = f.kinds.size === 1 && f.kinds.has("monster") ? f.monsterSubtype : undefined;
    parts.push(subtype && subtype !== "all" ? `${titleCase(subtype)} monsters` : [...f.kinds].map((k) => KIND_LABEL[k]).join(" or "));
  }
  if (f.lvl.size) parts.push("Level " + [...f.lvl].map((k) => TIER_RANGE[k]).join(" or "));
  if (f.type.size) parts.push([...f.type].map(typeKeyWords).join(" or "));
  if (f.attr.size) parts.push([...f.attr].map(titleCase).join(" or "));
  if (f.arch.size) parts.push([...f.arch].join(" or "));
  if (f.q) parts.push(`“${f.q}”`);
  return parts.join(", ");
}

export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export interface FacetChip {
  key: string;
  n: number;
}

/**
 * One row of filter chips. Counts come from the list shown; any key found in this pack gets a chip
 * too (greyed at zero), and so does anything already selected. Most cards first, then A to Z.
 * With a limit, the first `limit` stay and a selected chip is never cut.
 */
export function facetChips(opts: {
  list: RoomCard[];
  inPack: RoomCard[];
  selected: ReadonlySet<string>;
  keyOf: (card: RoomCard) => string | null | undefined;
  limit?: number;
}): FacetChip[] {
  const counts = new Map<string, number>();
  for (const c of opts.list) {
    const k = opts.keyOf(c);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const keys = new Set<string>(counts.keys());
  for (const c of opts.inPack) {
    const k = opts.keyOf(c);
    if (k) keys.add(k);
  }
  opts.selected.forEach((k) => keys.add(k));
  const sorted = [...keys]
    .map((key) => ({ key, n: counts.get(key) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  if (!opts.limit || sorted.length <= opts.limit) return sorted;
  const kept = sorted.slice(0, opts.limit);
  return [...kept, ...sorted.slice(opts.limit).filter((c) => opts.selected.has(c.key))];
}

/** Attribute chips: counts come from the list shown, but any attribute in this pack gets a chip too. */
export function attributeChips(list: RoomCard[], inPack: RoomCard[], selected: ReadonlySet<string>): FacetChip[] {
  return facetChips({ list, inPack, selected, keyOf: (c) => c.attribute });
}

/**
 * Type chips for one row: Monster type (monsters and the extra deck), Spells or Traps. Keys look like
 * `monster:Dragon`. With no engine data there are no keys, so the row is empty and hides.
 */
export function typeChips(row: TypeRow, list: RoomCard[], inPack: RoomCard[], selected: ReadonlySet<string>): FacetChip[] {
  const mine = new Set([...selected].filter((k) => k.startsWith(`${row}:`)));
  return facetChips({
    list,
    inPack,
    selected: mine,
    keyOf: (c) => {
      const key = typeKey(c);
      return key && key.startsWith(`${row}:`) ? key : null;
    },
  });
}

/** Archetype chips: the eight biggest, plus any you have switched on. */
export const ARCHETYPE_CHIP_LIMIT = 8;
export function archetypeChips(list: RoomCard[], inPack: RoomCard[], selected: ReadonlySet<string>): FacetChip[] {
  return facetChips({ list, inPack, selected, keyOf: (c) => c.archetype, limit: ARCHETYPE_CHIP_LIMIT });
}

/* ---------- the pool: grouping, order, pick numbers ---------- */

export type Order = "type" | "newest" | "oldest" | "name";

export interface PoolEntry {
  card: RoomCard;
  kind: Kind;
  /** 0-based position in pick order. */
  index: number;
}

export function poolEntries(pool: RoomCard[]): PoolEntry[] {
  return pool.map((card, index) => ({ card, kind: kindOf(card), index }));
}

export interface PickConfig {
  theme: boolean;
  packSize: number;
  cardsPerPlayer: number;
}

export interface PickInfo {
  /** Pack number (booster) or main/extra round number (theme). */
  round: number;
  /** Pick within the pack (booster) or round within the phase (theme). */
  step: number;
  phase: "main" | "extra";
}

export function pickInfo(index: number, cfg: PickConfig): PickInfo {
  if (cfg.theme) {
    const extra = index >= cfg.cardsPerPlayer;
    const n = extra ? index - cfg.cardsPerPlayer + 1 : index + 1;
    return { round: n, step: n, phase: extra ? "extra" : "main" };
  }
  const size = Math.max(1, cfg.packSize);
  return { round: Math.floor(index / size) + 1, step: (index % size) + 1, phase: "main" };
}

export function sortKey(card: RoomCard): [number | string, string] {
  const kind = kindOf(card);
  if (kind === "monster" || kind === "extra") return [-(card.level ?? 0), card.name];
  return [card.type, card.name];
}

export function compareCards(a: RoomCard, b: RoomCard): number {
  const x = sortKey(a);
  const y = sortKey(b);
  if (x[0] < y[0]) return -1;
  if (x[0] > y[0]) return 1;
  return x[1].localeCompare(y[1]);
}

/** Incoming entries are in pick order. Sorting preserves each entry's original index. */
export function orderEntries<T extends { card: RoomCard }>(entries: T[], order: Order): T[] {
  const sorted = [...entries];
  if (order === "newest") return sorted.reverse();
  if (order === "name") return sorted.sort((a, b) => a.card.name.localeCompare(b.card.name));
  if (order === "type") {
    return sorted.sort((a, b) => KINDS.indexOf(kindOf(a.card)) - KINDS.indexOf(kindOf(b.card)) || compareCards(a.card, b.card));
  }
  return sorted;
}

/** Copies of the same card (same name) share a row in the Type list. */
export function groupCopies<T extends { card: RoomCard }>(entries: T[]): T[][] {
  const by = new Map<string, T[]>();
  for (const e of entries) {
    const k = e.card.name;
    const g = by.get(k);
    if (g) g.push(e);
    else by.set(k, [e]);
  }
  return [...by.values()];
}

export function mixGradient(counts: KindCounts, of: number): string {
  const total = Number.isFinite(of) && of > 0 ? of : 1;
  let at = 0;
  const stops: string[] = [];
  for (const k of KINDS) {
    if (at >= total) break;
    const count = Math.min(counts[k], total - at);
    if (!(count > 0)) continue;
    const a = (at / total) * 100;
    at = Math.min(total, at + count);
    const b = (at / total) * 100;
    stops.push(`var(--k-${k}) ${a}% ${b}%`);
  }
  stops.push(`rgb(255 255 255 / 0.07) ${(at / total) * 100}% 100%`);
  return `conic-gradient(${stops.join(", ")})`;
}

/* ---------- what is on the table: the deal reducer ---------- */

export interface DealState {
  stepKey: string | null;
  /** The pack as dealt at the start of this step. It stays through waiting, so leftovers stay on the table. */
  dealt: RoomCard[];
  pickedId: number | null;
  /** Counts each fresh deal, so animations key on changes and never on each poll. */
  seq: number;
  reason: "deal" | "pass" | "stack" | "none";
  /** True when this deal began a step after one that was already running. */
  advanced: boolean;
}

export const INITIAL_DEAL: DealState = {
  stepKey: null,
  dealt: [],
  pickedId: null,
  seq: 0,
  reason: "none",
  advanced: false,
};

export type DealEvent =
  | {
      type: "server";
      stepKey: string;
      pack: RoomCard[];
      poolIds: ReadonlySet<number>;
      isMyTurn: boolean;
      completed: boolean;
      theme: boolean;
    }
  | { type: "picked"; cardId: number }
  | { type: "unpicked" };

export function stepKeyOf(packRound: number, pickStep: number): string {
  return `${packRound}:${pickStep}`;
}

export function packSignature(pack: RoomCard[]): string {
  return pack.map((c) => c.id).join(",");
}

export function dealReducer(state: DealState, event: DealEvent): DealState {
  if (event.type === "picked") {
    if (!state.dealt.some((c) => c.id === event.cardId)) return state;
    return { ...state, pickedId: event.cardId };
  }
  if (event.type === "unpicked") {
    return state.pickedId == null ? state : { ...state, pickedId: null };
  }
  if (event.completed) {
    if (state.dealt.length === 0 && state.pickedId == null) return state;
    return { ...state, dealt: [], pickedId: null };
  }
  const first = state.stepKey === null;
  const newStep = !first && state.stepKey !== event.stepKey;
  if (!first && !newStep) {
    const pooledCard = state.dealt.find((card) => event.poolIds.has(card.id));
    if (!event.isMyTurn || pooledCard) {
      const pickedId = pooledCard?.id ?? state.pickedId;
      return pickedId === state.pickedId ? state : { ...state, pickedId };
    }
  }
  const hasPack = event.isMyTurn && event.pack.length > 0;
  if (hasPack) {
    if (first || newStep) {
      return {
        stepKey: event.stepKey,
        dealt: event.pack,
        pickedId: null,
        seq: state.seq + 1,
        reason: event.theme ? "stack" : first ? "deal" : "pass",
        advanced: newStep,
      };
    }
    // Same step. If you already picked, a late poll must not bring your card back,
    // unless the server still offers it and the pool has no pick from this deal.
    if (state.pickedId != null) {
      if (!event.pack.some((c) => c.id === state.pickedId)) return state;
      return { ...state, pickedId: null, dealt: event.pack };
    }
    if (state.dealt.length === 0) {
      return { ...state, dealt: event.pack, seq: state.seq + 1, reason: event.theme ? "stack" : "deal", advanced: false };
    }
    if (packSignature(state.dealt) === packSignature(event.pack)) return state;
    return { ...state, dealt: event.pack };
  }
  if (newStep) {
    return { ...state, stepKey: event.stepKey, dealt: [], pickedId: null, advanced: true, reason: "none" };
  }
  if (first) return { ...state, stepKey: event.stepKey };
  return state;
}

/* ---------- the ribbon that opens a pack or a round ---------- */

export interface DealRibbon {
  /** The deal this ribbon belongs to. The cards stay off the table until it hides. */
  seq: number;
  title: string;
  sub: string;
  tone: "" | "extra";
}

/**
 * The news that comes before a deal, as in the mock: a new pack (pick 1), the start of a theme draft,
 * or the switch to the Extra deck. Every other deal (a pass inside a pack) has no ribbon and shows at once.
 */
export function dealRibbon(opts: {
  seq: number;
  theme: boolean;
  poolCount: number;
  pickStep: number;
  packRound: number;
  direction: 1 | -1;
  sizes: Pick<RoomSizes, "extraSize" | "cardsPerPlayer">;
}): DealRibbon | null {
  const { seq } = opts;
  if (seq === 0) return null;
  if (opts.theme) {
    if (opts.poolCount === 0 && seq === 1) {
      return { seq, title: "Theme draft", sub: "Private packs. Nothing passes.", tone: "" };
    }
    if (opts.sizes.extraSize > 0 && opts.poolCount === opts.sizes.cardsPerPlayer) {
      return {
        seq,
        title: "Extra deck",
        sub: `Main deck done. Pick ${opts.sizes.extraSize} for your Extra Deck.`,
        tone: "extra",
      };
    }
    return null;
  }
  if (opts.pickStep === 1) return { seq, title: `Pack ${opts.packRound}`, sub: passLabel(opts.direction), tone: "" };
  return null;
}

/**
 * A reload while you wait: the live deal is gone, but the draft's own pool is not. Your last pool card is the
 * one you took this step, so the reader can show it again. Nothing about anyone else's pick is read.
 * The leftover pack is not in the fetched state (the server returns no pack once you have picked).
 */
export function restoredPick(opts: {
  turn: Turn;
  seats: SeatLike[];
  pool: RoomCard[];
}): RoomCard | null {
  if (opts.turn !== "waiting" && opts.turn !== "settling") return null;
  const me = opts.seats.find((s) => s.isCurrentPlayer);
  if (!me?.hasPicked) return null;
  return opts.pool.length ? opts.pool[opts.pool.length - 1] : null;
}

/** The cards on the table: the dealt pack without the one you took. */
export function tableCards(state: DealState): RoomCard[] {
  return state.dealt.filter((c) => c.id !== state.pickedId);
}

/* ---------- seat events ---------- */

/** Seats that flipped hasPicked false -> true within the same step. */
export function newlyPicked(prev: SeatLike[], next: SeatLike[]): number[] {
  const was = new Map(prev.map((s) => [s.playerId, s.hasPicked]));
  return next.filter((s) => !s.isCurrentPlayer && was.get(s.playerId) === false && s.hasPicked).map((s) => s.playerId);
}

export function everyoneIn(seats: SeatLike[]): boolean {
  return seats.length > 0 && seats.every((s) => s.hasPicked);
}

/* ---------- header copy ---------- */

export interface RoomConfigLike {
  packSize?: number;
  packsPerPlayer?: number;
  cardsPerPlayer?: number;
  pickSeconds?: number;
  mode?: "booster" | "theme";
  alternatePassDirection?: boolean;
  extraDeckEnabled?: boolean;
  extraDeckSize?: number;
  themePackSize?: number;
}

export interface RoomSizes {
  theme: boolean;
  packSize: number;
  packsPerPlayer: number;
  cardsPerPlayer: number;
  extraSize: number;
  /** Cards you will end up with. */
  total: number;
  themePackSize: number;
}

export function roomSizes(config: RoomConfigLike): RoomSizes {
  const theme = config.mode === "theme";
  const cardsPerPlayer = config.cardsPerPlayer ?? 40;
  const extraSize = theme && (config.extraDeckEnabled ?? true) ? (config.extraDeckSize ?? 15) : 0;
  return {
    theme,
    packSize: config.packSize ?? 8,
    packsPerPlayer: config.packsPerPlayer ?? 5,
    cardsPerPlayer,
    extraSize,
    total: cardsPerPlayer + extraSize,
    themePackSize: config.themePackSize ?? 3,
  };
}

export interface ThemeProgress {
  inExtra: boolean;
  drafted: number;
  of: number;
}

/** Theme drafts: main deck first, then the optional extra deck. Derived from the live drafted count. */
export function themeProgress(drafted: number, sizes: RoomSizes): ThemeProgress {
  const inExtra = sizes.theme && sizes.extraSize > 0 && drafted >= sizes.cardsPerPlayer;
  if (inExtra) return { inExtra, drafted: Math.min(drafted - sizes.cardsPerPlayer, sizes.extraSize), of: sizes.extraSize };
  return { inExtra: false, drafted: Math.min(drafted, sizes.cardsPerPlayer), of: sizes.cardsPerPlayer };
}

/** Counts that drive the dial. In theme mode they follow the current phase. */
export function dialModel(pool: RoomCard[], sizes: RoomSizes) {
  if (!sizes.theme) {
    return { done: pool.length, of: sizes.cardsPerPlayer, label: `of ${sizes.cardsPerPlayer}`, counts: countKinds(pool) };
  }
  const tp = themeProgress(pool.length, sizes);
  const phasePool = tp.inExtra ? pool.slice(sizes.cardsPerPlayer) : pool.slice(0, sizes.cardsPerPlayer);
  return {
    done: tp.drafted,
    of: tp.of,
    label: tp.inExtra ? `of ${tp.of} extra` : `of ${tp.of} main`,
    counts: countKinds(phasePool),
  };
}

/* ---------- the edge clock ---------- */

type RingSeg =
  | { t: "line"; a: Pt; b: Pt; len: number }
  | { t: "arc"; c: Pt; a0: number; r: number; len: number };

function ringSegments(w: number, h: number, e: number, r: number): RingSeg[] {
  const line = (a: Pt, b: Pt): RingSeg => ({ t: "line", a, b, len: Math.hypot(b.x - a.x, b.y - a.y) });
  const arc = (c: Pt, a0: number): RingSeg => ({ t: "arc", c, a0, r, len: (Math.PI * r) / 2 });
  return [
    line({ x: w / 2, y: e }, { x: w - e - r, y: e }),
    arc({ x: w - e - r, y: e + r }, -Math.PI / 2),
    line({ x: w - e, y: e + r }, { x: w - e, y: h - e - r }),
    arc({ x: w - e - r, y: h - e - r }, 0),
    line({ x: w - e - r, y: h - e }, { x: e + r, y: h - e }),
    arc({ x: e + r, y: h - e - r }, Math.PI / 2),
    line({ x: e, y: h - e - r }, { x: e, y: e + r }),
    arc({ x: e + r, y: e + r }, Math.PI),
    line({ x: e + r, y: e }, { x: w / 2, y: e }),
  ];
}

export interface RingGeometry {
  length: number;
  pointAt: (len: number) => Pt;
  path: string;
}

/** A rounded rectangle traced clockwise from the middle of the far side. */
export function ringGeometry(w: number, h: number, e = 4, r = 14): RingGeometry {
  const segs = ringSegments(w, h, e, r);
  const length = segs.reduce((s, x) => s + x.len, 0);
  const pointAt = (len: number): Pt => {
    let rest = Math.min(Math.max(len, 0), length);
    for (const s of segs) {
      if (rest <= s.len) {
        const f = s.len === 0 ? 0 : rest / s.len;
        if (s.t === "line") return { x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f };
        const ang = s.a0 + (Math.PI / 2) * f;
        return { x: s.c.x + s.r * Math.cos(ang), y: s.c.y + s.r * Math.sin(ang) };
      }
      rest -= s.len;
    }
    const last = segs[segs.length - 1];
    return last.t === "line" ? last.b : { x: last.c.x, y: last.c.y };
  };
  const path = `M${w / 2},${e} H${w - e - r} A${r},${r} 0 0 1 ${w - e},${e + r} V${h - e - r} A${r},${r} 0 0 1 ${w - e - r},${h - e} H${e + r} A${r},${r} 0 0 1 ${e},${h - e - r} V${e + r} A${r},${r} 0 0 1 ${e + r},${e} Z`;
  return { length, pointAt, path };
}

export interface RingSegment {
  soft: string;
  core: string;
  delay: number;
}

export function ringSegmentCount(length: number): number {
  return Math.max(72, Math.min(180, Math.round(length / 13)));
}

export function buildRingSegments(geo: RingGeometry): RingSegment[] {
  const n = ringSegmentCount(geo.length);
  const L = geo.length;
  const fmt = (p: Pt) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  const pts = (a: number, b: number) => [0, 1 / 3, 2 / 3, 1].map((f) => fmt(geo.pointAt(a + (b - a) * f))).join(" ");
  const out: RingSegment[] = [];
  for (let k = 0; k < n; k++) {
    const a = (L * k) / n;
    const b = (L * (k + 1)) / n;
    out.push({ soft: pts(a, b), core: pts(a, Math.min(L, b + 0.8)), delay: Math.round((k * 650) / n) });
  }
  return out;
}

/** How many of n segments are lit for the fraction of time left. */
export function litSegments(frac: number, n: number): number {
  return Math.ceil(Math.max(0, Math.min(1, frac)) * n);
}

/** Time left as a fraction. Interpolates between the one-second ticks unless animations are off. */
export function clockFraction(opts: {
  seconds: number;
  total: number;
  sinceTickMs: number;
  smooth: boolean;
}): number {
  const { seconds, total, sinceTickMs, smooth } = opts;
  if (total <= 0) return 0;
  const left = smooth ? Math.max(seconds - 1, seconds - Math.min(sinceTickMs, 1000) / 1000) : seconds;
  return Math.max(0, Math.min(1, left / total));
}
