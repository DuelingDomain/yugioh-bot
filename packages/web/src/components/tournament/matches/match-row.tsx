"use client";

import { RankGem } from "@/components/sheet";
import { matchAnchorId, type MatchQueueProps } from "../sheet-contracts";
import type { Match } from "../types";
import { decidedPlayers, matchProjection, matchScore, matchView, opponent, reportNames, winnerScore } from "./match-model";
import { MatchControls, MatchError } from "./match-controls";
import { MatchHostControls, MatchReopenPanel } from "./match-host-actions";
import { MatchState } from "./match-state";
import { RemoteResultPanel } from "./remote-result-panel";
import { ReportPanel } from "./report-panel";
import { SetResultDialog } from "./set-result-dialog";
import { useMatchActions } from "./use-match-actions";
import { useRemoteResult } from "./use-remote-result";
import { remoteBlocksReport, type RemotePair } from "../remote-result";

export type MatchRowProps = MatchQueueProps & { match: Match };

export function MatchRow({ match, tournament, tournamentSlug, currentUserPlayerId, isHost, ratings, onChanged }: MatchRowProps) {
  const actions = useMatchActions(match, tournamentSlug, onChanged);
  const view = matchView(match, currentUserPlayerId, isHost, tournament, actions);
  // The Remote result of the viewer's own slot; the organizer's view of other slots is a later step.
  const remoteState = useRemoteResult({
    tournamentSlug, tournamentMatchId: match.id, onChanged,
    enabled: view.remote && view.player && match.playerTwoId !== null && match.status === "open" && tournament.status === "active",
    refreshKey: `${match.status}:${match.resolvedAt ?? ""}`,
  });
  const remoteResult = remoteState.result;
  const pair: RemotePair | null = match.playerTwoId === null ? null
    : { playerOneId: match.playerOneId, playerOneName: match.playerOneName, playerTwoId: match.playerTwoId, playerTwoName: match.playerTwoName ?? "Opponent" };
  const decided = match.status === "completed" && view.state !== "bye" && match.winnerId !== null;
  const players = decided ? decidedPlayers(match) : { winner: { id: match.playerOneId, name: match.playerOneName }, loser: { id: match.playerTwoId, name: match.playerTwoName } };
  const score = decided ? winnerScore(match) : matchScore(match);
  const reporting = view.canReport && actions.reporting && remoteState.loaded && !remoteBlocksReport(remoteResult);
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
      aria-label={`${match.playerOneName}${match.playerTwoName ? ` vs ${match.playerTwoName}` : ", bye"}`}
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
        <MatchControls match={match} view={view} actions={actions} waitingOn={reportNames(match).other} remoteResult={remoteResult} remoteLoading={!remoteState.loaded} />
        {hostInline && <MatchHostControls view={view} actions={actions} inline />}
      </div>
      {!hostInline && <MatchHostControls view={view} actions={actions} />}
      {reporting && currentUserPlayerId !== null && (
        <ReportPanel
          projection={matchProjection(match, currentUserPlayerId, ratings)}
          opponentName={opponent(match, currentUserPlayerId).name}
          confirmWindowHours={tournament.reportConfirmWindowHours ?? 24}
          loading={actions.loading !== null}
          onReport={actions.report}
        />
      )}
      {view.remote && pair && remoteResult && <RemoteResultPanel state={remoteState} pair={pair} viewerId={currentUserPlayerId} />}
      <MatchReopenPanel view={view} actions={actions} />
      <MatchError error={actions.error} />
      {actions.resultOpen && view.canSetResult && <SetResultDialog match={match} ratings={ratings} bestOf={tournament.bestOf ?? 3} actions={actions} />}
    </div>
  );
}
