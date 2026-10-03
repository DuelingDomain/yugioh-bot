"use client";

import * as React from "react";
import { Plus, Search } from "lucide-react";
import { svButtonClass } from "@/components/sheet";
import styles from "./create.module.css";

interface ArchetypeAddProps {
  /** Called with the chosen archetype name (from a suggestion or the Add button). */
  onSelect: (archetype: string) => void;
  inputId?: string;
  label?: string;
  hint?: React.ReactNode;
}

/**
 * Match Sheet version of the archetype type-ahead used by the cube draft form: debounced
 * suggestions from `/api/archetypes`, graceful when the API can't be reached. It only emits
 * the chosen name; the form decides how to resolve the archetype's cards. (The shared
 * `cubes/archetype-search` stays as it is for the cube editor.)
 */
export function ArchetypeAdd({
  onSelect,
  inputId = "draft-archetype-search",
  label = "Add a whole archetype",
  hint,
}: ArchetypeAddProps) {
  const [query, setQuery] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const reqId = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const myReq = ++reqId.current;
    const t = setTimeout(() => {
      fetch(`/api/archetypes?query=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? res.json() : { archetypes: [] }))
        .then((data: { archetypes: string[] }) => {
          if (myReq === reqId.current) setSuggestions((data.archetypes ?? []).slice(0, 8));
        })
        .catch(() => {
          if (myReq === reqId.current) setSuggestions([]);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const choose = (name: string) => {
    const archetype = name.trim();
    if (!archetype) return;
    onSelect(archetype);
    setQuery("");
    setSuggestions([]);
  };

  return (
    <div>
      <label className="label" htmlFor={inputId}>
        {label}
      </label>
      <div className={styles.search}>
        <span className={styles.in}>
          <Search className="ic sm" aria-hidden="true" />
          <input
            className="input"
            id={inputId}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                choose(query);
              }
            }}
            placeholder="Blue-Eyes, Dark Magician, Lightsworn"
            autoComplete="off"
          />
          {suggestions.length > 0 && (
            <ul className={styles.suggest} aria-label="Archetype suggestions">
              {suggestions.map((name) => (
                <li key={name}>
                  <button type="button" onClick={() => choose(name)}>
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
        <button
          className={svButtonClass("ghost")}
          type="button"
          disabled={query.trim().length === 0}
          onClick={() => choose(query)}
        >
          <Plus className="ic sm" aria-hidden="true" />
          Add
        </button>
      </div>
      {hint}
    </div>
  );
}
