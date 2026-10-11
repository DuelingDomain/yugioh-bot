"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowRight, Check, ChevronDown, Copy, Eye, Lock, Plus, Swords, Users } from "lucide-react";
import { isCustomDomain, type DuelFormat, type DuelHistoryScope, type DuelListItem } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { focusDuelWindowOnClick } from "./duel-window";
import { formatLabel, formatSeatCount, tagSeatCode } from "./table-format";
import {
  DUEL_LIST_KEY, cancelDuel, duelHistoryKey, leaveDuel, listDuels, surrenderDuel, takeDuelSeat,
  type DuelListPage,
} from "./api";
import {
  EMPTY_HISTORY_FILTERS, hasHistoryFilters, mergeLobbySearch, parseHistoryParams, presetRange, rememberHistorySearch,
  type HistoryFilters, type HistoryPreset, type HistoryStatus,
} from "./history-filters";
import { isNotableSeries, SeriesBadges } from "./series-banner";
import { cx, SheetButton, sheetButtonClass, SheetSegmented, SheetSelect, sheetRoot } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./lobby.module.css";

export type DuelListView = "live" | "history";

function statusLabel(status: DuelListItem["status"]): string {
  if (status === "lobby") return "Lobby";
  if (status === "active") return "Dueling";
  if (status === "completed") return "Finished";
  if (status === "cancelled") return "Cancelled";
  return "Interrupted";
}

function modeLabel(duel: DuelListItem): string {
  if (duel.mode === "domain") return isCustomDomain(duel.masterRule, duel.settings) ? "Custom Domain" : duel.format && duel.format !== "1v1" ? "Domain" : "Domain 1v1";
  return `Master Rule ${duel.masterRule}`;
}

