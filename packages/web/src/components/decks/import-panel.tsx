"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, RotateCw, TriangleAlert, Upload } from "lucide-react";
import type { DuelMode, SavedDeck } from "@yugidraft/shared/duels";
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
    <section className="panel dk-imp" aria-labelledby="deck-import-title">
      <div className="dk-imp-h">
        <h2 id="deck-import-title">Import YDK files</h2>
        <button className="btn btn-quiet btn-sm" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="dk-imp-b">
        <label className={`dk-drop ${styles.drop}`} data-dragging={dragging ? "" : undefined}>
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
          <Upload className="ic" aria-hidden="true" />
          {dragging ? "Let go to import" : "Drop .ydk files here"}
          <small>{dragging ? "Every file saves as its own deck." : "or click to choose. You can pick many at once."}</small>
        </label>

        <div>
          <span className="label">Save as</span>
          <div className="seg" role="group" aria-label="Save as">
            {MODE_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                aria-pressed={mode === choice.value}
                onClick={() => setMode(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <p className="hint">
            Each file becomes one saved deck, named after the file. A file with a #deckmaster section always saves as
            Domain. For Domain, a single Side card becomes the Deck Master.
          </p>
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <ul className="dk-res" aria-live="polite">
            {rows.map((row) => (
              <li key={row.key} data-st={row.state}>
                {row.state === "saving" ? <RotateCw className={`ic ${styles.spin}`} aria-hidden="true" /> : null}
                {row.state === "saved" ? <Check className="ic" aria-hidden="true" /> : null}
                {row.state === "failed" ? <TriangleAlert className="ic" aria-hidden="true" /> : null}
                <div>
                  <p className="f">{row.fileName}</p>
                  {row.state === "saving" ? <p className="s">Saving…</p> : null}
                  {row.state === "saved" ? (
                    <p className="s">
                      Saved as {row.deck.name} · {modeLabel(row.deck.mode)} · Main <b>{row.deck.deck.main.length}</b> ·
                      Extra <b>{row.deck.deck.extra.length}</b>
                    </p>
                  ) : null}
                  {row.state === "failed" ? <p className="s">{row.error}</p> : null}
                </div>
                {row.state === "saved" ? (
                  <Link href={`/decks/${row.deck.id}`} className="link">
                    Open
                    <ArrowRight className="ic sm" aria-hidden="true" />
                  </Link>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
          {finished ? (
            <div className="dk-res-f" style={{ padding: "0 18px 12px" }}>
              <button className="btn btn-quiet btn-sm" type="button" onClick={clearFinished}>
                Clear list
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
