"use client";

import { useEffect, useState } from "react";
import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { searchDuelCards } from "@/components/duel/api";
import { cardArtUrl } from "@/components/duel/constants";
import { SheetButton } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { defaultAddSection } from "./model";
import styles from "./editor.module.css";

export function DeckSearchPanel({
  onAdd,
  onCatalog,
}: {
  onAdd: (card: DuelCardInfo, section: "main" | "extra" | "side") => void;
  onCatalog: (cards: DuelCardInfo[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState<{ query: string; cards?: DuelCardInfo[]; error?: string } | null>(null);
  const trimmed = query.trim();
  const current = search?.query === trimmed ? search : null;

  useEffect(() => {
    if (!trimmed) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchDuelCards(trimmed).then(
        ({ cards }) => {
          if (cancelled) return;
          onCatalog(cards);
          setSearch({ query: trimmed, cards });
        },
        (reason: unknown) => {
          if (!cancelled) {
            setSearch({ query: trimmed, error: reason instanceof Error ? reason.message : "Could not search cards." });
          }
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, retry, onCatalog]);

  return (
    <section className={styles.search} aria-label="Card search">
      <h2 className={ui.sectionTitle}>Search</h2>
      <label>
        <span className={ui.label}>Find cards by name or passcode</span>
        <input
          type="search"
          value={query}
          maxLength={200}
          placeholder="e.g. Dark Magician or 46986414"
          className={ui.input}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className={ui.hint}>
        Add places Extra Deck monsters (Fusion, Synchro, Xyz, Link) in Extra. Everything else goes to Main. Use Side for an explicit Side copy.
      </p>
      <div aria-live="polite">
        {!trimmed ? (
          <p className={ui.hint}>Type a name or passcode to search the engine catalog.</p>
        ) : current?.error ? (
          <div className={styles.searchError}>
            <p role="alert" className={ui.alert}>{current.error}</p>
            <SheetButton size="sm" onClick={() => { setSearch(null); setRetry((value) => value + 1); }}>Retry</SheetButton>
          </div>
        ) : !current?.cards ? (
          <p className={ui.hint}>Searching…</p>
        ) : current.cards.length === 0 ? (
          <p className={ui.hint}>No cards found. Try another name or the full passcode.</p>
        ) : (
          <ul className={styles.searchResults} aria-label="Search results">
            {current.cards.map((card) => {
              const section = defaultAddSection(card);
              return (
                <li key={card.code} className={styles.searchHit}>
                  <button
                    type="button"
                    className={styles.searchMain}
                    onClick={() => onAdd(card, section)}
                    aria-label={`Add ${card.name} to ${section === "extra" ? "Extra" : "Main"}`}
                  >
                    <img src={cardArtUrl(card.code, "small")} alt="" loading="lazy" />
                    <span>
                      <strong>{card.name}</strong>
                      <span>{card.race} · {card.code} · {section === "extra" ? "Extra" : "Main"}</span>
                    </span>
                  </button>
                  <SheetButton
                    size="sm"
                    className={styles.searchSide}
                    onClick={() => onAdd(card, "side")}
                    aria-label={`Add ${card.name} to Side`}
                  >
                    Side
                  </SheetButton>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
