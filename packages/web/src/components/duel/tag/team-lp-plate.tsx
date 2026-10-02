import type { CSSProperties, KeyboardEvent } from "react";
import { LifePoints } from "../life-points";
import { formatClock } from "../table/holo-lp";
import type { ResponderState } from "./tag-logic";
import styles from "./tag-stage.module.css";

export type PlateState = "now" | "choosing" | "waiting" | "out";

export interface PlateMember {
  seat: number;
  name: string;
  code: string; // 1A, 2A, 1B, 2B
  rgb: string; // seat colour as "r g b"
  ink: string; // readable seat colour
  you: boolean;
  hand: number;
  deck: number;
  clockMs: number | null;
  clockRuns: boolean;
  now: boolean; // on the baton
  response: ResponderState | null; // set while this team answers a chain
  pickable: boolean; // the viewer may choose this rival
  hotkey: number | null;
  locked: boolean; // the attack aims at this member
}

export interface TeamPlateProps {
  teamName: string;
  glyph: "◆" | "●";
  near: boolean; // near team uses the violet to ice band, the other the verdant to rose band
  lp: number;
  startLp: number;
  state: PlateState;
  cracked: boolean;
  members: readonly PlateMember[];
  hang?: boolean; // the rival plate hangs from cords above its strip
  reducedMotion: boolean;
  onPick?: (seat: number) => void;
  plateRef?: (node: HTMLDivElement | null) => void;
  style?: CSSProperties;
}

const STATE_TEXT: Record<PlateState, string> = { now: "On turn", choosing: "Choosing", waiting: "Waiting", out: "Down" };

/** What the plate pill says for a team: down first, then a member that is choosing, then the team that holds the baton. */
export function plateState(opts: { out: boolean; choosing: boolean; onTurn: boolean }): PlateState {
  if (opts.out) return "out";
  if (opts.choosing) return "choosing";
  return opts.onTurn ? "now" : "waiting";
}

function HandIcon() {
  return (
    <svg className={styles.ico} viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.5" y="1.5" width="7" height="9" rx="1" />
    </svg>
  );
}

function DeckIcon() {
  return (
    <svg className={styles.ico} viewBox="0 0 12 12" aria-hidden="true">
      <rect x="3.5" y="0.8" width="6.5" height="8.2" rx="1" />
      <path d="M2 3v7.4c0 .4.3.8.8.8H8" />
    </svg>
  );
}

const RESPONSE_TEXT: Record<ResponderState, string> = { choosing: "…", waiting: "·", passed: "✓" };

function Chip({ member, onPick }: { member: PlateMember; onPick?: (seat: number) => void }) {
  const style = { ["--seat" as string]: member.rgb, ["--seat-ink" as string]: member.ink } as CSSProperties;
  const clock = formatClock(member.clockMs);
  const pick = () => {
    if (member.pickable) onPick?.(member.seat);
  };
  const onKey = (event: KeyboardEvent) => {
    if (member.pickable && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      pick();
    }
  };
  return (
    <div
      className={styles.mchip}
      data-lp-seat={member.seat}
      data-member-seat={member.seat}
      data-now={member.now ? "true" : undefined}
      data-pickable={member.pickable ? "true" : undefined}
      data-locked={member.locked ? "true" : undefined}
      role={member.pickable ? "button" : undefined}
      tabIndex={member.pickable ? 0 : undefined}
      aria-label={member.pickable ? `Choose ${member.name}` : undefined}
      style={style}
      onClick={pick}
      onKeyDown={onKey}
    >
      <span className={styles.pickring} aria-hidden="true" />
      {member.pickable && member.hotkey != null ? <kbd className={styles.keyhint}>{member.hotkey}</kbd> : null}
      <div className={styles.m1}>
        <span className={styles.code}>{member.code}</span>
        <b>{member.name.split(" ")[0]}</b>
        {member.you ? <span className={styles.you}>YOU</span> : null}
        {member.response ? (
          <span className={styles.st2} data-k={member.response} title={member.response}>
            {RESPONSE_TEXT[member.response]}
          </span>
        ) : null}
      </div>
      <div className={styles.m2}>
        <span title="Hand"><HandIcon />{member.hand}</span>
        <span title="Deck"><DeckIcon />{member.deck}</span>
        {clock ? <span className={styles.clk} data-tick={member.clockRuns ? "true" : undefined}>{clock}</span> : null}
      </div>
    </div>
  );
}

/** Team life plate: the shared LP once, then one chip per member. Each chip carries the data-lp-seat hook of its seat. */
export function TeamLpPlate({ teamName, glyph, near, lp, startLp, state, cracked, members, hang, reducedMotion, onPick, plateRef, style }: TeamPlateProps) {
  return (
    <div
      ref={plateRef}
      className={`${styles.plate} ${near ? styles.t0 : styles.t1} ${near ? styles.ownPlate : styles.farPlate}`}
      data-team-plate={near ? "near" : "far"}
      data-hang={hang ? "true" : undefined}
      data-cracked={cracked ? "true" : undefined}
      style={style}
    >
      <span className={styles.trim} aria-hidden="true" />
      <div>
        <div className={styles.pr1}>
          <i className={`${styles.glyph}`} aria-hidden="true">{glyph}</i>
          <span className={styles.tn}>{teamName}</span>
          <span className={styles.tstate} data-k={state}>{STATE_TEXT[state]}</span>
        </div>
        <div className={styles.pr2}>
          <LifePoints value={lp} reducedMotion={reducedMotion} size="lg" />
          <span className={styles.lpof}>/ {startLp.toLocaleString("en-US")}</span>
        </div>
      </div>
      <div className={styles.mchips}>
        {members.map((m) => (
          <Chip key={m.seat} member={m} onPick={onPick} />
        ))}
      </div>
      {cracked ? (
        <>
          <svg className={styles.crack} viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
            <path d="M52 0 L46 14 L56 22 L44 34 L53 42 L47 60" fill="none" stroke="rgb(255 148 137 / 0.9)" strokeWidth="1.2" />
            <path d="M46 14 L34 18 M56 22 L70 20 M44 34 L30 40" fill="none" stroke="rgb(255 148 137 / 0.6)" strokeWidth="0.8" />
          </svg>
          <span className={styles.defeat}>TEAM DOWN</span>
        </>
      ) : null}
    </div>
  );
}
