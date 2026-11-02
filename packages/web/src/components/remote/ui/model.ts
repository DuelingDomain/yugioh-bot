import { ygoModule, type RemoteRoom, type RemoteState } from "@yugidraft/shared/remote";
import type { CardInfo } from "./catalog";

export type TwinCard = RemoteState["seats"][number]["twin"][number];

export const MINUS = "−";
export const sg = (d: number) => (d < 0 ? MINUS : "+") + Math.abs(d);
export const COLORS = ["167 139 255", "240 128 170", "121 217 168", "255 160 110"];

/** The 14 cells of the holo field, in grid order (row 1 then row 2). */
export const ZK = ["gy", "m1", "m2", "m3", "m4", "m5", "ex", "f", "s1", "s2", "s3", "s4", "s5", "deck"] as const;
/** The two Extra Monster Zones (Master Rule 5), drawn in their own row above the grid. */
export const EK = ["e1", "e2"] as const;
export type ZoneKey = (typeof ZK)[number] | (typeof EK)[number];
export const ZN: Record<ZoneKey, string> = {
  gy: "Graveyard", m1: "Monster zone 1", m2: "Monster zone 2", m3: "Monster zone 3", m4: "Monster zone 4", m5: "Monster zone 5", ex: "Extra Deck",
  e1: "Extra Monster zone left", e2: "Extra Monster zone right", f: "Field zone", s1: "Spell and Trap zone 1", s2: "Spell and Trap zone 2", s3: "Spell and Trap zone 3", s4: "Spell and Trap zone 4", s5: "Spell and Trap zone 5", deck: "Deck",
};
export const zoneLabel = (z: ZoneKey) => ({ gy: "GY", ex: "EX DECK", f: "FIELD", deck: "DECK", e1: "EMZ", e2: "EMZ" } as Record<string, string>)[z] ?? (z[0] === "m" ? "M" + z[1] : "S" + z[1]);
export const isPile = (z: ZoneKey) => z === "gy" || z === "ex" || z === "deck";
export const isMonsterZone = (z: ZoneKey) => z[0] === "m" || z === "e1" || z === "e2";
/** Master Rule 5 tables (Advanced, Domain) have Extra Monster Zones and Pendulum Zones on the outer Spell/Trap zones. Genesys formats have neither. */
export const hasExtraZones = (formatId: string | undefined) => !formatId?.startsWith("genesys");
/** Pendulum Zone 1 and 2 sit on Spell/Trap zone 1 and 5. */
export const PENDULUM_CELLS = { 1: "s1", 2: "s5" } as const;
/** Pendulum zone slots sit on the outer S/T cells, and the Pendulum label shows on them. */
export const isPendulumCell = (z: ZoneKey) => z === "s1" || z === "s5";
/** The slot one Extra Monster Zone has in the facing seat's view: the engine shares one row, so my left zone is their right one. */
export const mirrorEmz = (slot: number) => (slot === 1 ? 2 : 1);
/** The seat that faces `seat` and shares its Extra Monster Zones: 1v1 is the other seat, 3-way pairs seats 0+1 (seat 2 is alone), 4-way pairs 0+1 and 2+3. */
export function facingSeat(seat: number, count: number): number | null {
  if (count === 2) return seat === 0 ? 1 : 0;
  if (count === 3) return seat === 0 ? 1 : seat === 1 ? 0 : null;
  if (count === 4) return seat ^ 1;
  return null;
}

/** Foundation zone + slot for a cell. */
export function foundationZone(z: ZoneKey): { zone: string; slot?: number } {
  if (z === "gy") return { zone: "graveyard" };
  if (z === "ex") return { zone: "extra" };
  if (z === "e1" || z === "e2") return { zone: "extra-monster", slot: Number(z[1]) };
  if (z === "f") return { zone: "field" };
  if (z === "deck") return { zone: "deck" };
  return { zone: z[0] === "m" ? "monster" : "spell-trap", slot: Number(z[1]) };
}

export const PHASES = ygoModule.phases;
export const PHASE_SHORT: Record<string, string> = { draw: "Draw", standby: "Standby", main1: "Main 1", battle: "Battle", main2: "Main 2", end: "End" };
export const PHASE_LONG: Record<string, string> = { draw: "Draw Phase", standby: "Standby Phase", main1: "Main Phase 1", battle: "Battle Phase", main2: "Main Phase 2", end: "End Phase" };
export const phaseIndex = (id: string) => Math.max(0, PHASES.findIndex(p => p.id === id));

/** Zones that do not fit the 7x2 grid. They show in a compact strip under the field. */
export const EXTRA_ZONES = [
  { id: "extra-monster", label: "EMZ" }, { id: "pendulum", label: "PZ" }, { id: "banished", label: "BAN" },
  { id: "hand", label: "HAND" }, { id: "hand-reveal", label: "SHOWN" },
] as const;

