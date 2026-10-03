"use client";

import { memo, useEffect, useRef } from "react";
import { animate, motionCalm } from "./motion";
import { ARROW } from "./card-img";
import { hue, initials, seatLayout, stripEdges, type SeatLike, type SeatState } from "./room-model";

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
  const { side, far } = seatLayout(friends.length + 1);
  const onFarEdge = (index: number) => index > side && index <= side + far;
  // Use the projected room pixels: perspective can tighten an otherwise spacious row.
  const farPositions = friends
    .filter((f) => onFarEdge(f.index))
    .map((f) => positions[f.index])
    .filter((p) => p !== undefined)
    .sort((a, b) => a.x - b.x);
  const spacing = farPositions.slice(1).reduce((min, p, i) => Math.min(min, p.x - farPositions[i].x), Infinity);
  const compact = spacing < 96;
  const width = Math.max(0, Math.min(118, spacing - 12));

  return (
    <div>
      {friends.map((f) => {
        const p = positions[f.index];
        const farSeat = onFarEdge(f.index);
        return (
          <div
            key={f.seat.playerId}
            className="seat"
            data-seat={f.index}
            data-state={f.state}
            data-far={farSeat ? "" : undefined}
            data-compact={farSeat && compact ? "" : undefined}
            data-dots-only={farSeat && width < 72 ? "" : undefined}
            style={{
              ...(p ? { left: p.x, top: p.y } : { left: "50%", top: -200 }),
              ...(farSeat ? { "--seat-width": `${width}px`, "--seat-scale": Math.min(1, width / (compact ? 60 : 84)) } : {}),
            } as React.CSSProperties}
          >
            <div className="who">
              <i className="sky" />
              <Avatar name={f.seat.displayName} picked={f.seat.hasPicked} />
              <div className="pk">
                <i />
                <b>{f.packN}</b>
              </div>
            </div>
            <div className="nm" title={f.seat.displayName}>
              {f.seat.displayName}
            </div>
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const update = () => {
      const more = stripEdges(strip.scrollLeft, strip.scrollWidth, strip.clientWidth);
      if (more) strip.dataset.more = more;
      else delete strip.dataset.more;
    };
    update();
    strip.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (observer) observer.observe(strip);
    else window.addEventListener("resize", update);
    return () => {
      strip.removeEventListener("scroll", update);
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", update);
    };
  }, [friends]);

  return (
    <div ref={ref} className="seatstrip" aria-label="Seats" role="list">
      <span className="dir" title="Pass direction">
        {ARROW}
      </span>
      {friends.map((f) => (
        <div key={f.seat.playerId} className="chip-seat" role="listitem" data-seat={f.index} data-state={f.state} title={f.seat.displayName}>
          <Avatar name={f.seat.displayName} picked={f.seat.hasPicked} />
          <i className="mp" />
          <span className="nm">{f.seat.displayName}</span>
        </div>
      ))}
    </div>
  );
});
