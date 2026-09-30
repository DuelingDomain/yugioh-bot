"use client";

// Hearthstone-style history rail for the Log tab: the last dozen actions as compact tiles, newest on top.
// Event grouping lives in history-model.ts (pure, tested); this file only draws it.
import { useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DuelCard, DuelCardInfo, DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";
import { cardArtUrl, formatLp } from "./constants";
import { duelFontClasses } from "./fonts";
import {
  emptyHistory,
  ingestHistory,
  isHiddenHistoryCard,
  shouldResetHistory,
  visibleHistory,
  type HistoryCard,
  type HistoryContext,
  type HistorySeparator,
  type HistoryState,
  type HistoryTile,
} from "./history-model";
import styles from "./history-rail.module.css";

export type DuelHistoryRailProps = {
  events: DuelEvent[];
  engine: DuelEngineView;
  mySeat: number | null;
  playerName: (seat: number) => string;
  /** Show a card in the inspector (Card tab). */
  onInspectCard: (card: DuelCard | DuelCardInfo) => void;
  reducedMotion: boolean;
};

const MAX_TILES = 12;
const DETAIL_WIDTH = 268;

function contextFor(engine: DuelEngineView): HistoryContext {
  const cards: DuelCard[] = [];
  for (const seat of engine.seats) {
    for (const card of seat.monsters) if (card) cards.push(card);
    for (const card of seat.spells) if (card) cards.push(card);
  }
  return {
    revision: engine.revision,
    turn: engine.turn,
    turnSeat: engine.turnSeat,
    phase: engine.phase,
    seatCount: engine.seats.length,
    cards,
  };
}

type Side = "you" | "opp";

function sideOf(seat: number | null, mySeat: number | null): Side {
  if (seat == null) return "opp";
  if (mySeat == null) return seat === 0 ? "you" : "opp";
  return seat === mySeat ? "you" : "opp";
}

function cardName(card: HistoryCard | null | undefined): string | null {
  return card && !isHiddenHistoryCard(card) ? (card.name ?? null) : null;
}

function inspectable(card: HistoryCard | null | undefined): card is HistoryCard {
  return card != null && card.code != null;
}

const SUMMON_VERB = {
  normal: "Normal Summon",
  tribute: "Tribute Summon",
  special: "Special Summon",
  flip: "Flip Summon",
} as const;

const SUMMON_PAST = {
  normal: "Normal Summoned",
  tribute: "Tribute Summoned",
  special: "Special Summoned",
  flip: "Flip Summoned",
} as const;

const CAUSE_LABEL = { battle: "battle damage", effect: "effect damage", cost: "LP paid" } as const;

type Namer = (seat: number | null) => string;

function verbFor(tile: HistoryTile): string {
  switch (tile.kind) {
    case "summon":
      return SUMMON_VERB[tile.summonKind ?? "normal"];
    case "set":
      return "Set";
    case "activate":
      return "Activates";
    case "attack":
      return tile.target?.direct ? "Direct" : "Attacks";
    case "damage":
      return tile.hits[0] ? (tile.hits[0].cause === "cost" ? "Pays LP" : "Takes damage") : "Damage";
    case "destroy":
      return "Destroyed";
  }
}

/** One full sentence for screen readers and the detail card. */
function sentenceFor(tile: HistoryTile, who: Namer): string {
  const actor = who(tile.seat);
  const name = cardName(tile.card);
  const parts: string[] = [];
  switch (tile.kind) {
    case "summon":
      parts.push(`${actor} ${SUMMON_PAST[tile.summonKind ?? "normal"]} ${name ?? "a face-down monster"}.`);
      break;
    case "set":
      parts.push(name ? `${actor} Set ${name}.` : `${actor} Set a card.`);
      break;
    case "activate":
      parts.push(`${actor} activated ${name ?? "a card"}.`);
      if (tile.chain && tile.chain.size > 1) parts.push(`Chain link ${tile.chain.index} of ${tile.chain.size}.`);
      if (tile.chain?.status === "negated") parts.push("Negated.");
      else if (tile.chain?.status === "resolved") parts.push("Resolved.");
      else if (tile.chain?.status === "resolving") parts.push("Resolving.");
      break;
    case "attack": {
      const attacker = name ?? "a monster";
      if (tile.target?.direct) parts.push(`${actor} attacked directly with ${attacker}.`);
      else parts.push(`${actor} attacked ${cardName(tile.target?.card) ?? "a monster"} with ${attacker}.`);
      break;
    }
    case "damage":
      break;
    case "destroy":
      parts.push(`${name ?? "A card"} was destroyed.`);
      break;
  }
  for (const hit of tile.hits) parts.push(`${who(hit.seat)} took ${formatLp(hit.amount)} ${CAUSE_LABEL[hit.cause]}.`);
  if (tile.kind !== "destroy") {
    for (const loss of tile.destroyed) parts.push(`${cardName(loss.card) ?? "A card"} was destroyed.`);
  }
  return parts.join(" ");
}

function CrackMark() {
  return (
    <svg className={styles.crack} viewBox="0 0 24 34" aria-hidden="true" focusable="false">
      <path d="M13 1 L9 11 L15 15 L8 23 L13 27 L10 33" pathLength={1} />
      <path d="M9 11 L3 14 M15 15 L21 13 M8 23 L3 27" pathLength={1} />
    </svg>
  );
}

function Art({ card, back = false, struck = false, size = "sm", role }: {
  card: HistoryCard | null | undefined;
  back?: boolean;
  struck?: boolean;
  size?: "sm" | "lg";
  role?: "attacker" | "target";
}) {
  const code = !back && card && !isHiddenHistoryCard(card) ? card.code : null;
  return (
    <span className={styles.art} data-size={size} data-struck={struck || undefined} data-art={role}
      data-back={code == null || undefined}>
      {code != null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cardArtUrl(code, "small")} alt="" loading="lazy" draggable={false} />
      ) : null}
      {struck ? <CrackMark /> : null}
    </span>
  );
}

