import type { DuelCard, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";
import { LOCATION_MZONE, LOCATION_SZONE, zoneKey } from "./constants";

/**
 * Equip links on the board: which card is attached to which monster.
 *
 * The server puts `equippedTo` (the monster's zone) on the equip card of each board snapshot, read
 * live from the core, so a link is always true for the board that is shown. Everything here is read
 * from that snapshot and nothing is kept between renders, so a page that loads late, a replay and a
 * monster that moved or changed control all show the right links. A hidden card carries no link, and
 * a face-down monster is never named.
 */

export type EquipLink = {
  /** Zone key of the equip card (see zoneKey). */
  equipKey: string;
  /** Zone key of the monster. */
  hostKey: string;
  equip: DuelCard;
  /** The monster as the viewer sees it: face-down monsters carry no name. */
  host: DuelCard;
  equipZone: DuelZoneRef;
  hostZone: DuelZoneRef;
};

export type EquipLinks = {
  /** In board order: seat 0 first, spells by zone. */
  links: readonly EquipLink[];
  byEquip: ReadonlyMap<string, EquipLink>;
  byHost: ReadonlyMap<string, readonly EquipLink[]>;
};

export type EquipRole =
  | { role: "equip"; link: EquipLink }
  | { role: "host"; links: readonly EquipLink[] };

export const EMPTY_EQUIP_LINKS: EquipLinks = { links: [], byEquip: new Map(), byHost: new Map() };

const keyOf = (card: { controller: number; location: number; sequence: number }): string =>
  zoneKey(card.controller, card.location, card.sequence);

const zoneOf = (card: { controller: number; location: number; sequence: number }): DuelZoneRef => ({
  controller: card.controller,
  location: card.location,
  sequence: card.sequence,
});

/** Reads every equip link from the seats of a board snapshot. A link with no monster on the board is dropped. */
export function resolveEquipLinks(seats: readonly DuelSeatView[]): EquipLinks {
  const onField = new Map<string, DuelCard>();
  for (const seat of seats) {
    for (const card of seat.monsters) if (card) onField.set(keyOf(card), card);
    for (const card of seat.spells) if (card) onField.set(keyOf(card), card);
  }
  const links: EquipLink[] = [];
  const byEquip = new Map<string, EquipLink>();
  const byHost = new Map<string, EquipLink[]>();
  for (const seat of seats) {
    for (const card of [...seat.monsters, ...seat.spells]) {
      const target = card?.equippedTo;
      if (!card || !target) continue;
      if (card.location !== LOCATION_MZONE && card.location !== LOCATION_SZONE) continue;
      const hostKey = keyOf(target);
      const host = onField.get(hostKey);
      if (!host) continue;
      const link: EquipLink = { equipKey: keyOf(card), hostKey, equip: card, host, equipZone: zoneOf(card), hostZone: zoneOf(host) };
      links.push(link);
      byEquip.set(link.equipKey, link);
      byHost.set(hostKey, [...(byHost.get(hostKey) ?? []), link]);
    }
  }
  return links.length === 0 ? EMPTY_EQUIP_LINKS : { links, byEquip, byHost };
}

/** What a board card is in the links: the equip card, the monster that carries equips, or neither. */
export function roleOfCard(links: EquipLinks, card: Pick<DuelCard, "controller" | "location" | "sequence">): EquipRole | null {
  const key = keyOf(card);
  const link = links.byEquip.get(key);
  if (link) return { role: "equip", link };
  const carried = links.byHost.get(key);
  return carried && carried.length > 0 ? { role: "host", links: carried } : null;
}

/** The links that use any of these zone keys (an element's data-zones list). */
export function linksTouching(links: EquipLinks, keys: readonly string[]): EquipLink[] {
  if (links.links.length === 0 || keys.length === 0) return [];
  return links.links.filter((link) => keys.includes(link.equipKey) || keys.includes(link.hostKey));
}

function nameOf(card: DuelCard): string | null {
  return card.code == null ? null : (card.name ?? null);
}

/** "Equipped to Blue-Eyes White Dragon"; a face-down monster is never named. */
export function equippedToText(link: EquipLink): string {
  if (link.host.code == null) return "Equipped to a face-down monster";
  return `Equipped to ${nameOf(link.host) ?? "a monster"}`;
}

/** "Equipped with Axe of Despair, Neo Blue-Eyes Ultimate Dragon". */
export function equippedWithText(links: readonly EquipLink[]): string {
  return `Equipped with ${links.map((link) => nameOf(link.equip) ?? "a card").join(", ")}`;
}

export function equipCountText(count: number): string {
  return `${count} equip${count === 1 ? "" : "s"}`;
}

/** The sentence for a board card: its tooltip and its screen reader text. null when it has no link. */
export function equipSentence(role: EquipRole | null): string | null {
  if (!role) return null;
  return role.role === "equip" ? equippedToText(role.link) : equippedWithText(role.links);
}

/* ---------- geometry (pure, so the line can be tested without a browser) ---------- */

export type Point = { x: number; y: number };
export type Box = { left: number; top: number; width: number; height: number };

const round2 = (n: number): number => Math.round(n * 100) / 100;
const num = (n: number): string => String(round2(n));

/**
 * Where the segment from the centre of `box` toward `toward` leaves the box. The centre when both
 * are the same point.
 */
export function boxEdgePoint(box: Box, toward: Point): Point {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : box.width / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : box.height / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: round2(cx + dx * t), y: round2(cy + dy * t) };
}

export type EquipLine = { d: string; from: Point; to: Point; mid: Point };

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * The line from the equip card to its monster. It leaves each card through the edge that faces the
 * other, `inset` px inside it, so the ends sit on the card art even when the two rows are only a
 * small gap apart. Cards in one column get a straight line; others a gentle bend. null when the
 * cards overlap (mid-move) or nothing can be drawn.
 */
export function equipLinePath(equipBox: Box, hostBox: Box, inset = 0): EquipLine | null {
  if (overlaps(equipBox, hostBox)) return null;
  const ec = { x: equipBox.left + equipBox.width / 2, y: equipBox.top + equipBox.height / 2 };
  const hc = { x: hostBox.left + hostBox.width / 2, y: hostBox.top + hostBox.height / 2 };
  const pull = (edge: Point, centre: Point): Point => {
    const dx = centre.x - edge.x;
    const dy = centre.y - edge.y;
    const len = Math.hypot(dx, dy);
    if (len === 0 || inset <= 0) return edge;
    const step = Math.min(inset, len);
    return { x: round2(edge.x + (dx / len) * step), y: round2(edge.y + (dy / len) * step) };
  };
  const from = pull(boxEdgePoint(equipBox, hc), ec);
  const to = pull(boxEdgePoint(hostBox, ec), hc);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1) return null;
  if (Math.abs(hc.x - ec.x) <= 4) {
    return { d: `M ${num(from.x)} ${num(from.y)} L ${num(to.x)} ${num(to.y)}`, from, to, mid: { x: round2((from.x + to.x) / 2), y: round2((from.y + to.y) / 2) } };
  }
  const bend = Math.min(len * 0.16, 24);
  const control = { x: (from.x + to.x) / 2 + (dy / len) * bend, y: (from.y + to.y) / 2 - (dx / len) * bend };
  const mid = { x: round2(0.25 * from.x + 0.5 * control.x + 0.25 * to.x), y: round2(0.25 * from.y + 0.5 * control.y + 0.25 * to.y) };
  return { d: `M ${num(from.x)} ${num(from.y)} Q ${num(control.x)} ${num(control.y)} ${num(to.x)} ${num(to.y)}`, from, to, mid };
}
