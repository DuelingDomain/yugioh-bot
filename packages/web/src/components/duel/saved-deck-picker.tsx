"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DuelDeck, DuelMode, SavedDeck } from "@yugidraft/shared/duels";
import { listSavedDecks } from "../decks/api";
import { SheetButton, SheetSelect, sheetButtonClass } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./deck-editor.module.css";

/** The names Manage decks and the room settings use for each format. */
const MODE_NAME: Record<DuelMode, string> = { domain: "Domain", normal: "Standard" };

/**
 * Lists the saved decks that were saved in the table's format, and only those. A custom table turns the
 * format and copy-limit checks off, but a Domain deck list stays a Domain list and a Standard deck list
 * stays a Standard list, so the two formats never mix here.
 */
export function SavedDeckPicker({ mode, disabled, onLoad }: {
  mode: DuelMode;
  disabled: boolean;
  /** Loads the chosen deck. Returns false when the player keeps the current deck. */
  onLoad: (deck: DuelDeck) => boolean;
}) {
  const [decks, setDecks] = useState<SavedDeck[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

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

  const matching = decks?.filter((saved) => saved.mode === mode) ?? [];
  const current = matching.find((saved) => String(saved.id) === selected);

  function choose(value: string) {
    const saved = matching.find((deck) => String(deck.id) === value);
    if (!saved || onLoad(saved.deck)) setSelected(value);
  }

  const placeholder = error ? "Saved decks unavailable"
    : !decks ? "Loading saved decks…"
    : matching.length ? "Choose a deck"
    : `No saved ${MODE_NAME[mode]} decks`;

  return (
    <section className={styles.head} aria-label="Saved decks">
      <div className={styles.addRow}>
        <SheetSelect label="Use a saved deck" className={styles.savedSelect}
          value={current ? selected : ""} disabled={disabled || !decks} onChange={choose}
          choices={[
            { value: "", label: placeholder },
            ...matching.map((saved) => ({ value: String(saved.id), label: `${saved.name} · ${saved.deck.main.length} Main / ${saved.deck.extra.length} Extra / ${saved.deck.side.length} Side` })),
          ]} />
        <SheetButton disabled={disabled} size="sm" onClick={() => setRetry((value) => value + 1)}>Refresh</SheetButton>
        <Link href="/decks" className={sheetButtonClass("quiet", "sm")}>Manage decks</Link>
      </div>
      {error ? <p role="alert" className={ui.alert}>{error}</p> : null}
      {decks && matching.length === 0 ? (
        <p className={styles.muted}>
          {decks.length > 0 ? "Your saved decks use another format. " : ""}
          In Manage decks, save a deck as {MODE_NAME[mode]} to use it at this table.
        </p>
      ) : null}
      <p className={styles.muted}>Choosing a deck loads a copy. Editing it here won&apos;t change your saved deck; this room&apos;s rules are checked before you ready up.</p>
    </section>
  );
}
