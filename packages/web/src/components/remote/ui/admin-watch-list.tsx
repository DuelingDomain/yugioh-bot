"use client";

import useSWR from "swr";
import type { RemoteTable } from "@yugidraft/shared/remote";
import { remoteApi } from "./api";
import { remoteTableHref } from "./create";

/** The link of the Watch button. `watch=1` asks for the admin view; the server grants it to the owner list only. */
export const adminWatchHref = (slug: string) => `${remoteTableHref(slug)}?watch=1`;

/** True for an admin (guild owner or Manage Server). `undefined` while it loads. One shared request. */
export function useAdminAccess(): boolean | undefined {
  const access = useSWR("remote:admin-access", () => fetch("/api/admin/access", { cache: "no-store" }).then(response => response.ok ? response.json() as Promise<{ admin: boolean }> : { admin: false }), { revalidateOnFocus: false });
  return access.data?.admin;
}

/** Admins only: every live table of the guild, private ones too. `undefined` for anyone else and while it loads. */
export function useAdminWatchTables(): RemoteTable[] | undefined {
  const admin = useAdminAccess();
  const all = useSWR(admin ? "remote:all" : null, () => remoteApi<{ tables: RemoteTable[] }>("?scope=all"), { refreshInterval: 5000, shouldRetryOnError: false });
  return admin && !all.error ? all.data?.tables : undefined;
}
