"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { RankGem } from "@/components/sheet";
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
  const reopening = view.canReopen && actions.reopening;
  // Someone else's open match: the organizer's actions sit inline, with no "Organizer" strip.
  const hostInline = view.state === "open" && !view.player;
  const stakes = view.state === "your-open" && currentUserPlayerId !== null && opponent(match, currentUserPlayerId).id !== null
    ? (() => { const p = matchProjection(match, currentUserPlayerId, ratings); return { win: p.winRating, lose: p.loseRating }; })()
    : null;
  const live = view.lamp === "live";
  const showState = !reporting && !reopening && (!hostInline || tournament.format === "single_elim");
  return (
    <div
      id={matchAnchorId(match.id)}
      className={`mrow${live ? " lv" : ""}`}
      data-s={view.lamp === "you" || view.lamp === "wait" || view.lamp === "live" || view.lamp === "done" || view.lamp === "open" ? view.lamp : undefined}
      aria-label={`${match.playerOneName}${match.playerTwoName ? ` vs ${match.playerTwoName}` : " · bye"}`}
    >
      <div>
        <div className="m-line">
          <span className={`m-p${decided || view.state === "bye" ? " win" : ""}`}>
            <RankGem tier={ratings.get(players.winner.id)?.rank ?? "none"} />{players.winner.name}
          </span>
          {view.state === "bye" ? <span className="m-vs">bye this round</span> : (
            <>
              <span className={score ? "m-sc" : "m-vs"} data-testid={score ? `tournament-match-score-${match.id}` : undefined}>{score ?? (decided ? "def." : "vs")}</span>
              <span className={`m-p${decided ? " lose" : ""}`}>
                <RankGem tier={players.loser.id === null ? "none" : ratings.get(players.loser.id)?.rank ?? "none"} />{players.loser.name}
              </span>
            </>
          )}
        </div>
        {showState && <MatchState match={match} state={view.state} format={tournament.format} hours={tournament.reportConfirmWindowHours ?? 24} stakes={stakes} />}
      </div>
      <div className="m-act">
        <MatchControls match={match} view={view} actions={actions} waitingOn={reportNames(match).other} />
        {hostInline && view.canSetResult && (
          <MatchButton variant="quiet" small disabled={actions.loading !== null} onClick={actions.openResult}>Set result</MatchButton>
        )}
      </div>
      {!reopening && ((view.canSetResult && !hostInline) || view.canReopen) && (
        <div className="m-host">
          <span className="lbl">Organizer</span>
          {view.canSetResult && (
            <MatchButton variant="quiet" small disabled={actions.loading !== null} onClick={actions.openResult}>
              Set result
            </MatchButton>
          )}
          {view.canReopen && (
            <MatchButton variant="quiet" small disabled={actions.loading !== null} onClick={actions.openReopen}>
              <RotateCcw className="ic sm" aria-hidden="true" />Reopen
            </MatchButton>
          )}
        </div>
      )}
      {reporting && currentUserPlayerId !== null && (
        <ReportPanel
          projection={matchProjection(match, currentUserPlayerId, ratings)}
          opponentName={opponent(match, currentUserPlayerId).name}
          confirmWindowHours={tournament.reportConfirmWindowHours ?? 24}
          loading={actions.loading !== null}
          onReport={actions.report}
        />
      )}
      {reopening && (
        <div className="report">
          <div className="banner banner-warn">
            <AlertCircle className="ic" aria-hidden="true" />
            <div><strong>Reopen this match?</strong> The result is cleared and the match goes back to not started. Either player can then play or report it again.</div>
          </div>
          <div className={`acts ${styles.reopenActs}`}>
            <MatchButton variant="quiet" small onClick={actions.cancelReopen}>Keep result</MatchButton>
            <MatchButton variant="danger" small disabled={actions.loading !== null} onClick={actions.reopen}>Reopen match</MatchButton>
          </div>
        </div>
      )}
      <MatchError error={actions.error} />
      {actions.resultOpen && <SetResultDialog match={match} ratings={ratings} bestOf={tournament.bestOf ?? 3} actions={actions} />}
    </div>
  );
}
