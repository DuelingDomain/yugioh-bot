"use client";

// Hearthstone-style history list for the Log tab: every action as a row with card art, an action icon,
// signed LP numbers and the acting side, grouped by turn, newest on top.
// Event grouping lives in history-model.ts and the row mapping in history-entries.ts (pure, tested);
// this file only draws them.
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Archive,
  Atom,
  Ban,
  Crosshair,
  Crown,
  Download,
  Eye,
  Flame,
  Hand,
  Heart,
  HeartCrack,
  Layers,
  Link2,
  Merge,
  Moon,
  Orbit,
  RotateCw,
  Shield,
  Skull,
  Sparkles,
  Square,
  Swords,
  Undo2,
  UserRound,
  ArrowDownToLine,
  ChevronUp,
  Zap,
} from "lucide-react";
import type { DuelCard, DuelCardInfo, DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";
import { cardArtUrl } from "./constants";
import { CardHoverInfo } from "./card-interactions";
import { duelFontClasses } from "./fonts";
import {
  buildHistoryView,
  type HistoryEntry,
  type HistoryGroup,
  type HistoryIconKind,
  type HistoryPhaseRow,
  type HistoryThumb,
  historyWho,
} from "./history-entries";
import {
  emptyHistory,
  ingestHistory,
  shouldResetHistory,
  type HistoryCard,
  type HistoryContext,
  type HistoryState,
} from "./history-model";
import { categoryForEntry, summonMethodForIcon } from "./log-category";
import baseStyles from "./history-rail.module.css";
import { useSkinStyles } from "./skin";

export type DuelHistoryRailProps = {
  events: DuelEvent[];
  engine: DuelEngineView;
  mySeat: number | null;
  playerName: (seat: number) => string;
  /** Show a card in the inspector. */
  onInspectCard: (card: DuelCard | DuelCardInfo) => void;
  reducedMotion: boolean;
  /** False while the Log tab is not in view; rows that arrive then are counted as unread. Default true. */
  active?: boolean;
  /** Told how many rows arrived while `active` was false. Back to 0 once the list is in view again. */
  onUnread?: (count: number) => void;
  /**
   * Seat colours (3 and 4 seat tables). A row, its mark, its thumb edges and its name pill take the colour of the seat
   * they belong to. Keep the map stable between renders. Absent: the 1v1 look (purple for you, dashed for the rest).
   */
  seatTones?: ReadonlyMap<number, { main: string; ink: string }>;
};

/** The facts the history model reads from an engine view. Shared with the table's history strip. */
export function contextFor(engine: DuelEngineView): HistoryContext {
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
    lp: engine.seats.map((seat) => seat.lp),
    cards,
    // Turn seats come from the server's "Turn N — Player X" lines; once a seat is out, older turns are not guessed.
    log: engine.log,
    anySeatOut: engine.seats.some((seat) => seat.eliminated || seat.pendingElimination),
  };
}

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
// The badge colour comes from log-category.ts (data-cat / data-summon); tone is no longer drawn.
type IconTone = "plain" | "attack" | "loss" | "gain" | "chain" | "quiet";

/** Icon, tone and label of each history row kind. Shared with the table's history strip. */
export const ICONS: Record<HistoryIconKind, { Icon: IconComponent; tone: IconTone; label: string }> = {
  normal: { Icon: Hand, tone: "plain", label: "Normal Summon" },
  tribute: { Icon: Crown, tone: "plain", label: "Tribute Summon" },
  special: { Icon: Sparkles, tone: "plain", label: "Special Summon" },
  flip: { Icon: RotateCw, tone: "plain", label: "Flip Summon" },
  fusion: { Icon: Merge, tone: "plain", label: "Fusion Summon" },
  synchro: { Icon: Orbit, tone: "plain", label: "Synchro Summon" },
  xyz: { Icon: Layers, tone: "plain", label: "Xyz Summon" },
  link: { Icon: Atom, tone: "plain", label: "Link Summon" },
  ritual: { Icon: Flame, tone: "plain", label: "Ritual Summon" },
  pendulum: { Icon: Moon, tone: "plain", label: "Pendulum Summon" },
  set: { Icon: Square, tone: "quiet", label: "Set" },
  activate: { Icon: Zap, tone: "chain", label: "Activate" },
  chain: { Icon: Link2, tone: "chain", label: "Chain link" },
  attack: { Icon: Swords, tone: "attack", label: "Attack" },
  direct: { Icon: Crosshair, tone: "attack", label: "Direct attack" },
  destroy: { Icon: Skull, tone: "loss", label: "Destroyed" },
  banish: { Icon: Ban, tone: "loss", label: "Banished" },
  grave: { Icon: Archive, tone: "quiet", label: "Sent to the Graveyard" },
  draw: { Icon: Download, tone: "plain", label: "Draw" },
  hand: { Icon: Undo2, tone: "quiet", label: "Returned to hand" },
  deck: { Icon: ArrowDownToLine, tone: "quiet", label: "Returned to Deck" },
  "lp-loss": { Icon: HeartCrack, tone: "loss", label: "LP lost" },
  "lp-gain": { Icon: Heart, tone: "gain", label: "LP gained" },
  position: { Icon: Shield, tone: "quiet", label: "Position change" },
  "flip-up": { Icon: Eye, tone: "plain", label: "Flipped face-up" },
};

