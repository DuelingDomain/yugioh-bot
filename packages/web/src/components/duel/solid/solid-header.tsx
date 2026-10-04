import type { ReactNode } from "react";
import type { BoardTilt } from "../board-view";
import header from "./header.module.css";
import { SvIcon } from "./icons";

export type SolidHeaderProps = {
  /** The wordmark and the spectator tag. */
  identity: ReactNode;
  /** "MR5 · Normal", "Domain · Normal" ... */
  format: string;
  turn: number | string;
  phaseName: string;
  /** The battle step, for the phase name's `data-step`. */
  step?: string | null;
  /** "Your turn", "Their turn", "Watching ..."; null before the engine is up. */
  turnText: string | null;
  tone: "you" | "opp" | "watch";
  spectator: boolean;
  /** The live dot and its label (V1 connection status). */
  live: ReactNode;
  /** The V1 room tools (bug report, report, pop-out, leave, sound ...). */
  tools: ReactNode;
  view: BoardTilt;
  onTilt: (tilt: BoardTilt) => void;
  onGear: () => void;
};

/**
 * `header.sv-hdr`: the wordmark and format, the turn and whose-turn pill, then the live dot, room tools, the
 * Tilt|Flat switch and the gear. Stub from the foundation: the header worker owns the markup and the look.
 */
export function SolidHeader({ identity, format, turn, phaseName, step, turnText, tone, spectator, live, tools, view, onTilt, onGear }: SolidHeaderProps) {
  return (
    <header className={header.hdr} data-sv-header="">
      <div className={header.brand}>
        {identity}
        <span className={header.fmt}>{format}</span>
      </div>
      <div className={header.turnbox}>
        <strong className={header.turnText}>Turn {turn}</strong>
        <span className={header.phase} data-step={step ?? undefined}>{phaseName}</span>
        {turnText ? <span className={header.pill} data-owner={tone} data-spectator={spectator ? "true" : undefined}>{turnText}</span> : null}
      </div>
      <div className={header.tools}>
        {live}
        {tools}
        <div className={header.viewSwitch} role="group" aria-label="Table view">
          <button type="button" aria-pressed={view === "tilt"} onClick={() => onTilt("tilt")}><SvIcon name="tilt" /> Tilt</button>
          <button type="button" aria-pressed={view === "flat"} onClick={() => onTilt("flat")}><SvIcon name="flat" /> Flat</button>
        </div>
        <button type="button" className={header.gear} aria-label="Settings" onClick={onGear}><SvIcon name="gear" /></button>
      </div>
    </header>
  );
}
