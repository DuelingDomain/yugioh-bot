"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DuelDeck, DuelMode, SavedDeck } from "@yugidraft/shared/duels";
import { listSavedDecks } from "../decks/api";
import { SheetButton, SheetSelect, sheetButtonClass } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./deck-editor.module.css";

const MODE_NAME: Record<DuelMode, string> = { domain: "Domain", normal: "Normal" };

/**
 * A saved deck remembers the format it was saved under. A checked table only takes decks of its own
 * format. A custom table turns the format checks off, so every saved deck can be loaded there; the
 * list still names a deck saved under the other format, so the player knows what they are loading.
 */
export function savedDeckChoice(saved: SavedDeck, mode: DuelMode, checked: boolean): { label: string; disabled: boolean } {
  const { main, extra, side } = saved.deck;
  const counts = `${saved.name} · ${main.length} Main / ${extra.length} Extra / ${side.length} Side`;
  if (saved.mode === mode) return { label: counts, disabled: false };
  const other = `saved as ${MODE_NAME[saved.mode]}`;
  return checked
    ? { label: `${counts} · ${other}, this is a ${MODE_NAME[mode]} table`, disabled: true }
    : { label: `${counts} · ${other}`, disabled: false };
}

export function SavedDeckPicker({ mode, checked, disabled, onLoad }: {
  mode: DuelMode;
  /** The table checks decks against its format (not a custom table). */
  checked: boolean;
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

  const listed = (decks ?? []).map((saved) => ({ saved, ...savedDeckChoice(saved, mode, checked) }));
  // Decks that fit this table come first; the ones it cannot take stay visible with the reason.
  const usable = listed.filter((entry) => !entry.disabled);
  const choices = [...usable, ...listed.filter((entry) => entry.disabled)];
  const current = usable.find((entry) => String(entry.saved.id) === selected);

  function choose(value: string) {
    const entry = usable.find((item) => String(item.saved.id) === value);
    if (!entry || onLoad(entry.saved.deck)) setSelected(value);
  }

  const placeholder = error ? "Saved decks unavailable"
    : !decks ? "Loading saved decks…"
    : usable.length ? "Choose a deck"
    : decks.length ? `No saved ${MODE_NAME[mode]} decks for this table`
    : "No saved decks";

  return (
    <section className={styles.head} aria-label="Saved decks">
      <div className={styles.addRow}>
        <SheetSelect label="Use a saved deck" className={styles.savedSelect}
          value={current ? selected : ""} disabled={disabled || !decks} onChange={choose}
          choices={[
            { value: "", label: placeholder },
            ...choices.map((entry) => ({ value: String(entry.saved.id), label: entry.label, disabled: entry.disabled })),
          ]} />
        <SheetButton disabled={disabled} size="sm" onClick={() => setRetry((value) => value + 1)}>Refresh</SheetButton>
        <Link href="/decks" className={sheetButtonClass("quiet", "sm")}>Manage decks</Link>
      </div>
      {error ? <p role="alert" className={ui.alert}>{error}</p> : null}
      <p className={styles.muted}>Choosing a deck loads a copy. Editing it here won&apos;t change your saved deck; this room&apos;s rules are checked before you ready up.</p>
    </section>
  );
}
