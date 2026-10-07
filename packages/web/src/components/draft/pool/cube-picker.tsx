"use client";

import * as React from "react";
import { Search } from "lucide-react";
import type { CubeOption } from "./pool-api";
import { cubeCardCount } from "./pool-model";
import { CardThumb } from "./pool-bits";
import styles from "./pool.module.css";

interface CubePickerProps {
  cubes: CubeOption[];
  userId: string | null;
  selectedId: number | null;
  /** Picking another cube drops the edits made for this draft. */
  hasEdits: boolean;
  /** Cards in your own pool that picking a cube replaces (they come back with "Start from scratch"). */
  replaces?: number;
  picking: number | null;
  error: string | null;
  keepName: string | null;
  onPick: (id: number) => void;
  onKeep: () => void;
}

/** A searchable list of cubes: name, card count, who made it, and three thumbnails. Not a native select. */
export function CubePicker({ cubes, userId, selectedId, hasEdits, replaces = 0, picking, error, keepName, onPick, onKeep }: CubePickerProps) {
  const [query, setQuery] = React.useState("");
  const listId = React.useId();
  const q = query.trim().toLowerCase();
  const list = cubes.filter(
    (c) => !q || c.name.toLowerCase().includes(q) || (c.createdByName ?? "").toLowerCase().includes(q),
  );
  return (
    <div className={styles.picker}>
      <div className={styles.in}>
        <Search size={16} aria-hidden="true" />
        <input
          className="input"
          type="search"
          placeholder="Search cubes"
          aria-label="Search cubes"
          aria-controls={listId}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>
      {hasEdits ? (
        <p className={styles.pkNote}>Your edits for this draft are dropped if you pick another cube.</p>
      ) : replaces > 0 ? (
        <p className={styles.pkNote}>
          Picking a cube replaces your {replaces.toLocaleString("en-US")} {replaces === 1 ? "card" : "cards"}. Start from scratch brings them back.
        </p>
      ) : null}
      {error && (
        <p className={`${styles.note} ${styles.bad}`} role="alert">
          <span>{error}</span>
        </p>
      )}
      <ul className={styles.pkList} id={listId} aria-label="Cubes">
        {list.length === 0 && <li className={styles.pkEmpty}>No cube matches that.</li>}
        {list.map((cube) => {
          const count = cubeCardCount(cube);
          const mine = userId !== null && cube.createdByUserId === userId;
          const by = mine ? "you" : cube.createdByName;
          return (
            <li key={cube.id}>
              <button
                type="button"
                className={styles.pkRow}
                aria-pressed={selectedId === cube.id}
                aria-busy={picking === cube.id || undefined}
                disabled={picking !== null}
                onClick={() => onPick(cube.id)}
              >
                <span>
                  <span className={styles.pkName}>{cube.name}</span>
                  <span className={styles.pkSub}>
                    {count !== null ? (
                      <span>
                        <span className={styles.count}>{count}</span>
                        {count === 1 ? "card" : "cards"}
                      </span>
                    ) : (
                      <span>Built from sets</span>
                    )}
                    {by && <span>by {by}</span>}
                  </span>
                </span>
                <span className={styles.mini} aria-hidden="true">
                  {cube.thumbIds.map((id) => (
                    <CardThumb key={id} id={id} />
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {keepName && (
        <div>
          <button type="button" className={styles.textBtn} onClick={onKeep}>
            Keep {keepName}
          </button>
        </div>
      )}
    </div>
  );
}
