"use client";

import * as React from "react";
import { Search, X, Grid3X3, RefreshCw } from "lucide-react";
import { SetBrowserModal } from "./set-browser-modal";
import { cn } from "@/lib/utils";
import styles from "./create/create.module.css";

type SetResult = {
  setName: string;
  setCode: string;
  cardCount: number;
};

type SetPickerProps = {
  selectedSets: string[];
  onSetsChange: (sets: string[]) => void;
  /** id of the search input, so a label can point at it. */
  inputId?: string;
};

export function SetPicker({ selectedSets, onSetsChange, inputId = "pool-set-search" }: SetPickerProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SetResult[]>([]);
  const [showResults, setShowResults] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setShowResults(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/sets?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.sets ?? []);
          setShowResults(true);
        }
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleSelect = (setName: string) => {
    if (!selectedSets.includes(setName)) {
      onSetsChange([...selectedSets, setName]);
    }
    setQuery("");
    setShowResults(false);
  };

  const handleRemove = (setName: string) => {
    onSetsChange(selectedSets.filter((s) => s !== setName));
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/sets", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      if (query.trim()) {
        const res2 = await fetch(`/api/sets?q=${encodeURIComponent(query.trim())}`);
        if (res2.ok) {
          const data = await res2.json();
          setResults(data.sets ?? []);
          setShowResults(true);
        }
      }
    } catch {
      setSyncError("Failed to sync sets");
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleSet = (setName: string) => {
    if (selectedSets.includes(setName)) {
      onSetsChange(selectedSets.filter((s) => s !== setName));
    } else {
      onSetsChange([...selectedSets, setName]);
    }
  };

  return (
    <div>
      <div className={styles.search}>
        <span className={styles.in}>
          <Search className="ic sm" aria-hidden="true" />
          <input
            className="input"
            id={inputId}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sets"
            autoComplete="off"
          />
          {showResults && results.length > 0 && (
            <ul className={styles.suggest} aria-label="Matching sets">
              {results.map((set) => (
                <li key={set.setName}>
                  <button type="button" onClick={() => handleSelect(set.setName)}>
                    {set.setName}
                    {selectedSets.includes(set.setName) && <span className={styles.added}> Added</span>}
                    <small>
                      {set.setCode} &middot; {set.cardCount} cards
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
        <button
          className={`btn btn-secondary ${styles.browseBtn}`}
          type="button"
          aria-label="Browse sets"
          onClick={() => setBrowserOpen(true)}
        >
          <Grid3X3 className="ic sm" aria-hidden="true" />
          <span className={styles.browseText}>Browse</span>
        </button>
        <button
          className={`btn btn-secondary ${styles.ib}`}
          type="button"
          onClick={handleSync}
          disabled={syncing}
          aria-label="Refresh the set list"
          title="Sync set list from YGOPRODeck"
        >
          <RefreshCw className={cn("ic sm", syncing && styles.spin)} aria-hidden="true" />
        </button>
      </div>
      {loading && (
        <p className="hint" role="status">
          Searching sets
        </p>
      )}
      {syncError && (
        <p className="ferr" role="alert">
          {syncError}
        </p>
      )}

      {selectedSets.length > 0 && (
        <ul className={styles.chips} aria-label="Sets in the pool">
          {selectedSets.map((setName) => (
            <li key={setName} className="chip chip-pen">
              {setName}
              <button type="button" onClick={() => handleRemove(setName)} aria-label={`Remove ${setName}`}>
                <X className="ic sm" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <SetBrowserModal
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        selectedSets={selectedSets}
        onToggleSet={handleToggleSet}
      />
    </div>
  );
}
