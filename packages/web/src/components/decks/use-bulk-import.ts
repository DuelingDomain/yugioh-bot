"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IMPORT_MAX_DECKS,
  bulkImportDecks,
  previewDeckImport,
  type ImportMode,
  type ImportPreview,
  type ImportSource,
} from "./import-api";
import { DeckRequestError } from "./api";
import {
  hasErrors,
  highestImportedNumber,
  pasteSource,
  rowSource,
  renumberImported,
  readSources,
  selectedItems,
  tagSources,
  toBulkRows,
  toItems,
  type PreviewItem,
  type SourceBatch,
} from "./bulk-import";

export type ImportTab = "files" | "paste";

/** The decks the last import created. They are no longer in the list; this is what the person sees instead. */
export type ImportOutcome = { created: Array<{ id: number; name: string }>; failedCount: number };

export type ImportView =
  | { phase: "idle" }
  | { phase: "loading"; items: PreviewItem[]; maxDecks: number; outcome: ImportOutcome | null }
  | { phase: "preview"; items: PreviewItem[]; maxDecks: number; outcome: ImportOutcome | null }
  | { phase: "importing"; items: PreviewItem[]; maxDecks: number; outcome: ImportOutcome | null }
  | { phase: "done"; outcome: ImportOutcome };

export type BulkImporter = ReturnType<typeof useBulkImport>;

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/** The rows already on screen, which a new pick is added to. */
function current(view: ImportView): { items: PreviewItem[]; maxDecks: number; outcome: ImportOutcome | null } {
  return view.phase === "preview" || view.phase === "loading" || view.phase === "importing"
    ? { items: view.items, maxDecks: view.maxDecks, outcome: view.outcome }
    : { items: [], maxDecks: IMPORT_MAX_DECKS, outcome: null };
}

/**
 * The library import: pick files or paste text, preview the decks the server found, then save the checked
 * ones. A new pick is added to the rows on screen, so name edits and checks stay. After an import the created
 * rows leave the list and the failed rows stay for a retry. `onImported` runs after any deck was created so
 * the library can refresh its list.
 */
