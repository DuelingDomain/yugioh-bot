"use client";

import { isLinkInfo, isMonsterInfo, type CardInfo } from "./catalog";
import { cardCode, type TwinCard } from "./model";
import t from "./stats-tokens.module.css";

/** What a face-up monster shows on the field and on a camera feed. Link monsters have ATK and a rating, no DEF. */
export type CardStats = { atk: string; def?: string; rating?: string };

const show = (value: number | null | undefined) => (value === undefined || value === null || value < 0 ? "?" : String(value));
const FIELD_ZONES = new Set(["monster", "extra-monster"]);

/**
 * The printed values of a face-up monster in a Monster Zone, or of a token (its own values). The table does not track
 * changes to ATK / DEF (boosts, effects, counters), so a monster shows what is printed on the card.
 */
export function statsOf(card: TwinCard, info: CardInfo | undefined): CardStats | null {
  if (!card.faceUp || !FIELD_ZONES.has(card.zone)) return null;
  if (card.token) return { atk: show(card.token.atk), def: show(card.token.def) };
  if (!cardCode(card) || !info || !isMonsterInfo(info)) return null;
  return isLinkInfo(info) ? { atk: show(info.atk), ...(info.level ? { rating: `L${info.level}` } : {}) } : { atk: show(info.atk), def: show(info.def) };
}

export const statsText = (stats: CardStats) => `ATK ${stats.atk}${stats.def !== undefined ? ` DEF ${stats.def}` : ""}${stats.rating ? ` Link rating ${stats.rating.slice(1)}` : ""}`;

/**
 * The ATK / DEF plate of a card in a field cell. It is a sibling of the card, so a Defense card turns under it and
 * the numbers stay upright. A field turned 180 degrees (another player's) turns the plate back, so it reads upright
 * for the viewer on either side of the table.
 */
export function StatPlate({ stats, turned }: { stats: CardStats; turned?: boolean }) {
  return <div className={`${t.wrap} ${turned ? t.turned : ""}`} aria-hidden="true" data-testid="stat-plate" data-upright="1">
    <span className={t.plate}><b>{stats.atk}</b>{stats.def !== undefined ? <><i>/</i><b>{stats.def}</b></> : null}{stats.rating ? <em>{stats.rating}</em> : null}</span>
  </div>;
}