function Portrait({ side, size = "sm" }: { side: Side; size?: "sm" | "lg" }) {
  return (
    <span className={styles.portrait} data-side={side} data-size={size} data-art="target" aria-hidden="true">
      <b>{side === "you" ? "You" : "Opp"}</b>
      <i>LP</i>
    </span>
  );
}

function Arrow() {
  return (
    <svg className={styles.arrow} viewBox="0 0 26 10" aria-hidden="true" focusable="false">
      <path d="M1 5 H22" />
      <path d="M18 1.4 L24 5 L18 8.6" />
    </svg>
  );
}

function isStruck(tile: HistoryTile, role: "attacker" | "target"): boolean {
  return tile.destroyed.some((loss) => loss.role === role);
}

function TileArts({ tile, mySeat, size = "sm" }: { tile: HistoryTile; mySeat: number | null; size?: "sm" | "lg" }) {
  if (tile.kind === "attack") {
    const target = tile.target;
    const defenderSide = sideOf(target?.seat ?? null, mySeat);
    return (
      <span className={styles.arts} data-size={size}>
        <Art card={tile.card} struck={isStruck(tile, "attacker")} size={size} role="attacker" />
        <Arrow />
        {target?.direct ? (
          <Portrait side={defenderSide} size={size} />
        ) : (
          <Art card={target?.card} struck={isStruck(tile, "target")} size={size} role="target" />
        )}
      </span>
    );
  }
  if (tile.kind === "damage") {
    return (
      <span className={styles.arts} data-size={size}>
        <Portrait side={sideOf(tile.hits[0]?.seat ?? tile.seat, mySeat)} size={size} />
      </span>
    );
  }
  return (
    <span className={styles.arts} data-size={size}>
      <Art card={tile.card} back={tile.kind === "set"} struck={tile.kind === "destroy"} size={size} />
    </span>
  );
}