export function useBulkImport(onImported: () => void) {
  const [tab, setTab] = useState<ImportTab>("files");
  const [mode, setMode] = useState<ImportMode>("standard");
  const [view, setView] = useState<ImportView>({ phase: "idle" });
  /** Why the preview or the import call failed. The preview, if any, stays on screen. */
  const [error, setError] = useState<string | null>(null);
  /** Files left out before the call, with the reason. */
  const [notes, setNotes] = useState<string[]>([]);
  /** Counts up on reset and unmount, so a reply for a list that is gone is dropped. */
  const epoch = useRef(0);
  const batch = useRef(0);
  /** The highest "Imported deck N" number given out, so a later pick counts on from it. */
  const imported = useRef(0);
  /** Picks that wait for or run in the queue. */
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const importing = useRef(false);
  /** Picks the server turned down with a 429 or a 503, to send again on request. */
  const held = useRef<Array<{ picked: SourceBatch; mode: ImportMode }>>([]);
  const [heldCount, setHeldCount] = useState(0);
  /** Every source sent so far, by its batch id, so one row can be checked again. */
  const known = useRef(new Map<string, ImportSource>());
  /** The view as last drawn, for work that runs after an await. */
  const shown = useRef<ImportView>({ phase: "idle" });
  const notify = useRef(onImported);
  notify.current = onImported;
  const modeNow = useRef(mode);
  modeNow.current = mode;
  shown.current = view;
  useEffect(() => () => { epoch.current += 1; }, []);

  /**
   * Work that calls the server runs one task after the other, so a second pick never throws the first away.
   * The view shows "loading" until the queue is empty, then goes back to the list (or to nothing). Resolves
   * true when the task says it changed the list.
   */
  const enqueue = useCallback((task: (live: () => boolean) => Promise<boolean>): Promise<boolean> => {
    const mine = epoch.current;
    pending.current += 1;
    setError(null);
    setView((state) => ({ phase: "loading", ...current(state) }));
    const run = async (): Promise<boolean> => {
      try {
        return await task(() => mine === epoch.current);
      } catch (reason: unknown) {
        if (mine === epoch.current) setError(message(reason, "Could not read these files."));
        return false;
      } finally {
        pending.current -= 1;
        if (mine === epoch.current) {
          const more = pending.current > 0;
          setView((state) => {
            if (state.phase !== "loading") return state;
            const kept = current(state);
            if (more) return { phase: "loading", ...kept };
            return kept.items.length > 0 ? { phase: "preview", ...kept } : { phase: "idle" };
          });
        }
      }
    };
    const result = queue.current.then(run, run);
    queue.current = result;
    return result;
  }, []);

  /**
   * A pick while an import runs is refused with a note: the import reply must reach the list. When the server
   * turns a pick down (a rate limit, the card check down) the pick is kept, and `retryHeld` sends it again.
   */
  const preview = useCallback((read: () => Promise<SourceBatch> | SourceBatch, forMode?: ImportMode): Promise<boolean> => {
    if (importing.current) {
      setNotes(["Wait for the import to finish, then add more decks."]);
      return Promise.resolve(false);
    }
    const requested = forMode ?? modeNow.current;
    setNotes([]);
    return enqueue(async (live) => {
      const picked = await read();
      if (!live()) return false;
      const { sources, notes: skipped } = picked;
      setNotes(skipped);
      if (sources.length === 0) {
        if (skipped.length === 0) setError("There is nothing to import.");
        return false;
      }
      batch.current += 1;
      const tagged = tagSources(sources, batch.current, requested);
      let found: ImportPreview;
      try {
        found = await previewDeckImport(tagged);
      } catch (reason: unknown) {
        if (live() && reason instanceof DeckRequestError && (reason.status === 429 || reason.status === 503)) {
          held.current.push({ picked, mode: requested });
          setHeldCount(held.current.length);
        }
        throw reason;
      }
      if (!live()) return false;
      for (const source of tagged) known.current.set(source.id, source);
      // The numbering is worked out here, not in the state update, because React may run an update twice.
      const base = Math.max(imported.current, highestImportedNumber(current(shown.current).items));
      const renamed = renumberImported(found.rows, base);
      imported.current = renamed.top;
      const added = toItems(renamed.rows, requested);
      const more = pending.current > 1;
      setView((state) => {
        const kept = current(state);
        return {
          phase: more ? "loading" : "preview",
          items: [...kept.items, ...added],
          maxDecks: found.maxDecks,
          outcome: kept.outcome,
        };
      });
      return true;
    });
  }, [enqueue]);

  /** Sends the picks again that the server turned down, one after the other, in their first order. */
  const retryHeld = useCallback(() => {
    if (importing.current) return;
    const again = held.current;
    held.current = [];
    setHeldCount(0);
    setError(null);
    for (const { picked, mode: was } of again) void preview(() => picked, was);
  }, [preview]);

  /** Gives up the picks the server turned down. */
  const dropHeld = useCallback(() => {
    held.current = [];
    setHeldCount(0);
  }, []);

  /**
   * Checks one row again, for a row that stopped at the lookup limit. Only that row's own text goes to the
   * server, not the rest of its source.
   */
  const recheck = useCallback((rowId: string) => {
    const item = current(shown.current).items.find((entry) => entry.row.rowId === rowId);
    const whole = item ? known.current.get(item.row.sourceId) : undefined;
    if (!item || !whole || importing.current) return Promise.resolve(false);
    const { source, line } = rowSource(whole, rowId);
    return enqueue(async (live) => {
      const found = await previewDeckImport([source]);
      if (!live()) return false;
      const only = found.rows[0];
      if (!only) return false;
      const withLine = <T extends { line?: number }>(issues: T[]): T[] => (
        line == null ? issues : issues.map((issue) => (issue.line == null ? issue : { ...issue, line }))
      );
      // Only the checked data changes. The row keeps its id, name and mode, and the person's checkbox stays.
      const fresh = {
        ...only,
        rowId,
        sourceId: item.row.sourceId,
        name: item.row.name,
        errors: withLine(only.errors),
        warnings: withLine(only.warnings),
        duplicateOf: only.duplicateOf ?? item.row.duplicateOf ?? null,
      };
      setView((state) => {
        const kept = current(state);
        const items = kept.items.map((entry) => (entry.row.rowId !== rowId ? entry : {
          ...entry,
          row: fresh,
          selected: entry.selected || (!hasErrors(fresh) && !fresh.duplicateOf),
          failure: null,
        }));
        return { phase: "loading", ...kept, items };
      });
      return true;
    });
  }, [enqueue]);

  const previewFiles = useCallback((list: FileList | File[]) => {
    const files = Array.from(list);
    if (files.length === 0) return;
    setTab("files");
    void preview(() => readSources(files));
  }, [preview]);

  const previewPaste = useCallback((text: string) => preview(() => pasteSource(text)), [preview]);

  const update = useCallback((change: (items: PreviewItem[]) => PreviewItem[]) => {
    setView((state) => (state.phase === "preview" ? { ...state, items: change(state.items) } : state));
  }, []);

  const rename = useCallback((rowId: string, name: string) => {
    update((items) => items.map((item) => (item.row.rowId === rowId ? { ...item, name } : item)));
  }, [update]);

  const toggle = useCallback((rowId: string) => {
    update((items) => items.map((item) => (
      item.row.rowId === rowId && !hasErrors(item.row) ? { ...item, selected: !item.selected } : item
    )));
  }, [update]);

  /** Checks every row that can be imported, or clears them all when they are all checked already. */
  const toggleAll = useCallback(() => {
    update((items) => {
      const usable = items.filter((item) => !hasErrors(item.row));
      const next = !usable.every((item) => item.selected);
      return items.map((item) => (hasErrors(item.row) ? item : { ...item, selected: next }));
    });
  }, [update]);

  const importSelected = useCallback(async () => {
    // One call to the server at a time: never import while a preview is still running.
    if (view.phase !== "preview" || importing.current || pending.current > 0) return;
    const { items, maxDecks } = view;
    const chosen = selectedItems(items);
    if (chosen.length === 0) return;
    const rows = toBulkRows(items);
    const mine = epoch.current;
    importing.current = true;
    setError(null);
    setView({ phase: "importing", items, maxDecks, outcome: view.outcome });
    try {
      const result = await bulkImportDecks(rows);
      if (mine !== epoch.current) return;
      // `failed[].index` counts the rows that were sent, which are the chosen rows in order.
      const reasons = new Map<string, string>();
      for (const failure of result.failed) {
        const item = chosen[failure.index];
        if (!item) continue;
        reasons.set(
          item.row.rowId,
          failure.errors.length > 0 ? failure.errors.map((issue) => issue.message).join(" ") : "The server refused this deck.",
        );
      }
      const sent = new Set(chosen.map((item) => item.row.rowId));
      const left = items
        .filter((item) => !sent.has(item.row.rowId) || reasons.has(item.row.rowId))
        .map((item) => (reasons.has(item.row.rowId) ? { ...item, selected: true, failure: reasons.get(item.row.rowId) ?? null } : item));
      const outcome: ImportOutcome = { created: result.created, failedCount: reasons.size };
      setView(left.length > 0 ? { phase: "preview", items: left, maxDecks, outcome } : { phase: "done", outcome });
      if (result.created.length > 0) notify.current();
    } catch (reason: unknown) {
      if (mine !== epoch.current) return;
      setView({ phase: "preview", items, maxDecks, outcome: view.outcome });
      setError(message(reason, "Could not import these decks."));
    } finally {
      importing.current = false;
    }
  }, [view]);

  const reset = useCallback(() => {
    epoch.current += 1;
    imported.current = 0;
    held.current = [];
    known.current.clear();
    setHeldCount(0);
    setView({ phase: "idle" });
    setError(null);
    setNotes([]);
  }, []);

  return {
    tab, setTab, mode, setMode, view, error, notes, heldCount,
    previewFiles, previewPaste, retryHeld, dropHeld, recheck, rename, toggle, toggleAll, importSelected, reset,
  };
}
