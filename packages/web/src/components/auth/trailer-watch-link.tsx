"use client";

import { TRAILER_WATCH_URL } from "./community-links";
import { TrailerDialog, useTrailerDialog } from "./trailer-dialog";
import styles from "./sign-in-shell.module.css";

/**
 * Trailer link for phones and narrow windows, where the side panel is hidden. A plain click opens the overlay; it stays a real
 * link, so modified clicks and middle clicks (and browsers without script) still open YouTube in a new tab.
 */
export function TrailerWatchLink() {
  const { open, show, close } = useTrailerDialog();

  return (
    <>
      <a
        className={styles["community-link"]}
        href={TRAILER_WATCH_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-haspopup="dialog"
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          show(event);
        }}
      >
        <span>Watch the trailer</span>
        <span className={styles.sr}> (opens a video player)</span>
      </a>
      <TrailerDialog open={open} onClose={close} />
    </>
  );
}
