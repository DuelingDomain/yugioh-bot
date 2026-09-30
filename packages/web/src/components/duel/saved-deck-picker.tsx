"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DuelDeck, DuelMode, SavedDeck } from "@yugidraft/shared/duels";
import { listSavedDecks } from "../decks/api";
import { SheetButton, SheetSelect, sheetButtonClass } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./deck-editor.module.css";

export function SavedDeckPicker({ mode, disabled, onLoad }: {
  mode: DuelMode;
  disabled: boolean;
  onLoad: (deck: DuelDeck) => void;
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

  return (
    <section className={styles.head} aria-label="Saved decks">
      <div className={styles.addRow}>
        <SheetSelect label="Use a saved deck" className={styles.savedSelect}
          value={current ? selected : ""} disabled={disabled || !decks} onChange={setSelected}
          choices={[
            { value: "", label: error ? "Saved decks unavailable" : !decks ? "Loading saved decks…" : matching.length ? "Choose a deck" : `No saved ${mode === "domain" ? "Domain" : "Standard"} decks` },
            ...matching.map((saved) => ({ value: String(saved.id), label: `${saved.name} · ${saved.deck.main.length} Main / ${saved.deck.extra.length} Extra / ${saved.deck.side.length} Side` })),
          ]} />
        <SheetButton disabled={disabled || !current} onClick={() => { if (current) onLoad(current.deck); }}>Load deck</SheetButton>
        <SheetButton disabled={disabled} size="sm" onClick={() => setRetry((value) => value + 1)}>Refresh</SheetButton>
        <Link href="/decks" className={sheetButtonClass("quiet", "sm")}>Manage decks</Link>
      </div>
      {error ? <p role="alert" className={ui.alert}>{error}</p> : null}
      <p className={styles.muted}>Loads a copy. Editing it here won&apos;t change your saved deck; this room&apos;s rules are checked before you ready up.</p>
    </section>
  );
}