export type Cell = { card?: TwinCard; count: number };
/** Puts twin cards into grid cells. Cards without a slot take the first free slot of their row. */
export function cellsFor(twin: readonly TwinCard[], extraZones = false): Record<ZoneKey, Cell> {
  const cells = Object.fromEntries([...ZK, ...EK].map(k => [k, { count: 0 }])) as Record<ZoneKey, Cell>;
  const rows: Record<string, { prefix: string; slots: number; list: TwinCard[] }> = { monster: { prefix: "m", slots: 5, list: [] }, "spell-trap": { prefix: "s", slots: 5, list: [] } };
  const emz: TwinCard[] = []; const pendulum: TwinCard[] = [];
  for (const card of twin) {
    if (card.zone === "graveyard") cells.gy.count++;
    else if (card.zone === "extra") cells.ex.count++;
    else if (card.zone === "deck") cells.deck.count++;
    else if (card.zone === "field") { cells.f.card = card; cells.f.count = 1; }
    else if (extraZones && card.zone === "extra-monster") emz.push(card);
    else if (extraZones && card.zone === "pendulum") pendulum.push(card);
    else if (rows[card.zone]) rows[card.zone].list.push(card);
  }
  for (const { prefix, slots, list } of Object.values(rows)) {
    const used = new Set<number>(); const loose: TwinCard[] = [];
    for (const card of list) {
      if (card.slot && card.slot<=slots && !used.has(card.slot)) { used.add(card.slot); cells[`${prefix}${card.slot}` as ZoneKey] = { card, count: 1 }; } else loose.push(card);
    }
    for (const card of loose) {
      const free = [1, 2, 3, 4, 5].find(n => n<=slots&&!used.has(n)); if (!free) break;
      used.add(free); cells[`${prefix}${free}` as ZoneKey] = { card, count: 1 };
    }
  }
  const usedEmz = new Set<number>(); const looseEmz: TwinCard[] = [];
  for (const card of emz) { if ((card.slot === 1 || card.slot === 2) && !usedEmz.has(card.slot)) { usedEmz.add(card.slot); cells[`e${card.slot}` as ZoneKey] = { card, count: 1 }; } else looseEmz.push(card); }
  for (const card of looseEmz) { const free = [1, 2].find(n => !usedEmz.has(n)); if (!free) break; usedEmz.add(free); cells[`e${free}` as ZoneKey] = { card, count: 1 }; }
  // A Pendulum card keeps its own twin zone but draws on the outer Spell/Trap cell, when nothing else sits there.
  for (const card of pendulum) {
    const key = PENDULUM_CELLS[card.slot === 2 ? 2 : 1]; const other = PENDULUM_CELLS[card.slot === 2 ? 1 : 2];
    const target = !cells[key].card ? key : !cells[other].card ? other : null;
    if (target) cells[target] = { card, count: 1 };
  }
  return cells;
}
/** The grid cell of one card. Pass the whole field of its seat: loose cards take the first free slot. */
export const cellKeyOf = (card: TwinCard, twin: readonly TwinCard[] = [card]): ZoneKey | null => {
  for (const [k, cell] of Object.entries(cellsFor(twin, true))) if (cell.card?.ref === card.ref) return k as ZoneKey;
  return null;
};

export const cardCode = (card: Pick<TwinCard, "cardId" | "passcode">) => card.cardId ?? card.passcode;
export function cardName(card: TwinCard, info?: CardInfo): string { return card.name ?? info?.name ?? (cardCode(card) ? `Card ${cardCode(card)}` : "Unknown card"); }
/** The card frame kinds the field draws. They follow the online duel board, where the printed frame shows the type. */
export type FrameKind = "normal" | "effect" | "ritual" | "fusion" | "synchro" | "xyz" | "link" | "pendulum" | "spell" | "trap" | "token";
/** Frame kind of a card, from its catalog frame type first and its type line second. */
export function frameOf(info: CardInfo | undefined): FrameKind {
  const frame = (info?.frameType ?? "").toLowerCase();
  const type = info?.type ?? "";
  if (frame === "spell" || /spell/i.test(type)) return "spell";
  if (frame === "trap" || /trap/i.test(type)) return "trap";
  for (const kind of ["xyz", "synchro", "fusion", "link", "ritual"] as const) if (frame.includes(kind) || new RegExp(kind, "i").test(type)) return kind;
  if (frame.includes("pendulum") || /pendulum/i.test(type)) return "pendulum";
  if (frame === "token" || /token/i.test(type)) return "token";
  return (frame === "normal" || /normal/i.test(type)) && !/effect/i.test(type) ? "normal" : "effect";
}
export const hueOf = (id: number) => (id * 47) % 360;

