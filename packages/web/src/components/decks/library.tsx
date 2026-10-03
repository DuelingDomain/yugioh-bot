"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { Check, FileUp, Plus, Trash2, TriangleAlert } from "lucide-react";
import { FloorList, FloorRow, StatusLine, SvButton, Zone } from "@/components/sheet";
import { cardArtUrl } from "@/components/duel/constants";
import { deleteSavedDeck, listSavedDecks, type SavedDeckView } from "./api";
import { DeckImportPanel, useDeckImport } from "./import-panel";
import { deckFanCodes, deckStatus } from "./library-status";
import { formatWhen, modeLabel } from "./model";
import { PageFrame } from "./page-frame";
import { RegistrationMark } from "./registration";
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
  deck: SavedDeckView;
  confirming: boolean;
  busy: boolean;
  deleteError: string | null;
  onAskDelete: () => void;
  onDelete: () => void;
  onKeep: () => void;
}) {
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.querySelector<HTMLElement>("[data-keep]")?.focus();
  }, [confirming]);
  const status = deckStatus(deck);
  const fan = deckFanCodes(deck.deck);
  const registered = deck.registration != null;
  const tone = status.ok ? (registered ? "ready" : "quiet") : "short";
  return (
    <FloorRow className={styles.row}>
      <span className={styles.fan} aria-hidden="true">
        {fan.length > 0 ? (
          <span className={styles.fanArt}>
            {fan.map((code) => (
              <img key={code} src={cardArtUrl(code, "small")} alt="" loading="lazy" decoding="async" />
            ))}
          </span>
        ) : (
          <Zone state="empty" size="md" />
        )}
      </span>
      <div className={styles.main}>
        <p className={styles.nameLine}>
          <Link className={styles.openLink} href={`/decks/${deck.id}`}>
            {deck.name}
          </Link>
          <span className={styles.mode}>{modeLabel(deck.mode)}</span>
        </p>
        <p className={styles.counts}>
          <span>Main <b>{deck.deck.main.length}</b></span>
          <span>Extra <b>{deck.deck.extra.length}</b></span>
          <span>Side <b>{deck.deck.side.length}</b></span>
          {deck.deck.deckMaster != null ? <span>Master</span> : null}
          <span className={styles.when}>Updated {formatWhen(deck.updatedAt)}</span>
        </p>
        {deck.draftId != null ? <p className={styles.draftTag}>Made in a draft. Only cards you drafted.</p> : null}
        {registered ? <RegistrationMark registration={deck.registration} className={styles.mark} /> : null}
      </div>
      <div className={styles.status} data-tone={tone}>
        <p className={styles.statusHead}>
          {status.ok ? <Check size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
          {status.head}
        </p>
        {status.rest != null || status.more > 0 ? (
          <p className={styles.statusRest}>
            {status.rest != null ? <span>{status.rest}</span> : null}
            {status.more > 0 ? <span>{status.more} more {status.more === 1 ? "note" : "notes"}</span> : null}
          </p>
        ) : null}
      </div>
      {confirming ? (
        <div ref={confirmRef} className={styles.confirm} role="group" aria-label={`Delete ${deck.name}`}>
          <span>Delete {deck.name}? This can&apos;t be undone.</span>
          {deleteError ? <span className={styles.why} role="alert">{deleteError}</span> : null}
          <span className={styles.confirmActs}>
            <SvButton variant="danger" disabled={busy} onClick={onDelete}>Delete</SvButton>
            <SvButton variant="ghost" disabled={busy} onClick={onKeep} data-keep="">Keep</SvButton>
          </span>
        </div>
      ) : (
        <div className={styles.acts}>
          <Link className={`sv-btn quiet ${styles.openBtn}`} href={`/decks/${deck.id}`} aria-label={`Open ${deck.name}`}>
            Open
          </Link>
          <button className={styles.trash} type="button" aria-label={`Delete ${deck.name}`} disabled={busy} onClick={onAskDelete}>
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      )}
    </FloorRow>
  );
}

export function SavedDeckLibrary() {
  const [decks, setDecks] = useState<SavedDeckView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const onImported = useCallback((deck: SavedDeckView) => {
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

  async function confirmDelete(deck: SavedDeckView) {
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
    <PageFrame
      title="Decks"
      sub={decks != null && decks.length > 0 ? `${decks.length} saved` : undefined}
      actions={
        <>
          <SvButton aria-expanded={importOpen} onClick={() => setImportOpen((open) => !open)}>
            <FileUp size={16} aria-hidden="true" />
            Import YDK
          </SvButton>
          <SvButton as="a" href="/decks/new" variant="primary">
            <Plus size={16} aria-hidden="true" />
            New deck
          </SvButton>
        </>
      }
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
      <p className={styles.lede}>
        Private lists you can import at a table. Saving here does not make a deck legal for a duel.
      </p>

      {importOpen ? (
        <DeckImportPanel importer={importer} dragging={dragging} onClose={() => setImportOpen(false)} />
      ) : null}

      {decks == null && !error ? (
        <ul className={styles.skeleton} aria-busy="true" aria-label="Loading saved decks">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <span className="sk" style={{ width: 72, height: 64 }} />
              <span className={styles.skText}>
                <span className="sk" style={{ width: "42%", height: 14 }} />
                <span className="sk" style={{ width: "66%" }} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div role="alert" className={styles.alert}>
          <StatusLine tone="block">{error}</StatusLine>
          <SvButton variant="quiet" onClick={load}>Retry</SvButton>
        </div>
      ) : null}

      {decks && decks.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyZones} aria-hidden="true">
            <Zone state="empty" size="md" />
            <Zone state="empty" size="md" />
            <Zone state="empty" size="md" />
          </span>
          <div>
            <h2>No saved decks yet</h2>
            <p>
              Import your YDK files or build a list, and reuse it when you sit down at a table. You can also drop .ydk
              files anywhere on this page.
            </p>
            <div className={styles.emptyActs}>
              <SvButton variant="ghost" onClick={() => setImportOpen(true)}>
                <FileUp size={16} aria-hidden="true" />
                Import YDK files
              </SvButton>
              <SvButton as="a" href="/decks/new" variant="quiet">
                Create a deck
              </SvButton>
            </div>
          </div>
        </div>
      ) : null}

      {decks && decks.length > 0 ? (
        <>
          <FloorList aria-label="Saved decks">
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
          </FloorList>
          <p className={styles.foot}>Sizes only. The table checks the banlist and copy limits when you ready up.</p>
        </>
      ) : null}
    </PageFrame>
  );
}
