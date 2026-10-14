"use client";

import { useEffect, useRef, useState } from "react";
import { TRAILER_EMBED_URL, TRAILER_POSTER_SRC } from "./community-links";
import styles from "./sign-in-shell.module.css";

/** Click-to-load launch trailer. The poster is a local file; nothing is requested from YouTube until the play button is used. */
export function TrailerFacade() {
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (playing) frameRef.current?.focus();
  }, [playing]);

  return (
    <section className={styles.trailer} aria-labelledby="trailer-title">
      <h2 className={styles["trailer-cap"]} id="trailer-title">Launch trailer</h2>
      <div className={`${styles["trailer-window"]} ${playing ? styles["is-playing"] : ""}`}>
        {playing ? (
          <iframe
            ref={frameRef}
            className={styles["trailer-frame"]}
            src={TRAILER_EMBED_URL}
            title="Launch trailer"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <>
            <img
              className={styles["trailer-poster"]}
              src={TRAILER_POSTER_SRC}
              alt="Illustration of a three-player card table using original card backs. Poster for the launch trailer."
              width="1440"
              height="900"
              loading="lazy"
              decoding="async"
            />
            <button className={styles["trailer-play"]} type="button" aria-label="Play the launch trailer" onClick={() => setPlaying(true)}>
              <span className={styles["trailer-disc"]}>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M6 3.5v17L21 12Z" /></svg>
              </span>
            </button>
          </>
        )}
      </div>
    </section>
  );
}
