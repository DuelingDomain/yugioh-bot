"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { foldCardText } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import styles from "./bridges.module.css";

/** An archetype box with a list of the names that fit. The text is the choice once it is a whole name. */
export function ArchetypeCombo({ label, text, names, onText, placeholder, autoFocus = false }: {
  label: string;
  text: string;
  names: readonly string[] | null;
  onText: (text: string) => void;
  placeholder: string;
  /** Take the focus at once. While the names load the box is read-only, so the focus never drops to the page. */
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ready = names != null;
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
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
          ref={inputRef}
          className={cn("input", styles.comboInput)}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
          placeholder={names ? placeholder : "Loading archetypes…"}
          value={text}
          readOnly={!ready}
          aria-busy={!ready || undefined}
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
export function wholeName(text: string, names: readonly string[] | null): string | null {
  const folded = text.trim().toLowerCase();
  return folded && names ? names.find((name) => name.toLowerCase() === folded) ?? null : null;
}
