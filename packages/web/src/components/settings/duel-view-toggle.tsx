"use client";

import * as React from "react";
import { FloorList, FloorRow, SectionHead } from "@/components/sheet";
import { useBoardView } from "@/components/duel/board-view";
import styles from "./duel-view-toggle.module.css";

/**
 * The "This device" section. The 3D mode setting lives in this browser only (localStorage), so it has its own
 * heading: the page's "For the whole server" line does not cover it.
 */
export function DuelViewToggle() {
  const view = useBoardView();
  const id = React.useId();
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  return (
    <section className="set-sec" aria-labelledby="set-device" data-device-settings="">
      <div className="set-intro">
        <h2 id="set-device">This device</h2>
        <p>Saved in this browser only. Other people on the server and your other devices are not changed.</p>
      </div>
      <div className={styles.block}>
        <SectionHead as="h3" title="Duel board" note="this browser" />
        <FloorList>
          <FloorRow className={styles.row}>
            <div className="sv-cell-grow">
              <p className={styles.title} id={labelId}>3D mode</p>
              <p className={styles.note} id={helpId}>
                Show 1v1 duels on the tilted Solid Vision table. Off uses the classic board.
              </p>
            </div>
            <span className="sv-cell-end">
              <input
                className={styles.switch}
                type="checkbox"
                role="switch"
                checked={view.mode === "3d"}
                aria-labelledby={labelId}
                aria-describedby={helpId}
                onChange={(event) => view.setMode(event.target.checked ? "3d" : "classic")}
              />
            </span>
          </FloorRow>
        </FloorList>
      </div>
    </section>
  );
}
