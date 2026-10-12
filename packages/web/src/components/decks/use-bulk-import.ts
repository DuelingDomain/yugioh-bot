"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bulkImportDecks,
  previewDeckImport,
  type BulkImportResult,
  type ImportPreview,
} from "./import-api";
import {
  hasErrors,
  pasteSource,
  readSources,
  selectedItems,
  toBulkRows,
  toItems,
  type PreviewItem,
  type SourceBatch,
} from "./bulk-import";

export type ImportTab = "files" | "paste";

export type ImportView =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "preview"; items: PreviewItem[]; maxDecks: number }
  | { phase: "importing"; items: PreviewItem[]; maxDecks: number }
  | { phase: "done"; names: string[]; result: BulkImportResult };

export type BulkImporter = ReturnType<typeof useBulkImport>;

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/**
 * The library import: pick files or paste text, preview the decks the server found, then save the checked
 * ones. `onImported` runs after any deck was created so the library can refresh its list.
 */
export function useBulkImport(onImported: () => void) {
  const [tab, setTab] = useState<ImportTab>("files");
  const [view, setView] = useState<ImportView>({ phase: "idle" });
  /** Why the preview or the import call failed. The preview, if any, stays on screen. */
  const [error, setError] = useState<string | null>(null);
  /** Files left out before the call, with the reason. */
  const [notes, setNotes] = useState<string[]>([]);
  const latest = useRef(0);
  const notify = useRef(onImported);
  notify.current = onImported;
  useEffect(() => () => { latest.current += 1; }, []);

  const preview = useCallback(async (read: () => Promise<SourceBatch> | SourceBatch) => {
    const request = ++latest.current;
    setError(null);
    setNotes([]);
    setView({ phase: "loading" });
    try {
      const { sources, notes: skipped } = await read();
      if (request !== latest.current) return;
      setNotes(skipped);
      if (sources.length === 0) {
        setView({ phase: "idle" });
        if (skipped.length === 0) setError("There is nothing to import.");
        return;
      }
      const found: ImportPreview = await previewDeckImport(sources);
      if (request !== latest.current) return;
      setView({ phase: "preview", items: toItems(found.rows), maxDecks: found.maxDecks });
    } catch (reason: unknown) {
      if (request !== latest.current) return;
      setView({ phase: "idle" });
      setError(message(reason, "Could not read these files."));
    }
  }, []);

  const previewFiles = useCallback((list: FileList | File[]) => {
    const files = Array.from(list);
    if (files.length === 0) return;
    setTab("files");
    void preview(() => readSources(files));
  }, [preview]);

  const previewPaste = useCallback((text: string) => {
    void preview(() => pasteSource(text));
  }, [preview]);

  const update = useCallback((change: (items: PreviewItem[]) => PreviewItem[]) => {
    setView((current) => (current.phase === "preview" ? { ...current, items: change(current.items) } : current));
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
    const chosen = selectedItems(view.items);
    if (chosen.length === 0) return;
    const rows = toBulkRows(view.items);
    const request = ++latest.current;
    setError(null);
    setView({ phase: "importing", items: view.items, maxDecks: view.maxDecks });
    try {
      const result = await bulkImportDecks(rows);
      if (request !== latest.current) return;
      setView({ phase: "done", names: rows.map((row) => row.name), result });
      if (result.created.length > 0) notify.current();
    } catch (reason: unknown) {
      if (request !== latest.current) return;
      setView({ phase: "preview", items: view.items, maxDecks: view.maxDecks });
      setError(message(reason, "Could not import these decks."));
    }
  }, [view]);

  const reset = useCallback(() => {
    latest.current += 1;
    setView({ phase: "idle" });
    setError(null);
    setNotes([]);
  }, []);

  return { tab, setTab, view, error, notes, previewFiles, previewPaste, rename, toggle, toggleAll, importSelected, reset };
}
