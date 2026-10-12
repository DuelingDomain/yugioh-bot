"use client";

import { useState } from "react";
import Link from "next/link";
import { RotateCw, Upload } from "lucide-react";
import { Segmented, SectionHead, StatusLine, SvButton } from "@/components/sheet";
import type { BulkImportResult } from "./import-api";
import { ImportPreviewList } from "./import-preview";
import type { BulkImporter, ImportTab } from "./use-bulk-import";
import styles from "./library.module.css";

export type DeckImporter = BulkImporter;

const TABS = [
  { value: "files" as const, label: "Files" },
  { value: "paste" as const, label: "Paste" },
] satisfies ReadonlyArray<{ value: ImportTab; label: string }>;

const PASTE_EXAMPLE = "ydke://o6lXBQ==!!!";

function ImportResult({ names, result, onMore, onClose }: {
  names: string[];
  result: BulkImportResult;
  onMore: () => void;
  onClose: () => void;
}) {
  const { created, failed } = result;
  return (
    <div className={styles.pvDone} role="status">
      {created.length > 0 ? (
        <StatusLine tone="ready">
          {created.length === 1 ? "1 deck was created." : `${created.length} decks were created.`}
        </StatusLine>
      ) : null}
      {created.length > 0 ? (
        <ul className={styles.results} aria-label="Created decks">
          {created.map((deck) => (
            <li key={deck.id}>
              <span className={styles.resFile}>{deck.name}</span>
              <Link href={`/decks/${deck.id}`} className={styles.resLink} aria-label={`Open ${deck.name}`}>Open</Link>
            </li>
          ))}
        </ul>
      ) : null}
      {failed.length > 0 ? (
        <>
          <StatusLine tone="block">
            {failed.length === 1 ? "1 deck could not be created." : `${failed.length} decks could not be created.`}
          </StatusLine>
          <ul className={styles.results} aria-label="Decks that failed">
            {failed.map((item) => (
              <li key={item.index} data-st="failed">
                <span className={styles.resFile}>{names[item.index] ?? `Deck ${item.index + 1}`}</span>
                <span className={styles.resFacts}>
                  {item.errors.length > 0 ? item.errors.map((issue) => issue.message).join(" ") : "The server refused this deck."}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {created.length === 0 && failed.length === 0 ? <StatusLine tone="neutral">Nothing was imported.</StatusLine> : null}
      <div className={styles.resFoot}>
        <SvButton variant="quiet" onClick={onMore}>Import more</SvButton>
        <SvButton variant="ghost" onClick={onClose}>Done</SvButton>
      </div>
    </div>
  );
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
  const { tab, setTab, view, error, notes, previewFiles, previewPaste, rename, toggle, toggleAll, importSelected, reset } = importer;
  const [paste, setPaste] = useState("");
  const busy = view.phase === "loading" || view.phase === "importing";
  const showSource = view.phase === "idle" || view.phase === "loading";

  return (
    <section className={styles.import} aria-labelledby="deck-import-title">
      <SectionHead
        id="deck-import-title"
        title="Import decks"
        action={<SvButton variant="quiet" onClick={onClose}>Close</SvButton>}
      />

      {showSource ? (
        <div className={styles.importSource}>
          <Segmented label="Import from" value={tab} options={TABS} disabled={busy} onChange={setTab} />

          {tab === "files" ? (
            <label className={styles.drop} data-dragging={dragging ? "" : undefined} aria-busy={busy || undefined}>
              <input
                type="file"
                accept=".ydk,.ydke,.txt,text/plain"
                multiple
                className={styles.srOnly}
                aria-label="Deck files"
                disabled={busy}
                onChange={(event) => {
                  const files = event.target.files;
                  if (files) previewFiles(files);
                  event.target.value = "";
                }}
              />
              <Upload size={20} aria-hidden="true" />
              {dragging ? "Let go to preview" : "Drop .ydk or .ydke files here"}
              <small>{dragging ? "You can check every deck before it saves." : "or click to choose. You can pick many at once."}</small>
            </label>
          ) : (
            <div className={styles.pasteBox}>
              <label>
                <span className="label">YDK text or YDKE codes</span>
                <textarea
                  className="input"
                  rows={6}
                  spellCheck={false}
                  value={paste}
                  disabled={busy}
                  placeholder={`#main\n89631139\n...\n\nor\n\n${PASTE_EXAMPLE}`}
                  onChange={(event) => setPaste(event.target.value)}
                />
              </label>
              <p className={styles.hintText}>
                Paste one YDK list, or one <code>ydke://</code> code per line. Each code becomes its own deck. Example:{" "}
                <code>{PASTE_EXAMPLE}</code>
              </p>
              <div>
                <SvButton variant="primary" disabled={busy || !paste.trim()} onClick={() => previewPaste(paste)}>
                  Preview decks
                </SvButton>
              </div>
            </div>
          )}

          {view.phase === "loading" ? (
            <p className={styles.pvLoading} role="status">
              <RotateCw size={16} className={styles.spin} aria-hidden="true" />
              Checking the decks…
            </p>
          ) : null}
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className={styles.pvNotes} aria-label="Left out">
          {notes.map((note) => <li key={note}><StatusLine tone="warn">{note}</StatusLine></li>)}
        </ul>
      ) : null}

      {error ? (
        <div role="alert" className={styles.pvError}>
          <StatusLine tone="block">{error}</StatusLine>
        </div>
      ) : null}

      {view.phase === "preview" || view.phase === "importing" ? (
        <ImportPreviewList
          items={view.items}
          maxDecks={view.maxDecks}
          busy={view.phase === "importing"}
          onRename={rename}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onImport={() => void importSelected()}
          onCancel={reset}
        />
      ) : null}

      {view.phase === "done" ? (
        <ImportResult names={view.names} result={view.result} onMore={reset} onClose={onClose} />
      ) : null}
    </section>
  );
}
