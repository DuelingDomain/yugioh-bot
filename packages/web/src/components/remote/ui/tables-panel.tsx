"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowRight, Camera, Plus, Users } from "lucide-react";
import type { RemoteTable } from "@yugidraft/shared/remote";
import { cx, sheetButtonClass } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import styles from "@/components/duel/lobby.module.css";
import { remoteFormatName, remoteTableHref } from "./create";
import { remoteApi } from "./api";

/** The "Remote Duels" section of the Duels page: your tables and the open ones, in the look of the live table rows. */
export function RemoteTablesPanel() {
  const mine = useSWR("remote:live", () => remoteApi<{ tables: RemoteTable[] }>("?scope=live"), { refreshInterval: 5000 });
  const open = useSWR("remote:open", () => remoteApi<{ tables: RemoteTable[] }>("?scope=open"), { refreshInterval: 5000 });
  const own = new Set((mine.data?.tables ?? []).map(table => table.slug));
  const tables = [...(mine.data?.tables ?? []), ...(open.data?.tables ?? []).filter(table => !own.has(table.slug))].filter(table => table.status !== "ended");
  const error = !mine.data && !open.data ? (mine.error ?? open.error) : undefined;
  return <section className={styles.section} aria-label="Remote Duels" data-testid="remote-tables-panel">
    <div className={styles.bar}>
      <h2 className={ui.sectionTitle}>Remote Duels</h2>
      <div className={styles.controls}>
        <Link href="/duels/remote" className={sheetButtonClass("quiet", "sm")} data-testid="remote-lobby-link">All remote tables</Link>
        <Link href="/duels/new?type=remote" className={sheetButtonClass("secondary", "sm")}><Plus size={15} strokeWidth={1.7} aria-hidden />New Remote Duel</Link>
      </div>
    </div>
    <p className={ui.hint}>Physical cards over webcam · voice + card reading.</p>
    {error ? <p className={ui.alert} role="alert">{error.message}</p> : !mine.data && !open.data ? <p className={ui.hint}>Loading remote tables…</p>
      : tables.length === 0 ? <p className={styles.empty}>No remote tables right now.</p>
      : <ul className={styles.list}>{tables.map(table => {
        const yours = own.has(table.slug); const openSeats = table.seatCount - table.seats.length;
        // "Open" only where someone else can sit down: a solo or full table of yours is still being set up.
        const status = table.status === "active" ? "In progress" : table.solo || openSeats <= 0 ? "Setting up" : "Open";
        return <li key={table.slug} className={styles.row}>
          {/* A full document load: the table page is cross-origin isolated. */}
          <a href={remoteTableHref(table.slug)} className={styles.rowLink} data-testid={`remote-row-${table.slug}`}>
            <span className={styles.rowMain}>
              <span className={styles.rowTitle}>
                <span className={styles.name}>{remoteFormatName(table.format?.id)} · {table.seatCount === 2 ? "1v1" : `${table.seatCount}-way`}</span>
                {yours ? <span className={cx(ui.chip, ui.chipAccent)}>Your table</span> : null}
              </span>
              <span className={styles.chips}>
                <span className={ui.chip}><Camera size={13} strokeWidth={1.6} aria-hidden />Remote</span>
                {table.solo ? <span className={ui.chip}>Solo test</span> : null}
                <span className={cx(ui.chip, table.status === "active" && ui.chipGold)}>{status}</span>
                <span className={ui.chip}><Users size={13} strokeWidth={1.6} aria-hidden />{table.seats.length}/{table.seatCount}</span>
              </span>
            </span>
            <span className={styles.go}>
              {yours ? "Return" : table.status === "lobby" && openSeats > 0 && !table.solo ? `Join · ${openSeats} open` : "Open"}
              <ArrowRight size={15} strokeWidth={1.6} aria-hidden />
            </span>
          </a>
        </li>;
      })}</ul>}
  </section>;
}
