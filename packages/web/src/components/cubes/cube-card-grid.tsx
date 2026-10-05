"use client";

import { cardImageUrl } from "@/lib/card-image-url";
import * as React from "react";
import type { CardSummary } from "@/lib/card-types";
import styles from "./cubes.module.css";

export interface UnknownEntry {
  id: number;
  copies: number;
}

function copiesWord(n: number): string {
  return n === 1 ? "copy" : "copies";
}

/** The pool as cards, copies stamped on. A click selects; only a button removes. */
export function CubeCardGrid({
  label,
  cards,
  unknown,
  selectedId,
  onSelect,
}: {
  label: string;
  /** `qty` carries the copies. */
  cards: CardSummary[];
  unknown: UnknownEntry[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <ul className="ce-grid" aria-label={label}>
      {cards.map((card) => {
        const n = card.qty ?? 1;
        const sel = selectedId === card.id;
        return (
          <li key={card.id} className={`ct${sel ? " sel" : ""}`}>
            <button
              type="button"
              aria-label={`${card.name}, ${n} ${copiesWord(n)}`}
              aria-pressed={sel}
              onClick={() => onSelect(card.id)}
            >
              <span className="ct-art">
                <img src={cardImageUrl(card.id, "small")} alt="" loading="lazy" decoding="async" />
                <span className={`ct-x${n < 3 ? " lo" : ""}`} aria-hidden="true">
                  ×{n}
                </span>
              </span>
              <span className="ct-n">{card.name}</span>
            </button>
          </li>
        );
      })}
      {unknown.map(({ id, copies }) => {
        const sel = selectedId === id;
        return (
          <li key={`unknown-${id}`} className={`ct${sel ? " sel" : ""}`} data-testid="card-pool-grid-unknown">
            <button
              type="button"
              aria-label={`Passcode ${id} not in catalog yet, ${copies} ${copiesWord(copies)}`}
              aria-pressed={sel}
              onClick={() => onSelect(id)}
            >
              <span className="ct-art">
                <span className={styles.unknownArt}>{id}</span>
                <span className={`ct-x${copies < 3 ? " lo" : ""}`} aria-hidden="true">
                  ×{copies}
                </span>
              </span>
              <span className="ct-n">not in catalog yet</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
