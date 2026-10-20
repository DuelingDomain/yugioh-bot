"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { POLL_MS } from "@/lib/admin-console/sections";
import type { SectionDataMap, SectionId, SectionResult } from "@/lib/admin-console/types";

export type LoadFailure = "forbidden" | "unauthorized" | "unavailable";
export interface SectionSnapshot<K extends SectionId> {
  result: SectionResult<SectionDataMap[K]> | null;
  /** When the browser last got an answer. */
  fetchedAt: number | null;
  /** Set when the request itself failed. The last good result stays in `result`. */
  failure: LoadFailure | null;
}

interface Entry {
  snapshot: SectionSnapshot<SectionId>;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
  inflight: boolean;
  /** A refresh was asked for while a request was running; run one more when it ends. */
  again: boolean;
}
const EMPTY: SectionSnapshot<SectionId> = { result: null, fetchedAt: null, failure: null };
const entries = new Map<SectionId, Entry>();

function entry(id: SectionId): Entry {
  let found = entries.get(id);
  if (!found) { found = { snapshot: EMPTY, listeners: new Set(), timer: null, inflight: false, again: false }; entries.set(id, found); }
  return found;
}
function publish(e: Entry, snapshot: SectionSnapshot<SectionId>) {
  e.snapshot = snapshot;
  e.listeners.forEach((l) => l());
}

async function load(id: SectionId) {
  const e = entry(id);
  if (e.inflight) { e.again = true; return; }
  e.inflight = true;
  try {
    const res = await fetch(`/api/admin/console/${id}`, { cache: "no-store" });
    if (res.status === 401) publish(e, { ...e.snapshot, failure: "unauthorized" });
    else if (res.status === 403 || res.status === 404) publish(e, { ...e.snapshot, failure: "forbidden" });
    else if (!res.ok) publish(e, { ...e.snapshot, failure: "unavailable" });
    else publish(e, { result: (await res.json()) as SectionResult<SectionDataMap[SectionId]>, fetchedAt: Date.now(), failure: null });
  } catch {
    publish(e, { ...e.snapshot, failure: "unavailable" });
  } finally {
    e.inflight = false;
    if (e.again) { e.again = false; void load(id); }
  }
}

/** Ask for a fresh answer now, for example after an Approve click. Safe to call from any panel. */
export function refreshSection(id: SectionId): void {
  void load(id);
}

/**
 * One shared poll per section, however many components read it (a panel and the summary strip both do).
 * The poll stops while no component reads it and while the tab is hidden, and runs once when the tab shows again.
 */
export function useAdminSection<K extends SectionId>(id: K): SectionSnapshot<K> & { reload: () => void } {
  const subscribe = useCallback((listener: () => void) => {
    const e = entry(id);
    e.listeners.add(listener);
    if (e.listeners.size === 1) {
      void load(id);
      e.timer = setInterval(() => { if (document.visibilityState === "visible") void load(id); }, POLL_MS[id]);
    }
    return () => {
      e.listeners.delete(listener);
      if (e.listeners.size === 0 && e.timer) { clearInterval(e.timer); e.timer = null; }
    };
  }, [id]);
  const snapshot = useSyncExternalStore(subscribe, () => entry(id).snapshot, () => EMPTY) as SectionSnapshot<K>;
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") void load(id); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [id]);
  const reload = useCallback(() => refreshSection(id), [id]);
  return { ...snapshot, reload };
}
