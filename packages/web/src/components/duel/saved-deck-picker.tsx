"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DuelDeck, DuelMode, GenesysSettings, SavedDeck } from "@yugidraft/shared/duels";
import { formatLabel } from "../decks/genesys";
import { listSavedDecks } from "../decks/api";
import { savedDeckTag, useSavedDeckPoints } from "./saved-deck-genesys";
import { GenesysDeckChoices, genesysDeckRows } from "./saved-deck-genesys-list";
import { SheetButton, SheetSelect, sheetButtonClass } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./deck-editor.module.css";

export { savedDeckTag };

/** The player's saved decks. `add` puts a new deck in the list at once, with no reload. */
export function useSavedDecks() {
  const [decks, setDecks] = useState<SavedDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const latest = useRef<SavedDeck[] | null>(null);
  latest.current = decks;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDecks(null);
    void listSavedDecks().then(
      (saved) => { if (!cancelled) setDecks(saved); },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load saved decks.");
      },
    );
    return () => { cancelled = true; };
  }, [retry]);

  const reload = useCallback(() => setRetry((value) => value + 1), []);
  const add = useCallback((saved: SavedDeck) => {
    if (latest.current) {
      latest.current = [saved, ...latest.current];
      setDecks(latest.current);
    } else {
      // The list is loading or failed to load. A one-deck list would hide the other decks, so load it
      // again; the new deck is saved already, so the new list holds it.
      setRetry((value) => value + 1);
    }
  }, []);
  return { decks, error, reload, add, latest };
}

export type SavedDeckList = ReturnType<typeof useSavedDecks>;

/**
 * Lets the player load the saved decks that were saved in the table's format. A custom table turns the
 * format and copy-limit checks off, but a Domain deck list stays a Domain list and a Standard deck list
 * stays a Standard list, so the two formats never mix here. Decks of the other format stay in the list,
 * after the usable ones, disabled and with the reason, so a deck is never missing without a sign.
 */
export function SavedDeckPicker({ mode, genesys = null, disabled, list, onLoad }: {
  mode: DuelMode;
  /** The room's Genesys setting. In a Genesys room each deck shows its points and state; a deck over the cap can not be picked. */
  genesys?: GenesysSettings | null;
  disabled: boolean;
  list: SavedDeckList;
  /** Loads the chosen deck. Returns false when the player keeps the current deck. */
  onLoad: (deck: DuelDeck) => boolean;
}) {
  const { decks, error, reload } = list;
  const [selected, setSelected] = useState("");
  const hintId = useId();
  const points = useSavedDeckPoints(decks, mode, genesys != null);

  const sameMode = decks?.filter((saved) => saved.mode === mode) ?? [];
  // A stable sort: in a Genesys room the tagged decks come first, and inside each group the list keeps its order.
  const matching = genesys ? [...sameMode].sort((a, b) => Number(Boolean(b.genesys)) - Number(Boolean(a.genesys))) : sameMode;
  const otherFormat = decks?.filter((saved) => saved.mode !== mode) ?? [];
  const current = matching.find((saved) => String(saved.id) === selected);

  function choose(value: string) {
    const saved = matching.find((deck) => String(deck.id) === value);
    if (!saved || onLoad(saved.deck)) setSelected(value);
  }

  const showHint = Boolean(decks) && (matching.length === 0 || otherFormat.length > 0);
  const placeholder = error ? "Saved decks unavailable"
    : !decks ? "Loading saved decks…"
    : matching.length ? "Choose a deck"
    : `No saved ${formatLabel(mode, genesys)} decks`;

  return (
    <section className={styles.head} aria-label="Saved decks">
      {genesys ? (
        <GenesysDeckChoices mode={mode} genesys={genesys} picked={current ? selected : ""} disabled={disabled} emptyText={placeholder}
          rows={decks ? genesysDeckRows(decks, mode, genesys, points.catalog, points.settled, points.failed) : []} onPick={choose} />
      ) : null}
      <div className={styles.addRow}>
        {genesys ? null : (
          <SheetSelect label="Use a saved deck" className={styles.savedSelect} describedBy={showHint ? hintId : undefined}
            value={current ? selected : ""} disabled={disabled || !decks} onChange={choose}
            choices={[
              { value: "", label: placeholder },
              ...matching.map((saved) => {
                const tag = savedDeckTag(saved);
                return {
                  value: String(saved.id),
                  label: `${saved.name} · ${saved.deck.main.length} Main / ${saved.deck.extra.length} Extra / ${saved.deck.side.length} Side${tag ? ` · ${tag}` : ""}`,
                };
              }),
              ...otherFormat.map((saved) => ({
                value: String(saved.id),
                label: `${saved.name} · Saved as ${formatLabel(saved.mode, saved.genesys)}. Not usable in a ${formatLabel(mode, genesys)} room.`,
                disabled: true,
              })),
            ]} />
        )}
        <SheetButton disabled={disabled} size="sm" onClick={reload}>Refresh</SheetButton>
        <Link href="/decks" className={sheetButtonClass("quiet", "sm")}>Manage decks</Link>
      </div>
      {error ? <p role="alert" className={ui.alert}>{error}</p> : null}
      {showHint ? (
        <p id={hintId} className={styles.muted}>
          {otherFormat.length > 0
            ? `${otherFormat.length === 1 ? "1 saved deck uses" : `${otherFormat.length} saved decks use`} another format and can't be loaded here. `
            : ""}
          {matching.length === 0 || otherFormat.length > 0 ? `In Manage decks, save a deck as ${formatLabel(mode, genesys)} to use it at this table. ` : ""}
        </p>
      ) : null}
      <p className={styles.muted}>Choosing a deck loads a copy. Editing it here won&apos;t change your saved deck; this room&apos;s rules are checked before you ready up.</p>
    </section>
  );
}
