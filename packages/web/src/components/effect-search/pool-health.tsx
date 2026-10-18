"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import type { CardPoolHealth } from "@yugidraft/shared/services";
import { EffectCredit } from "./batch-bar";
import styles from "./effect-search.module.css";

export interface PoolHealthEntry {
  cubeId: number;
  cubeName: string;
  /** Null when the server could not read the pool's health. */
  health: CardPoolHealth | null;
}

const UNAVAILABLE = "Pool health is unavailable";

/** The pool health a preflight answer carries. Anything that does not fit the shape is dropped, so a bad answer shows nothing. */
export function parsePoolHealth(data: unknown): PoolHealthEntry[] {
  const list = (data as { poolHealth?: unknown } | null)?.poolHealth;
  if (!Array.isArray(list)) return [];
  const out: PoolHealthEntry[] = [];
  for (const raw of list) {
    const row = raw as Partial<PoolHealthEntry> | null;
    if (!row || typeof row.cubeId !== "number" || typeof row.cubeName !== "string") continue;
    const health = row.health;
    const ok = health && typeof health === "object" && Array.isArray(health.warnings) && health.roles && health.extraDeck;
    out.push({ cubeId: row.cubeId, cubeName: row.cubeName, health: ok ? (health as CardPoolHealth) : null });
  }
  return out;
}

/**
 * The preflight puts each health note in its `warnings` too, prefixed with the cube name. The health block shows
 * them, so they leave the plain list: no player reads the same line twice.
 */
export function withoutHealthWarnings(warnings: readonly string[], entries: readonly PoolHealthEntry[]): string[] {
  if (entries.length === 0) return [...warnings];
  const seen = new Set<string>();
  for (const { cubeName, health } of entries) {
    for (const w of health?.warnings ?? []) seen.add(`${cubeName}: ${w}`);
    if (!health) seen.add(`${cubeName}: ${UNAVAILABLE}`);
  }
  return warnings.filter((w) => !seen.has(w) && !entries.some((e) => !e.health && w.startsWith(`${e.cubeName}: ${UNAVAILABLE}`)));
}

function counts(health: CardPoolHealth): Array<[string, number]> {
  const rows: Array<[string, number]> = [
    ["Cards", health.cards],
    ["Searchers", health.roles.searchers],
    ["Extenders", health.roles.extenders],
    ["Removal", health.roles.removal],
    ["Hand traps", health.roles.handTraps],
  ];
  const x = health.extraDeck;
  if (x.synchro) rows.push(["Synchro", x.synchro], ["Tuners", x.tuners]);
  if (x.fusion) rows.push(["Fusion", x.fusion]);
  if (x.xyz) rows.push(["Xyz", x.xyz]);
  if (x.link) rows.push(["Link", x.link]);
  return rows;
}

/** Warnings only: what the cubes in the draft may lack. It never blocks the start. */
export function PoolHealth({ entries }: { entries: readonly PoolHealthEntry[] }) {
  const headingId = React.useId();
  if (entries.length === 0) return null;
  return (
    <section className={styles.health} aria-labelledby={headingId} data-testid="pool-health">
      <h3 className={styles.healthHead} id={headingId}>
        Pool health
      </h3>
      {entries.map(({ cubeId, cubeName, health }) => (
        <div key={cubeId} className={styles.healthCube}>
          <p className={styles.healthName}>{cubeName}</p>
          {health ? (
            <>
              <ul className={styles.counts} aria-label={`Counts for ${cubeName}`}>
                {counts(health).map(([label, n]) => (
                  <li key={label}>
                    {label} <b>{n}</b>
                  </li>
                ))}
              </ul>
              {health.warnings.length > 0 ? (
                <ul className={styles.healthWarn}>
                  {health.warnings.map((w) => (
                    <li key={w}>
                      <TriangleAlert aria-hidden="true" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.readNote}>No gaps found.</p>
              )}
            </>
          ) : (
            <ul className={styles.healthWarn}>
              <li>
                <TriangleAlert aria-hidden="true" />
                <span>Pool health is unavailable for this cube. The card supply checks still apply.</span>
              </li>
            </ul>
          )}
        </div>
      ))}
      <EffectCredit />
    </section>
  );
}
