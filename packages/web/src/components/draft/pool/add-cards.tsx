"use client";

import * as React from "react";
import { Check, CircleAlert, Info, Plus, Search } from "lucide-react";
import { svButtonClass } from "@/components/sheet";
import { isExtraDeckMonster, type CardSummary } from "@/lib/card-types";
import { parseCustomCardIds } from "@/lib/custom-card-pool";
import { useResultNav } from "@/lib/hooks/use-result-nav";
import { fetchArchetypes, fetchSets, resolveCards, resolvePasscodes, type SetInfo } from "./pool-api";
import { CardThumb } from "./pool-bits";
import {
  DEFAULT_COPIES,
  MAX_COPIES,
  addCopyLine,
  addedLine,
  kindText,
  passcodesLine,
} from "./pool-model";
import type { PoolEditor } from "./use-pool-editor";
import styles from "./pool.module.css";

export type AddTab = "card" | "archetype" | "set" | "passcodes";

const TABS: Array<{ value: AddTab; label: string }> = [
  { value: "card", label: "Card" },
  { value: "archetype", label: "Archetype" },
  { value: "set", label: "Set" },
  { value: "passcodes", label: "Paste passcodes" },
];

interface Note {
  tone: "ok" | "bad";
  text: string;
}

const NOT_REACHABLE = "The card database may be unreachable.";

