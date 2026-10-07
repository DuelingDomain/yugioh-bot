import type { ReactNode } from "react";
import type { BoardTilt } from "../board-view";
import header from "./header.module.css";
import { SvIcon, type SvIconName } from "./icons";

export type SolidHeaderProps = {
  /** The wordmark and the spectator tag. */
  identity: ReactNode;
  /** The clock block (every seat), beside the format. Hidden on a narrow screen, where the board shows its own clocks. */
  clock?: ReactNode;
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
 * Tilt/Flat button and the gear. Presentational only: the room hands it every node (concept styles.css 134-142).
 */
export function SolidHeader({ identity, clock, format, turn, phaseName, step, turnText, tone, spectator, live, tools, view, onTilt, onGear }: SolidHeaderProps) {
  const flat = view === "flat";
  const pillIcon: SvIconName = tone === "you" ? "user" : tone === "opp" ? "bot" : "eye";
  return (
    <header className={header.hdr} data-sv-header="">
      <div className={header.brand}>
        <span className={header.wordmark}>{identity}</span>
        <span className={header.slash} aria-hidden="true">/</span>
        <span className={header.fmt}>{format}</span>
        {clock ? <span className={header.clocks}>{clock}</span> : null}
      </div>
      <div className={header.turnbox}>
        <strong className={header.turnText}>
          <span>Turn {turn}</span>
          <span className={header.dot} aria-hidden="true"> · </span>
          <span className={header.phase} data-step={step ?? undefined}>{phaseName}</span>
        </strong>
        {turnText ? (
          <span className={header.pill} data-owner={tone} data-spectator={spectator ? "true" : undefined}>
            <SvIcon name={pillIcon} size={14} />
            <span className={header.pillFull}>{turnText}</span>
            <span className={header.pillShort}>{tone === "opp" ? "Their turn" : turnText}</span>
          </span>
        ) : null}
      </div>
      <div className={header.tools}>
        <div className={header.live}>{live}</div>
        <div className={header.roomTools}>{tools}</div>
        <span className={header.sep} aria-hidden="true" />
        <button type="button" className={header.view} data-view={view} onClick={() => onTilt(flat ? "tilt" : "flat")}
          aria-label={flat ? "Board view: Flat. Switch to Tilt" : "Board view: Tilt. Switch to Flat"}>
          <SvIcon name={flat ? "flat" : "tilt"} />
          <b>{flat ? "Flat" : "Tilt"}</b>
        </button>
        <button type="button" className={header.gear} aria-label="Settings" onClick={onGear}><SvIcon name="gear" size={17} /></button>
      </div>
    </header>
  );
}