/** Decklist cards for one seat (Main, Extra and Side). */
export function deckIdsOf(room: RemoteRoom, seat: number): number[] {
  const deck = room.seats.find(s => s.seat === seat)?.deck?.deck;
  return deck ? [...deck.main, ...deck.extra, ...deck.side] : [];
}
export function hasDeck(room: RemoteRoom, seat: number) { return !!room.seats.find(s => s.seat === seat)?.deck; }
export function notInDecklist(room: RemoteRoom, seat: number, code: number | undefined) {
  return code !== undefined && hasDeck(room, seat) && !deckIdsOf(room, seat).includes(code);
}
/** The first live copy-limit flag for a seat. Dismissed flags do not warn. */
export function deckFlag(room: RemoteRoom, seat: number) {
  return room.state.deckChecks?.flags.find(f => f.seat === seat && !f.dismissed);
}
export function seenCardIds(room: RemoteRoom): number[] {
  const ids: number[] = [];
  for (const s of room.state.seats) for (const c of s.twin) { const code = cardCode(c); if (code) ids.push(code); }
  return ids;
}

/** Battle result using the public ATK/DEF of both monsters. Returns null when a number is missing. */
export type Battle = {
  title: string; sub: string; result: string;
  attackerAtk: number | null; targetValue: number | null; targetDef: boolean;
  damageSeat: number | null; damage: number; destroyTarget: boolean; destroyAttacker: boolean; direct: boolean;
};
export function battleMath(args: {
  attacker: { name: string; atk: number | null; seat: number };
  target: { name: string; atk: number | null; def: number | null; defense: boolean; seat: number } | null;
  targetSeat: number; lp: (seat: number) => number; seatName: (seat: number) => string;
}): Battle {
  const { attacker, target, targetSeat, lp, seatName } = args;
  if (!target) {
    const atk = attacker.atk ?? 0;
    return { title: `${attacker.name} attacks ${seatName(targetSeat)} directly`, sub: `${atk} direct damage · ${seatName(targetSeat)} ${lp(targetSeat)} → ${Math.max(0, lp(targetSeat) - atk)}`,
      result: `${seatName(targetSeat)} ${sg(-atk)}`, attackerAtk: attacker.atk, targetValue: null, targetDef: false, damageSeat: atk ? targetSeat : null, damage: -atk, destroyTarget: false, destroyAttacker: false, direct: true };
  }
  const value = target.defense ? target.def : target.atk;
  if (attacker.atk === null || value === null) {
    return { title: `${attacker.name} attacks ${target.name}`, sub: "ATK/DEF unknown. Resolve by hand.", result: "Resolve by hand", attackerAtk: attacker.atk, targetValue: value,
      targetDef: target.defense, damageSeat: null, damage: 0, destroyTarget: false, destroyAttacker: false, direct: false };
  }
  const diff = attacker.atk - value;
  let damageSeat: number | null = null; let damage = 0; let destroyTarget = false; let destroyAttacker = false;
  if (diff > 0) { destroyTarget = true; if (!target.defense) { damageSeat = target.seat; damage = -diff; } }
  else if (diff < 0) { damageSeat = attacker.seat; damage = diff; destroyAttacker = !target.defense; }
  else if (!target.defense) { destroyTarget = true; destroyAttacker = true; }
  const bits = [`${attacker.atk} vs ${value} ${target.defense ? "DEF" : "ATK"}`];
  if (destroyTarget) bits.push(`${target.name} destroyed`);
  if (destroyAttacker) bits.push(`${attacker.name} destroyed`);
  if (damageSeat !== null) bits.push(`${seatName(damageSeat)} ${lp(damageSeat)} → ${Math.max(0, lp(damageSeat) + damage)}`);
  const result = damageSeat !== null ? `${seatName(damageSeat)} ${sg(damage)}` : destroyTarget || destroyAttacker ? "Destroy" : "No change";
  return { title: `${attacker.name} attacks ${target.name}`, sub: bits.join(" · "), result, attackerAtk: attacker.atk, targetValue: value, targetDef: target.defense,
    damageSeat, damage, destroyTarget, destroyAttacker, direct: false };
}

/** The detector card handed to the reader, so it crops that exact card. */
export const readCardOf = (hit: { quad: { x: number; y: number }[]; kind: "face-up" | "face-down"; confidence: number; refined: boolean; covered?: boolean }) =>
  ({ quad: hit.quad, kind: hit.kind, confidence: hit.confidence, partial: !hit.refined, ...(hit.covered ? { covered: true } : {}) });
