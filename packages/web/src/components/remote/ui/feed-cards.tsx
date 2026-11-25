"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { fieldMatPoint, hasExtraMonsterZones, type FieldCalibration, type FieldFormat } from "@yugidraft/vision";
import { fieldGridCells, useZoneGrid } from "@/lib/remote/zone-grid";
import type { CardInfo } from "./catalog";
import { cardArt } from "./catalog";
import { cardCode, cardName, cellsFor, type TwinCard } from "./model";
import { statsOf, type CardStats } from "./card-stats";
import { useVideoHub } from "./video-hub";
import { isFresh, markLabel, useLiveMarks, type ChainMark } from "./chain-marks";
import t from "./stats-tokens.module.css";

/** The cards of every seat and the card facts, for the labels drawn on camera feeds. The table and the spectator screen provide it. */
type Source = { seats: readonly { twin: readonly TwinCard[] }[]; info: (id: number | undefined) => CardInfo | undefined; marks?: readonly ChainMark[] };
const Ctx = createContext<Source | null>(null);
export function FeedCardsProvider({ seats, info, marks, children }: Source & { children: ReactNode }) {
  const value = useMemo(() => ({ seats, info, marks }), [seats, info, marks]);
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

type Cell = { x: number; y: number; w: number; h: number };
type Item = { key: string; card: TwinCard; stats: CardStats; cell: Cell };
type Proxy = { key: string; card: TwinCard; cell: Cell };
const ZONE_OF: Record<string, string> = { m1: "M1", m2: "M2", m3: "M3", m4: "M4", m5: "M5", e1: "EMZ1", e2: "EMZ2", s1: "S1", s2: "S2", s3: "S3", s4: "S4", s5: "S5", f: "FIELD" };

/**
 * A card this seat controls but does not own (given to it, or taken: `ownerSeat` names the real owner). Its paper card
 * lies on the owner's mat, so nothing on this seat's own mat shows it. It is drawn as a proxy in its zone on this feed.
 */
const isControlled = (card: TwinCard, seat: number) => card.ownerSeat !== undefined && card.ownerSeat !== seat && !card.token;

/** Maps the unit square (an image's corners) to a card's corners as an SVG affine matrix; the card is small, so perspective across it is negligible. */
const matrixOf = ([a, b, , d]: Point[]) => `matrix(${b.x - a.x} ${b.y - a.y} ${d.x - a.x} ${d.y - a.y} ${a.x} ${a.y})`;

/**
 * Over one camera feed: the ATK / DEF of each face-up monster, each token as a card drawn in its zone, and each card the
 * seat controls for another player as a proxy (art, ATK / DEF and a Controlled tag). Everything is placed through the
 * calibration, so it follows the mat's perspective. A token or proxy lies turned in Defense. The text is plain HTML, so
 * it reads upright for whoever looks at the feed. Without a saved calibration (zones placed on the mat) nothing is drawn.
 */
export function FeedCards(props: { seat: number; frame: CSSProperties | null; format: FieldFormat; read: () => FieldCalibration | undefined }) {
  return <><FeedStats {...props} /><FeedChain {...props} /></>;
}

/**
 * The chain mark on a feed: a short glow and the label "Effect activated · Chain N" where the activated card lies on the
 * mat, then a small "Chain N" badge while the chain is open. A card with no field cell (in hand, or no calibration) shows
 * the label at the top of the feed instead. Plain HTML, so it reads upright for everyone.
 */
function FeedChain({ seat, frame, format, read }: { seat: number; frame: CSSProperties | null; format: FieldFormat; read: () => FieldCalibration | undefined }) {
  const data = useContext(Ctx);
  const { live, now } = useLiveMarks(data?.marks);
  const calibration = useCalibration(read);
  const emz = hasExtraMonsterZones(format);
  const cells = useMemo(() => fieldGridCells(format, calibration?.zoneSpacing, calibration?.zones), [format, calibration?.zoneSpacing, calibration?.zones]);
  const twin = data?.seats[seat]?.twin;
  const known = (ref: string) => !!ref && !!data?.seats.some(item => item.twin.some(card => card.ref === ref));
  const mine = live.filter(mark => twin?.some(card => card.ref === mark.ref) || (mark.seat === seat && !known(mark.ref)));
  if (!frame || !mine.length || !twin) return null;
  const placed = cellsFor(twin, emz);
  return <div className={t.feedLayer} style={frame} aria-hidden="true" data-testid={`feed-chain-${seat}`}>
    {mine.map(mark => {
      const key = (Object.keys(ZONE_OF) as (keyof typeof ZONE_OF)[]).find(zone => placed[zone as keyof typeof placed]?.card?.ref === mark.ref);
      const cell = key ? cells.find(item => item.zone === ZONE_OF[key]) : undefined;
      const at = calibration?.orientation && cell ? through(calibration, cell, { x: .5, y: .02 }) : null;
      const fresh = isFresh(mark, now);
      if (at && inView(at)) {
        const corners = cardInCell(false).corners.map(p => through(calibration!, cell!, p));
        return <span key={`${mark.ref}:${mark.n}`} data-testid="feed-chain-mark" data-fresh={fresh ? "1" : "0"}>
          {fresh ? <svg viewBox="0 0 1 1" preserveAspectRatio="none"><polygon className={t.chainGlow} points={corners.map(p => `${p.x},${p.y}`).join(" ")} /></svg> : null}
          <span className={`${t.label} ${t.chainTag}`} style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}>{markLabel(mark, now)}</span>
        </span>;
      }
      return <span key={`${mark.ref}:${mark.n}`} className={`${t.label} ${t.chainTag} ${t.chainTop}`} data-testid="feed-chain-mark" data-fresh={fresh ? "1" : "0"}>{markLabel(mark, now)}</span>;
    })}
  </div>;
}

