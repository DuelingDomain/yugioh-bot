"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IMPORT_MAX_DECKS,
  bulkImportDecks,
  previewDeckImport,
  type ImportMode,
  type ImportPreview,
} from "./import-api";
import {
  hasErrors,
  pasteSource,
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
export type ImportOutcome = { created: Array<{ id: number; name: string }> };

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
  const latest = useRef(0);
  const batch = useRef(0);
  const notify = useRef(onImported);
  notify.current = onImported;
  const modeNow = useRef(mode);
  modeNow.current = mode;
  useEffect(() => () => { latest.current += 1; }, []);

  /** Resolves true when new rows were added, so the paste box knows it can clear. */
  const preview = useCallback(async (read: () => Promise<SourceBatch> | SourceBatch): Promise<boolean> => {
    const request = ++latest.current;
    const requested = modeNow.current;
    const back = (state: ImportView): ImportView => {
      const kept = current(state);
      return kept.items.length > 0 ? { phase: "preview", ...kept } : { phase: "idle" };
    };
    setError(null);
    setNotes([]);
    setView((state) => ({ phase: "loading", ...current(state) }));
    try {
      const { sources, notes: skipped } = await read();
      if (request !== latest.current) return false;
      setNotes(skipped);
      if (sources.length === 0) {
        setView(back);
        if (skipped.length === 0) setError("There is nothing to import.");
        return false;
      }
      batch.current += 1;
      const found: ImportPreview = await previewDeckImport(tagSources(sources, batch.current, requested));
      if (request !== latest.current) return false;
      const added = toItems(found.rows, requested);
      setView((state) => {
        const kept = current(state);
        return { phase: "preview", items: [...kept.items, ...added], maxDecks: found.maxDecks, outcome: kept.outcome };
      });
      return true;
    } catch (reason: unknown) {
      if (request !== latest.current) return false;
      setView(back);
      setError(message(reason, "Could not read these files."));
      return false;
    }
  }, []);

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
    if (view.phase !== "preview") return;
    const { items, maxDecks } = view;
    const chosen = selectedItems(items);
    if (chosen.length === 0) return;
    const rows = toBulkRows(items);
    const request = ++latest.current;
    setError(null);
    setView({ phase: "importing", items, maxDecks, outcome: view.outcome });
    try {
      const result = await bulkImportDecks(rows);
      if (request !== latest.current) return;
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
      const outcome: ImportOutcome = { created: result.created };
      setView(left.length > 0 ? { phase: "preview", items: left, maxDecks, outcome } : { phase: "done", outcome });
      if (result.created.length > 0) notify.current();
    } catch (reason: unknown) {
      if (request !== latest.current) return;
      setView({ phase: "preview", items, maxDecks, outcome: view.outcome });
      setError(message(reason, "Could not import these decks."));
    }
  }, [view]);

  const reset = useCallback(() => {
    latest.current += 1;
    setView({ phase: "idle" });
    setError(null);
    setNotes([]);
  }, []);

  return {
    tab, setTab, mode, setMode, view, error, notes,
    previewFiles, previewPaste, rename, toggle, toggleAll, importSelected, reset,
  };
}
