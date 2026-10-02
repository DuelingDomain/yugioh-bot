"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { RankGem } from "@/components/rank/rank-gem";
import sheet from "@/components/sheet/sheet.module.css";
import { matchAnchorId, type MatchQueueProps } from "../sheet-contracts";
import type { Match } from "../types";
import { decidedPlayers, matchProjection, matchScore, matchView, opponent, reportNames, winnerScore } from "./match-model";
import { MatchButton, MatchControls, MatchError } from "./match-controls";
import { MatchState } from "./match-state";
import { ReportPanel } from "./report-panel";
import { SetResultDialog } from "./set-result-dialog";
import { useMatchActions } from "./use-match-actions";
import styles from "./matches.module.css";

export type MatchRowProps = MatchQueueProps & { match: Match };

export function MatchRow({ match, tournament, tournamentSlug, currentUserPlayerId, isHost, ratings, onChanged }: MatchRowProps) {
  const actions = useMatchActions(match, tournamentSlug, onChanged);
  const view = matchView(match, currentUserPlayerId, isHost, tournament, actions);
  const decided = match.status === "completed" && view.state !== "bye" && match.winnerId !== null;
  const players = decided ? decidedPlayers(match) : { winner: { id: match.playerOneId, name: match.playerOneName }, loser: { id: match.playerTwoId, name: match.playerTwoName } };
  const score = decided ? winnerScore(match) : matchScore(match);
  const reporting = view.canReport && actions.reporting;
  const reopening = view.canReopen && tournament.format === "round_robin" && actions.reopening;
  const hostInline = view.state === "open" && !view.player;
  const canReopen = view.canReopen && tournament.format === "round_robin";
  return <div id={matchAnchorId(match.id)} className={styles.mrow} data-s={view.lamp} aria-label={`${match.playerOneName}${match.playerTwoName ? ` vs ${match.playerTwoName}` : " · bye"}`}>
    <div>
      <div className={styles["m-line"]}>
        <span className={`${styles["m-p"]} ${decided || view.state === "bye" ? styles.win : ""}`}><RankGem tier={ratings.get(players.winner.id)?.rank ?? "none"} />{players.winner.name}</span>
        {view.state === "bye" ? <span className={styles["m-vs"]}>bye this round</span> : <>
          <span className={score ? styles["m-sc"] : styles["m-vs"]} data-testid={score ? `tournament-match-score-${match.id}` : undefined}>{score ?? (decided ? "def." : "vs")}</span>
          <span className={`${styles["m-p"]} ${decided ? styles.lose : ""}`}><RankGem tier={players.loser.id === null ? "none" : ratings.get(players.loser.id)?.rank ?? "none"} />{players.loser.name}</span>
        </>}
      </div>
      {!reporting && !reopening && (!hostInline || tournament.format === "single_elim") && <MatchState match={match} state={view.state} lamp={view.lamp} format={tournament.format} hours={tournament.reportConfirmWindowHours ?? 24} />}
    </div>
    <div className={`${styles["m-act"]} ${styles.controls}`}>
      <MatchControls match={match} view={view} actions={actions} waitingOn={reportNames(match).other} />
      {hostInline && view.canSetResult && <MatchButton variant="quiet" small disabled={actions.loading !== null} onClick={actions.openResult}>Set result</MatchButton>}
    </div>
    {!reopening && ((view.canSetResult && !hostInline) || canReopen) && <div className={`${styles["m-host"]} ${styles.controls}`}>
      <span className={styles.lbl}>Organizer</span>
      {view.canSetResult && <MatchButton variant="quiet" small disabled={actions.loading !== null} onClick={actions.openResult}>Set result</MatchButton>}
      {canReopen && <MatchButton variant="quiet" small disabled={actions.loading !== null} onClick={actions.openReopen}><RotateCcw size={14} aria-hidden="true" />Reopen</MatchButton>}
    </div>}
    {reporting && currentUserPlayerId !== null && <ReportPanel projection={matchProjection(match, currentUserPlayerId, ratings)} opponentName={opponent(match, currentUserPlayerId).name} confirmWindowHours={tournament.reportConfirmWindowHours ?? 24} loading={actions.loading !== null} onReport={actions.report} />}
    {reopening && <div className={styles.report}>
      <div className={`${sheet.banner} ${sheet["banner-warn"]}`}><AlertCircle size={16} aria-hidden="true" /><div><strong>Reopen this match?</strong> The result is cleared and the match goes back to not started. Either player can then play or report it again.</div></div>
      <div className={`${sheet.acts} ${styles["reopen-acts"]} ${styles.controls}`}>
        <MatchButton variant="quiet" small onClick={actions.cancelReopen}>Keep result</MatchButton>
        <MatchButton variant="danger" small disabled={actions.loading !== null} onClick={actions.reopen}>Reopen match</MatchButton>
      </div>
    </div>}
    <MatchError error={actions.error} />
    {actions.resultOpen && <SetResultDialog match={match} ratings={ratings} bestOf={tournament.bestOf ?? 3} actions={actions} />}
  </div>;
}
