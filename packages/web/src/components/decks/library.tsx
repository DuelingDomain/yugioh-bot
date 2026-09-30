"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import type { SavedDeck } from "@yugidraft/shared/duels";
import { cx, SheetButton, sheetButtonClass, sheetRoot } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { deleteSavedDeck, listSavedDecks } from "./api";
import { formatWhen, modeLabel } from "./model";
import styles from "./library.module.css";

export function SavedDeckLibrary() {
  const [decks, setDecks] = useState<SavedDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    <div className={cx(sheetRoot, styles.wrap)}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={ui.title}>Decks</h1>
          <p className={ui.lede}>Private lists you can import at a table. Saving here does not make a deck legal for a duel.</p>
        </div>
        <Link href="/decks/new" className={sheetButtonClass("primary", "lg")}>
          <Plus size={17} strokeWidth={1.7} aria-hidden />
          New deck
        </Link>
      </header>

      {decks == null && !error ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading saved decks">
          <div className={styles.skelRow} />
          <div className={styles.skelRow} />
          <div className={styles.skelRow} />
        </div>
      ) : null}

      {error ? (
        <div className={styles.errorBlock}>
          <p role="alert" className={ui.alert}>{error}</p>
          <SheetButton size="sm" onClick={load}>Retry</SheetButton>
        </div>
      ) : null}

      {decks && decks.length === 0 ? (
        <div className={styles.empty}>
          <p>No saved decks yet. Build a list, import a YDK, and reuse it when you sit down at a table.</p>
          <Link href="/decks/new" className={sheetButtonClass("primary")}>
            <Plus size={16} strokeWidth={1.7} aria-hidden />
            Create a deck
          </Link>
        </div>
      ) : null}

      {decks && decks.length > 0 ? (
        <ul className={styles.list}>
          {decks.map((deck) => {
            const confirming = pendingId === deck.id;
            return (
              <li key={deck.id} className={styles.row}>
                <Link href={`/decks/${deck.id}`} className={styles.rowLink}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>
                      <span className={styles.name}>{deck.name}</span>
                      <span className={cx(ui.chip, deck.mode === "domain" && ui.chipGold)}>{modeLabel(deck.mode)}</span>
                    </span>
                    <span className={styles.meta}>
                      <span className={styles.counts}>
                        Main <b className={ui.num}>{deck.deck.main.length}</b>
                        <span aria-hidden> · </span>
                        Extra <b className={ui.num}>{deck.deck.extra.length}</b>
                        <span aria-hidden> · </span>
                        Side <b className={ui.num}>{deck.deck.side.length}</b>
                        {deck.deck.deckMaster != null ? (
                          <>
                            <span aria-hidden> · </span>
                            Master
                          </>
                        ) : null}
                      </span>
                      <span className={styles.when}>Updated {formatWhen(deck.updatedAt)}</span>
                    </span>
                  </span>
                  <span className={styles.go}>
                    Open
                    <ArrowRight size={15} strokeWidth={1.6} aria-hidden />
                  </span>
                </Link>
                <div className={styles.actions}>
                  {confirming ? (
                    <div className={styles.confirm}>
                      <p className={styles.confirmText}>Delete {deck.name}?</p>
                      {deleteError ? <p role="alert" className={ui.alert}>{deleteError}</p> : null}
                      <div className={styles.confirmBtns}>
                        <SheetButton
                          kind="danger"
                          size="sm"
                          loading={busyId === deck.id}
                          disabled={busyId != null}
                          onClick={() => void confirmDelete(deck)}
                        >
                          Delete
                        </SheetButton>
                        <SheetButton kind="quiet" size="sm" disabled={busyId != null} onClick={() => { setPendingId(null); setDeleteError(null); }}>
                          Keep
                        </SheetButton>
                      </div>
                    </div>
                  ) : (
                    <SheetButton
                      kind="quiet"
                      size="sm"
                      aria-label={`Delete ${deck.name}`}
                      disabled={busyId != null}
                      onClick={() => { setPendingId(deck.id); setDeleteError(null); }}
                    >
                      Delete
                    </SheetButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
