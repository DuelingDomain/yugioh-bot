"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowRight, Check, ChevronDown, Copy, Eye, Lock, Plus, Swords, Users } from "lucide-react";
import { isCustomDomain, type DuelFormat, type DuelHistoryScope, type DuelListItem } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { focusDuelWindowOnClick } from "./duel-window";
import { formatLabel, formatSeatCount, seatTeamLabel, tagSeatCode } from "./table-format";
import {
  DUEL_LIST_KEY, cancelDuel, duelHistoryKey, leaveDuel, listDuels, surrenderDuel, takeDuelSeat,
  type DuelListEntry, type DuelListSeat,
} from "./api";
import {
  EMPTY_HISTORY_FILTERS, hasHistoryFilters, lobbySearch, presetRange,
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
  const date = new Date(`${text.replace(" ", "T")}Z`);
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

function engineLabel(engine: DuelListEntry["engine"]): string {
  const family = typeof engine === "string" ? engine : engine?.coreFamily;
  return family ? `${family} engine` : "";
}

/** Result of one seat: the server value when sent, else worked out from the winner (a Tag win is shared by the team). */
function seatResult(duel: DuelListEntry, seat: DuelListSeat): string {
  if (seat.result) return seat.result;
  if (duel.status !== "completed") return "";
  if (duel.winnerSeat == null) return "Draw";
  const same = duel.format === "tag"
    ? seatTeamLabel(duel.format, seat.seat) === seatTeamLabel(duel.format, duel.winnerSeat)
    : seat.seat === duel.winnerSeat;
  return same ? "Won" : "Lost";
}

function seatLine(duel: DuelListEntry, seat: DuelListSeat): string {
  const code = tagSeatCode(duel.format, seat.seat);
  const team = seat.team != null ? `Team ${seat.team + 1}` : seatTeamLabel(duel.format, seat.seat);
  const place = duel.format === "tag" ? `${team ?? ""} ${code ?? ""}`.trim() : `Seat ${seat.seat + 1}`;
  const result = seatResult(duel, seat);
  return `${place} ${seat.displayName}${seat.isBot ? " (bot)" : ""}${result ? ` · ${result}` : ""}`;
}

/** Small button that copies the duel slug for bug reports. */
function CopySlug({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(slug);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }
  return (
    <span className={styles.slug}>
      <code>{slug}</code>
      <button type="button" className={styles.copyBtn} onClick={() => void copy()} aria-label={`Copy duel id ${slug}`}>
        {copied ? <Check size={13} strokeWidth={1.8} aria-hidden /> : <Copy size={13} strokeWidth={1.6} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function isOrganizer(duel: DuelListItem): boolean {
  const mine = duel.seats.find((seat) => seat.seat === duel.mySeat);
  return mine != null && duel.organizerPlayerId === mine.playerId;
}

function outcomeLabel(duel: DuelListItem): string {
  if (duel.status === "interrupted") return "Interrupted";
  if (duel.winnerSeat == null) return "Draw";
  if (duel.mySeat != null) return duel.winnerSeat === duel.mySeat ? "Won" : "Lost";
  const winner = duel.seats.find((seat) => seat.seat === duel.winnerSeat);
  return `${winner?.displayName ?? `Seat ${duel.winnerSeat + 1}`} won`;
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

function HistoryRow({ duel }: { duel: DuelListEntry }) {
  const [open, setOpen] = useState(false);
  const outcome = outcomeLabel(duel);
  const created = parseUtc(duel.createdAt);
  const started = parseUtc(duel.startedAt ?? null) ?? created;
  const ended = parseUtc(duel.endedAt);
  const when = ended ?? created;
  const engine = engineLabel(duel.engine);
  const length = duel.durationMs != null ? formatDuration(duel.durationMs) : "";
  const turns = duel.turnCount != null ? `${duel.turnCount} ${duel.turnCount === 1 ? "turn" : "turns"}` : "";
  const hasDetails = Boolean(started || length || turns || engine || duel.seats.length > 0);
  const range = started && ended
    ? `${formatDateTime(started)} to ${sameDay(started, ended) ? formatTime(ended) : formatDateTime(ended)}`
    : started ? `Started ${formatDateTime(started)}` : "";
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
          <span className={styles.dot} aria-hidden>·</span>
          <span className={cx(styles.outcome, outcomeTone(outcome))}>{outcome}</span>
          {duel.resultReason ? <span className={styles.reason}> · {duel.resultReason}</span> : null}
        </p>
        {hasDetails ? (
          <>
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
              <CopySlug slug={duel.slug} />
            </div>
          </>
        ) : null}
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

function HistoryFilterBar({ filters, q, card, onFilters, onQ, onCard, onClear }: {
  filters: HistoryFilters;
  q: string;
  card: string;
  onFilters: (patch: Partial<HistoryFilters>) => void;
  onQ: (value: string) => void;
  onCard: (value: string) => void;
  onClear: () => void;
}) {
  const active = hasHistoryFilters(filters) || q !== "" || card !== "";
  return (
    <form className={styles.filters} role="search" aria-label="Filter match history" onSubmit={(event) => event.preventDefault()}>
      <label className={styles.fieldFrom}>
        <span className={ui.label}>From</span>
        <input type="datetime-local" className={cx(ui.input, styles.dateInput)} value={filters.from}
          max={filters.to || undefined} onChange={(event) => onFilters({ from: event.target.value })} />
      </label>
      <label className={styles.fieldTo}>
        <span className={ui.label}>To</span>
        <input type="datetime-local" className={cx(ui.input, styles.dateInput)} value={filters.to}
          min={filters.from || undefined} onChange={(event) => onFilters({ to: event.target.value })} />
      </label>
      <SheetSelect className={styles.fieldFormat} label="Format" value={filters.format}
        choices={FORMAT_CHOICES} onChange={(format) => onFilters({ format })} />
      <SheetSelect className={styles.fieldFormat} label="Status" value={filters.status}
        choices={STATUS_CHOICES} onChange={(status) => onFilters({ status })} />
      <label className={styles.fieldText}>
        <span className={ui.label}>Player or duel name</span>
        <input type="search" className={ui.input} value={q} placeholder="Player or duel name" autoComplete="off"
          onChange={(event) => onQ(event.target.value)} />
      </label>
      <label className={styles.fieldText}>
        <span className={ui.label}>Card</span>
        <input type="search" className={ui.input} value={card} placeholder="Card name" autoComplete="off"
          onChange={(event) => onCard(event.target.value)} />
      </label>
      <div className={styles.presets} role="group" aria-label="Quick date ranges">
        {PRESETS.map((preset) => (
          <button key={preset.value} type="button" className={cx(ui.chip, styles.preset)}
            onClick={() => onFilters(presetRange(preset.value))}>
            {preset.label}
          </button>
        ))}
        {active ? <SheetButton kind="quiet" size="sm" onClick={onClear}>Clear filters</SheetButton> : null}
      </div>
    </form>
  );
}

type MorePages = { key: string; items: DuelListEntry[]; cursor: string | null; loading: boolean; error: string | null };

export function DuelLobby({ initialView = "live", initialScope = "mine", initialFilters = EMPTY_HISTORY_FILTERS }: {
  initialView?: DuelListView;
  initialScope?: DuelHistoryScope;
  initialFilters?: HistoryFilters;
}) {
  const [history, setHistory] = useState(initialView === "history");
  const [scope, setScope] = useState<DuelHistoryScope>(initialScope);
  const [filters, setFilters] = useState<HistoryFilters>(initialFilters);
  const [qText, setQText] = useState(initialFilters.q);
  const [cardText, setCardText] = useState(initialFilters.card);
  const [more, setMore] = useState<MorePages | null>(null);
  const [closing, setClosing] = useState<DuelListItem | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const listKey = history ? duelHistoryKey(scope, filters) : DUEL_LIST_KEY;
  const { data, error, isLoading, mutate } = useSWR(
    listKey,
    () => listDuels(history, scope, filters),
    { refreshInterval: history ? 0 : 1000, revalidateOnFocus: true },
  );

  // Text boxes commit to the filters 300 ms after the last key press.
  useEffect(() => {
    if (qText.trim() === filters.q && cardText.trim() === filters.card) return;
    const timer = setTimeout(() => setFilters((current) => ({ ...current, q: qText.trim(), card: cardText.trim() })), 300);
    return () => clearTimeout(timer);
  }, [qText, cardText, filters.q, filters.card]);

  // A new query starts again from its first page.
  useEffect(() => { setMore(null); }, [listKey]);

  // Keep the page URL in step so a filtered list can be bookmarked.
  useEffect(() => {
    const url = `${window.location.pathname}${lobbySearch(history, scope, filters)}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", url);
  }, [history, scope, filters]);

  const pages = history && more?.key === listKey ? more : null;
  const cursor = pages ? pages.cursor : data?.nextCursor ?? null;
  const firstSlugs = new Set((data?.duels ?? []).map((duel) => duel.slug));
  const duels = [...(data?.duels ?? []), ...(pages?.items ?? []).filter((duel) => !firstSlugs.has(duel.slug))];
  const canSeeAll = data?.canSeeAll === true;
  const filtered = hasHistoryFilters(filters);

  async function loadMore() {
    if (!history || !cursor || pages?.loading) return;
    const key = listKey;
    setMore((current) => ({ ...(current?.key === key ? current : { key, items: [], cursor }), loading: true, error: null }));
    try {
      const page = await listDuels(true, scope, filters, cursor);
      setMore((current) => current?.key === key
        ? { key, items: [...current.items, ...page.duels], cursor: page.nextCursor ?? null, loading: false, error: null }
        : current);
    } catch (err) {
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
                {canSeeAll ? <span className={styles.adminHint}>Admin: all duels, private included</span> : null}
                <SheetSegmented label="History scope" hideLabel value={scope}
                  choices={[{ value: "mine", label: "Mine" }, { value: "all", label: "All" }] as const}
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
          <HistoryFilterBar filters={filters} q={qText} card={cardText}
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
          history && (filtered || qText !== "" || cardText !== "") ? (
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
              ? <HistoryRow key={duel.slug} duel={duel} />
              : <LiveRow key={duel.slug} duel={duel} onClose={(item) => { setCloseError(null); setClosing(item); }} />)}
          </ul>
        ) : null}
        {history && pages?.error ? <p className={ui.alert}>{pages.error}</p> : null}
        {history && cursor ? (
          <div className={styles.more}>
            <SheetButton kind="secondary" loading={pages?.loading === true} onClick={() => void loadMore()}>Load more</SheetButton>
          </div>
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
