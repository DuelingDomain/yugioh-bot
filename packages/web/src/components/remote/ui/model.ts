import { ygoModule, type RemoteRoom, type RemoteState } from "@yugidraft/shared/remote";
import type { CardInfo } from "./catalog";

export type TwinCard = RemoteState["seats"][number]["twin"][number];

export const MINUS = "−";
export const sg = (d: number) => (d < 0 ? MINUS : "+") + Math.abs(d);
export const COLORS = ["167 139 255", "240 128 170", "121 217 168", "255 160 110"];

/** The 14 cells of the holo field, in grid order (row 1 then row 2). */
export const ZK = ["gy", "m1", "m2", "m3", "m4", "m5", "ex", "f", "s1", "s2", "s3", "s4", "s5", "deck"] as const;
export type ZoneKey = (typeof ZK)[number];
export const ZN: Record<ZoneKey, string> = {
  gy: "Graveyard", m1: "Monster zone 1", m2: "Monster zone 2", m3: "Monster zone 3", m4: "Monster zone 4", m5: "Monster zone 5", ex: "Extra Deck",
  f: "Field zone", s1: "Spell and Trap zone 1", s2: "Spell and Trap zone 2", s3: "Spell and Trap zone 3", s4: "Spell and Trap zone 4", s5: "Spell and Trap zone 5", deck: "Deck",
};
export const zoneLabel = (z: ZoneKey) => ({ gy: "GY", ex: "EX", f: "FIELD", deck: "DECK" } as Record<string, string>)[z] ?? (z[0] === "m" ? "M" + z[1] : "S" + z[1]);
export const isPile = (z: ZoneKey) => z === "gy" || z === "ex" || z === "deck";
export const isMonsterZone = (z: ZoneKey) => z[0] === "m";

/** Foundation zone + slot for a cell. */
export function foundationZone(z: ZoneKey): { zone: string; slot?: number } {
  if (z === "gy") return { zone: "graveyard" };
  if (z === "ex") return { zone: "extra" };
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
export function cellsFor(twin: readonly TwinCard[]): Record<ZoneKey, Cell> {
  const cells = Object.fromEntries(ZK.map(k => [k, { count: 0 }])) as Record<ZoneKey, Cell>;
  const rows: Record<string, { prefix: string; list: TwinCard[] }> = { monster: { prefix: "m", list: [] }, "spell-trap": { prefix: "s", list: [] } };
  for (const card of twin) {
    if (card.zone === "graveyard") cells.gy.count++;
    else if (card.zone === "extra") cells.ex.count++;
    else if (card.zone === "deck") cells.deck.count++;
    else if (card.zone === "field") { cells.f.card = card; cells.f.count = 1; }
    else if (rows[card.zone]) rows[card.zone].list.push(card);
  }
  for (const { prefix, list } of Object.values(rows)) {
    const used = new Set<number>(); const loose: TwinCard[] = [];
    for (const card of list) {
      if (card.slot && !used.has(card.slot)) { used.add(card.slot); cells[`${prefix}${card.slot}` as ZoneKey] = { card, count: 1 }; } else loose.push(card);
    }
    for (const card of loose) {
      const free = [1, 2, 3, 4, 5].find(n => !used.has(n)); if (!free) break;
      used.add(free); cells[`${prefix}${free}` as ZoneKey] = { card, count: 1 };
    }
  }
  return cells;
}
export const cellKeyOf = (card: TwinCard): ZoneKey | null => {
  for (const [k, cell] of Object.entries(cellsFor([card]))) if (cell.card?.ref === card.ref) return k as ZoneKey;
  return null;
};

export const cardCode = (card: Pick<TwinCard, "cardId" | "passcode">) => card.cardId ?? card.passcode;
export function cardName(card: TwinCard, info?: CardInfo): string { return card.name ?? info?.name ?? (cardCode(card) ? `Card ${cardCode(card)}` : "Unknown card"); }
/** Frame class for the small card art. */
export function frameOf(info: CardInfo | undefined): "tNormal" | "tEffect" | "tSpell" | "tTrap" {
  const type = info?.type ?? "";
  if (/spell/i.test(type)) return "tSpell";
  if (/trap/i.test(type)) return "tTrap";
  return /normal/i.test(type) && !/effect/i.test(type) ? "tNormal" : "tEffect";
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
  else if (diff < 0) { damageSeat = attacker.seat; damage = diff; }
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
export const readCardOf = (hit: { quad: { x: number; y: number }[]; kind: "face-up" | "face-down"; confidence: number; refined: boolean }) =>
  ({ quad: hit.quad, kind: hit.kind, confidence: hit.confidence, partial: !hit.refined });
