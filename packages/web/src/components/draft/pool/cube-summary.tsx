"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import type { PoolEditor } from "./use-pool-editor";
import { extraNote, tallyCopies, totalCopies } from "./pool-model";
import { Tally, Thumbs } from "./pool-bits";
import styles from "./pool.module.css";

/**
 * The chosen cube as one card: name, how many cards, the tally and a strip of thumbnails. In the lobby it is
 * "From Goat cube" (and ", edited" once the pool differs) and shows the draft's own pool.
 */
export function CubeSummary({
  ctl,
  lobby,
  onChange,
  extraRound = false,
}: {
  ctl: PoolEditor;
  lobby: boolean;
  onChange?: () => void;
  /** True when the draft has an Extra Deck round, so the cube's Extra pool is dealt and needs no note. */
  extraRound?: boolean;
}) {
  const meta = ctl.meta;
  const source = lobby ? ctl.pool : ctl.base;
  const extraSource = lobby ? ctl.extra : ctl.baseExtra;
  const counts = React.useMemo(() => tallyCopies(source, ctl.info), [source, ctl.info]);
  const thumbs = React.useMemo(() => {
    const out: Array<{ id: number; src?: string }> = [];
    for (const id of source.keys()) {
      out.push({ id, src: ctl.info(id)?.imageUrlSmall });
      if (out.length === 6) break;
    }
    return out;
  }, [source, ctl.info]);
  if (!meta) return null;
  const mine = ctl.userId !== null && meta.creatorId === ctl.userId;
  const by = mine ? "you" : meta.creatorName;
  const title = lobby ? `From ${meta.name}${ctl.edited ? ", edited" : ""}` : meta.name;
  const extraCopies = totalCopies(extraSource);
  const note = extraRound ? null : extraNote(extraCopies);
  return (
    <section className={styles.cube} aria-label="Chosen cube">
      <div className={styles.cubeTop}>
        <div className={styles.cubeHead}>
          <h3 className={styles.cubeName}>{title}</h3>
          <p className={styles.cubeBy}>{lobby ? "Saved with this draft" : by ? `By ${by}` : ""}</p>
        </div>
        <div className={styles.cubeLinks}>
          <a className={styles.lnk} href={`/cubes/${meta.cubeId}`} target="_blank" rel="noopener noreferrer">
            Open in editor <ExternalLink size={14} aria-hidden="true" />
            <span className={styles.sr}>(opens in a new tab)</span>
          </a>
          {!lobby && onChange && (
            <button type="button" className={styles.lnk} onClick={onChange}>
              Change cube
            </button>
          )}
        </div>
      </div>
      <div className={styles.cubeBody}>
        <div className={styles.cubeStack}>
          <p className={styles.cubeCount}>
            <b>{totalCopies(source)}</b>cards in the main pool
            <small>
              <b>{extraCopies}</b>in the Extra pool
            </small>
          </p>
          <Tally counts={counts} />
        </div>
        <Thumbs cards={thumbs} />
      </div>
      {note && <p className={styles.extraNote}>{note}</p>}
    </section>
  );
}
