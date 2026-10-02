"use client";

import { useState } from "react";
import { defaultDuelSettings, type DuelDeck, type DuelRoom, type DuelSeriesSummary } from "@yugidraft/shared/duels";
import { SeriesGameLabel } from "../series-banner";
import { DuelResultScreen } from "../duel-result";
import { SideDeckPanel } from "../side-deck-panel";
import styles from "../room.module.css";
import type { LabBoard, LabSeries } from "./board";
import { CARDS as C } from "./cards";

/**
 * The Best of 3 part of the FX lab: a room for the series scenarios, the real header label and the
 * real between-games and match screens. The buttons that save or ready call the real API, which
 * answers with an error in the lab; that is the only part that is not live.
 */

const NAMES: [string, string] = ["Sulman", "Imran"];

/** A side deck with a few real cards: swap a Main card with a Side card, or an Extra card with a Side Extra monster. */
const SIDE_DECK: DuelDeck = {
  main: [C.sangan.code, C.kuriboh.code, C.potOfGreed.code, C.monsterReborn.code, C.blueEyes.code, C.darkMagician.code],
  extra: [C.darkPaladin.code, C.stardust.code],
  side: [C.cyberDragon.code, C.summonedSkull.code, C.utopia.code],
};

function summary(spec: LabSeries): DuelSeriesSummary {
  const over = spec.screen === "won";
  const between = spec.screen === "ready" || spec.screen === "side";
  const nextLive = spec.screen === "next-live";
  return {
    id: 7,
    bestOf: 3,
    ranked: false,
    status: over ? "completed" : between ? "between_games" : "active",
    playerIds: [1, 2],
    displayNames: NAMES,
    wins: spec.wins,
    gameNumber: nextLive ? spec.game + 1 : spec.game,
    currentDuelSlug: nextLive ? "fx-lab-next" : "fx-lab",
    winnerPlayerId: over ? (spec.wins[0] > spec.wins[1] ? 1 : 2) : null,
    tournamentId: null,
    tournamentSlug: null,
    tournamentMatchId: null,
    nextGameAt: between ? new Date(Date.now() + (spec.secondsLeft ?? 45) * 1000).toISOString() : null,
    sideReady: [false, spec.opponentReady === true],
    hasSide: [true, true],
  };
}

export function labSeriesRoom(board: LabBoard, spec: LabSeries): DuelRoom {
  const finished = spec.screen !== "label";
  const spectator = spec.viewer === "spectator";
  // Game 1 is the one you just won or lost: the leader of the score won it. Game 3 of the match was won by the match winner.
  const winnerSeat = spec.wins[0] > spec.wins[1] ? 0 : 1;
  const result = finished ? { winnerSeat, reason: "Life points reached 0" } : null;
  return {
    session: {
      id: 1,
      slug: "fx-lab",
      name: "FX lab",
      guildId: "lab",
      organizerPlayerId: 1,
      mode: "normal",
      masterRule: 5,
      status: finished ? "completed" : "active",
      settings: { ...defaultDuelSettings("normal"), visibility: spec.visibility ?? "public" },
      seats: [
        { seat: 0, playerId: 1, displayName: NAMES[0], ready: true, isBot: false },
        { seat: 1, playerId: 2, displayName: NAMES[1], ready: true, isBot: false },
      ],
      createdAt: "",
      endedAt: null,
      archivedAt: null,
      winnerPlayerId: finished ? (winnerSeat === 0 ? 1 : 2) : null,
      winnerSeat: finished ? winnerSeat : null,
      resultReason: finished ? "Life points reached 0" : null,
      bestOf: 3,
      seriesId: 7,
      gameNumber: spec.game,
    },
    role: spectator ? "spectator" : "player",
    mySeat: spectator ? null : 0,
    myDeck: null,
    clock: null,
    metadataOnly: false,
    engine: {
      revision: 99,
      turn: 5,
      turnSeat: 0,
      phase: "end",
      seats: board.seats,
      prompt: null,
      chain: [],
      events: [],
      log: [],
      result,
    },
    series: summary(spec),
    mySide: spectator ? null : { baseDeck: SIDE_DECK, currentDeck: SIDE_DECK },
  };
}

/** The room header as a duel shows it, so the label is seen where it ships (top right, by the Live pill). */
export function SeriesLabHeader({ room }: { room: DuelRoom }) {
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <span>Yugidraft</span>
        <span className={styles.format}>MR5 · 1v1</span>
      </div>
      <div className={styles.turn}>
        <strong>Turn 3</strong><span className={styles.phaseName}>Main Phase 1</span>
      </div>
      <div className={styles.status}>
        <SeriesGameLabel room={room} />
        <span className={styles.connectionStatus} data-live="true"><i className={styles.liveDot} aria-hidden />Live duel</span>
      </div>
    </header>
  );
}

/** The screen a scenario opens: the result screen (ready, won) with the Side deck button wired to the real panel. */
export function SeriesLabScreen({ room, spec, reduced, sound }: { room: DuelRoom; spec: LabSeries; reduced: boolean; sound: boolean }) {
  const [closed, setClosed] = useState(false);
  const [side, setSide] = useState(spec.screen === "side");
  const series = room.series;
  if (spec.screen === "label" || !series) return null;
  if (side && room.mySide) {
    return (
      <SideDeckPanel slug="fx-lab" series={series} myIndex={0} side={room.mySide}
        onClose={() => { setSide(false); if (spec.screen === "side") setClosed(true); }}
        onChanged={() => undefined} onNavigate={() => undefined} />
    );
  }
  if (closed) return null;
  return (
    <DuelResultScreen room={room} slug="fx-lab" reducedMotion={reduced} soundEnabled={sound}
      onClose={() => setClosed(true)} onExit={() => setClosed(true)}
      onOpenSide={() => setSide(true)} onSeriesChanged={() => undefined} onNavigate={() => undefined} />
  );
}
