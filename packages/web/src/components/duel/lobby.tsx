"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowRight, Eye, Lock, Plus, Swords, Users } from "lucide-react";
import { isCustomDomain, type DuelHistoryScope, type DuelListItem } from "@yugidraft/shared/duels";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { focusDuelWindowOnClick } from "./duel-window";
import { formatLabel, formatSeatCount } from "./table-format";
import { DUEL_LIST_KEY, cancelDuel, leaveDuel, listDuels, surrenderDuel, takeDuelSeat } from "./api";
import { isNotableSeries, SeriesBadges } from "./series-banner";
import { cx, SheetButton, sheetButtonClass, SheetSegmented, sheetRoot } from "./sheet-ui";
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

function formatDate(text: string | null): string {
  const date = parseUtc(text);
  return date ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
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

function HistoryRow({ duel }: { duel: DuelListItem }) {
  const outcome = outcomeLabel(duel);
  return (
    <li className={cx(styles.row, styles.historyRow)}>
      <div className={styles.rowMain}>
        <span className={styles.name}>{duel.name}</span>
        <span className={styles.chips}>
          <span className={ui.chip}>{modeLabel(duel)}</span>
          {isNotableSeries(duel.series) ? <SeriesBadges series={duel.series} plain /> : null}
          {duel.endedAt ? <span className={styles.activity}>{formatDate(duel.endedAt)}</span> : null}
        </span>
        <p className={styles.versus}>
          {duel.mySeat != null ? "vs " : ""}{opponents(duel)}
          <span className={styles.dot} aria-hidden>·</span>
          <span className={cx(styles.outcome, outcomeTone(outcome))}>{outcome}</span>
          {duel.resultReason ? <span className={styles.reason}> · {duel.resultReason}</span> : null}
        </p>
      </div>
      <div className={styles.historyActions}>
        <Link href={`/duels/${duel.slug}/replay`} className={sheetButtonClass("primary", "sm")}>Replay</Link>
        <Link href={`/duels/${duel.slug}`} className={sheetButtonClass("secondary", "sm")}>Final board</Link>
      </div>
    </li>
  );
}

export function DuelLobby({ initialView = "live" }: { initialView?: DuelListView }) {
  const [history, setHistory] = useState(initialView === "history");
  const [scope, setScope] = useState<DuelHistoryScope>("mine");
  const [closing, setClosing] = useState<DuelListItem | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useSWR(
    history ? `${DUEL_LIST_KEY}?archived=1&scope=${scope}` : DUEL_LIST_KEY,
    () => listDuels(history, scope),
    { refreshInterval: history ? 0 : 1000, revalidateOnFocus: true },
  );

  const duels = data?.duels ?? [];
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
              <SheetSegmented label="History scope" hideLabel value={scope}
                choices={[{ value: "mine", label: "Mine" }, { value: "all", label: "All" }] as const}
                onChange={setScope} />
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
        {isLoading && !data ? <p className={ui.hint}>Loading tables…</p> : null}
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
          <p className={styles.empty}>
            {history ? "No finished duels yet." : "No live duels right now."}
          </p>
        ) : duels.length > 0 ? (
          <ul className={styles.list}>
            {duels.map((duel) => history
              ? <HistoryRow key={duel.slug} duel={duel} />
              : <LiveRow key={duel.slug} duel={duel} onClose={(item) => { setCloseError(null); setClosing(item); }} />)}
          </ul>
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
