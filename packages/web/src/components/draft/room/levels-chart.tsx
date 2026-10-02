"use client";

import { memo } from "react";
import { levelsModel, type RoomCard, type TierKey } from "./room-model";

/** Monster levels: one bar per star level for main deck monsters, grouped by what a summon costs. Each group is a filter. */
export const LevelsChart = memo(function LevelsChart({
  cards,
  selected,
  onToggle,
}: {
  cards: RoomCard[];
  selected: ReadonlySet<TierKey>;
  onToggle: (key: TierKey) => void;
}) {
  const m = levelsModel(cards);
  if (m.empty) return <p className="lv-empty">Monster levels show here once you pick a monster.</p>;
  return (
    <>
      <div className="lv-h">
        <span>Monster levels</span>
        <small>Main deck, by stars</small>
      </div>
      <div className="lv-chart">
        {m.bands.map((b) => (
          <button
            key={b.key}
            type="button"
            data-g="lvl"
            data-k={b.key}
            aria-pressed={selected.has(b.key)}
            aria-label={`${b.label}, level ${b.lo} to ${b.hi}: ${b.total} monster${b.total === 1 ? "" : "s"}`}
            style={{ "--cols": b.hi - b.lo + 1 } as React.CSSProperties}
            onClick={() => onToggle(b.key)}
          >
            <span className="lbars" aria-hidden="true">
              {b.bars.map((bar) => (
                <span key={bar.level} className="lb" style={{ "--h": bar.h } as React.CSSProperties} data-zero={bar.n ? undefined : ""}>
                  <span className="lbx">
                    <i />
                    <b>{bar.n || ""}</b>
                  </span>
                  <small>{bar.level}</small>
                </span>
              ))}
            </span>
            <span className="lt">
              {b.label} <b>{b.total}</b>
            </span>
          </button>
        ))}
      </div>
      {m.extra.length ? (
        <p className="lv-ex">
          <span>Extra deck</span>
          {m.extra.map((e) => (
            <span key={e.name}>
              {e.name} <b>{e.n}</b>
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
});