type Hover = { card: HistoryCard; anchor: HTMLElement };
type ThumbHandlers = {
  onEnter: (card: HistoryCard, element: HTMLElement) => void;
  onLeave: () => void;
  onOpen: (card: HistoryCard) => void;
};

type SeatTones = NonNullable<DuelHistoryRailProps["seatTones"]>;

/** CSS variables of a seat colour, or nothing when the rail has no colours or the seat is unknown. */
function toneStyle(tones: SeatTones | undefined, seat: number | null | undefined): CSSProperties | undefined {
  const tone = tones && seat != null ? tones.get(seat) : undefined;
  return tone ? ({ "--seat-main": tone.main, "--seat-ink": tone.ink } as CSSProperties) : undefined;
}

function Thumb({ thumb, handlers, iconBadge, tones }: { thumb: HistoryThumb; handlers: ThumbHandlers; iconBadge?: ReactNode; tones?: SeatTones }) {
  const styles = useSkinStyles(baseStyles, "history");
  const toned = toneStyle(tones, thumb.seat);
  if (thumb.role === "portrait") {
    return (
      <span className={styles.portrait} data-side={thumb.side} data-toned={toned ? "true" : undefined} style={toned} title={thumb.label} aria-hidden="true">
        <UserRound size={16} strokeWidth={1.75} aria-hidden />
        <b>{thumb.label}</b>
        {iconBadge}
      </span>
    );
  }
  const face = (
    <>
      {thumb.code != null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cardArtUrl(thumb.code, "small")} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : null}
      {thumb.struck ? <CrackMark /> : null}
      {iconBadge}
    </>
  );
  const common = {
    className: styles.thumb,
    style: toned,
    "data-toned": toned ? "true" : undefined,
    "data-role": thumb.role,
    "data-back": thumb.code == null || undefined,
    "data-struck": thumb.struck || undefined,
  };
  const card = thumb.card;
  if (!card) {
    return <span {...common} aria-hidden="true">{face}</span>;
  }
  return (
    <button
      type="button"
      {...common}
      aria-label={`Inspect ${thumb.name ?? "card"}`}
      onClick={() => handlers.onOpen(card)}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") handlers.onEnter(card, event.currentTarget);
      }}
      onPointerLeave={handlers.onLeave}
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) handlers.onEnter(card, event.currentTarget);
      }}
      onBlur={handlers.onLeave}
    >
      {face}
    </button>
  );
}

function CrackMark() {
  const styles = useSkinStyles(baseStyles, "history");
  return (
    <svg className={styles.crack} viewBox="0 0 24 34" aria-hidden="true" focusable="false">
      <path d="M13 1 L9 11 L15 15 L8 23 L13 27 L10 33" pathLength={1} />
      <path d="M9 11 L3 14 M15 15 L21 13 M8 23 L3 27" pathLength={1} />
    </svg>
  );
}

function IconBadge({ kind, corner = false }: { kind: HistoryIconKind; corner?: boolean }) {
  const styles = useSkinStyles(baseStyles, "history");
  const { Icon, label } = ICONS[kind];
  return (
    <span className={styles.badge} data-summon={summonMethodForIcon(kind) ?? undefined} data-corner={corner || undefined}
      title={label} aria-hidden="true">
      <Icon size={13} strokeWidth={2} aria-hidden />
    </span>
  );
}

type RowProps = {
  entry: HistoryEntry;
  latest: boolean;
  animate: boolean;
  handlers: ThumbHandlers;
  tones?: SeatTones;
};