function FeedStats({ seat, frame, format, read }: { seat: number; frame: CSSProperties | null; format: FieldFormat; read: () => FieldCalibration | undefined }) {
  const data = useContext(Ctx);
  const clipBase = useId().replace(/\W/g, "");
  const calibration = useCalibration(read);
  const emz = hasExtraMonsterZones(format);
  const cells = useMemo(() => fieldGridCells(format, calibration?.zoneSpacing, calibration?.zones), [format, calibration?.zoneSpacing, calibration?.zones]);
  const twin = data?.seats[seat]?.twin;
  const { items, proxies } = useMemo<{ items: Item[]; proxies: Proxy[] }>(() => {
    if (!twin || !data) return { items: [], proxies: [] };
    const placed = cellsFor(twin, emz);
    const items: Item[] = [], proxies: Proxy[] = [];
    for (const key of Object.keys(ZONE_OF) as (keyof typeof ZONE_OF)[]) {
      const card = placed[key as keyof typeof placed]?.card; const cell = cells.find(item => item.zone === ZONE_OF[key]);
      if (!card || !cell) continue;
      if (isControlled(card, seat)) proxies.push({ key: card.ref, card, cell });
      const stats = key[0] === "m" || key[0] === "e" ? statsOf(card, data.info(cardCode(card))) : null; if (stats) items.push({ key: card.ref, card, stats, cell });
    }
    return { items, proxies };
  }, [twin, data, emz, cells, seat]);
  if (!frame || !calibration?.orientation || !(items.length || proxies.length)) return null;
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
      {proxies.map(({ key, card, cell }, index) => {
        const shape = cardInCell(card.position === "defense");
        const pts = shape.corners.map(p => through(calibration, cell, p));
        const code = card.faceUp ? cardCode(card) : undefined;
        const points = pts.map(p => `${p.x},${p.y}`).join(" "), clip = `${clipBase}-${index}`;
        return <g key={key} data-testid="feed-proxy" data-position={card.position === "defense" ? "defense" : "attack"} data-face={code ? "up" : "down"}>
          <polygon className={t.tokenFill} points={points} />
          {code ? <><clipPath id={clip}><polygon points={points} /></clipPath>
            <g clipPath={`url(#${clip})`}><image href={cardArt(code)} width="1" height="1" preserveAspectRatio="none" transform={matrixOf(pts)} /></g></> : null}
          <polygon className={t.proxyEdge} points={points} />
        </g>;
      })}
    </svg>
    {proxies.map(({ key, card, cell }) => {
      const at = through(calibration, cell, { x: .5, y: card.position === "defense" ? .22 : .02 });
      if (!inView(at)) return null;
      return <span key={key} className={`${t.label} ${t.tag}`} style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }} data-testid="feed-proxy-tag">Controlled</span>;
    })}
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
