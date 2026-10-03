"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Eye, Radio, Volume2, VolumeX } from "lucide-react";
import { isCustomDomain, teamOfSeat, type DuelEngineView, type DuelSession } from "@yugidraft/shared/duels";
import { connectionLabel as labelForConnection } from "../connection-label";
import { isBattlePhase, phaseTitle } from "../constants";
import type { DuelPreferences } from "../preferences";
import roomStyles from "../room.module.css";
import type { TableConnection } from "../table/table-settings";
import { SEAT_TONE_HEX } from "../table/types";
import { hexToRgbTriplet } from "../table/seat-angle";
import { tagTurnText, type TagTeamNames } from "./live-tag";
import styles from "./tag-header.module.css";

/** The tone of a Rooftop seat: team 0 violet, team 1 gold-leaning rose, so the pill reads without the camera. */
const TEAM_TONE = [SEAT_TONE_HEX.violet, SEAT_TONE_HEX.rose] as const;

export interface TagHeaderProps {
  /** The mode label (Domain or MR) and the title come from the session, never from a fixed word. */
  session: DuelSession;
  engine: Pick<DuelEngineView, "turn" | "turnSeat" | "phase" | "battleStep">;
  viewerSeat: number | null;
  nameOf: (seat: number) => string;
  teamNames: TagTeamNames;
  /** The account preference from `useDuelPreferences()`: the same object the shell gives the FX and sound. */
  preferences: Pick<DuelPreferences, "soundEnabled" | "setSoundEnabled">;
  connection?: TableConnection;
  /** Room controls, such as the Surrender button. */
  headerTools?: ReactNode;
  /** Shown when the room can leave the finished duel. */
  onExit?: () => void;
  /** Shown when the player hid the result screen. */
  onShowResult?: () => void;
}

/** The mode label of the pill: "Domain", "Custom Domain" or "MR5". */
export function tagModeLabel(session: Pick<DuelSession, "mode" | "masterRule" | "settings">): string {
  if (session.mode === "domain") return isCustomDomain(session.masterRule, session.settings) ? "Custom Domain" : "Domain";
  return `MR${session.masterRule}`;
}

/**
 * The header of the live Rooftop: title, mode, "Turn N" (its own node, so e2e can match it), the phase, who plays,
 * header tools, the connection label and the sound switch. Styles come from the shell's tokens (--duel-*).
 */
export function TagHeader({ session, engine, viewerSeat, nameOf, teamNames, preferences, connection, headerTools, onExit, onShowResult }: TagHeaderProps) {
  const spectator = viewerSeat == null;
  const turnSeat = engine.turnSeat;
  const myTurn = !spectator && turnSeat === viewerSeat;
  const terminal = session.status !== "active";
  const connectionLabel = labelForConnection(terminal, connection);
  const live = connectionLabel === "Live";
  const phase = isBattlePhase(engine.phase) ? "Battle Phase" : phaseTitle(engine.phase);
  const turnTeam = teamOfSeat("tag", turnSeat);
  const tone = TEAM_TONE[turnTeam] ?? TEAM_TONE[0];
  const soundLabel = preferences.soundEnabled ? "On" : "Off";
  return (
    <header className={styles.header} data-tag-header>
      <div className={styles.identity}>
        <Link href="/duels">Yugidraft</Link>
        <i aria-hidden>/</i>
        <span className={styles.title} title={session.name}>{session.name}</span>
        <em className={styles.format}>{tagModeLabel(session)} &middot; Tag duel (2v2)</em>
        {spectator ? (
          <strong className={styles.spectator} title="You are watching. Hidden cards stay private.">
            <Eye size={13} strokeWidth={1.75} aria-hidden /> You are spectating
          </strong>
        ) : null}
      </div>
      <div className={styles.turn}>
        <strong data-tag-turn>{tagTurnText(engine.turn)}</strong>
        <span className={styles.phase}>{phase}</span>
        <span
          className={styles.turnPill}
          data-mine={myTurn ? "true" : "false"}
          data-testid="who-pill"
          style={{ "--turn": hexToRgbTriplet(tone.main) } as CSSProperties}
        >
          {spectator ? `${nameOf(turnSeat)} to play` : myTurn ? "Your turn" : `${nameOf(turnSeat)}'s turn`}
          <small>&middot; {teamNames[turnTeam]}</small>
        </span>
      </div>
      <div className={styles.status}>
        {headerTools}
        <span className={roomStyles.connectionStatus} role="status" aria-live="polite" data-live={live}>
          {live ? <i className={roomStyles.liveDot} aria-hidden /> : <Radio size={15} strokeWidth={1.75} aria-hidden />}
          {live ? (spectator ? "Live duel · watching" : "Live duel") : connectionLabel}
        </span>
        {onShowResult ? <button type="button" className={styles.tool} onClick={onShowResult}><span>Show result</span></button> : null}
        {onExit ? <button type="button" className={styles.tool} onClick={onExit}><span>Exit duel</span></button> : null}
        <button
          type="button"
          className={styles.tool}
          data-sound-toggle
          aria-label={`Sound effects ${soundLabel.toLowerCase()}`}
          aria-pressed={preferences.soundEnabled}
          onClick={() => preferences.setSoundEnabled(!preferences.soundEnabled)}
        >
          {preferences.soundEnabled ? <Volume2 size={15} strokeWidth={1.75} aria-hidden /> : <VolumeX size={15} strokeWidth={1.75} aria-hidden />}
        </button>
      </div>
    </header>
  );
}
