"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cardArt, isMonsterInfo, type CardInfo } from "./catalog";
import { Icon } from "./icons";
import s from "./remote-ui.module.css";

/** A box in viewport pixels. */
export type Rect = { left: number; top: number; right: number; bottom: number };
/** Where a card popup points: the clicked card, and the feed that shows it (the popup stays inside the feed when it fits). */
export type PopAt = { anchor: Rect | null; feed: Rect | null };
export type Tier = "sure" | "not sure" | "low match";

const MARGIN = 8; const GAP = 14;
type Placed = { left: number; top: number; side: "left" | "right" | "none"; arrow: number };

/** Puts a popup of size w x h beside the card, inside the feed when it fits there, otherwise inside the window. */
export function placePopup(at: PopAt, w: number, h: number, vw: number, vh: number): Placed {
  const view: Rect = { left: MARGIN, top: MARGIN, right: vw - MARGIN, bottom: vh - MARGIN };
  const card = at.anchor;
  if (!card) return { left: Math.max(MARGIN, (vw - w) / 2), top: Math.max(MARGIN, (vh - h) / 2), side: "none", arrow: 0 };
  const inside = (box: Rect) => ({ x: box.right - box.left >= w + MARGIN, y: box.bottom - box.top >= h + MARGIN });
  const tryBox = (box: Rect): Placed | null => {
    if (!inside(box).x) return null;
    const right = card.right + GAP; const left = card.left - GAP - w;
    const side = right + w <= box.right ? "right" : left >= box.left ? "left" : null;
    if (!side) return null;
    const x = side === "right" ? right : left;
    const mid = (card.top + card.bottom) / 2;
    const lo = inside(box).y ? box.top + MARGIN : view.top; const hi = (inside(box).y ? box.bottom - MARGIN : view.bottom) - h;
    const top = Math.max(lo, Math.min(mid - h / 2, Math.max(lo, hi)));
    return { left: x, top, side: side === "right" ? "left" : "right", arrow: Math.max(22, Math.min(h - 22, mid - top)) };
  };
  const clipped: Rect | null = at.feed ? { left: Math.max(at.feed.left, view.left), top: Math.max(at.feed.top, view.top), right: Math.min(at.feed.right, view.right), bottom: Math.min(at.feed.bottom, view.bottom) } : null;
  const placed = (clipped && tryBox(clipped)) ?? tryBox(view);
  if (placed) return placed;
  // No room beside the card: cover the lower part of the window and keep the card visible above it.
  return { left: Math.max(MARGIN, Math.min(vw - w - MARGIN, (card.left + card.right) / 2 - w / 2)), top: Math.max(MARGIN, vh - h - MARGIN), side: "none", arrow: 0 };
}

/**
 * The frame of the card popups (tray and identified card): fixed beside the clicked card with a small pointer.
 * On a phone or a narrow window the CSS turns it into a bottom sheet and the position is ignored.
 */
export function PopupFrame({ at, layer, label, busy, testid, className, children }: {
  at: PopAt; layer: string; label: string; busy?: boolean; testid: string; className?: string; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const key = `${at.anchor ? `${Math.round(at.anchor.left)},${Math.round(at.anchor.top)},${Math.round(at.anchor.right)},${Math.round(at.anchor.bottom)}` : "-"}|${at.feed ? `${Math.round(at.feed.left)},${Math.round(at.feed.top)},${Math.round(at.feed.right)},${Math.round(at.feed.bottom)}` : "-"}`;
  useLayoutEffect(() => {
    const node = box.current; if (!node) return;
    const place = () => setPlaced(old => {
      const next = placePopup(at, node.offsetWidth, node.offsetHeight, window.innerWidth, window.innerHeight);
      return old && old.left === next.left && old.top === next.top && old.side === next.side && old.arrow === next.arrow ? old : next;
    });
    place();
    const observer = new ResizeObserver(place); observer.observe(node);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
    // `key` stands for the two boxes in `at`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const style: CSSProperties = placed ? { left: placed.left, top: placed.top, ["--arrow" as string]: `${placed.arrow}px` } : { left: 8, top: 8, visibility: "hidden" };
  return <div ref={box} className={`${s.pop} ${s.big} ${s.show} ${className ?? ""}`} data-layer={layer} data-side={placed?.side ?? "none"} role="dialog" aria-label={label} aria-busy={busy} style={style} data-testid={testid}>
    {children}
  </div>;
}

/** The large card picture. `id` null shows the shimmer while the reader works. */
export function BigArt({ id, label, reading }: { id: number | null; label?: string; reading?: boolean }) {
  const [broken, setBroken] = useState<number | null>(null);
  const bad = id !== null && broken === id;
  return <div className={`${s.bigart} ${id === null ? s.bigartSk : ""}`} aria-hidden={id === null && !reading ? true : undefined}>
    {id === null ? <div className={s.skart}><div className={s.skshine} />{reading ? <span className={s.skread}><i />Reading card…</span> : <span className={s.skread}><Icon name="cam" />{label ?? "No card"}</span>}</div>
      : bad ? <div className={s.skart}><span className={s.skread}>{label ?? "Art unavailable"}</span></div>
      : <img key={id} src={cardArt(id, "full")} alt={label ?? ""} onError={() => setBroken(id)} data-testid="big-art" />}
  </div>;
}

/** Slim tier chip: how sure the local reader was. */
export function TierChip({ tier }: { tier: Tier | undefined }) {
  if (!tier) return null;
  return <span className={`${s.tier} ${tier === "sure" ? s.tierSure : tier === "not sure" ? s.tierMaybe : s.tierLow}`} data-testid="tier-chip" data-tier={tier}>
    {tier === "sure" ? "Sure" : tier === "not sure" ? "Not sure" : "Low match"}
  </span>;
}

/** The facts and text lines in the order of the duel card inspector: facts, ATK / DEF, then the card text under a rule. */
export function cardFacts(info: CardInfo | undefined): { facts: string; combat: string | null } {
  if (!info) return { facts: "", combat: null };
  const link = /link/i.test(info.type);
  const monster = isMonsterInfo(info);
  const rank = !monster || link || !info.level ? "" : /xyz/i.test(info.type) ? `Rank ${info.level}` : `Level ${info.level}`;
  const facts = monster ? [rank, info.attribute, info.type.replace(/\s*monster$/i, "")].filter(Boolean).join(" · ") : info.type.replace(/\s*card$/i, "");
  if (!monster) return { facts, combat: null };
  const atk = `ATK ${info.atk ?? "?"}`;
  return { facts, combat: link ? (info.level ? `${atk} / LINK-${info.level}` : atk) : `${atk} / DEF ${info.def ?? "?"}` };
}

/** Name, facts, combat line and the full card text. `children` sit between the facts and the text. */
export function CardText({ info, name, fallbackName, children }: { info: CardInfo | undefined; name?: string; fallbackName: string; children?: ReactNode }) {
  const { facts, combat } = cardFacts(info);
  return <>
    <h2 className={s.bname} data-testid="popover-name">{info?.name ?? name ?? fallbackName}</h2>
    {children}
    {facts || combat ? <div className={s.bfacts}>{facts ? <p className={s.bdetails}>{facts}</p> : null}{combat ? <p className={s.bcombat}>{combat}</p> : null}</div>
      : <div className={s.bfacts}><p className={s.bdetails}>Loading card…</p></div>}
    {info?.effectText ? <p className={s.btext} tabIndex={0} aria-label="Card text">{info.effectText}</p> : null}
  </>;
}
