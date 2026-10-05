"use client";

import * as React from "react";
import type { PoolTallyCounts } from "./pool-model";
import { thumbUrl } from "./pool-model";
import styles from "./pool.module.css";

/** Monsters, spells and traps with their copies. */
export function Tally({ counts }: { counts: PoolTallyCounts }) {
  return (
    <p className={styles.tally}>
      <span style={{ "--k": "var(--k-mon)" } as React.CSSProperties}>
        <b>{counts.monsters}</b>Monsters
      </span>
      <span style={{ "--k": "var(--k-spell)" } as React.CSSProperties}>
        <b>{counts.spells}</b>Spells
      </span>
      <span style={{ "--k": "var(--k-trap)" } as React.CSSProperties}>
        <b>{counts.traps}</b>Traps
      </span>
    </p>
  );
}

export function CardThumb({ id, src, className }: { id: number; src?: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={thumbUrl(id)} alt="" loading="lazy" decoding="async" />
  );
}

export function Thumbs({ cards }: { cards: Array<{ id: number; src?: string }> }) {
  return (
    <ul className={styles.thumbs} aria-hidden="true">
      {cards.map((c) => (
        <li key={c.id}>
          <CardThumb id={c.id} src={c.src} />
        </li>
      ))}
    </ul>
  );
}
