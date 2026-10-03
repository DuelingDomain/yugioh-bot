"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { RotateCw, Upload } from "lucide-react";
import type { DuelMode } from "@yugidraft/shared/duels";
import { Segmented, SectionHead, StatusLine, SvButton } from "@/components/sheet";
import { createSavedDeck, type SavedDeckView } from "./api";
import { MAX_IMPORT_FILE_BYTES, prepareDeckImport } from "./import";
import { modeLabel } from "./model";
import styles from "./library.module.css";

const MODE_CHOICES = [
  { value: "normal" as const, label: "Standard" },
  { value: "domain" as const, label: "Domain" },
] as const;

type ImportOutcome =
  | { state: "saved"; deck: SavedDeckView }
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
export function useDeckImport(onImported: (deck: SavedDeckView) => void) {
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
    <section className={styles.import} aria-labelledby="deck-import-title">
      <SectionHead
        id="deck-import-title"
        title="Import YDK files"
        action={<SvButton variant="quiet" onClick={onClose}>Close</SvButton>}
      />

      <div className={styles.importBody}>
        <label className={styles.drop} data-dragging={dragging ? "" : undefined}>
          <input
            type="file"
            accept=".ydk,.txt,text/plain"
            multiple
            className={styles.srOnly}
            aria-label="YDK files"
            onChange={(event) => {
              const files = event.target.files;
              if (files) importFiles(files, mode);
              event.target.value = "";
            }}
          />
          <Upload size={20} aria-hidden="true" />
          {dragging ? "Let go to import" : "Drop .ydk files here"}
          <small>{dragging ? "Every file saves as its own deck." : "or click to choose. You can pick many at once."}</small>
        </label>

        <div className={styles.saveAs}>
          <span className="label">Save as</span>
          <Segmented label="Save as" value={mode} options={MODE_CHOICES} onChange={setMode} />
          <p className={styles.hintText}>
            Each file becomes one saved deck, named after the file. A file with a #deckmaster section always saves as
            Domain. For Domain, a single Side card becomes the Deck Master.
          </p>
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <ul className={styles.results} aria-live="polite">
            {rows.map((row) => (
              <li key={row.key} data-st={row.state}>
                {row.state === "saving" ? <RotateCw size={16} className={styles.spin} aria-hidden="true" /> : null}
                <span className={styles.resFile}>{row.fileName}</span>
                {row.state === "saving" ? <span className={styles.resFacts}>Saving…</span> : null}
                {row.state === "saved" ? (
                  <>
                    <span className={styles.resFacts}>
                      <span>Saved as {row.deck.name}</span>
                      <span>{modeLabel(row.deck.mode)}</span>
                      <span>Main <b>{row.deck.deck.main.length}</b></span>
                      <span>Extra <b>{row.deck.deck.extra.length}</b></span>
                    </span>
                    <Link href={`/decks/${row.deck.id}`} className={styles.resLink}>Open</Link>
                  </>
                ) : null}
                {row.state === "failed" ? <StatusLine tone="block">{row.error}</StatusLine> : null}
              </li>
            ))}
          </ul>
          {finished ? (
            <div className={styles.resFoot}>
              <SvButton variant="quiet" onClick={clearFinished}>Clear list</SvButton>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