const EntryRow = memo(function EntryRow({ entry, latest, animate, handlers, tones }: RowProps) {
  const styles = useSkinStyles(baseStyles, "history");
  const rowTone = toneStyle(tones, entry.seat);
  const attack = entry.icon === "attack" || entry.icon === "direct";
  const [first, second] = entry.thumbs;
  return (
    <li
      className={styles.row}
      style={rowTone}
      data-toned={rowTone ? "true" : undefined}
      data-side={entry.side}
      data-icon={entry.icon}
      data-cat={categoryForEntry(entry)}
      data-summon={summonMethodForIcon(entry.icon) ?? undefined}
      data-latest={latest || undefined}
      data-enter={animate || undefined}
      aria-current={latest ? "true" : undefined}
    >
      <span className={styles.mark} aria-hidden="true" />
      <span className={styles.thumbs} data-count={entry.thumbs.length}>
        {attack && second ? (
          <>
            <Thumb thumb={first} handlers={handlers} tones={tones} />
            <span className={styles.link} aria-hidden="true">
              <IconBadge kind={entry.icon} />
            </span>
            <Thumb thumb={second} handlers={handlers} tones={tones} />
          </>
        ) : (
          <Thumb thumb={first} handlers={handlers} tones={tones} iconBadge={<IconBadge kind={entry.icon} corner />} />
        )}
      </span>
      <span className={styles.text} aria-hidden="true" title={entry.sentence}>
        <span className={styles.head}>
          <span className={styles.who} data-side={entry.side} title={entry.actor}>{entry.actor}</span>
          <span className={styles.verb}>{entry.verb}</span>
        </span>
        <span className={styles.title} data-negated={entry.negated || undefined}>{entry.title}</span>
        {entry.tags.length > 0 ? (
          <span className={styles.tags}>
            {entry.tags.map((tag) => (
              <span key={tag.label} className={styles.tag} data-tone={tag.tone} data-plain={tag.plain || undefined}>{tag.label}</span>
            ))}
          </span>
        ) : null}
      </span>
      {entry.lp.length > 0 ? (
        <span className={styles.lp} aria-hidden="true">
          {entry.lp.map((change, index) => (
            <span key={index} className={styles.lpNum} data-cause={change.cause} data-gain={change.delta > 0 || undefined}
              data-side={change.side} title={`${change.who}: ${change.label}${change.total ? ` (${change.total})` : ""}`}>
              <span className={styles.lpMain}>
                <b>{change.text}</b>
                <small>{change.unit}</small>
              </span>
              {change.total ? <span className={styles.lpTotal}>{change.total}</span> : null}
              <i className={styles.lpWho}>{change.who}</i>
            </span>
          ))}
        </span>
      ) : null}
      <span className={styles.sr}>{entry.sentence}{latest ? " Latest event." : ""}</span>
    </li>
  );
}, (a, b) =>
  a.entry.key === b.entry.key &&
  a.entry.lastEventId === b.entry.lastEventId &&
  a.entry.actor === b.entry.actor &&
  a.entry.sentence === b.entry.sentence &&
  a.entry.side === b.entry.side &&
  a.tones === b.tones &&
  a.latest === b.latest &&
  a.animate === b.animate &&
  a.handlers === b.handlers);

const PhaseRow = memo(function PhaseRow({ row }: { row: HistoryPhaseRow }) {
  const styles = useSkinStyles(baseStyles, "history");
  return (
    <li className={styles.phase} data-battle={row.battle || undefined}>
      <span>{row.label}</span>
    </li>
  );
});

const Group = memo(function Group({ group, latestKey, animateAfter, handlers, tones }: {
  group: HistoryGroup;
  latestKey: number | null;
  animateAfter: number;
  handlers: ThumbHandlers;
  tones?: SeatTones;
}) {
  const styles = useSkinStyles(baseStyles, "history");
  return (
    <li className={styles.group}>
      <h4 className={styles.turn} data-turn>{group.label}</h4>
      <ol className={styles.rows} role="list">
        {group.rows.map((row) =>
          row.type === "phase" ? (
            <PhaseRow key={`p${row.key}`} row={row} />
          ) : (
            <EntryRow key={`e${row.key}`} entry={row} latest={row.key === latestKey} animate={row.key > animateAfter}
              handlers={handlers} tones={tones} />
          ),
        )}
      </ol>
    </li>
  );
});

