import type { CSSProperties } from "react";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import { isOut } from "./seat-state";
import { seatStatus } from "./targets";
import { hexToRgbTriplet } from "./seat-angle";
import { SEAT_TONE_HEX, type SeatStatus, type TableLayout } from "./types";
import styles from "./turn-ring.module.css";

const R = 48;
const C = 62;

export function phaseLabel(phase: string): string {
  if (phase === "draw") return "DRAW";
  if (phase === "standby") return "STANDBY";
  if (phase === "main1") return "MAIN 1";
  if (phase === "main2") return "MAIN 2";
  if (phase === "end") return "END";
  return /battle|damage/.test(phase) ? "BATTLE" : phase.toUpperCase();
}

const LABEL: Partial<Record<SeatStatus, string>> = {
  turn: "TURN",
  next: "NEXT",
  choosing: "CHOOSING",
  leaving: "LEAVING",
  eliminated: "OUT",
};

export interface TurnRingProps {
  layout: TableLayout;
  /** The layout that numbers the nodes, when `layout` holds only the seats still in the duel (the numbers do not change). */
  numbering?: TableLayout;
  engine: Pick<DuelEngineView, "turn" | "phase" | "turnSeat" | "seats">;
  /** Screen angle of every seat on the ring (degrees, 0 = right, 90 = down), by seat. */
  angles: ReadonlyMap<number, number>;
  /** Where the ring stands on the stage (stage px, centre) and how large it is drawn. */
  pose: { x: number; y: number; scale: number };
  promptSeat: number | null;
  /** The FX lock is on: the ring says so. */
  locked?: boolean;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
/** Rounded: server and client trig can differ in the last digits, which breaks hydration. */
const r2 = (value: number) => Math.round(value * 100) / 100;
const at = (deg: number, r = R) => ({ x: r2(C + Math.cos(rad(deg)) * r), y: r2(C + Math.sin(rad(deg)) * r) });

/**
 * The turn medallion at the middle of the table: the turn number and phase in the hub, a node per seat at the angle
 * of its field, and clockwise arcs in turn order. The lit arc leaves the seat that plays now. It never takes pointer
 * events. In the fly-in view its text turns against the world (`--ry`) so it stays level.
 */
export function TurnRing({ layout, numbering = layout, engine, angles, pose, promptSeat, locked = false }: TurnRingProps) {
  const seats = [...layout.slots].sort((a, b) => a.turnOrder - b.turnOrder);
  const tone = (seat: number) => SEAT_TONE_HEX[layout.slots.find((slot) => slot.seat === seat)?.tone ?? "violet"];
  const angle = (seat: number) => angles.get(seat) ?? 90;
  const viewOf = (seat: number) => engine.seats.find((view) => view.seat === seat);
  // Eliminated seats have no arc. The lit arc leaves the turn seat for the next living seat, so it also passes over a
  // Leaving seat (that seat is not the next to play).
  const ring = seats.filter((slot) => viewOf(slot.seat)?.eliminated !== true);
  const arcs = ring.length < 2 ? [] : ring.map((slot, index) => {
    const lit = slot.seat === engine.turnSeat;
    let next = ring[(index + 1) % ring.length];
    if (lit) {
      for (let step = 1; step < ring.length; step += 1) {
        const candidate = ring[(index + step) % ring.length];
        if (!isOut(viewOf(candidate.seat))) {
          next = candidate;
          break;
        }
      }
    }
    const a0 = angle(slot.seat);
    let a1 = angle(next.seat);
    while (a1 <= a0) a1 += 360;
    // A long arc is cut short so it does not run across the table, except on a two-seat ring: its two arcs must
    // reach the other seat, even when one of them spans 270 degrees.
    if (ring.length > 2 && a1 - a0 > 240) a1 = a0 + 120;
    const s = at(a0 + 16);
    const e = at(a1 - 16);
    const hex = tone(slot.seat).main;
    return (
      <path
        key={slot.seat}
        d={`M${s.x} ${s.y} A${R} ${R} 0 0 1 ${e.x} ${e.y}`}
        data-arc={slot.seat}
        data-arc-to={next.seat}
        data-lit={lit ? "true" : undefined}
        stroke={lit ? hex : "rgb(181 153 99 / 0.45)"}
        strokeWidth={lit ? 2 : 1.2}
        fill="none"
        markerEnd={lit ? "url(#ring-arrow-lit)" : "url(#ring-arrow)"}
      />
    );
  });
  const points = (ring.length > 0 ? ring : seats).map((slot) => at(angle(slot.seat)));
  const litHex = tone(engine.turnSeat).main;
  const style: CSSProperties = { transform: `translate(${pose.x - 62}px, ${pose.y - 62}px) scale(${pose.scale})` };
  return (
    <div className={styles.ring} style={style} data-turn-ring data-lock={locked ? "true" : undefined} aria-hidden="true">
      <svg viewBox="0 0 124 124">
        <defs>
          <marker id="ring-arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0L6 3L0 6z" fill="rgb(181 153 99 / 0.6)" />
          </marker>
          <marker id="ring-arrow-lit" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0L6 3L0 6z" fill={litHex} />
          </marker>
          <radialGradient id="ring-disc">
            <stop offset="0" stopColor="#121a30" />
            <stop offset="1" stopColor="#070b15" stopOpacity="0.9" />
          </radialGradient>
        </defs>
        <circle cx="62" cy="62" r="60" fill="url(#ring-disc)" stroke="rgb(181 153 99 / 0.5)" strokeWidth="1" />
        <circle cx="62" cy="62" r="56" fill="none" stroke="rgb(181 153 99 / 0.22)" strokeWidth="0.8" strokeDasharray="1 3" />
        <polygon points={points.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgb(228 182 79 / 0.04)" stroke="rgb(228 182 79 / 0.55)" strokeWidth="1" />
        <circle cx="62" cy="62" r="20" fill="#0a0f1c" stroke="rgb(181 153 99 / 0.6)" strokeWidth="1" />
        <g className={styles.turnText}>
          <text x="62" y="62" textAnchor="middle" className={styles.num} fontSize="15" fill="#efe7d5">
            {engine.turn}
          </text>
          <text x="62" y="73" textAnchor="middle" className={styles.phase} fontSize="6.5" fill={/battle|damage/.test(engine.phase) ? "#d98d52" : "#958f81"}>
            {phaseLabel(engine.phase)}
          </text>
        </g>
        {arcs}
        {seats.map((slot) => {
          const status = seatStatus(engine, slot.seat, promptSeat);
          const p = at(angle(slot.seat));
          const hex = tone(slot.seat);
          const rgb = hexToRgbTriplet(hex.main);
          const out = status === "eliminated";
          const isTurn = status === "turn";
          const label = LABEL[status];
          const nodeStyle: CSSProperties & Record<string, string> = { "--rgb": rgb };
          return (
            <g key={slot.seat} className={styles.node} data-ring-seat={slot.seat} data-status={status} style={nodeStyle}>
              {isTurn ? (
                <circle cx={p.x} cy={p.y} r="15" fill={`rgb(${rgb} / 0.18)`} stroke={hex.main} strokeWidth="1.5">
                  <animate attributeName="r" values="13;16;13" dur="2.4s" repeatCount="indefinite" />
                </circle>
              ) : null}
              {status === "choosing" ? <circle cx={p.x} cy={p.y} r="12.5" fill="none" stroke="#e4b64f" strokeWidth="1.6" strokeDasharray="3 2" /> : null}
              <circle
                cx={p.x}
                cy={p.y}
                r="9.5"
                fill={out ? "#2a2826" : `rgb(${rgb} / ${isTurn ? 1 : 0.35})`}
                stroke={out ? "#5f5c57" : hex.main}
                strokeWidth="1.2"
                strokeDasharray={status === "next" ? "2.5 2" : undefined}
              />
              <text x={p.x} y={p.y + 3.6} textAnchor="middle" className={styles.initial} fontSize="10.5" fill={isTurn ? "#0a0f1c" : out ? "#5f5c57" : hex.ink}>
                {seatInitial(slot.seat, numbering)}
              </text>
              {out ? <path d={`M${p.x - 7} ${p.y + 7} L${p.x + 7} ${p.y - 7}`} stroke="#e45a4d" strokeWidth="1.6" /> : null}
              {label ? (
                <text
                  x={p.x}
                  y={p.y + (p.y > C ? 25 : -15)}
                  textAnchor="middle"
                  className={styles.tag}
                  fontSize="8"
                  fill={status === "choosing" ? "#f4d690" : status === "leaving" || out ? "#ff9489" : isTurn ? hex.ink : "#958f81"}
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <span className={styles.lock}>Camera locked</span>
    </div>
  );
}

/** The initial inside a node: the place number on the table (1 = you), so it never depends on a name. */
function seatInitial(seat: number, layout: TableLayout): string {
  return String(layout.slots.findIndex((slot) => slot.seat === seat) + 1);
}