function Chips({ tile, who, part = "all", detail = false }: {
  tile: HistoryTile;
  who: Namer;
  /** "hits" is the LP loss figure, "tags" the chain and destroyed chips. */
  part?: "all" | "hits" | "tags";
  detail?: boolean;
}) {
  const chips: ReactNode[] = [];
  if (part !== "hits") {
    if (tile.chain && tile.chain.size > 1) {
      chips.push(<span key="chain" className={styles.chip} data-tone="chain">Chain {tile.chain.index}</span>);
    }
    if (tile.chain && tile.chain.status !== "pending") {
      const label = { resolving: "Resolving", resolved: "Resolved", negated: "Negated" }[tile.chain.status];
      chips.push(
        <span key="status" className={styles.chip} data-tone={tile.chain.status === "negated" ? "loss" : "quiet"}>
          {label}
        </span>,
      );
    }
    const destroyedCount = tile.kind === "destroy" ? 0 : tile.destroyed.length;
    if (destroyedCount > 0 || (detail && tile.kind === "destroy")) {
      chips.push(
        <span key="destroyed" className={styles.chip} data-tone="loss">
          {destroyedCount > 1 ? `${destroyedCount} destroyed` : "Destroyed"}
        </span>,
      );
    }
  }
  if (part !== "tags") {
    tile.hits.forEach((hit, index) => {
      chips.push(
        <span key={`hit${index}`} className={styles.hit} data-cause={hit.cause}
          title={`${who(hit.seat)}: ${CAUSE_LABEL[hit.cause]}`}>
          −{formatLp(hit.amount)}
        </span>,
      );
    });
  }
  return chips.length > 0 ? <span className={styles.chips} data-part={part}>{chips}</span> : null;
}

function nameLine(tile: HistoryTile, who: Namer): string {
  const name = cardName(tile.card);
  switch (tile.kind) {
    case "attack": {
      const attacker = name ?? "Monster";
      if (tile.target?.direct) return `${attacker} → ${who(tile.target.seat)}`;
      return `${attacker} → ${cardName(tile.target?.card) ?? "Monster"}`;
    }
    case "set":
      return name ?? "Card";
    case "summon":
      return name ?? "Face-down monster";
    case "damage":
      return tile.hits[0] ? who(tile.hits[0].seat) : "Life Points";
    default:
      return name ?? "Card";
  }
}

function Tile({ tile, mySeat, who, animate, onEnter, onLeave, onOpen }: {
  tile: HistoryTile;
  mySeat: number | null;
  who: Namer;
  animate: boolean;
  onEnter: (tile: HistoryTile, element: HTMLElement) => void;
  onLeave: () => void;
  onOpen: (tile: HistoryTile, event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const side = sideOf(tile.seat, mySeat);
  const label = sentenceFor(tile, who);
  return (
    <li className={styles.item} data-enter={animate || undefined}>
      <button
        type="button"
        className={styles.tile}
        data-side={side}
        data-kind={tile.kind}
        data-chain={tile.chain && tile.chain.size > 1 ? "true" : undefined}
        data-status={tile.chain?.status}
        aria-label={label}
        onClick={(event) => onOpen(tile, event)}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") onEnter(tile, event.currentTarget);
        }}
        onPointerLeave={onLeave}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) onEnter(tile, event.currentTarget);
        }}
        onBlur={onLeave}
      >
        <span className={styles.mark} aria-hidden="true" />
        <TileArts tile={tile} mySeat={mySeat} />
        <span className={styles.body}>
          <span className={styles.head}>
            <span className={styles.who} data-side={side}>{side === "you" && mySeat != null ? "You" : who(tile.seat)}</span>
            <span className={styles.verb}>{verbFor(tile)}</span>
            <Chips tile={tile} who={who} part="hits" />
          </span>
          <span className={styles.name} data-negated={tile.chain?.status === "negated" || undefined}>
            {nameLine(tile, who)}
          </span>
          <Chips tile={tile} who={who} part="tags" />
        </span>
      </button>
    </li>
  );
}

function Separator({ sep, who, animate }: { sep: HistorySeparator; who: Namer; animate: boolean }) {
  const isTurn = sep.turn != null;
  const battle = /battle/i.test(sep.label);
  return (
    <li className={styles.sep} data-turn={isTurn || undefined} data-battle={battle || undefined}
      data-enter={animate || undefined} aria-label={isTurn ? `Turn ${sep.turn}, ${sep.label}` : sep.label}>
      <span>
        {isTurn ? `Turn ${sep.turn} · ${who(sep.turnSeat ?? null)} · ` : ""}
        {sep.label}
      </span>
    </li>
  );
}

type Hover = { key: number; rect: DOMRect };

