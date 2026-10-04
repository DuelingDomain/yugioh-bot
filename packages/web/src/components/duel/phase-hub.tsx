"use client";

import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import type { DuelPromptOption } from "@yugidraft/shared/duels";
import { BATTLE, phaseStations, type StationView } from "./phase-hub-model";
import { duelFontClasses } from "./fonts";
import { useIsNarrow } from "./side-panel";
import { battleStepInfo, resolveBattleStep, type BattleStep } from "./station-track";
import styles from "./phase-hub.module.css";

export type PhaseHubProps = {
  /**
   * "lane": the 1v1 board. A slim lane under the Extra Monster Zones; the strip carries the owner and the turn on its row.
   * "table": a table of 3 or 4. The same strip at a place `hubPose` found; the owner and the turn sit in a caption line above it
   * (the table stage's `data-hub-size` decides whether that caption, or the strip alone, fits).
   */
  variant: "lane" | "table";
  /** Raw engine phase (engine.phase). */
  phase: string | null | undefined;
  battleStep?: BattleStep | null;
  turn: number | null | undefined;
  /** Seat whose turn it is (engine.turnSeat). */
  turnSeat: number | null | undefined;
  /** Local seat, or null for a spectator. */
  mySeat: number | null;
  playerName: (seat: number) => string;
  /** The turn seat's colour (hex): the dot, and the lit chip when it is not your turn. Absent: the gold of the duel's hairlines. */
  tone?: { main: string; ink: string } | null;
  /** Options of the local seat's current "action" prompt, else []. The same list the station track gets. */
  actionOptions: DuelPromptOption[];
  /** The local seat may submit an answer right now. */
  canAct: boolean;
  /** Sends the phase move. The room's answer path: the same call the bar's buttons make. */
  onChoose: (optionId: string) => void;
  reducedMotion: boolean;
};


function Chip({ view, litName, onChoose }: { view: StationView; litName: string; onChoose: (optionId: string) => void }) {
  const { station, state, option } = view;
  const inner = (
    <>
      <span className={styles.code}>{station.code}</span>
      {state === "current" ? <span className={styles.name} aria-hidden="true">{litName}</span> : null}
      {state === "done" ? <span className={styles.tick} aria-hidden="true"><Check strokeWidth={2.6} /></span> : null}
    </>
  );
  const common = {
    className: styles.chip,
    "data-state": state,
    "data-live": option ? "true" : "false",
    "data-phase": station.code,
    "aria-current": state === "current" ? ("step" as const) : undefined,
    title: `${station.name}. ${station.hint}`,
  };
  if (option) {
    return (
      <button type="button" {...common} aria-label={option.label} onClick={() => onChoose(option.id)}>
        {inner}
      </button>
    );
  }
  return (
    <span {...common}>
      {inner}
      <span className={styles.srOnly}>
        {station.name}{state === "done" ? ", done" : state === "current" ? ", current phase" : ""}
      </span>
    </span>
  );
}

/**
 * The phases of the turn, in the middle of the board, as one strip: DP SP M1 BP M2 EP on a hairline track. It reads the same model as the bar (`phaseStations`) and sends the
 * same option ids through the same `onChoose`: Battle, Main 2 and End are buttons only while the local seat may answer
 * and the engine offers that move; on every other turn, and while anything else is being decided, it is read-only.
 * The lit chip is wider and carries the phase's full name. Only opacity and transform ever animate.
 */
export function PhaseHub({
  variant, phase, battleStep, turn, turnSeat, mySeat, playerName, tone, actionOptions, canAct, onChoose, reducedMotion,
}: PhaseHubProps) {
  // On a phone the hub does not fit; the bar keeps the phases there (the station track makes the same call).
  const narrow = useIsNarrow();
  const { current, stations } = phaseStations({ phase, actionOptions, canAct });
  const spectator = mySeat == null;
  const myTurn = !spectator && turnSeat === mySeat;
  const noTurn = turnSeat == null;
  const owner = turnSeat != null ? playerName(turnSeat) : "";
  const litStation = stations[current]?.station;
  const step = current === BATTLE ? battleStepInfo(resolveBattleStep(phase, battleStep)) : null;
  // The opening step is itself called "Battle": say "Battle step" rather than "Battle · Battle".
  const litName = litStation ? (step ? (step.short === litStation.name ? `${litStation.name} step` : `${litStation.name} · ${step.short}`) : litStation.name) : "";
  const style = (tone ? { "--seat": tone.main, "--seat-ink": tone.ink } : undefined) as CSSProperties | undefined;
  const summary = noTurn
    ? "No active turn"
    : `Turn ${turn ?? "—"}, ${myTurn ? "your turn" : `${owner}'s turn`}${litStation ? `, ${step?.name ?? litStation.name}` : ""}`;

  if (narrow) return null;

  const who = (
    <span className={styles.who} title={noTurn ? undefined : owner}>
      <i className={styles.dot} aria-hidden="true" />
      <span className={styles.whoName}>{noTurn ? "No turn" : myTurn ? "You" : owner}</span>
      <b className={styles.turn}>Turn {turn ?? "—"}</b>
    </span>
  );
  const track = (
    <div className={styles.track}>
      {stations.map((view) => <Chip key={view.station.code} view={view} litName={litName} onChoose={onChoose} />)}
    </div>
  );

  return (
    <nav
      aria-label="Duel phases"
      className={`${styles.root} ${duelFontClasses}`}
      data-variant={variant}
      data-tone={myTurn ? "mine" : "theirs"}
      data-phase={litStation?.code ?? "none"}
      data-reduced={reducedMotion ? "true" : "false"}
      data-testid="phase-hub"
      style={style}
    >
      <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">{summary}</p>
      {variant === "lane" ? (
        <div className={styles.plate}>
          <div className={styles.owner} data-part="owner">{who}</div>
          {track}
        </div>
      ) : (
        <>
          <div className={styles.caption} data-part="owner" aria-hidden="true">
            {who}
            <span className={styles.captionLit}>{litName}</span>
          </div>
          <div className={styles.plate}>{track}</div>
        </>
      )}
    </nav>
  );
}
