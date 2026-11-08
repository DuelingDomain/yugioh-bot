import { DuelServiceError } from "./duels.js";
import type { DuelHistoryPage, DuelListItem } from "../duels/index.js";
import type { RemoteHistoryItem, RemoteHistoryPage } from "../remote/history.js";

export type HistoryType = "all" | "online" | "remote";
export type MergedHistoryPage = { duels: (DuelListItem | RemoteHistoryItem)[]; nextCursor: string | null; canSeeAll: boolean };

/** The merged list keeps one cursor per source. `od` and `rd` mean that source has no more rows; `r: ""` means Remote has not started. */
type Composite = { o?: string; r?: string; od?: 1; rd?: 1 };

function readComposite(cursor: string | null | undefined): Composite {
  if (!cursor) return {};
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    const text = (key: string) => value[key] === undefined || typeof value[key] === "string";
    if (!value || typeof value !== "object" || !text("o") || !text("r")) throw new Error("bad");
    return { o: value.o, r: value.r, ...(value.od ? { od: 1 } : {}), ...(value.rd ? { rd: 1 } : {}) };
  } catch {
    throw new DuelServiceError("Invalid cursor", 400);
  }
}

const timeOf = (item: DuelListItem | RemoteHistoryItem) => Date.parse(item.endedAt ?? item.createdAt ?? "") || 0;

/**
 * Online and Remote history in one list, newest first. A page holds a whole online page plus the Remote rows that are not
 * older than its last row, so the online cursor needs no per-row position. When online has no more rows, the Remote page comes whole.
 */
export function mergeHistory(input: {
  cursor: string | null | undefined;
  online: (cursor: string | undefined) => DuelHistoryPage;
  remote: (cursor: string | undefined) => RemoteHistoryPage;
}): MergedHistoryPage {
  const cursor = readComposite(input.cursor);
  const online = cursor.od ? null : input.online(cursor.o);
  const remote = cursor.rd ? null : input.remote(cursor.r || undefined);
  const onlineMore = !!online?.nextCursor, onlineItems = online?.duels ?? [];
  const cut = onlineMore && onlineItems.length ? timeOf(onlineItems[onlineItems.length - 1]!) : -Infinity;
  const remoteItems = (remote?.items ?? []).filter(item => timeOf(item) >= cut);
  // Remote rows left out of this page are read again from the last row that was kept. "" is the start of the list (page 1 has
  // no Remote position yet), so it is never mixed up with `rd`, which means Remote has no more rows.
  const remoteMore = !!remote && (remoteItems.length < remote.items.length || !!remote.nextCursor);
  const remoteNext = remoteMore ? (remoteItems.length ? remoteItems[remoteItems.length - 1]!.cursor : cursor.r ?? "") : null;
  const duels = [...onlineItems, ...remoteItems].sort((a, b) => timeOf(b) - timeOf(a));
  const done = !onlineMore && remoteNext === null;
  const next: Composite = {
    ...(onlineMore ? { o: online!.nextCursor! } : { od: 1 }),
    ...(remoteNext !== null ? { r: remoteNext } : { rd: 1 }),
  };
  return { duels, canSeeAll: !!online?.canSeeAll || !!remote?.canSeeAll,
    nextCursor: done ? null : Buffer.from(JSON.stringify(next)).toString("base64url") };
}