function Detail({ tile, rect, mySeat, who, reducedMotion }: {
  tile: HistoryTile;
  rect: DOMRect;
  mySeat: number | null;
  who: Namer;
  reducedMotion: boolean;
}) {
  const width = Math.min(DETAIL_WIDTH, window.innerWidth - 16);
  const roomLeft = rect.left - width - 10;
  const style: CSSProperties = { width };
  if (roomLeft >= 8) {
    style.left = roomLeft;
    style.top = Math.max(8, Math.min(rect.top - 24, window.innerHeight - 300));
  } else {
    style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const below = rect.bottom + 8;
    if (below + 230 > window.innerHeight) style.bottom = Math.max(8, window.innerHeight - rect.top + 8);
    else style.top = below;
  }
  const side = sideOf(tile.seat, mySeat);
  const context = [tile.turn ? `Turn ${tile.turn}` : "", tile.phase].filter(Boolean).join(" · ");
  return createPortal(
    <div className={`${styles.detail} ${duelFontClasses}`} style={style} role="tooltip" data-side={side} data-kind={tile.kind}
      data-motion={reducedMotion ? "off" : "on"}>
      <TileArts tile={tile} mySeat={mySeat} size="lg" />
      <div className={styles.detailText}>
        <span className={styles.who} data-side={side}>{side === "you" && mySeat != null ? "You" : who(tile.seat)}</span>
        <strong>{nameLine(tile, who)}</strong>
        <p>{sentenceFor(tile, who)}</p>
        <Chips tile={tile} who={who} detail />
        {context ? <small>{context}</small> : null}
      </div>
    </div>,
    document.body,
  );
}

export function DuelHistoryRail({ events, engine, mySeat, playerName, onInspectCard, reducedMotion }: DuelHistoryRailProps) {
  const [stored, setStored] = useState<HistoryState>(() => ingestHistory(emptyHistory(), events, contextFor(engine)));
  const [hover, setHover] = useState<Hover | null>(null);

  // Fold new events into our own accumulated list while rendering, so the window can roll without losing tiles.
  const base = shouldResetHistory(stored, events, engine.revision) ? emptyHistory() : stored;
  const history = ingestHistory(base, events, contextFor(engine));
  if (history !== stored) setStored(history);

  const who: Namer = (seat) => {
    if (seat == null) return "Unknown";
    if (mySeat != null && seat === mySeat) return "You";
    return playerName(seat);
  };

  const items = visibleHistory(history.items, MAX_TILES);
  if (items.length === 0) return null;

  const hovered = hover
    ? (history.items.find((item): item is HistoryTile => item.type === "tile" && item.key === hover.key) ?? null)
    : null;

  const open = (tile: HistoryTile, event: MouseEvent<HTMLButtonElement>) => {
    const onTarget = (event.target as HTMLElement).closest('[data-art="target"]') != null;
    const card = onTarget && tile.kind === "attack" ? tile.target?.card : tile.card;
    const fallback = tile.kind === "attack" ? tile.card : null;
    const pick = inspectable(card) ? card : inspectable(fallback) ? fallback : null;
    if (pick) onInspectCard(pick);
  };

  return (
    <section className={`${styles.rail} ${duelFontClasses}`} data-motion={reducedMotion ? "off" : "on"}
      aria-label="Duel history">
      <h3 className={styles.cap}>
        <span>History</span>
        <small>Newest first</small>
      </h3>
      <ol className={styles.list} role="list" onKeyDown={(event) => { if (event.key === "Escape") setHover(null); }}>
        {items.map((item) => {
          const animate = !reducedMotion && item.key > history.animateAfter;
          return item.type === "sep" ? (
            <Separator key={`s${item.key}`} sep={item} who={who} animate={animate} />
          ) : (
            <Tile key={`t${item.key}`} tile={item} mySeat={mySeat} who={who} animate={animate}
              onEnter={(tile, element) => setHover({ key: tile.key, rect: element.getBoundingClientRect() })}
              onLeave={() => setHover(null)} onOpen={open} />
          );
        })}
      </ol>
      {hover && hovered ? <Detail tile={hovered} rect={hover.rect} mySeat={mySeat} who={who} reducedMotion={reducedMotion} /> : null}
    </section>
  );
}
