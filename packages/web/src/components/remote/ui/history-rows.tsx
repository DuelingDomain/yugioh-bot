"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, Camera, Lock, Trophy, Users } from "lucide-react";
import type { RemoteHistoryItem, RemoteTable } from "@yugidraft/shared/remote";
import { cx, sheetButtonClass } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import styles from "@/components/duel/lobby.module.css";
import { remoteFormatName, remoteTableHref } from "./create";
import { remoteApi } from "./api";
import { adminWatchHref, useAdminWatchTables } from "./admin-watch-list";

const dateTime = (text: string | null) => text ? new Date(text).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const length = (ms: number | null) => {
  if (ms == null) return "";
  const total = Math.max(0, Math.round(ms / 1000)), hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${total % 60}s` : `${total}s`;
};
const tableKind = (seatCount: number) => seatCount === 2 ? "1v1" : `${seatCount}-way`;

/** One ended Remote table in Match history, in the look of an online history row. */
export function RemoteHistoryRow({ duel }: { duel: RemoteHistoryItem }) {
  const when = dateTime(duel.endedAt ?? duel.createdAt);
  const others = duel.seats.filter(seat => seat.seat !== duel.mySeat);
  const mine = duel.seats.find(seat => seat.seat === duel.mySeat);
  const outcome = mine?.result === "win" ? "Won" : mine?.result === "loss" ? "Lost" : mine?.result === "draw" ? "Draw" : "";
  const winner = duel.winnerSeat === null ? undefined : duel.seats.find(seat => seat.seat === duel.winnerSeat)?.displayName;
  const meta = [length(duel.durationMs), duel.turnCount != null ? `${duel.turnCount} ${duel.turnCount === 1 ? "turn" : "turns"}` : ""].filter(Boolean);
  return <li className={cx(styles.row, styles.historyRow)} data-testid={`remote-history-${duel.slug}`}>
    <div className={styles.rowMain}>
      <span className={styles.name}>{duel.name}</span>
      <span className={styles.chips}>
        <span className={ui.chip}><Camera size={13} strokeWidth={1.6} aria-hidden />Remote</span>
        <span className={ui.chip}>{remoteFormatName(duel.formatId)} · {tableKind(duel.seatCount)}</span>
        <span className={ui.chip}>Finished</span>
        {duel.tournament ? <span className={ui.chip}><Trophy size={13} strokeWidth={1.6} aria-hidden />{duel.tournament.name ?? "Tournament"}</span> : null}
        {duel.visibility === "private" ? <span className={ui.chip}><Lock size={13} strokeWidth={1.6} aria-hidden />Private</span> : null}
        {when ? <time className={styles.activity} dateTime={duel.endedAt ?? duel.createdAt ?? undefined}>{when}</time> : null}
      </span>
      <p className={styles.versus}>
        {duel.mySeat != null ? "vs " : ""}{(duel.mySeat != null ? others : duel.seats).map(seat => seat.displayName).join(duel.mySeat != null ? ", " : " vs ")}
        {outcome || winner ? <><span className={styles.dot} aria-hidden>·</span><span className={cx(styles.outcome, outcome === "Won" ? styles.won : outcome === "Lost" ? styles.lost : "")}>{outcome || `${winner} won`}</span></> : null}
      </p>
      {meta.length ? <p className={styles.meta}>{meta.map((part, index) => <span key={index}>{part}</span>)}</p> : null}
    </div>
    <div className={styles.historyActions}>
      {duel.tournament?.slug ? <Link href={`/tournament/${encodeURIComponent(duel.tournament.slug)}`} className={sheetButtonClass("secondary", "sm")} data-testid={`remote-tournament-${duel.slug}`}>Tournament</Link> : null}
      <Link href={`/duels/remote/${duel.slug}/replay`} className={sheetButtonClass("primary", "sm")} data-testid={`remote-replay-${duel.slug}`}>Replay</Link>
    </div>
  </li>;
}

/** My live Remote tables and the open public ones, for the live list. Polls like the online list does. */
export function useRemoteLive(enabled: boolean) {
  const mine = useSWR(enabled ? "remote:live" : null, () => remoteApi<{ tables: RemoteTable[] }>("?scope=live"), { refreshInterval: 5000 });
  const open = useSWR(enabled ? "remote:open" : null, () => remoteApi<{ tables: RemoteTable[] }>("?scope=open"), { refreshInterval: 5000 });
  const own = new Set((mine.data?.tables ?? []).map(table => table.slug));
  const everyLive = useAdminWatchTables();
  const listed = [...(mine.data?.tables ?? []), ...(open.data?.tables ?? []).filter(table => !own.has(table.slug))];
  // Admins also get the live tables nobody else can see (private ones). They open as a spectator.
  const seen = new Set(listed.map(table => table.slug));
  const adminOnly = new Set((everyLive ?? []).filter(table => !seen.has(table.slug)).map(table => table.slug));
  const tables = [...listed, ...(everyLive ?? []).filter(table => adminOnly.has(table.slug))].filter(table => table.status !== "ended");
  return { tables, own, adminOnly, ready: !!(mine.data || open.data) };
}

/** One live or open Remote table in the live list, with a Remote tag. */
export function RemoteLiveRow({ table, yours, adminView = false }: { table: RemoteTable; yours: boolean; adminView?: boolean }) {
  const openSeats = table.seatCount - table.seats.length;
  // "Open" only where someone else can sit down: a solo or full table of yours is still being set up.
  const status = table.status === "active" ? "In progress" : table.solo || openSeats <= 0 ? "Setting up" : "Open";
  return <li className={styles.row}>
    {/* A full document load: the table page is cross-origin isolated. */}
    <a href={adminView ? adminWatchHref(table.slug) : remoteTableHref(table.slug)} className={styles.rowLink} data-testid={`remote-row-${table.slug}`}>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>
          <span className={styles.name}>{remoteFormatName(table.format?.id)} · {tableKind(table.seatCount)}</span>
          {yours ? <span className={cx(ui.chip, ui.chipAccent)}>Your table</span> : null}
        </span>
        <span className={styles.chips}>
          <span className={ui.chip}><Camera size={13} strokeWidth={1.6} aria-hidden />Remote</span>
          {table.solo ? <span className={ui.chip}>Solo test</span> : null}
          {table.visibility === "private" ? <span className={ui.chip}>Private</span> : null}
          <span className={cx(ui.chip, table.status === "active" && ui.chipGold)}>{status}</span>
          <span className={ui.chip}><Users size={13} strokeWidth={1.6} aria-hidden />{table.seats.length}/{table.seatCount}</span>
        </span>
      </span>
      <span className={styles.go}>
        {adminView ? "Watch · Admin" : yours ? "Return" : table.status === "lobby" && openSeats > 0 ? `Join · ${openSeats} open` : table.status === "lobby" ? "Full — watch" : "Watch"}
        <ArrowRight size={15} strokeWidth={1.6} aria-hidden />
      </span>
    </a>
  </li>;
}
