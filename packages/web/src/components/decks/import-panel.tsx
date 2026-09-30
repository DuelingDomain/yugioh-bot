"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, FileUp, Loader2 } from "lucide-react";
import type { DuelMode, SavedDeck } from "@yugidraft/shared/duels";
import { cx, SheetButton, SheetSegmented } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { createSavedDeck } from "./api";
import { MAX_IMPORT_FILE_BYTES, prepareDeckImport } from "./import";
import { modeLabel } from "./model";
import styles from "./library.module.css";

const MODE_CHOICES = [
  { value: "normal" as const, label: "Standard" },
  { value: "domain" as const, label: "Domain" },
] as const;

type ImportOutcome =
  | { state: "saved"; deck: SavedDeck }
  | { state: "failed"; error: string };

type ImportRow = { key: number; fileName: string } & ({ state: "saving" } | ImportOutcome);

async function importOne(file: File, mode: DuelMode): Promise<ImportOutcome> {
  try {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error("This file is too large to be a YDK deck.");
    }
    const prepared = prepareDeckImport(await file.text(), file.name, mode);
    return { state: "saved", deck: await createSavedDeck(prepared) };
  } catch (reason: unknown) {
    return { state: "failed", error: reason instanceof Error ? reason.message : "Could not import this file." };
  }
}

export type DeckImporter = ReturnType<typeof useDeckImport>;

/** Saves each dropped file as its own deck, one at a time, in drop order. */
export function useDeckImport(onImported: (deck: SavedDeck) => void) {
  const [mode, setMode] = useState<DuelMode>("normal");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const nextKey = useRef(1);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const importFiles = useCallback((list: FileList | File[], modeForFiles: DuelMode) => {
    const entries = Array.from(list).map((file) => ({ key: nextKey.current++, file }));
    if (entries.length === 0) return;
    setRows((current) => [
      ...entries.map(({ key, file }): ImportRow => ({ key, fileName: file.name, state: "saving" })),
      ...current,
    ]);
    chain.current = chain.current.then(async () => {
      for (const { key, file } of entries) {
        const outcome = await importOne(file, modeForFiles);
        setRows((current) => current.map((row) => (row.key === key ? { key, fileName: file.name, ...outcome } : row)));
        if (outcome.state === "saved") onImported(outcome.deck);
      }
    });
  }, [onImported]);

  const clearFinished = useCallback(() => {
    setRows((current) => current.filter((row) => row.state === "saving"));
  }, []);

  return { mode, setMode, rows, importFiles, clearFinished };
}

export function DeckImportPanel({
  importer,
  dragging,
  onClose,
}: {
  importer: DeckImporter;
  dragging: boolean;
  onClose: () => void;
}) {
  const { mode, setMode, rows, importFiles, clearFinished } = importer;
  const saving = rows.some((row) => row.state === "saving");
  const finished = rows.length > 0 && !saving;

  return (
    <section className={styles.importPanel} aria-labelledby="deck-import-title">
      <div className={styles.importHead}>
        <h2 id="deck-import-title" className={styles.importTitle}>Import YDK files</h2>
        <SheetButton kind="quiet" size="sm" onClick={onClose}>Close</SheetButton>
      </div>

      <div className={styles.importBody}>
        <label className={styles.drop} data-dragging={dragging ? "true" : undefined}>
          <input
            type="file"
            accept=".ydk,.txt,text/plain"
            multiple
            className={ui.srOnly}
            aria-label="YDK files"
            onChange={(event) => {
              const files = event.target.files;
              if (files) importFiles(files, mode);
              event.target.value = "";
            }}
          />
          <FileUp size={22} strokeWidth={1.4} aria-hidden />
          <span className={styles.dropTitle}>Drop .ydk files here</span>
          <span className={styles.dropHint}>or click to choose. You can pick many at once.</span>
        </label>

        <div className={styles.importOptions}>
          <SheetSegmented label="Save as" value={mode} choices={MODE_CHOICES} onChange={setMode} />
          <p className={ui.hint}>
            Each file becomes one saved deck, named after the file. A file with a #deckmaster section always
            saves as Domain. For Domain, a single Side card becomes the Deck Master.
          </p>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className={styles.results}>
          <ul className={styles.resultList} aria-live="polite">
            {rows.map((row) => (
              <li key={row.key} className={styles.result} data-state={row.state}>
                <span className={styles.resultIcon} aria-hidden>
                  {row.state === "saving" ? <Loader2 size={15} className={ui.spin} /> : null}
                  {row.state === "saved" ? <Check size={15} /> : null}
                  {row.state === "failed" ? <AlertTriangle size={15} /> : null}
                </span>
                <span className={styles.resultMain}>
                  <span className={styles.resultFile}>{row.fileName}</span>
                  {row.state === "saving" ? <span className={styles.resultNote}>Saving…</span> : null}
                  {row.state === "saved" ? (
                    <span className={styles.resultNote}>
                      Saved as {row.deck.name} · {modeLabel(row.deck.mode)} · Main{" "}
                      <b className={ui.num}>{row.deck.deck.main.length}</b> · Extra{" "}
                      <b className={ui.num}>{row.deck.deck.extra.length}</b>
                    </span>
                  ) : null}
                  {row.state === "failed" ? <span className={cx(styles.resultNote, ui.alert)}>{row.error}</span> : null}
                </span>
                {row.state === "saved" ? (
                  <Link href={`/decks/${row.deck.id}`} className={styles.resultOpen}>
                    Open
                    <ArrowRight size={14} strokeWidth={1.6} aria-hidden />
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          {finished ? (
            <SheetButton kind="quiet" size="sm" onClick={clearFinished}>Clear list</SheetButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
