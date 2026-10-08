"use client";

import * as React from "react";

export interface PagedListOptions<Raw, Item extends { id: number }> {
  /** The list route, without a query string: `/api/drafts`. */
  endpoint: string;
  /** The first page, rendered by the server. */
  initialItems: Item[];
  initialCursor: string | null;
  /** Turns one API row into the shape the page renders. */
  adapt: (raw: Raw) => Item;
}

export interface PagedList<Item> {
  items: Item[];
  /** Null once the last page is in. */
  nextCursor: string | null;
  status: "idle" | "loading" | "error";
  /** True once at least one extra page has been appended. */
  appended: boolean;
  /** How many rows the latest load added, for the screen reader note. Changes identity on every load. */
  lastLoad: { count: number } | null;
  loadMore: () => void;
}

interface Page<Raw> {
  items: Raw[];
  nextCursor: string | null;
}

function isPage<Raw>(body: unknown): body is Page<Raw> {
  if (!body || typeof body !== "object") return false;
  const page = body as Partial<Page<Raw>>;
  return Array.isArray(page.items) && (page.nextCursor === null || typeof page.nextCursor === "string");
}

/**
 * Cursor paging for a list whose first page the server rendered. `loadMore` asks for the next page,
 * ignores calls while one is in flight, appends the rows (skipping any id already shown) and keeps
 * the cursor. A failed load leaves the rows and the cursor alone, so the same call can retry.
 * When the server hands down a new first page (a refresh), the appended rows are dropped.
 */
export function usePagedList<Raw, Item extends { id: number }>({
  endpoint, initialItems, initialCursor, adapt,
}: PagedListOptions<Raw, Item>): PagedList<Item> {
  const [items, setItems] = React.useState(initialItems);
  const [nextCursor, setNextCursor] = React.useState(initialCursor);
  const [status, setStatus] = React.useState<PagedList<Item>["status"]>("idle");
  const [appended, setAppended] = React.useState(false);
  const [lastLoad, setLastLoad] = React.useState<{ count: number } | null>(null);

  const inflight = React.useRef(false);
  const aborter = React.useRef<AbortController | null>(null);
  const live = React.useRef({ items, nextCursor, adapt });
  live.current = { items, nextCursor, adapt };

  // A new first page from the server replaces what was loaded.
  const [seen, setSeen] = React.useState({ initialItems, initialCursor });
  if (seen.initialItems !== initialItems || seen.initialCursor !== initialCursor) {
    setSeen({ initialItems, initialCursor });
    setItems(initialItems);
    setNextCursor(initialCursor);
    setStatus("idle");
    setAppended(false);
    setLastLoad(null);
  }
  React.useEffect(() => {
    // A page that replaced the rows mid-load makes that response stale.
    aborter.current?.abort();
    inflight.current = false;
  }, [initialItems, initialCursor]);
  React.useEffect(() => () => aborter.current?.abort(), []);

  const loadMore = React.useCallback(() => {
    const cursor = live.current.nextCursor;
    if (inflight.current || cursor === null) return;
    inflight.current = true;
    setStatus("loading");
    const controller = new AbortController();
    aborter.current = controller;
    void (async () => {
      try {
        const res = await fetch(`${endpoint}?cursor=${encodeURIComponent(cursor)}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (!isPage<Raw>(body)) throw new Error("Unexpected list response");
        if (controller.signal.aborted) return;
        const known = new Set(live.current.items.map((item) => item.id));
        const fresh: Item[] = [];
        for (const raw of body.items) {
          const item = live.current.adapt(raw);
          if (known.has(item.id)) continue;
          known.add(item.id);
          fresh.push(item);
        }
        setItems((prev) => [...prev, ...fresh]);
        setNextCursor(body.nextCursor);
        setAppended(true);
        setLastLoad({ count: fresh.length });
        setStatus("idle");
      } catch {
        if (controller.signal.aborted) return;
        setStatus("error");
      } finally {
        if (aborter.current === controller) inflight.current = false;
      }
    })();
  }, [endpoint]);

  return { items, nextCursor, status, appended, lastLoad, loadMore };
}
