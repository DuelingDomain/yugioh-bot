"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { searchPlayers, type DuelPlayerOption } from "./api";
import { cx, SheetButton } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./creator.module.css";

const SEARCH_DELAY_MS = 250;

/**
 * Optional opponent for a challenge. Type to search players; the search waits for a short pause
 * in typing and cancels the request it replaces. A picked player shows as a chip with a clear button.
 */
export function OpponentPicker({ value, onChange, disabled = false, autoFocus = false, delayMs = SEARCH_DELAY_MS }: {
  value: DuelPlayerOption | null;
  onChange: (player: DuelPlayerOption | null) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  delayMs?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DuelPlayerOption[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const q = query.trim();
    if (value || q.length === 0) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      setError(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchPlayers(q, controller.signal).then(
        ({ players }) => {
          if (controller.signal.aborted) return;
          setResults(players);
          setSearched(true);
          setError(null);
          setLoading(false);
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Could not search players.");
          setLoading(false);
        },
      );
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, value, delayMs]);

  function pick(player: DuelPlayerOption) {
    onChange(player);
    setQuery("");
  }

  if (value) {
    return (
      <div className={styles.picked}>
        <span className={cx(ui.chip, ui.chipAccent)} data-testid="opponent-chip">{value.displayName}</span>
        <SheetButton kind="quiet" size="sm" disabled={disabled} onClick={() => { onChange(null); window.setTimeout(() => inputRef.current?.focus(), 0); }}>
          <X size={14} strokeWidth={1.6} aria-hidden /> Clear opponent
        </SheetButton>
      </div>
    );
  }

  return (
    <div className={styles.picker}>
      <label>
        <span className={ui.label}>Opponent (optional)</span>
        <input ref={inputRef} type="search" className={ui.input} value={query} disabled={disabled}
          placeholder="Search players by name" autoComplete="off" maxLength={60}
          aria-controls={listId} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div id={listId} aria-live="polite">
        {error ? <p className={ui.alert} role="alert">{error}</p> : null}
        {!error && loading ? <p className={ui.hint}>Searching…</p> : null}
        {!error && !loading && searched && results.length === 0 ? <p className={ui.hint}>No players found.</p> : null}
        {results.length > 0 ? (
          <ul className={styles.results} aria-label="Players">
            {results.map((player) => (
              <li key={player.id}>
                <button type="button" className={styles.result} disabled={disabled} onClick={() => pick(player)}>{player.displayName}</button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