function parseUtc(text: string | null): Date | null {
  if (!text) return null;
  // History times are ISO with a zone; lastActivityAt keeps the stored "YYYY-MM-DD HH:MM:SS" UTC text.
  const date = new Date(/[zZ]$|[+-]\d{2}:\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relativeActivity(text: string): string {
  const date = parseUtc(text);
  if (!date) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "active just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `active ${hours}h ago`;
  return `active ${Math.floor(hours / 24)}d ago`;
}

/** Local date and time, such as "Oct 10, 2026, 9:42 PM". */
function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Time of day only, for the end of a duel that started the same day. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${total % 60}s`;
  return `${total}s`;
}

function engineLabel(engine: DuelListItem["engine"]): string {
  return engine ? `${engine} engine` : "";
}

const SEAT_RESULT = { win: "Won", loss: "Lost", draw: "Draw" } as const;

type HistorySeat = DuelListItem["seats"][number];

function seatLine(duel: DuelListItem, seat: HistorySeat): string {
  const code = tagSeatCode(duel.format, seat.seat);
  const place = seat.team != null && code ? `Team ${seat.team + 1} ${code}` : `Seat ${seat.seat + 1}`;
  const result = seat.result ? SEAT_RESULT[seat.result] : "";
  return `${place} ${seat.displayName}${seat.isBot ? " (bot)" : ""}${result ? ` · ${result}` : ""}`;
}

/** Small button that copies the duel slug for bug reports. */
function CopySlug({ slug, onResult }: { slug: string; /** Tells the list live region what happened. */ onResult: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    let next: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(slug);
    } catch {
      next = "failed";
    }
    setState(next);
    onResult(next === "copied" ? "Copied" : "Copy failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }
  const text = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";
  return (
    <span className={styles.slug}>
      <code>{slug}</code>
      <button type="button" className={styles.copyBtn} onClick={() => void copy()}>
        {state === "copied" ? <Check size={13} strokeWidth={1.8} aria-hidden /> : <Copy size={13} strokeWidth={1.6} aria-hidden />}
        {text}
        {state === "idle" ? <>{" "}<span className={ui.srOnly}>duel id {slug}</span></> : null}
      </button>
    </span>
  );
}

function isOrganizer(duel: DuelListItem): boolean {
  const mine = duel.seats.find((seat) => seat.seat === duel.mySeat);
  return mine != null && duel.organizerPlayerId === mine.playerId;
}

const NO_RESULT = "—";

/**
 * The result text of a finished row, from the status and the seat results.
 * Cancelled and interrupted duels have no result text: the status chip says it.
 */
function outcomeLabel(duel: DuelListItem): string {
  if (duel.status === "cancelled" || duel.status === "interrupted") return "";
  const mine = duel.mySeat != null ? duel.seats.find((seat) => seat.seat === duel.mySeat) : undefined;
  if (mine?.result) return SEAT_RESULT[mine.result];
  const winners = duel.seats.filter((seat) => seat.result === "win");
  if (winners.length > 0) {
    // Tag: the whole team won, not only one player.
    const team = winners[0].team;
    if (duel.format === "tag" && team != null) return `Team ${team + 1} won`;
    return `${winners.map((seat) => seat.displayName).join(" and ")} won`;
  }
  if (duel.seats.some((seat) => seat.result === "draw")) return "Draw";
  // Older rows have no seat results: use the winner seat when there is one.
  if (duel.winnerSeat != null) {
    if (duel.mySeat != null) return duel.winnerSeat === duel.mySeat ? "Won" : "Lost";
    const winner = duel.seats.find((seat) => seat.seat === duel.winnerSeat);
    return `${winner?.displayName ?? `Seat ${duel.winnerSeat + 1}`} won`;
  }
  return NO_RESULT;
}

function outcomeTone(label: string): string {
  if (label === "Won") return styles.won;
  if (label === "Lost") return styles.lost;
  return "";
}

function opponents(duel: DuelListItem): string {
  const others = duel.seats.filter((seat) => seat.seat !== duel.mySeat);
  return others.map((seat) => seat.displayName).join(" vs ") || "No opponent";
}

type CloseCopy = {
  title: string;
  body: string;
  confirm: string;
  danger: boolean;
  run: (slug: string) => Promise<unknown>;
};

function closeCopy(duel: DuelListItem): CloseCopy {
  if (duel.status === "active") {
    return {
      title: "Surrender and close",
      body: "This ends the duel as a loss for you and moves it to Match history.",
      confirm: "Surrender",
      danger: true,
      run: surrenderDuel,
    };
  }
  if (isOrganizer(duel)) {
    return {
      title: "Cancel table",
      body: "This removes the table. No result is recorded.",
      confirm: "Cancel table",
      danger: false,
      run: cancelDuel,
    };
  }
  return {
    title: "Leave table",
    body: "You give up your seat. The organizer keeps the table.",
    confirm: "Leave table",
    danger: false,
    run: leaveDuel,
  };
}

function LiveRow({ duel, onClose }: { duel: DuelListItem; onClose: (duel: DuelListItem) => void }) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const own = duel.mySeat != null;
  const seatCount = formatSeatCount(duel.format);
  const openSeat = Array.from({ length: seatCount }, (_, seat) => seat)
    .find((index) => !duel.seats.some((seat) => seat.seat === index));
  const open = duel.status === "lobby" && openSeat != null && duel.seriesId == null && duel.series == null;
  const full = duel.status === "lobby" && duel.seats.length >= seatCount;
  const activity = relativeActivity(duel.lastActivityAt);
  const roomPath = `/duels/${duel.slug}`;

  async function join() {
    if (joining || openSeat == null) return;
    setJoining(true);
    let destination = roomPath;
    try {
      await takeDuelSeat(duel.slug, openSeat);
    } catch {
      destination = `${roomPath}?join=failed`;
    } finally {
      setJoining(false);
    }
    router.push(destination);
  }

  const content = (
    <>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>
          <span className={styles.name}>{duel.name}</span>
          {own ? <span className={cx(ui.chip, ui.chipAccent)}>Your table</span> : null}
        </span>
        <span className={styles.chips}>
          <span className={ui.chip}>{modeLabel(duel)}</span>
          <span className={cx(ui.chip, duel.status === "active" && ui.chipGold)}>{statusLabel(duel.status)}</span>
          {isNotableSeries(duel.series) ? <SeriesBadges series={duel.series} showGame plain /> : null}
          <span className={ui.chip}><Users size={13} strokeWidth={1.6} aria-hidden />{duel.seats.length}/{seatCount}</span>
          {duel.format && duel.format !== "1v1" ? <span className={ui.chip}>{formatLabel(duel.format)}</span> : null}
          {duel.settings.visibility === "private" ? <span className={ui.chip}><Lock size={13} strokeWidth={1.6} aria-hidden />Private</span> : null}
          {activity ? <span className={styles.activity}>{activity}</span> : null}
        </span>
      </span>
      <span className={styles.go}>
        {own || open ? null : <Eye size={15} strokeWidth={1.6} aria-hidden />}
        {own ? "Return" : open ? "Join" : full ? "Full — watch" : "Watch"}
        <ArrowRight size={15} strokeWidth={1.6} aria-hidden />
      </span>
    </>
  );
  return (
    <li className={styles.row}>
      {!own && open ? (
        <button type="button" className={styles.rowLink} disabled={joining} aria-busy={joining || undefined}
          onClick={() => void join()}>
          {content}
        </button>
      ) : <Link href={roomPath} className={styles.rowLink} onClick={(event) => focusDuelWindowOnClick(roomPath, event)}>{content}</Link>}
      {!own && open ? (
        <div className={styles.close}>
          <Link href={`/duels/${duel.slug}`} className={sheetButtonClass("quiet", "sm")}>
            <Eye size={15} strokeWidth={1.6} aria-hidden />Watch
          </Link>
        </div>
      ) : null}
      {own ? (
        <div className={styles.close}>
          <SheetButton kind="quiet" size="sm" onClick={() => onClose(duel)} aria-label={`Close ${duel.name}`}>
            Close
          </SheetButton>
        </div>
      ) : null}
    </li>
  );
}

function HistoryRow({ duel, onAnnounce }: { duel: DuelListItem; onAnnounce: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const outcome = outcomeLabel(duel);
  const created = parseUtc(duel.createdAt);
  const started = parseUtc(duel.startedAt);
  const ended = parseUtc(duel.endedAt);
  const when = ended ?? created;
  const engine = engineLabel(duel.engine);
  const length = duel.durationMs != null ? formatDuration(duel.durationMs) : "";
  const turns = duel.turnCount != null ? `${duel.turnCount} ${duel.turnCount === 1 ? "turn" : "turns"}` : "";
  // Older duels have no start time and no duration. The header time already shows their end (or creation) time.
  const range = started
    ? ended ? `${formatDateTime(started)} to ${sameDay(started, ended) ? formatTime(ended) : formatDateTime(ended)}` : `Started ${formatDateTime(started)}`
    : "";
  return (
    <li className={cx(styles.row, styles.historyRow)}>
      <div className={styles.rowMain}>
        <span className={styles.name}>{duel.name}</span>
        <span className={styles.chips}>
          <span className={ui.chip}>{modeLabel(duel)}</span>
          {duel.format && duel.format !== "1v1" ? <span className={ui.chip}>{formatLabel(duel.format)}</span> : null}
          <span className={ui.chip}>{statusLabel(duel.status)}</span>
          {isNotableSeries(duel.series) ? <SeriesBadges series={duel.series} plain /> : null}
          {duel.private ? <span className={ui.chip}><Lock size={13} strokeWidth={1.6} aria-hidden />Private</span> : null}
          {when ? <time className={styles.activity} dateTime={when.toISOString()}>{formatDateTime(when)}</time> : null}
        </span>
        <p className={styles.versus}>
          {duel.mySeat != null ? "vs " : ""}{opponents(duel)}
          {outcome ? (
            <>
              <span className={styles.dot} aria-hidden>·</span>
              <span className={cx(styles.outcome, outcomeTone(outcome))}>
                {outcome === NO_RESULT ? <><span aria-hidden>{NO_RESULT}</span><span className={ui.srOnly}>No result</span></> : outcome}
              </span>
            </>
          ) : null}
          {duel.resultReason ? <span className={styles.reason}> · {duel.resultReason}</span> : null}
        </p>
        <button type="button" className={styles.detailsToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
          Details<ChevronDown size={14} strokeWidth={1.6} aria-hidden />
        </button>
        <div className={cx(styles.details, open && styles.detailsOpen)}>
          {range || length || turns || engine ? (
            <p className={styles.meta}>
              {[range, length, turns, engine].filter(Boolean).map((part, index) => (
                <span key={index}>{part}</span>
              ))}
            </p>
          ) : null}
          {duel.seats.length > 0 ? (
            <ul className={styles.players} aria-label="Players">
              {duel.seats.map((seat) => <li key={seat.seat}>{seatLine(duel, seat)}</li>)}
            </ul>
          ) : null}
          <CopySlug slug={duel.slug} onResult={onAnnounce} />
        </div>
      </div>
      <div className={styles.historyActions}>
        <Link href={`/duels/${duel.slug}/replay`} className={sheetButtonClass("primary", "sm")}>Replay</Link>
        <Link href={`/duels/${duel.slug}`} className={sheetButtonClass("secondary", "sm")}>Final board</Link>
      </div>
    </li>
  );
}

const FORMAT_CHOICES: readonly { value: DuelFormat | ""; label: string }[] = [
  { value: "", label: "Any" },
  { value: "1v1", label: "1v1" },
  { value: "tag", label: "Tag" },
  { value: "ffa3", label: "3-way" },
  { value: "ffa4", label: "4-way" },
];

const STATUS_CHOICES: readonly { value: HistoryStatus | ""; label: string }[] = [
  { value: "", label: "Any" },
  { value: "completed", label: "Finished" },
  { value: "interrupted", label: "Interrupted" },
  { value: "cancelled", label: "Cancelled" },
];

const PRESETS: readonly { value: HistoryPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "Last 7 days" },
];

function HistoryFilterBar({ canSeeAll, showStatus, filters, q, card, rangeError, hideClear, onFilters, onQ, onCard, onClear }: {
  /** The card filter works only for admins; the server ignores it for members. */
  canSeeAll: boolean;
  /** The status filter works only for an admin on All; the server ignores it elsewhere. */
  showStatus: boolean;
  filters: HistoryFilters;
  q: string;
  card: string;
  rangeError: boolean;
  /** The empty state already has its own Clear filters button. */
  hideClear: boolean;
  onFilters: (patch: Partial<HistoryFilters>) => void;
  onQ: (value: string) => void;
  onCard: (value: string) => void;
  onClear: () => void;
}) {
  const active = hasHistoryFilters({ ...filters, status: showStatus ? filters.status : "" }) || q !== "" || card !== "";
  // The chip the user clicked stays marked while the range is unchanged ("Last 7 days" moves with the clock).
  const [applied, setApplied] = useState<{ value: HistoryPreset; from: string; to: string } | null>(null);
  const isPressed = (value: HistoryPreset): boolean => {
    if (applied?.value === value && applied.from === filters.from && applied.to === filters.to) return true;
    const range = presetRange(value);
    return value !== "week" && range.from === filters.from && range.to === filters.to;
  };
  return (
    <form className={cx(styles.filters, !showStatus && styles.noStatus, !canSeeAll && styles.noCard)} role="search"
      aria-label="Filter match history" onSubmit={(event) => event.preventDefault()}>
      <label className={styles.fieldFrom}>
        <span className={ui.label}>From</span>
        <input type="datetime-local" className={cx(ui.input, styles.dateInput)} value={filters.from}
          max={filters.to || undefined} onChange={(event) => onFilters({ from: event.target.value })} />
      </label>
      <label className={styles.fieldTo}>
        <span className={ui.label}>To</span>
        <input type="datetime-local" className={cx(ui.input, styles.dateInput)} value={filters.to}
          min={filters.from || undefined} aria-invalid={rangeError || undefined}
          aria-describedby={rangeError ? "history-range-error" : undefined}
          onChange={(event) => onFilters({ to: event.target.value })} />
      </label>
      {rangeError ? <p id="history-range-error" role="alert" className={cx(ui.alert, styles.rangeError)}>From must be before To.</p> : null}
      <SheetSelect className={styles.fieldFormat} label="Format" value={filters.format}
        choices={FORMAT_CHOICES} onChange={(format) => onFilters({ format })} />
      {showStatus ? (
        <SheetSelect className={styles.fieldFormat} label="Status" value={filters.status}
          choices={STATUS_CHOICES} onChange={(status) => onFilters({ status })} />
      ) : null}
      <label className={styles.fieldText}>
        <span className={ui.label}>Player or duel name</span>
        <input type="search" className={ui.input} value={q} placeholder="Player or duel name" autoComplete="off"
          onChange={(event) => onQ(event.target.value)} />
      </label>
      {canSeeAll ? (
        <label className={styles.fieldText}>
          <span className={ui.label}>Card</span>
          <input type="search" className={ui.input} value={card} placeholder="Card name" autoComplete="off"
            onChange={(event) => onCard(event.target.value)} />
        </label>
      ) : null}
      <div className={styles.presets} role="group" aria-label="Quick date ranges">
        {PRESETS.map((preset) => {
          const pressed = isPressed(preset.value);
          return (
            <button key={preset.value} type="button" className={cx(ui.chip, styles.preset, pressed && ui.chipAccent)}
              aria-pressed={pressed}
              onClick={() => {
                const range = presetRange(preset.value);
                setApplied({ value: preset.value, ...range });
                onFilters(range);
              }}>
              {preset.label}
            </button>
          );
        })}
        {active && !hideClear ? <SheetButton kind="quiet" size="sm" onClick={onClear}>Clear filters</SheetButton> : null}
      </div>
    </form>
  );
}

type MorePages = { key: string; items: DuelListItem[]; cursor: string | null; loading: boolean; error: string | null };

/** The page URL is the source of the first view, scope and filters, so Back from a replay restores what the user had. */
export function DuelLobby({ initialView, initialScope, initialFilters, viewerId }: {
  /** The signed-in user: the saved history search belongs to this user only. */
  viewerId?: number | string;
  /** Overrides the view in the URL. */
  initialView?: DuelListView;
  initialScope?: DuelHistoryScope;
  initialFilters?: HistoryFilters;
}) {
  const searchParams = useSearchParams();
  const [initial] = useState(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const parsed = parseHistoryParams(params);
    return {
      view: initialView ?? (params.get("view") === "history" ? "history" : "live"),
      scope: initialScope ?? parsed.scope,
      filters: initialFilters ?? parsed.filters,
    };
  });
  const [history, setHistory] = useState(initial.view === "history");
  const [scope, setScope] = useState<DuelHistoryScope>(initial.scope);
  const [filters, setFilters] = useState<HistoryFilters>(initial.filters);
  const [qText, setQText] = useState(initial.filters.q);
  const [cardText, setCardText] = useState(initial.filters.card);
  const [more, setMore] = useState<MorePages | null>(null);
  const [closing, setClosing] = useState<DuelListItem | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const moreWrap = useRef<HTMLDivElement | null>(null);
  const endNote = useRef<HTMLParagraphElement | null>(null);
  const focusEnd = useRef(false);
  const listKey = history ? duelHistoryKey(scope, filters) : DUEL_LIST_KEY;
  const activeListKey = useRef(listKey);
  activeListKey.current = listKey;
  // A range that ends before it starts would only get a 400 from the server, so no request goes out.
  const rangeError = history && filters.from !== "" && filters.to !== ""
    && new Date(filters.from).getTime() > new Date(filters.to).getTime();
  // Later history pages are loaded by hand: a refresh on focus or reconnect would move rows between page 1 and those
  // pages. While only page 1 is loaded the refresh is safe, so a tab left open still gets new duels.
  const { data, error, isLoading, mutate } = useSWR(
    rangeError ? null : listKey,
    () => listDuels(history, scope, filters),
    { refreshInterval: history ? 0 : 1000, revalidateOnFocus: !history || more == null, revalidateOnReconnect: !history || more == null },
  );

  // Remembered between queries so the admin-only boxes do not blink while a new page loads.
  const [canSeeAll, setCanSeeAll] = useState(false);
  const returnToMine = useCallback(() => {
    setCanSeeAll(false);
    setScope("mine");
    setMore(null);
    setFilters(current => ({ ...current, status: "", card: "" }));
    setCardText("");
  }, []);
  useEffect(() => {
    if (history && typeof data?.canSeeAll === "boolean") setCanSeeAll(data.canSeeAll);
  }, [history, data?.canSeeAll]);

  // A member or a removed owner can open an old All bookmark. Return to Mine
  // and remove the saved owner page when the server refuses that scope.
  useEffect(() => {
    if (!history || scope !== "all") return;
    if (data?.canSeeAll === false || (error && typeof error === "object" && "status" in error && error.status === 403)) {
      returnToMine();
    }
  }, [history, scope, data?.canSeeAll, error, returnToMine]);

  // The server ignores status and card for members, so a bookmarked value is dropped instead of shown as active.
  useEffect(() => {
    if (!history || data?.canSeeAll !== false || (!filters.status && !filters.card && !cardText)) return;
    setFilters((current) => ({ ...current, status: "", card: "" }));
    setCardText("");
  }, [history, data?.canSeeAll, filters.status, filters.card, cardText]);

  // Text boxes commit to the filters 300 ms after the last key press.
  useEffect(() => {
    if (qText.trim() === filters.q && cardText.trim() === filters.card) return;
    const timer = setTimeout(() => setFilters((current) => ({ ...current, q: qText.trim(), card: cardText.trim() })), 300);
    return () => clearTimeout(timer);
  }, [qText, cardText, filters.q, filters.card]);

  // A new query starts again from its first page.
  useEffect(() => { setMore(null); }, [listKey]);

  // A copy result for the shared live region; it gives way to the row count again after a moment.
  const [copyNote, setCopyNote] = useState("");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);
  const announce = useCallback((text: string) => {
    setCopyNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setCopyNote(""), 2500);
  }, []);

  // Keep the page URL in step so a filtered list can be bookmarked. The state argument is null so that Next
  // takes over the new URL (the old history state would make it skip the update). Other params stay.
  useEffect(() => {
    const search = mergeLobbySearch(window.location.search, history, scope, filters);
    if (search !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${search}`);
    if (history) rememberHistorySearch(search, viewerId);
  }, [history, scope, filters]);

  const pages = history && more?.key === listKey ? more : null;
  const cursor = pages ? pages.cursor : data?.nextCursor ?? null;
  const seen = new Set<string>();
  const duels = [...(data?.duels ?? []), ...(pages?.items ?? [])].filter((duel) => {
    if (seen.has(duel.slug)) return false;
    seen.add(duel.slug);
    return true;
  });
  // One polite live region serves the whole list: a copy result first, else the row count.
  const live = {
    text: copyNote || (duels.length > 0
      ? `Showing ${duels.length} ${duels.length === 1 ? "duel" : "duels"}${cursor ? ", more available" : ""}`
      : ""),
  };
  // The Status filter counts only where the server applies it (an admin on All).
  const showStatus = canSeeAll && scope === "all";
  const filtered = hasHistoryFilters({ ...filters, status: showStatus ? filters.status : "" });
  const emptyFiltered = history && !rangeError && !isLoading && data != null && duels.length === 0
    && (filtered || qText !== "" || cardText !== "");

  // When the last page has loaded the button is gone: move focus to the note that takes its place.
  useEffect(() => {
    if (!cursor && focusEnd.current && endNote.current) {
      focusEnd.current = false;
      endNote.current.focus();
    }
  }, [cursor, pages?.items.length]);

  async function loadMore() {
    if (!history || !cursor || pages?.loading) return;
    const key = listKey;
    focusEnd.current = document.activeElement != null && document.activeElement === moreWrap.current?.querySelector("button");
    setMore((current) => ({ ...(current?.key === key ? current : { key, items: [], cursor }), loading: true, error: null }));
    try {
      const page = await listDuels(true, scope, filters, cursor);
      setMore((current) => current?.key === key
        ? { key, items: [...current.items, ...page.duels], cursor: page.nextCursor ?? null, loading: false, error: null }
        : current);
    } catch (err) {
      if (activeListKey.current === key && scope === "all"
        && err && typeof err === "object" && "status" in err && err.status === 403) {
        returnToMine();
        return;
      }
      const message = err instanceof Error ? err.message : "Could not load more duels.";
      setMore((current) => current?.key === key ? { ...current, loading: false, error: message } : current);
    }
  }

  function clearFilters() {
    setFilters(EMPTY_HISTORY_FILTERS);
    setQText("");
    setCardText("");
  }

  const copy = closing ? closeCopy(closing) : null;

  function dismiss() {
    if (closeBusy) return;
    setClosing(null);
    setCloseError(null);
  }

  async function confirmClose() {
    if (!closing || !copy || closeBusy) return;
    setCloseBusy(true);
    setCloseError(null);
    try {
      await copy.run(closing.slug);
      setClosing(null);
      await mutate();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : "Could not close this table.");
    } finally {
      setCloseBusy(false);
    }
  }

  return (
    <div className={cx(sheetRoot, styles.wrap)}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={ui.title}>Duels</h1>
          <p className={ui.lede}>Automated 1v1 tables.</p>
        </div>
        <div className={styles.headActions}>
          <Link href="/duels/new?challenge=1" className={sheetButtonClass("secondary", "lg")}>
            <Swords size={17} strokeWidth={1.7} aria-hidden />Challenge a player
          </Link>
          <Link href="/duels/new" className={sheetButtonClass("primary", "lg")}>
            <Plus size={17} strokeWidth={1.7} aria-hidden />Create game
          </Link>
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.bar}>
          <h2 className={ui.sectionTitle}>{history ? "Match history" : "Live tables"}</h2>
          <div className={styles.controls}>
            {history ? (
              <>
                {showStatus ? <span className={styles.adminHint}>Admin: all duels, private included</span> : null}
                <SheetSegmented label="History scope" hideLabel value={scope}
                  choices={canSeeAll ? [{ value: "mine", label: "Mine" }, { value: "all", label: "All" }] as const
                    : [{ value: "mine", label: "Mine" }] as const}
                  onChange={setScope} />
              </>
            ) : null}
            <SheetSegmented label="Tables view" hideLabel value={history}
              choices={[{ value: false, label: "Live tables" }, { value: true, label: "Match history" }]}
              onChange={setHistory} />
          </div>
        </div>
        <p className={ui.hint}>
          {history
            ? "Finished duels with replays and saved final boards."
            : "Open tables and duels in progress. Join takes an open seat; Watch enters as a spectator. Finished duels move to Match history."}
        </p>
        {history ? (
          <HistoryFilterBar canSeeAll={canSeeAll} showStatus={showStatus} filters={filters} q={qText} card={cardText}
            rangeError={rangeError} hideClear={emptyFiltered}
            onFilters={(patch) => setFilters((current) => ({ ...current, ...patch }))}
            onQ={setQText} onCard={setCardText} onClear={clearFilters} />
        ) : null}
        {isLoading && !data ? <p className={ui.hint}>{history ? "Loading duels…" : "Loading tables…"}</p> : null}
        {error && !data ? (
          <div className={styles.errorBlock}>
            <p className={ui.alert}>{error instanceof Error ? error.message : "Could not load duels."}</p>
            <SheetButton size="sm" onClick={() => void mutate()}>Retry</SheetButton>
          </div>
        ) : null}
        {error && data ? (
          <p className={styles.reconnect}>Connection dropped. Reconnecting…</p>
        ) : null}
        {!isLoading && data && duels.length === 0 ? (
          emptyFiltered ? (
            <div className={styles.empty}>
              <p>No duels match these filters.</p>
              <SheetButton size="sm" onClick={clearFilters}>Clear filters</SheetButton>
            </div>
          ) : (
            <p className={styles.empty}>
              {history ? "No finished duels yet." : "No live duels right now."}
            </p>
          )
        ) : duels.length > 0 ? (
          <ul className={styles.list}>
            {duels.map((duel) => history
              ? <HistoryRow key={duel.slug} duel={duel} onAnnounce={announce} />
              : <LiveRow key={duel.slug} duel={duel} onClose={(item) => { setCloseError(null); setClosing(item); }} />)}
          </ul>
        ) : null}
        {history && pages?.error ? <p className={ui.alert}>{pages.error}</p> : null}
        {history && cursor ? (
          <div ref={moreWrap} className={styles.more}>
            {/* aria-disabled, not disabled: the button keeps keyboard focus while the next page loads. */}
            <SheetButton kind="secondary" aria-disabled={pages?.loading === true || undefined}
              aria-busy={pages?.loading === true || undefined} onClick={() => void loadMore()}>
              {pages?.loading ? "Loading…" : "Load more"}
            </SheetButton>
          </div>
        ) : null}
        {history && pages && !cursor && !pages.loading ? (
          <p ref={endNote} tabIndex={-1} className={cx(ui.hint, styles.endNote)}>All duels are loaded.</p>
        ) : null}
        {history ? (
          <p role="status" className={ui.srOnly}>{live.text}</p>
        ) : null}
      </section>

      <Modal open={closing != null} onClose={dismiss} title={copy?.title}>
        <p className="text-sm text-text-secondary">{copy?.body}</p>
        {closeError ? <p role="alert" className="mt-3 text-sm text-accent-cta">{closeError}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant={copy?.danger ? "danger" : "primary"} loading={closeBusy} disabled={closeBusy}
            onClick={() => void confirmClose()}>
            {copy?.confirm}
          </Button>
          <Button type="button" variant="ghost" disabled={closeBusy} onClick={dismiss}>Keep table</Button>
        </div>
      </Modal>
    </div>
  );
}
