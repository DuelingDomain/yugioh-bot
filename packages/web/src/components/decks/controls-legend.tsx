"use client";

import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { ChevronDown } from "lucide-react";
import { isMacPlatform } from "./card-press";
import styles from "./editor.module.css";

/** One way to do an action: keys pressed together, shown as one chip each. */
type Combo = string[];
type Row = { action: string; keys: Combo[] };
type Group = { title: string; rows: Row[] };

const OPEN_KEY = "deck-controls-open";

const noSubscribe = () => () => {};
/** False on the server and during hydration, then the real platform: no mismatch, no flash of the wrong key. */
function useModifier() {
  const mac = useSyncExternalStore(noSubscribe, isMacPlatform, () => false);
  return mac ? "Cmd" : "Ctrl";
}

function Keys({ keys }: { keys: Combo[] }) {
  return (
    <>
      {keys.map((combo, index) => (
        <Fragment key={combo.join("+")}>
          {index > 0 ? <span className={styles["de-lg-or"]}>or</span> : null}
          <span className={styles["de-lg-combo"]}>
            {combo.map((key, at) => (
              <Fragment key={key}>
                {at > 0 ? <span className={styles["de-lg-plus"]} aria-hidden>+</span> : null}
                <kbd>{key}</kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className={styles["de-lg-rows"]}>
      {rows.map((row) => (
        <div key={row.action}>
          <dt>{row.action}</dt>
          <dd><Keys keys={row.keys} /></dd>
        </div>
      ))}
    </dl>
  );
}

/** The few controls used most, then every control behind a disclosure. The phone line says what a touch does. */
export function ControlsLegend({ phone = false, domain = false }: { phone?: boolean; domain?: boolean }) {
  const mod = useModifier();
  const [open, setOpen] = useState(false);
  // The saved choice is read after mount, so the server markup and the first client render agree.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(OPEN_KEY) === "1") setOpen(true);
    } catch {
      /* Storage can be blocked. The panel then starts closed each time. */
    }
  }, []);
  if (phone) {
    return <p className={styles["de-legend-phone"]}>Tap: select a card · Hold: change art</p>;
  }

  // Domain has one copy of a card and no Side Deck, so the rows for those do not show there.
  const quick: Row[] = [
    { action: "Remove a deck card", keys: [["Click"]] },
    { action: "Change art", keys: [["Right-click"]] },
    ...(domain ? [] : [{ action: "Move to Side Deck", keys: [[mod, "Click"]] }]),
    { action: "Add from card list", keys: [["Double-click"]] },
  ];
  const groups: Group[] = [
    {
      title: "Deck cards",
      rows: [
        { action: "Remove", keys: [["Click"]] },
        { action: "Change art", keys: [["Right-click"]] },
        ...(domain ? [{ action: "Set as Deck Master (monster)", keys: [["Crown"]] }] : [
          { action: "To or from Side Deck", keys: [[mod, "Click"]] },
          { action: "Add a copy", keys: [[mod, "Right-click"]] },
        ]),
      ],
    },
    {
      title: "Card list",
      rows: [
        { action: "Preview", keys: [["Click"]] },
        { action: "Add", keys: [["Double-click"], ["Right-click"]] },
      ],
    },
    {
      title: "Keyboard, focused card",
      rows: [
        { action: "Select", keys: [["Enter"], ["Space"]] },
        { action: "Remove", keys: [["Delete"]] },
        ...(domain ? [{ action: "Set as Deck Master", keys: [["M"]] }] : [
          { action: "Add a copy", keys: [["+"], ["="]] },
          { action: "To or from Side Deck", keys: [[mod, "Enter"]] },
        ]),
        { action: "Change art", keys: [["Menu"], ["Shift", "F10"]] },
      ],
    },
  ];

  return (
    <section className={styles["de-legend"]} aria-label="Controls">
      <details
        className={styles["de-lg-all"]}
        open={open}
        onToggle={(event) => {
          const next = event.currentTarget.open;
          setOpen(next);
          try {
            window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
          } catch {
            /* Storage can be blocked. The choice then lasts until the page closes. */
          }
        }}
      >
        <summary>
          <h3 className={styles["de-legend-h"]}>Controls</h3>
          <span className={styles["de-lg-toggle"]}>All controls<ChevronDown className="ic sm" aria-hidden /></span>
        </summary>
        {groups.map((group) => (
          <div key={group.title} className={styles["de-lg-group"]}>
            <h4 className={styles["de-legend-k"]}>{group.title}</h4>
            <Rows rows={group.rows} />
          </div>
        ))}
      </details>
      {open ? null : <Rows rows={quick} />}
    </section>
  );
}
