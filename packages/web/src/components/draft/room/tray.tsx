"use client";

import { memo } from "react";
import { KINDS, KIND_LABEL, mixGradient, type Kind, type KindCounts, type RoomCard } from "./room-model";

export interface TrayProps {
  done: number;
  of: number;
  label: string;
  counts: KindCounts;
  /** The latest pick of each kind, shown in its slot. */
  last: Partial<Record<Kind, RoomCard>>;
  active: ReadonlySet<Kind>;
  landed: { kind: Kind; seq: number } | null;
  onDial: () => void;
  onKind: (kind: Kind) => void;
}

/** The duel disk: a dial that fills toward your deck, and four counters that double as filters. */
export const Tray = memo(function Tray(p: TrayProps) {
  return (
    <div className="disk">
      <button className="dial" type="button" aria-controls="binder" aria-label={`Your picks: ${p.done} of ${p.of}. Open your picks.`} onClick={p.onDial}>
        <span className="face" style={{ "--mix": mixGradient(p.counts, Math.max(1, p.of)) } as React.CSSProperties}>
          <b>{p.done}</b>
        </span>
        <span className="lbl">
          <em>
            <i className="lamp" />
            Your picks
          </em>
          <small>{p.label}</small>
        </span>
      </button>
      {KINDS.map((k) => {
        const land = p.landed && p.landed.kind === k ? p.landed.seq : 0;
        const card = p.last[k];
        return (
          <button
            key={k}
            className="slot"
            type="button"
            data-kind={k}
            data-land={land ? "" : undefined}
            aria-pressed={p.active.has(k)}
            aria-label={`${p.counts[k]} ${KIND_LABEL[k]}. Show them.`}
            onClick={() => p.onKind(k)}
          >
            <span className="win" key={`w${land}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {card ? <img src={card.imageUrlSmall || card.imageUrl} alt="" /> : null}
            </span>
            <b key={`b${land}`} className={land ? "bump" : undefined}>
              {p.counts[k]}
            </b>
            <small>
              <i />
              {KIND_LABEL[k]}
            </small>
          </button>
        );
      })}
    </div>
  );
});