function NoteLine({ note }: { note: Note | null }) {
  // The live region stays in the page so a result is announced when it appears.
  return (
    <div role="status" aria-live="polite">
      {note && (
        <p className={`${styles.note}${note.tone === "bad" ? ` ${styles.bad}` : ""}`}>
          {note.tone === "bad" ? <CircleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          <span>{note.text}</span>
        </p>
      )}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className={`${styles.note} ${styles.quiet}`}>
      <Info size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * For an add that awaits the card list. `begin()` is called before the request; the function it returns says
 * whether this tab is still showing and the editor is still in the same session (no Cancel, Change cube, Reset
 * or save since), so an answer from before never lands in a newer pool.
 */
function useAddGuard(ctl: PoolEditor) {
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ctlRef = React.useRef(ctl);
  ctlRef.current = ctl;
  return React.useCallback(() => {
    const started = ctlRef.current.session();
    return () => mounted.current && ctlRef.current.session() === started;
  }, []);
}

/** Card, Archetype, Set and Paste passcodes. Each add ends with one line that says what happened. */
export function AddCards({ ctl, initialTab }: { ctl: PoolEditor; initialTab: AddTab }) {
  const [tab, setTab] = React.useState<AddTab>(initialTab);
  const [note, setNote] = React.useState<Note | null>(null);

  const choose = (next: AddTab) => {
    setTab(next);
    setNote(null);
  };

  return (
    <>
      <div className={`seg ${styles.tabs}`} role="group" aria-label="Add by">
        {TABS.map((t) => (
          <button key={t.value} type="button" aria-pressed={tab === t.value} onClick={() => choose(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "card" && <CardTab ctl={ctl} setNote={setNote} />}
      {tab === "archetype" && <ArchetypeTab ctl={ctl} setNote={setNote} />}
      {tab === "set" && <SetTab ctl={ctl} setNote={setNote} />}
      {tab === "passcodes" && <PasscodesTab ctl={ctl} setNote={setNote} />}
      <NoteLine note={note} />
    </>
  );
}

type TabProps = { ctl: PoolEditor; setNote: (note: Note | null) => void };

function CardTab({ ctl, setNote }: TabProps) {
  const inputId = React.useId();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CardSummary[]>([]);
  const [resultsFor, setResultsFor] = React.useState("");
  // The text whose search failed. It shows only while the input still holds that text.
  const [failedFor, setFailedFor] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [searching, setSearching] = React.useState(false);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    const mine = ++seq.current;
    if (!q) {
      setResults([]);
      setResultsFor("");
      setFailedFor("");
      setSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      setFailedFor("");
      resolveCards({ fuzzyName: q })
        .then((r) => {
          if (mine !== seq.current) return;
          setResults(r.cards.filter((c) => !isExtraDeckMonster(c)).slice(0, 8));
          setResultsFor(q);
        })
        .catch(() => {
          if (mine !== seq.current) return;
          // A failed search is not "no match": say so, and keep resultsFor on the last good answer.
          setResults([]);
          setFailedFor(q);
        })
        .finally(() => {
          if (mine === seq.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, retry]);

  const trimmed = query.trim();
  const failed = failedFor === trimmed && !searching;
  const addOne = (card: CardSummary) => setNote({ tone: "ok", text: addCopyLine(card.name, ctl.addCopy(card)) });
  const nav = useResultNav({
    items: results,
    query,
    resultsFor,
    setQuery,
    onPick: addOne,
    canPick: (card) => (ctl.pool.get(card.id) ?? 0) < MAX_COPIES,
  });
  return (
    <>
      <div className={styles.in}>
        <Search size={16} aria-hidden="true" />
        <input
          id={inputId}
          className="input"
          type="search"
          placeholder="Search cards by name"
          aria-label="Search cards by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          {...nav.inputProps}
        />
      </div>
      {!trimmed && <Hint>Type a card name. Enter or a click adds one copy.</Hint>}
      {trimmed && searching && results.length === 0 && <Hint>Searching.</Hint>}
      {failed && (
        <div role="alert" className={styles.searchErr}>
          <p className={`${styles.note} ${styles.bad}`}>
            <CircleAlert size={16} aria-hidden="true" />
            <span>The card search did not work. Try again.</span>
          </p>
          <button type="button" className={`${svButtonClass("ghost")} ${styles.small}`} onClick={() => {
            setFailedFor("");
            setRetry((n) => n + 1);
          }}>
            Try again
          </button>
        </div>
      )}
      {trimmed && !searching && !failed && resultsFor === trimmed && results.length === 0 && <Hint>No main-deck card matches that.</Hint>}
      {results.length > 0 && (
        <ul className={styles.res} aria-label={`Results for ${trimmed}`} aria-busy={searching || nav.stale || undefined} data-stale={nav.stale ? "" : undefined} {...nav.listProps}>
          {results.map((card, index) => {
            const copies = ctl.pool.get(card.id) ?? 0;
            return (
              <li key={card.id} className={styles.resRow} {...nav.optionProps(index)}>
                <CardThumb id={card.id} src={card.imageUrlSmall} className={styles.thumb} />
                <div className={styles.resN}>
                  <b>{card.name}</b>
                  <span>{kindText(card)}</span>
                </div>
                <div className={styles.resAct}>
                  {copies > 0 && <span className={styles.inPool}>{copies} in pool</span>}
                  {/* Only a look: the whole row is the option and the click target. */}
                  <span className={`${styles.ib} ${styles.ibAdd}`} aria-hidden="true" data-disabled={copies >= MAX_COPIES ? "" : undefined}>
                    <Plus size={16} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function ArchetypeTab({ ctl, setNote }: TabProps) {
  const begin = useAddGuard(ctl);
  const inputId = React.useId();
  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    const mine = ++seq.current;
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      fetchArchetypes(q)
        .then((list) => {
          if (mine === seq.current) setSuggestions(list);
        })
        .catch(() => {
          if (mine === seq.current) setSuggestions([]);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const addArchetype = async (raw: string) => {
    const archetype = raw.trim();
    if (!archetype || busy) return;
    setBusy(true);
    setNote(null);
    const current = begin();
    try {
      const { cards } = await resolveCards({ archetype });
      if (!current()) return;
      if (cards.length === 0) {
        setNote({ tone: "bad", text: `No cards found for ${archetype}.` });
      } else {
        const outcome = ctl.add(cards.map((card) => ({ card, copies: DEFAULT_COPIES })));
        setNote({ tone: "ok", text: addedLine(archetype, outcome) });
        setQuery("");
        setSuggestions([]);
      }
    } catch {
      if (current()) setNote({ tone: "bad", text: `Couldn't add ${archetype}. ${NOT_REACHABLE}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.addRow}>
        <div className={styles.in}>
          <Search size={16} aria-hidden="true" />
          <input
            id={inputId}
            className="input"
            type="search"
            placeholder="Blue-Eyes, Dark Magician, Lightsworn"
            aria-label="Archetype"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addArchetype(query);
              }
            }}
            autoComplete="off"
          />
          {suggestions.length > 0 && (
            <ul className={styles.sugg} aria-label="Archetype suggestions">
              {suggestions.map((name) => (
                <li key={name}>
                  <button type="button" onClick={() => void addArchetype(name)}>
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className={svButtonClass("ghost")}
          disabled={query.trim().length === 0 || busy}
          aria-busy={busy || undefined}
          onClick={() => void addArchetype(query)}
        >
          <Plus size={16} aria-hidden="true" />
          Add
        </button>
      </div>
      <Hint>Adds every main-deck card in the archetype, {DEFAULT_COPIES} copies each.</Hint>
    </>
  );
}

function SetTab({ ctl, setNote }: TabProps) {
  const begin = useAddGuard(ctl);
  const [sets, setSets] = React.useState<SetInfo[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState<ReadonlySet<string>>(new Set());

  // The server does the matching (it holds every set and returns the first 25), so the text goes to it.
  React.useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        fetchSets(query)
          .then((list) => {
            if (cancelled) return;
            setFailed(false);
            setSets(list);
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
      },
      query.trim() ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const shown = sets ?? [];

  const addSet = async (set: SetInfo) => {
    if (busy) return;
    setBusy(set.setName);
    setNote(null);
    const current = begin();
    try {
      const { cards } = await resolveCards({ setNames: [set.setName] });
      if (!current()) return;
      const outcome = ctl.add(cards.map((card) => ({ card, copies: card.qty ?? 1 })));
      setAdded((prev) => new Set(prev).add(set.setName));
      setNote({ tone: "ok", text: addedLine(set.setName, outcome) });
    } catch {
      if (current()) setNote({ tone: "bad", text: `Couldn't add ${set.setName}. ${NOT_REACHABLE}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className={styles.in}>
        <Search size={16} aria-hidden="true" />
        <input
          className="input"
          type="search"
          placeholder="Search sets"
          aria-label="Search sets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>
      {sets === null && !failed && <Hint>Loading sets.</Hint>}
      {failed && <Hint>Couldn&apos;t load the sets.</Hint>}
      {sets !== null && shown.length === 0 && <Hint>{query.trim() ? "No set matches that." : "No sets are loaded yet."}</Hint>}
      {shown.length > 0 && (
        <ul className={styles.res} style={{ gap: 0 }} aria-label="Sets">
          {shown.map((set) => {
            const done = added.has(set.setName);
            return (
              <li key={set.setName} className={styles.setRow}>
                <div>
                  <b>{set.setName}</b>
                  <span>
                    <span className={styles.count}>{set.cardCount}</span>cards
                  </span>
                </div>
                <button
                  type="button"
                  className={`${svButtonClass("ghost")} ${styles.small}`}
                  disabled={done || busy !== null}
                  aria-busy={busy === set.setName || undefined}
                  aria-label={done ? `${set.setName} added` : `Add ${set.setName}`}
                  onClick={() => void addSet(set)}
                >
                  {done ? <Check size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
                  {done ? "Added" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length >= 25 && <Hint>Showing the first {shown.length} sets. Type to narrow the list.</Hint>}
    </>
  );
}

function PasscodesTab({ ctl, setNote }: TabProps) {
  const begin = useAddGuard(ctl);
  const inputId = React.useId();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const parsed = React.useMemo(() => parseCustomCardIds(text), [text]);
  const count = parsed.cardIds.length;

  const addPasscodes = async () => {
    if (count === 0 || busy) return;
    setBusy(true);
    setNote(null);
    const current = begin();
    try {
      const occurrences = new Map<number, number>();
      for (const id of parsed.cardIds) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
      const { cards, unknownIds } = await resolvePasscodes(Array.from(occurrences.keys()));
      if (!current()) return;
      const outcome = ctl.addPasscodes(occurrences, cards, unknownIds);
      setNote({ tone: "ok", text: passcodesLine({ ...outcome, invalid: parsed.errors.length }) });
      setText("");
    } catch {
      if (current()) setNote({ tone: "bad", text: `Couldn't add the passcodes. ${NOT_REACHABLE}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label className={styles.sr} htmlFor={inputId}>
        Passcodes
      </label>
      <textarea
        id={inputId}
        className="input"
        rows={4}
        placeholder="One passcode per line, or separated by commas"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div>
        <button
          type="button"
          className={svButtonClass("ghost")}
          disabled={count === 0 || busy}
          aria-busy={busy || undefined}
          onClick={() => void addPasscodes()}
        >
          <Plus size={16} aria-hidden="true" />
          {count > 0 ? `Add ${count} ${count === 1 ? "passcode" : "passcodes"}` : "Add passcodes"}
        </button>
      </div>
    </>
  );
}
