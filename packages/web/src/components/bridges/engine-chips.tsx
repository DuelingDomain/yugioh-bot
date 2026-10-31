"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { DetectedEngine } from "@/lib/bridges-api";
import { cn } from "@/lib/utils";
import { ArchetypeCombo, wholeName } from "./archetype-combo";
import { MAX_ENGINES } from "./engines-model";
import { useArchetypeNames } from "./use-engines";
import styles from "./bridges.module.css";

/**
 * The engines the Bridges tab works on, as chips. A chip has a ×; the groups that are only a little in the deck wait
 * under "Also in deck" with a +; "+ Add" takes any archetype by name. Four is the most. The chips change the
 * Bridges tab only. A control that goes away when it is used gives the keyboard focus to the next one.
 */
export function EngineChips({ title, set, light, edited, busy, keepOne, onRemove, onAdd, onReset, resetLabel = "Reset to deck", emptyText }: {
  title: string;
  set: readonly string[];
  /** Groups in the deck that are not in the set. Pick mode has none. */
  light?: readonly DetectedEngine[];
  edited?: boolean;
  /** The answer for the set is on its way. */
  busy?: boolean;
  /** The last chip stays: the deck always keeps one engine. */
  keepOne?: boolean;
  onRemove: (name: string) => void;
  onAdd: (name: string) => void;
  onReset?: () => void;
  resetLabel?: string;
  /** What an empty set says. Nothing: the tab says it once, below. */
  emptyText?: string;
}) {
  const full = set.length >= MAX_ENGINES;
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const { names: all, error, retry } = useArchetypeNames(adding);
  const names = useMemo(() => (all ? all.filter((name) => !set.some((have) => have.toLowerCase() === name.toLowerCase())) : null), [all, set]);
  const chosen = wholeName(text, names);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  // Where the focus goes once the chips have changed: the × of a chip, or the Add chip.
  const [focusNext, setFocusNext] = useState<{ name: string | null; tick: number } | null>(null);
  const moveFocus = (name: string | null) => setFocusNext((before) => ({ name, tick: (before?.tick ?? 0) + 1 }));
  useEffect(() => {
    if (!focusNext) return;
    const chip = focusNext.name ? removeButtons.current.get(focusNext.name) : undefined;
    const last = [...removeButtons.current.values()].filter((button) => !button.disabled).at(-1);
    const target = (chip && !chip.disabled ? chip : null) ?? addButton.current ?? last;
    target?.focus();
    setFocusNext(null);
  }, [focusNext, set, adding]);
  const lastStays = keepOne && set.length === 1;

  function add(name: string) {
    onAdd(name);
    setText("");
    setAdding(false);
    moveFocus(null);
  }

  function remove(name: string, index: number) {
    const left = set.filter((item) => item !== name);
    onRemove(name);
    moveFocus(keepOne && left.length === 1 ? null : left[index] ?? left[index - 1] ?? null);
  }

  return (
    <div className={styles.chips} data-testid="engine-chips" aria-busy={busy || undefined}>
      <h4 className={styles.subTitle}>{title}</h4>
      <div className={styles.chipRow}>
        <ul className={styles.chipList} aria-label={title}>
          {set.map((name, index) => (
            <li key={name} className={styles.chip} data-testid="engine-chip">
              <span className={styles.chipName} title={name}>{name}</span>
              <button type="button" className={styles.chipX} aria-label={`Remove ${name}`} disabled={lastStays}
                title={lastStays ? "Keep one engine. Add another one first." : undefined}
                ref={(node) => { if (node) removeButtons.current.set(name, node); else removeButtons.current.delete(name); }}
                onClick={() => remove(name, index)}><X size={13} strokeWidth={2} aria-hidden /></button>
            </li>
          ))}
          {!full && !adding ? (
            <li>
              <button ref={addButton} type="button" className={cn(styles.chip, styles.chipAdd)} data-testid="engine-add" onClick={() => setAdding(true)}><Plus size={13} strokeWidth={2} aria-hidden />Add</button>
            </li>
          ) : null}
        </ul>
        {/* Next to the list, not in it: a screen reader counts the chips and nothing else. */}
        {edited && onReset ? (
          <button type="button" className={cn(styles.link, styles.chipReset)} data-testid="engine-reset" onClick={() => { onReset(); moveFocus(null); }}>{resetLabel}</button>
        ) : null}
      </div>
      {set.length === 0 && !adding && emptyText ? <p className={styles.note} data-testid="engine-none">{emptyText}</p> : null}
      {adding && !full ? (
        <form className={styles.addForm} data-testid="engine-add-form" onSubmit={(event) => { event.preventDefault(); if (chosen) add(chosen); }}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setAdding(false); setText(""); moveFocus(null); } }}>
          <ArchetypeCombo label="Add an engine" text={text} names={names} placeholder="Argostars, Blue-Eyes…" onText={setText} autoFocus />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={!chosen}>Add</button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setAdding(false); setText(""); moveFocus(null); }}>Cancel</button>
        </form>
      ) : null}
      {adding && error ? <p className={styles.note} role="alert">{error} <button type="button" className={styles.link} onClick={retry}>Try again</button></p> : null}
      {full ? <p className={styles.note}>Four engines is the most. Remove one to add another.</p> : null}
      {light && light.length > 0 ? (
        <p className={styles.also} data-testid="engine-also">
          <span>Also in deck:</span>
          {light.map((engine) => (
            <button key={engine.name} type="button" className={styles.alsoItem} disabled={full} aria-label={`Add ${engine.name}, ${engine.copies} ${engine.copies === 1 ? "card" : "cards"} in deck`} onClick={() => { onAdd(engine.name); moveFocus(engine.name); }}>
              {engine.name} <span className="num">{engine.copies}</span><Plus size={12} strokeWidth={2} aria-hidden />
            </button>
          ))}
        </p>
      ) : null}
    </div>
  );
}
