"use client";

import { useLayoutEffect, useRef } from "react";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { cardArtUrl } from "./constants";
import { showcaseBox } from "./add-to-hand";
import { Track } from "./summon-fx";
import fx from "./move-fx.module.css";
import styles from "./add-fx.module.css";

export const CONFIRM_MS = 1500;

/** A historical confirmation shows a separate face briefly; it never changes the live card's zone. */
export function ConfirmGhost({ event, overlay, done }: {
  event: DuelEvent;
  overlay: HTMLElement;
  done: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const doneRef = useRef(done);
  doneRef.current = done;
  const box = showcaseBox(overlay.getBoundingClientRect());
  useLayoutEffect(() => {
    const track = new Track();
    track.play(root.current, [
      { opacity: 0, offset: 0 }, { opacity: 1, offset: 0.12 },
      { opacity: 1, offset: 0.88 }, { opacity: 0, offset: 1 },
    ], { duration: CONFIRM_MS, easing: "linear", fill: "both" });
    track.after(CONFIRM_MS, () => doneRef.current());
    return () => track.dispose();
  }, []);

  return (
    <div ref={root} style={{ opacity: 0 }}>
      <div className={fx.ghost} data-testid="confirmed-ghost" style={{
        left: box.cx - box.height * 0.686 / 2, top: box.cy - box.height / 2,
        width: box.height * 0.686, height: box.height,
      }}>
        <img className={fx.art} src={cardArtUrl(event.card!.code, "full")} alt="" draggable={false} />
      </div>
      <div className={styles.label} data-testid="confirmed-label" style={{ left: box.cx, top: box.cy + box.height / 2 + 8 }}>
        <span className={styles.title}>Confirmed</span>
        <span className={styles.source}>{event.card!.name}</span>
      </div>
    </div>
  );
}
