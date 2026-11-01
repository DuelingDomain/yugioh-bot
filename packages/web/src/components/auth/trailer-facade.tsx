"use client";

import { TRAILER_POSTER_SRC } from "./community-links";
import { TrailerDialog, useTrailerDialog } from "./trailer-dialog";
import styles from "./sign-in-shell.module.css";

/** Launch trailer thumbnail. The poster is a local file; nothing is requested from YouTube until the button opens the overlay. */
export function TrailerFacade() {
  const { open, show, close } = useTrailerDialog();

  return (
    <section className={styles.trailer} aria-labelledby="trailer-title">
      <h2 className={styles["trailer-cap"]} id="trailer-title">Launch trailer</h2>
      <div className={styles["trailer-window"]}>
        <img
          className={styles["trailer-poster"]}
          src={TRAILER_POSTER_SRC}
          alt=""
          width="1440"
          height="900"
          loading="lazy"
          decoding="async"
        />
        <button className={styles["trailer-play"]} type="button" aria-haspopup="dialog" onClick={show}>
          <span className={styles["trailer-disc"]}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M6 3.5v17L21 12Z" /></svg>
          </span>
          <span className={styles["trailer-label"]}>Watch trailer<span className={styles.sr}> in a large player</span></span>
        </button>
      </div>
      <TrailerDialog open={open} onClose={close} />
    </section>
  );
}
