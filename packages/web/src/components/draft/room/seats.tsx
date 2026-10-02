"use client";

import { memo, useEffect, useRef } from "react";
import { animate, motionCalm } from "./motion";
import { ARROW } from "./card-img";
import { hue, initials, type SeatLike, type SeatState } from "./room-model";

export interface FriendView {
  /** Table index: 1 is first on your left. */
  index: number;
  seat: SeatLike;
  packN: number;
  state: SeatState;
}

function Avatar({ name, picked }: { name: string; picked: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const was = useRef(picked);
  // a friend locking in nods, once, in the step they were still picking
  useEffect(() => {
    if (!was.current && picked && !motionCalm()) {
      animate(ref.current, [{ transform: "none" }, { transform: "translateY(-3px) scale(1.1)" }, { transform: "none" }], {
        duration: 380,
        easing: "ease-out",
      });
    }
    was.current = picked;
  }, [picked]);
  return (
    <i ref={ref} className="av" style={{ "--hue": hue(name) } as React.CSSProperties} aria-hidden="true">
      {initials(name)}
    </i>
  );
}

const stateLabel = (s: SeatState) => (s === "picked" ? "Picked" : "Picking");

/** Friends sit around the table, drawn upright and pinned to where their anchor lands on the tilted mat. */
export const Seats = memo(function Seats({
  friends,
  positions,
  theme,
}: {
  friends: FriendView[];
  positions: Record<number, { x: number; y: number }>;
  theme: boolean;
}) {
  return (
    <div>
      {friends.map((f) => {
        const p = positions[f.index];
        return (
          <div
            key={f.seat.playerId}
            className="seat"
            data-seat={f.index}
            data-state={f.state}
            style={p ? { left: p.x, top: p.y } : { left: "50%", top: -200 }}
          >
            <div className="who">
              <i className="sky" />
              <Avatar name={f.seat.displayName} picked={f.seat.hasPicked} />
              <div className="pk">
                <i />
                <b>{f.packN}</b>
              </div>
            </div>
            <div className="nm">{f.seat.displayName}</div>
            <div className="st">
              <span className="stx">{stateLabel(f.state)}</span>
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
});

/** On a phone the friends sit in a strip above the table. */
export const SeatStrip = memo(function SeatStrip({ friends }: { friends: FriendView[] }) {
  return (
    <div className="seatstrip">
      <span className="dir" title="Pass direction">
        {ARROW}
      </span>
      {friends.map((f) => (
        <div key={f.seat.playerId} className="chip-seat" data-seat={f.index} data-state={f.state} title={f.seat.displayName}>
          <Avatar name={f.seat.displayName} picked={f.seat.hasPicked} />
          <i className="mp" />
          <span className="nm">{f.seat.displayName}</span>
        </div>
      ))}
    </div>
  );
});
