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

const timeOf = (item: DuelHistoryPage["duels"][number] | RemoteHistoryItem) => {
  if ("remote" in item) return Date.parse(item.endedAt ?? item.createdAt!);
  // Use the actual SQLite sort key: an invalid ended_at belongs to the undated tail even if createdAt is valid.
  const { time } = JSON.parse(Buffer.from(item.cursor, "base64url").toString()) as { time: number | null };
  return time === null ? -Infinity : Math.round((time - 2440587.5) * 86_400_000);
};

/**
 * Merge two keyset pages, advancing each source only through consumed rows. Unread rows are fetched again on the next
 * request. Stop when either source needs another fetch, including when filtering hides a whole Remote page.
 * Each source's id order is preserved on equal timestamps, with online rows first across sources.
 */
export function mergeHistory(input: {
  cursor: string | null | undefined;
  online: (cursor: string | undefined) => DuelHistoryPage;
  remote: (cursor: string | undefined) => RemoteHistoryPage;
  limit?: number;
  /** Hides Remote rows after the page is read. Hidden rows still count as read, so the next page starts after them. */
  remoteKeep?: (item: RemoteHistoryItem) => boolean;
}): MergedHistoryPage {
  const cursor = readComposite(input.cursor);
  const limit = Math.min(input.limit ?? 50, 100);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new DuelServiceError("Limit must be a positive integer", 400);
  const online = cursor.od ? null : input.online(cursor.o);
  const remote = cursor.rd ? null : input.remote(cursor.r || undefined);
  const onlineItems = online?.duels ?? [], remoteItems = remote?.items ?? [];
  const duels: MergedHistoryPage["duels"] = [];
  let onlineRead = 0, remoteRead = 0;
  while (duels.length < limit) {
    // Rows beyond either fetched page may be newer than the other source's next row.
    if ((onlineRead === onlineItems.length && online?.nextCursor) || (remoteRead === remoteItems.length && remote?.nextCursor)) break;
    const o = onlineItems[onlineRead], r = remoteItems[remoteRead];
    if (!o && !r) break;
    if (r && (!o || timeOf(r) > timeOf(o))) {
      remoteRead++;
      if (!input.remoteKeep || input.remoteKeep(r)) duels.push(r);
    } else {
      onlineRead++;
      duels.push(o!);
    }
  }
  const onlineMore = !!online && (onlineRead < onlineItems.length || !!online.nextCursor);
  const remoteMore = !!remote && (remoteRead < remoteItems.length || !!remote.nextCursor);
  // On a fully consumed source page, use its continuation even if corrupt/hidden rows were omitted from its items.
  const onlineNext = onlineRead === onlineItems.length ? online?.nextCursor : onlineRead ? onlineItems[onlineRead - 1]!.cursor : cursor.o;
  const remoteNext = remoteMore ? (remoteRead === remoteItems.length ? remote!.nextCursor : remoteRead ? remoteItems[remoteRead - 1]!.cursor : cursor.r ?? "") : null;
  const done = !onlineMore && remoteNext === null;
  const next: Composite = {
    ...(onlineMore ? { o: onlineNext ?? undefined } : { od: 1 }),
    ...(remoteNext !== null ? { r: remoteNext } : { rd: 1 }),
  };
  return { duels, canSeeAll: !!online?.canSeeAll || !!remote?.canSeeAll,
    nextCursor: done ? null : Buffer.from(JSON.stringify(next)).toString("base64url") };
}
