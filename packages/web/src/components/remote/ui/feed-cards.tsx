"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { fieldMatPoint, hasExtraMonsterZones, type FieldCalibration, type FieldFormat } from "@yugidraft/vision";
import { fieldGridCells, useZoneGrid } from "@/lib/remote/zone-grid";
import type { CardInfo } from "./catalog";
import { cardCode, cardName, cellsFor, type TwinCard } from "./model";
import { statsOf, type CardStats } from "./card-stats";
import { useVideoHub } from "./video-hub";
import t from "./stats-tokens.module.css";

/** The cards of every seat and the card facts, for the labels drawn on camera feeds. The table and the spectator screen provide it. */
type Source = { seats: readonly { twin: readonly TwinCard[] }[]; info: (id: number | undefined) => CardInfo | undefined };
const Ctx = createContext<Source | null>(null);
export function FeedCardsProvider({ seats, info, children }: Source & { children: ReactNode }) {
  const value = useMemo(() => ({ seats, info }), [seats, info]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

type Point = { x: number; y: number };
/** A card is 59 by 86; the cell holds one card. Local units: the cell is 1 wide and CARD_RATIO tall. */
const CARD_RATIO = 86 / 59;
/** The card fills this share of the cell width (Attack). In Defense it lies on its side and fits the width of the cell. */
const FILL = .84, FIT = .92;

/**
 * Corners of a card lying in a cell, in cell fractions (0..1). Attack: upright. Defense: turned a quarter turn
 * counter-clockwise as the virtual field draws it, so the card's top edge is on the left. `front` is that top edge.
 */
export function cardInCell(defense: boolean): { corners: Point[]; front: [Point, Point] } {
  const hw = FILL / 2, hh = hw * CARD_RATIO;
  const local: Point[] = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
  // CSS rotate(-90deg) in screen coordinates (y down): (x, y) -> (y, -x). Then fit the card's long side into the cell width.
  const scale = defense ? Math.min(1, (FIT / 2) / hh) : 1;
  const place = (p: Point): Point => { const q = defense ? { x: p.y, y: -p.x } : p; return { x: .5 + q.x * scale, y: .5 + (q.y * scale) / CARD_RATIO }; };
  const corners = local.map(place);
  return { corners, front: [corners[0], corners[1]] };
}

/** A point of a cell (fractions 0..1) on the picture (0..1), through the calibration's homography. */
const through = (calibration: FieldCalibration, cell: { x: number; y: number; w: number; h: number }, p: Point): Point => fieldMatPoint({ x: cell.x + p.x * cell.w, y: cell.y + p.y * cell.h }, calibration);
const inView = (p: Point) => p.x > .01 && p.x < .99 && p.y > .01 && p.y < .99;

/** The saved calibration of a feed, read again twice a second (a calibration someone else shares arrives over the data channel). */
function useCalibration(read: () => FieldCalibration | undefined): FieldCalibration | undefined {
  const latest = useRef(read); latest.current = read;
  const [value, setValue] = useState<FieldCalibration | undefined>(() => read());
  useEffect(() => {
    const refresh = () => { const next = latest.current(); setValue(old => JSON.stringify(old) === JSON.stringify(next) ? old : next); };
    refresh(); const timer = setInterval(refresh, 500); return () => clearInterval(timer);
  }, []);
  return value;
}

type Item = { key: string; card: TwinCard; stats: CardStats; cell: { x: number; y: number; w: number; h: number } };

/**
 * Over one camera feed: the ATK / DEF of each face-up monster, and each token as a card drawn in its zone. Everything is
 * placed through the calibration, so it follows the mat's perspective. A token lies turned in Defense. The text is plain
 * HTML, so it reads upright for whoever looks at the feed. Without a saved calibration (zones placed on the mat) nothing is drawn.
 */
export function FeedCards({ seat, frame, format, read }: { seat: number; frame: CSSProperties | null; format: FieldFormat; read: () => FieldCalibration | undefined }) {
  const data = useContext(Ctx);
  const calibration = useCalibration(read);
  const emz = hasExtraMonsterZones(format);
  const cells = useMemo(() => fieldGridCells(format, calibration?.zoneSpacing, calibration?.zones), [format, calibration?.zoneSpacing, calibration?.zones]);
  const twin = data?.seats[seat]?.twin;
  const items = useMemo<Item[]>(() => {
    if (!twin || !data) return [];
    const placed = cellsFor(twin, emz);
    return (["m1", "m2", "m3", "m4", "m5", "e1", "e2"] as const).flatMap(key => {
      const card = placed[key]?.card; if (!card) return [];
      const stats = statsOf(card, data.info(cardCode(card))); if (!stats) return [];
      const zone = key[0] === "m" ? `M${key[1]}` : `EMZ${key[1]}`;
      const cell = cells.find(item => item.zone === zone); return cell ? [{ key: card.ref, card, stats, cell }] : [];
    });
  }, [twin, data, emz, cells]);
  if (!frame || !calibration?.orientation || !items.length) return null;
  const tokens = items.filter(item => item.card.token);
  return <div className={t.feedLayer} style={frame} aria-hidden="true" data-testid={`feed-cards-${seat}`}>
    <svg viewBox="0 0 1 1" preserveAspectRatio="none">
      {tokens.map(({ key, card, cell }) => {
        const shape = cardInCell(card.position === "defense");
        const pts = shape.corners.map(p => through(calibration, cell, p));
        const [a, b] = shape.front.map(p => through(calibration, cell, p));
        return <g key={key} data-testid="feed-token" data-position={card.position === "defense" ? "defense" : "attack"}>
          <polygon className={t.tokenFill} points={pts.map(p => `${p.x},${p.y}`).join(" ")} />
          <line className={t.tokenFront} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        </g>;
      })}
    </svg>
    {items.map(({ key, card, stats, cell }) => {
      // A token's label sits at the middle of its card; a real card keeps its picture clear, so its label goes near the lower edge.
      const at = through(calibration, cell, card.token ? { x: .5, y: .5 } : { x: .5, y: .86 });
      if (!inView(at)) return null;
      return <span key={key} className={t.label} style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }} data-testid={card.token ? "feed-token-label" : "feed-stats"}>
        {card.token ? <small>{cardName(card)}</small> : null}
        <b>{stats.atk}{stats.def !== undefined ? `/${stats.def}` : ""}{stats.rating ? <em> {stats.rating}</em> : null}</b>
      </span>;
    })}
  </div>;
}

/** The overlay of a player's own table feed or another player's feed: the calibration is the shared one or the one the owner sends. */
export function HubFeedCards({ seat, frame }: { seat: number; frame: CSSProperties | null }) {
  const grid = useZoneGrid(), hub = useVideoHub();
  const own = grid.ownSeat === seat;
  const read = () => own ? (grid.placed ? grid.calibration : undefined) : hub.trackedCalibration?.(seat);
  return <FeedCards seat={seat} frame={frame} format={grid.format} read={read} />;
}
