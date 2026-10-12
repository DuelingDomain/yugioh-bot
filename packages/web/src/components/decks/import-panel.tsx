"use client";

import { useState } from "react";
import Link from "next/link";
import { RotateCw, Upload } from "lucide-react";
import { Segmented, SectionHead, StatusLine, SvButton } from "@/components/sheet";
import { MODE_CHOICES } from "./bulk-import";
import { ImportPreviewList } from "./import-preview";
import type { BulkImporter, ImportOutcome, ImportTab } from "./use-bulk-import";
import styles from "./library.module.css";

export type DeckImporter = BulkImporter;

const TABS = [
  { value: "files" as const, label: "Files" },
  { value: "paste" as const, label: "Paste" },
] satisfies ReadonlyArray<{ value: ImportTab; label: string }>;

const PASTE_EXAMPLE = "ydke://o6lXBQ==!!!";

/** One live summary of the last import. The reason for each failed deck is under that deck in the list. */
function ImportCreated({ outcome }: { outcome: ImportOutcome }) {
  const { created, failedCount } = outcome;
  return (
    <div className={styles.pvDone} role="status" aria-live="polite">
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
      {failedCount > 0 ? (
        <StatusLine tone="block">
          {failedCount === 1 ? "1 deck could not be created." : `${failedCount} decks could not be created.`}
          {" "}The reason is under each deck below. You can try again.
        </StatusLine>
      ) : null}
    </div>
  );
}

function ImportDone({ outcome, onMore, onClose }: { outcome: ImportOutcome; onMore: () => void; onClose: () => void }) {
  return (
    <div className={styles.pvDone}>
      {outcome.created.length > 0 ? <ImportCreated outcome={outcome} /> : <StatusLine tone="neutral">Nothing was imported.</StatusLine>}
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
  const { tab, setTab, mode, setMode, view, error, notes, heldCount, previewFiles, previewPaste, retryHeld, recheck, rename, toggle, toggleAll, importSelected, reset } = importer;
  const [paste, setPaste] = useState("");
  const busy = view.phase === "loading" || view.phase === "importing";
  const showSource = view.phase === "idle" || view.phase === "loading" || view.phase === "preview";
  const items = view.phase === "idle" || view.phase === "done" ? [] : view.items;
  const maxDecks = view.phase === "idle" || view.phase === "done" ? 0 : view.maxDecks;
  const listed = view.phase === "preview" || view.phase === "importing" || (view.phase === "loading" && items.length > 0);
  const outcome = view.phase === "preview" || view.phase === "importing" || view.phase === "loading" ? view.outcome : null;

  return (
    <section className={styles.import} aria-labelledby="deck-import-title">
      <SectionHead
        id="deck-import-title"
        title="Import decks"
        action={<SvButton variant="quiet" onClick={onClose}>Close</SvButton>}
      />

      {showSource ? (
        <div className={styles.importSource}>
          <Segmented label="Save as" value={mode} options={MODE_CHOICES} disabled={busy} onChange={setMode} />
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
                <SvButton variant="primary" disabled={busy || !paste.trim()} onClick={() => void previewPaste(paste).then((added) => { if (added) setPaste(""); })}>
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
          {heldCount > 0 ? (
            <SvButton variant="quiet" disabled={busy} onClick={retryHeld}>
              {heldCount === 1 ? "Send the last pick again" : `Send the last ${heldCount} picks again`}
            </SvButton>
          ) : null}
        </div>
      ) : null}

      {outcome && (outcome.created.length > 0 || outcome.failedCount > 0) ? <ImportCreated outcome={outcome} /> : null}

      {listed ? (
        <ImportPreviewList
          items={items}
          maxDecks={maxDecks}
          busy={view.phase !== "preview"}
          onRename={rename}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onRecheck={recheck}
          onImport={() => void importSelected()}
          onCancel={reset}
        />
      ) : null}

      {view.phase === "done" ? <ImportDone outcome={view.outcome} onMore={reset} onClose={onClose} /> : null}
    </section>
  );
}
