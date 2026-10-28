"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { foldCardText } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import { fetchBridgeArchetypes, type BridgeScope, type ShownBridge } from "./bridges-api";
import { errorText, useBridgeList } from "./use-bridges";
import styles from "./bridges.module.css";

/** An archetype box with a list of the names that fit. The text is the choice once it is a whole name. */
function ArchetypeCombo({ label, text, names, onText, placeholder }: {
  label: string;
  text: string;
  names: readonly string[] | null;
  onText: (text: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const matches = useMemo(() => {
    const folded = foldCardText(text);
    if (!folded || !names) return [];
    const starts: string[] = [];
    const contains: string[] = [];
    for (const name of names) {
      const fold = foldCardText(name);
      if (fold === folded) return [];
      if (fold.startsWith(folded)) starts.push(name);
      else if (fold.includes(folded)) contains.push(name);
    }
    return [...starts, ...contains].slice(0, 8);
  }, [text, names]);
  const expanded = open && matches.length > 0;

  function choose(name: string) {
    onText(name);
    setOpen(false);
    setActive(0);
  }

  return (
    <label className={styles.comboField}>
      <span className={styles.comboLabel}>{label}</span>
      <span className={styles.combo}>
        <input
          className={cn("input", styles.comboInput)}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
          placeholder={names ? placeholder : "Loading archetypes…"}
          value={text}
          disabled={!names}
          autoComplete="off"
          onChange={(event) => { onText(event.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (!expanded) return;
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => (value + 1) % matches.length); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => (value - 1 + matches.length) % matches.length); }
            if (event.key === "Enter") { event.preventDefault(); const match = matches[active]; if (match) choose(match); }
            if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
          }}
        />
        {expanded ? (
          <ul id={listId} role="listbox" className={styles.comboList} aria-label={`${label} archetypes`}>
            {matches.map((name, index) => (
              <li key={name} id={`${listId}-${index}`} role="option" aria-selected={index === active} className={styles.comboOption}
                onMouseDown={(event) => { event.preventDefault(); choose(name); }} onMouseEnter={() => setActive(index)}>
                {name}
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    </label>
  );
}

/** The whole name a text stands for, or null. Case does not matter. */
function wholeName(text: string, names: readonly string[] | null): string | null {
  const folded = text.trim().toLowerCase();
  return folded && names ? names.find((name) => name.toLowerCase() === folded) ?? null : null;
}

/**
 * "X to Y": pick two archetypes and see the bridge each way. This is a free, stored lookup and needs no
 * deep search. A bridge that did not pass the checks is not shown, so an empty answer says so.
 */
export function BridgeSearch({ start, genesys, genesysRemaining, renderList }: {
  /** The deck's archetype, to fill the first box. */
  start: string | null;
  genesys: boolean;
  genesysRemaining?: number;
  renderList: (bridges: ShownBridge[], title: string) => React.ReactNode;
}) {
  const [names, setNames] = useState<readonly string[] | null>(null);
  const [namesError, setNamesError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [from, setFrom] = useState(start ?? "");
  const [to, setTo] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let live = true;
    setNamesError(null);
    fetchBridgeArchetypes().then((found) => { if (live) setNames(found); }, (reason: unknown) => { if (live) setNamesError(errorText(reason)); });
    return () => { live = false; };
  }, [retry]);
  // The first box follows the deck until the player types in it.
  useEffect(() => { if (!touched && start) setFrom(start); }, [start, touched]);

  const source = wholeName(from, names);
  const target = wholeName(to, names);
  const scope = useMemo<BridgeScope | null>(
    () => (source && target && source !== target ? { source, target, format: genesys ? "genesys" : "advanced", ...(genesys && genesysRemaining != null ? { genesysRemaining } : {}) } : null),
    [source, target, genesys, genesysRemaining],
  );
  const { list, loading, error, retry: again } = useBridgeList(scope, false);

  return (
    <div className={styles.search} data-testid="bridge-search">
      <div className={styles.searchBoxes}>
        <ArchetypeCombo label="From" text={from} names={names} placeholder="Odion, Blue-Eyes…" onText={(text) => { setTouched(true); setFrom(text); }} />
        <span className={styles.searchTo} aria-hidden>→</span>
        <ArchetypeCombo label="To" text={to} names={names} placeholder="Argostars, Ashtra…" onText={setTo} />
      </div>
      {namesError ? <p className={styles.note} role="alert">{namesError} <button type="button" className={styles.link} onClick={() => setRetry((value) => value + 1)}>Try again</button></p> : null}
      {source && target && source === target ? <p className={styles.note}>Choose two different archetypes.</p> : null}
      {!scope && !namesError && !(source && target) ? <p className={styles.note}>Pick two archetypes to see the bridge each way.</p> : null}
      {scope && loading && !list ? <p className={styles.note} role="status">Looking…</p> : null}
      {scope && error ? <p className={styles.note} role="alert">{error.message} <button type="button" className={styles.link} onClick={again}>Try again</button></p> : null}
      {scope && list && !error ? (
        <div className={styles.searchResults} aria-busy={loading || undefined} data-testid="bridge-search-results">
          <div>
            <h4 className={styles.subTitle}>{scope.source} → {scope.target}</h4>
            {list.results.length ? renderList(list.results, `${scope.source} to ${scope.target}`) : <p className={styles.note} data-testid="bridge-search-none">No bridge that passed our checks.</p>}
          </div>
          <div>
            <h4 className={styles.subTitle}>{scope.target} → {scope.source}</h4>
            {list.reverse?.length ? renderList(list.reverse, `${scope.target} to ${scope.source}`) : <p className={styles.note} data-testid="bridge-search-none">No bridge that passed our checks.</p>}
          </div>
          {list.inReview > 0 ? <p className={styles.note}>{list.inReview} {list.inReview === 1 ? "bridge is" : "bridges are"} still in review.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