const TOP_SLACK = 12;

export function DuelHistoryRail({ events, engine, mySeat, playerName, onInspectCard, reducedMotion, active = true, onUnread, seatTones }: DuelHistoryRailProps) {
  const styles = useSkinStyles(baseStyles, "history");
  const [stored, setStored] = useState<HistoryState>(() => ingestHistory(emptyHistory(), events, contextFor(engine)));
  const [hover, setHover] = useState<Hover | null>(null);
  const [atTop, setAtTop] = useState(true);
  const [seen, setSeen] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Fold new events into our own accumulated list while rendering, so the window can roll without losing rows.
  const base = shouldResetHistory(stored, events, engine.revision) ? emptyHistory() : stored;
  const history = ingestHistory(base, events, contextFor(engine));
  if (history !== stored) setStored(history);

  const seatCount = engine.seats.length;
  const who = (seat: number | null) => historyWho(seat, mySeat, playerName, seatCount);
  // Rows only change when an event arrives or a player name does, so key the view on those, not on `who`.
  const names = Array.from({ length: seatCount }, (_, seat) => who(seat)).join("\u0000");
  const view = useMemo(
    () => buildHistoryView(history.items, { mySeat, who, seatCount }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.items, mySeat, names, seatCount],
  );

  const onInspectRef = useRef(onInspectCard);
  onInspectRef.current = onInspectCard;
  const handlers = useMemo<ThumbHandlers>(() => ({
    onEnter: (card, element) => setHover({ card, anchor: element }),
    onLeave: () => setHover(null),
    onOpen: (card) => onInspectRef.current(card),
  }), []);

  const latestKey = view.latestKey;
  useEffect(() => {
    if (atTop) setSeen(latestKey);
  }, [atTop, latestKey]);

  const unseen = useMemo(() => {
    if (atTop || seen == null) return 0;
    let count = 0;
    for (const group of view.groups) for (const row of group.rows) if (row.type === "entry" && row.key > seen) count += 1;
    return count;
  }, [atTop, seen, view.groups]);

  // The newest row seen while in view. Rows above it arrived while the list was out of view. The first value
  // is whatever is there at mount, so a reload mid-duel does not start with a badge.
  const [readKey, setReadKey] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (active || readKey === undefined) setReadKey(latestKey);
  }, [active, latestKey, readKey]);
  const unread = useMemo(() => {
    if (active || readKey === undefined) return 0;
    const floor = readKey ?? Number.NEGATIVE_INFINITY;
    let count = 0;
    for (const group of view.groups) for (const row of group.rows) if (row.type === "entry" && row.key > floor) count += 1;
    return count;
  }, [active, readKey, view.groups]);
  useEffect(() => {
    onUnread?.(unread);
  }, [onUnread, unread]);

  if (view.entryCount === 0) return null;

  const onScroll = () => {
    const element = scroller.current;
    if (element) setAtTop(element.scrollTop <= TOP_SLACK);
  };
  const jumpToNewest = () => {
    scroller.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") setHover(null);
    if (event.key === "Home" && event.target === event.currentTarget) {
      event.preventDefault();
      jumpToNewest();
    }
  };

  return (
    <section className={`${styles.rail} ${duelFontClasses}`} data-motion={reducedMotion ? "off" : "on"}
      aria-label="Duel history">
      <h3 className={styles.cap}>
        <span>History</span>
        <small>Newest first</small>
      </h3>
      <div className={styles.listWrap}>
        <div ref={scroller} className={styles.list} tabIndex={0} role="region" aria-label="Duel history events"
          onScroll={onScroll} onKeyDown={onKeyDown}>
          <ol className={styles.groups} role="list">
            {view.groups.map((group) => (
              <Group key={group.key} group={group} latestKey={latestKey} animateAfter={history.animateAfter}
                handlers={handlers} tones={seatTones} />
            ))}
          </ol>
        </div>
        <div className={styles.pillSlot} aria-live="polite">
          {unseen > 0 ? (
            <button type="button" className={styles.pill} onClick={jumpToNewest}>
              <ChevronUp size={14} strokeWidth={2} aria-hidden />
              {unseen === 1 ? "1 new event" : `${unseen} new events`}
            </button>
          ) : null}
        </div>
      </div>
      {hover ? <CardHoverInfo card={hover.card} anchor={hover.anchor} /> : null}
    </section>
  );
}
