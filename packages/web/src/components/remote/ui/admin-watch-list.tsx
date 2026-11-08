"use client";

import useSWR from "swr";
import type { RemoteTable } from "@yugidraft/shared/remote";
import { remoteApi } from "./api";
import { remoteFormatName, remoteTableHref } from "./create";
import l from "./remote-lobby.module.css";

/** The link of the Watch button. `watch=1` asks for the admin view; the server grants it to the owner list only. */
export const adminWatchHref = (slug: string) => `${remoteTableHref(slug)}?watch=1`;

/** Admins only: every live table of the guild, private ones too. `undefined` for anyone else and while it loads. */
export function useAdminWatchTables(): RemoteTable[] | undefined {
  const access = useSWR("remote:admin-access", () => fetch("/api/admin/access", { cache: "no-store" }).then(response => response.ok ? response.json() as Promise<{ admin: boolean }> : { admin: false }), { revalidateOnFocus: false });
  const all = useSWR(access.data?.admin ? "remote:all" : null, () => remoteApi<{ tables: RemoteTable[] }>("?scope=all"), { refreshInterval: 5000, shouldRetryOnError: false });
  return access.data?.admin && !all.error ? all.data?.tables : undefined;
}

/** The lobby card: every live table with a Watch button. Nothing renders for anyone else. */
export function AdminWatchList() {
  const tables = useAdminWatchTables();
  if (!tables) return null;
  return <section className={l.card} aria-label="All live tables" data-testid="admin-watch-list">
    <h2>All live tables · Admin</h2>
    {tables.length === 0 ? <p className={l.note}>No live tables.</p> :
      <ul className={l.tables}>{tables.map(table => <li key={table.slug} className={l.watchRow}>
        <span className={l.watchInfo}>
          <span>{table.slug}</span>
          <span className={l.tag}>{remoteFormatName(table.format?.id)}</span>
          <span className={l.tag}>{table.visibility === "private" ? "Private" : "Public"}</span>
          <span className={`${l.tag} ${table.status === "active" ? l.tagLive : ""}`}>{table.status}</span>
          <span className={l.note}>{table.seats.map(seat => seat.displayName).join(", ") || "No players"} · {table.seats.length}/{table.seatCount}</span>
        </span>
        <a className={l.btn} href={adminWatchHref(table.slug)} data-testid={`admin-watch-${table.slug}`}>Watch</a>
      </li>)}</ul>}
  </section>;
}
