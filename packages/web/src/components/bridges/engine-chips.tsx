"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type { DetectedEngine } from "@/lib/bridges-api";
import { cn } from "@/lib/utils";
import { ArchetypeCombo, wholeName } from "./bridge-search";
import { MAX_ENGINES } from "./engines-model";
import { useArchetypeNames } from "./use-engines";
import styles from "./bridges.module.css";

/**
 * The engines the Bridges tab works on, as chips. A chip has a ×; the groups that are only a little in the deck wait
 * under "Also in deck" with a +; "+ Add" takes any archetype by name. Four is the most. The chips change the
 * Bridges tab only.
 */
export function EngineChips({ title, set, light, edited, busy, onRemove, onAdd, onReset, resetLabel = "Reset to deck", emptyText = "No engine found yet. Add one, or add more cards from one archetype." }: {
  title: string;
  set: readonly string[];
  /** Groups in the deck that are not in the set. Pick mode has none. */
  light?: readonly DetectedEngine[];
  edited?: boolean;
  /** The answer for the set is on its way. */
  busy?: boolean;
  onRemove: (name: string) => void;
  onAdd: (name: string) => void;
  onReset?: () => void;
  resetLabel?: string;
  /** What an empty set says. */
  emptyText?: string;
}) {
  const full = set.length >= MAX_ENGINES;
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const { names: all, error, retry } = useArchetypeNames(adding);
  const names = useMemo(() => (all ? all.filter((name) => !set.some((have) => have.toLowerCase() === name.toLowerCase())) : null), [all, set]);
  const chosen = wholeName(text, names);

  function add(name: string) {
    onAdd(name);
    setText("");
    setAdding(false);
  }

  return (
    <div className={styles.chips} data-testid="engine-chips" aria-busy={busy || undefined}>
      <h4 className={styles.subTitle}>{title}</h4>
      <ul className={styles.chipList} aria-label={title}>
        {set.map((name) => (
          <li key={name} className={styles.chip} data-testid="engine-chip">
            <span className={styles.chipName} title={name}>{name}</span>
            <button type="button" className={styles.chipX} aria-label={`Remove ${name}`} onClick={() => onRemove(name)}><X size={13} strokeWidth={2} aria-hidden /></button>
          </li>
        ))}
        {!full && !adding ? (
          <li>
            <button type="button" className={cn(styles.chip, styles.chipAdd)} data-testid="engine-add" onClick={() => setAdding(true)}><Plus size={13} strokeWidth={2} aria-hidden />Add</button>
          </li>
        ) : null}
      </ul>
      {set.length === 0 && !adding ? <p className={styles.note} data-testid="engine-none">{emptyText}</p> : null}
      {adding && !full ? (
        <form className={styles.addForm} data-testid="engine-add-form" onSubmit={(event) => { event.preventDefault(); if (chosen) add(chosen); }}>
          <ArchetypeCombo label="Add an engine" text={text} names={names} placeholder="Argostars, Blue-Eyes…" onText={setText} />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={!chosen}>Add</button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setAdding(false); setText(""); }}>Cancel</button>
        </form>
      ) : null}
      {adding && error ? <p className={styles.note} role="alert">{error} <button type="button" className={styles.link} onClick={retry}>Try again</button></p> : null}
      {full ? <p className={styles.note}>Four engines is the most. Remove one to add another.</p> : null}
      {light && light.length > 0 ? (
        <p className={styles.also} data-testid="engine-also">
          <span>Also in deck:</span>
          {light.map((engine) => (
            <button key={engine.name} type="button" className={styles.alsoItem} disabled={full} aria-label={`Add ${engine.name}, ${engine.copies} ${engine.copies === 1 ? "card" : "cards"} in deck`} onClick={() => onAdd(engine.name)}>
              {engine.name} <span className="num">{engine.copies}</span><Plus size={12} strokeWidth={2} aria-hidden />
            </button>
          ))}
        </p>
      ) : null}
      {edited && onReset ? <button type="button" className={styles.link} data-testid="engine-reset" onClick={onReset}>{resetLabel}</button> : null}
    </div>
  );
}
