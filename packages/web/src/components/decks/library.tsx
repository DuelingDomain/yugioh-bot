"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { Check, FileUp, Layers, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import type { SavedDeck } from "@yugidraft/shared/duels";
import { SheetRoot } from "@/components/sheet";
import { cardArtUrl } from "@/components/duel/constants";
import { deleteSavedDeck, listSavedDecks } from "./api";
import { DeckImportPanel, useDeckImport } from "./import-panel";
import { deckFanCodes, deckStatus } from "./library-status";
import { formatWhen, modeLabel } from "./model";
import styles from "./library.module.css";

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function DeckRow({
  deck,
  confirming,
  busy,
  deleteError,
  onAskDelete,
  onDelete,
  onKeep,
}: {
  deck: SavedDeck;
  confirming: boolean;
  busy: boolean;
  deleteError: string | null;
  onAskDelete: () => void;
  onDelete: () => void;
  onKeep: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
  }, [confirming]);
  const status = deckStatus(deck);
  const fan = deckFanCodes(deck.deck);
  return (
    <li className={`cb-row ${styles.row}`} data-confirm={confirming || undefined}>
      <span className="cb-fan" aria-hidden="true">
        {fan.map((code) => (
          <img key={code} src={cardArtUrl(code, "small")} alt="" loading="lazy" decoding="async" />
        ))}
      </span>
      <div>
        <p className="nm-line">
          <Link className={`nm ${styles.openLink}`} href={`/decks/${deck.id}`}>
            {deck.name}
          </Link>
          <span className={`chip${deck.mode === "domain" ? " chip-gold" : ""}`}>{modeLabel(deck.mode)}</span>
        </p>
        <p className="mt">
          <span>
            Main <b>{deck.deck.main.length}</b> · Extra <b>{deck.deck.extra.length}</b> · Side{" "}
            <b>{deck.deck.side.length}</b>
            {deck.deck.deckMaster != null ? " · Master" : ""}
          </span>
          <span className="dot" />
          <span>Updated {formatWhen(deck.updatedAt)}</span>
        </p>
        {deck.draftId != null ? (
          <p className="tags">
            <span className="chip">
              <Layers className="ic" aria-hidden="true" />
              Made in a draft
            </span>
            <span>Only cards you drafted</span>
          </p>
        ) : null}
      </div>
      <div className="cb-ready">
        <span className={`l ${status.ok ? "ok" : "short"}`}>
          {status.ok ? <Check className="ic" aria-hidden="true" /> : <TriangleAlert className="ic" aria-hidden="true" />}
          {status.head}
        </span>
        {status.rest != null || status.more > 0 ? (
          <span>
            {status.rest}
            {status.more > 0 ? (
              <span className="more">
                {status.rest != null ? " · " : ""}
                {status.more} more {status.more === 1 ? "note" : "notes"}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {confirming ? (
        <div className={`cb-confirm ${styles.confirm}`} role="group" aria-label={`Delete ${deck.name}`}>
          <span>Delete {deck.name}? This can&apos;t be undone.</span>
          {deleteError ? (
            <span className={styles.why} role="alert">
              {deleteError}
            </span>
          ) : null}
          <button className="btn btn-danger btn-sm" type="button" disabled={busy} onClick={onDelete}>
            Delete
          </button>
          <button ref={keepRef} className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={onKeep}>
            Keep
          </button>
        </div>
      ) : (
        <div className="cb-acts">
          <Link className="btn btn-secondary btn-sm" href={`/decks/${deck.id}`} aria-label={`Open ${deck.name}`}>
            Open
          </Link>
          <button className="ib danger" type="button" aria-label={`Delete ${deck.name}`} disabled={busy} onClick={onAskDelete}>
            <Trash2 className="ic" aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
  );
}

export function SavedDeckLibrary() {
  const [decks, setDecks] = useState<SavedDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const onImported = useCallback((deck: SavedDeck) => {
    // While the first list load is in flight, that load picks the new deck up.
    setDecks((current) => (current == null ? current : [deck, ...current.filter((item) => item.id !== deck.id)]));
  }, []);
  const importer = useDeckImport(onImported);

  const load = useCallback(() => {
    setError(null);
    void listSavedDecks().then(
      (saved) => {
        const ordered = saved.toSorted((a, b) => {
          if (a.updatedAt === b.updatedAt) return b.id - a.id;
          return a.updatedAt < b.updatedAt ? 1 : -1;
        });
        setDecks(ordered);
      },
      (reason: unknown) => {
        setDecks(null);
        setError(reason instanceof Error ? reason.message : "Could not load saved decks.");
      },
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmDelete(deck: SavedDeck) {
    if (busyId != null) return;
    setBusyId(deck.id);
    setDeleteError(null);
    try {
      await deleteSavedDeck(deck.id);
      setPendingId(null);
      setDecks((current) => current?.filter((item) => item.id !== deck.id) ?? null);
    } catch (reason: unknown) {
      setDeleteError(reason instanceof Error ? reason.message : "Could not delete that deck.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SheetRoot
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setImportOpen(true);
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        setImportOpen(true);
        importer.importFiles(event.dataTransfer.files, importer.mode);
      }}
    >
      <header className="page-h sheet-head">
        <div>
          <h1 className="t-title">Decks</h1>
          <p className="page-sub">
            Private lists you can import at a table. Saving here does not make a deck legal for a duel.
          </p>
        </div>
        <div className={styles.headActions}>
          <button
            className="btn btn-secondary"
            type="button"
            aria-expanded={importOpen}
            onClick={() => setImportOpen((open) => !open)}
          >
            <FileUp className="ic sm" aria-hidden="true" />
            Import YDK
          </button>
          <Link href="/decks/new" className="btn btn-primary">
            <Plus className="ic sm" aria-hidden="true" />
            New deck
          </Link>
        </div>
      </header>

      {importOpen ? (
        <DeckImportPanel importer={importer} dragging={dragging} onClose={() => setImportOpen(false)} />
      ) : null}

      {decks == null && !error ? (
        <div className="cb-list" aria-busy="true" aria-label="Loading saved decks">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`cb-row ${styles.row}`}>
              <span className="sk" style={{ width: 64, height: 64 }} />
              <div style={{ display: "grid", gap: 10 }}>
                <span className="sk" style={{ width: "42%", height: 14 }} />
                <span className="sk" style={{ width: "66%" }} />
              </div>
              <span className="cb-ready">
                <span className="sk" style={{ width: "80%" }} />
              </span>
              <span className="cb-acts">
                <span className="sk" style={{ width: 64, height: 30 }} />
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="banner banner-bad" role="alert">
          <TriangleAlert className="ic" aria-hidden="true" />
          <div>{error}</div>
          <button className="btn btn-secondary btn-sm" type="button" style={{ marginLeft: "auto" }} onClick={load}>
            <RotateCcw className="ic sm" aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : null}

      {decks && decks.length === 0 ? (
        <div className="empty" style={{ padding: "36px 20px" }}>
          <FileUp className="ic" aria-hidden="true" />
          <h2>No saved decks yet</h2>
          <p>
            Import your YDK files or build a list, and reuse it when you sit down at a table. You can also drop .ydk
            files anywhere on this page.
          </p>
          <div className="acts">
            <button className="btn btn-primary" type="button" onClick={() => setImportOpen(true)}>
              <FileUp className="ic sm" aria-hidden="true" />
              Import YDK files
            </button>
            <Link href="/decks/new" className="btn btn-secondary">
              <Plus className="ic sm" aria-hidden="true" />
              Create a deck
            </Link>
          </div>
        </div>
      ) : null}

      {decks && decks.length > 0 ? (
        <>
          <ul className="cb-list" aria-label="Saved decks">
            {decks.map((deck) => (
              <DeckRow
                key={deck.id}
                deck={deck}
                confirming={pendingId === deck.id}
                busy={busyId != null}
                deleteError={pendingId === deck.id ? deleteError : null}
                onAskDelete={() => {
                  setPendingId(deck.id);
                  setDeleteError(null);
                }}
                onDelete={() => void confirmDelete(deck)}
                onKeep={() => {
                  setPendingId(null);
                  setDeleteError(null);
                }}
              />
            ))}
          </ul>
          <p className="dk-foot">Sizes only. The table checks the banlist and copy limits when you ready up.</p>
        </>
      ) : null}
    </SheetRoot>
  );
}
