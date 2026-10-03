"use client";

import { useId, useState } from "react";
import { ChainMedallion, HistoryRail, HistoryRow, HistoryTurn, LivePill } from "@/components/sheet";
import { SECTION_IDS, matchAnchorId, type MatchQueueProps } from "../sheet-contracts";
import { formatRecent, parseDbTime } from "../sheet-dates";
import type { Match } from "../types";
import { decidedPlayers, featuredMatch, groupMatches, isMatchPlayer, winnerScore } from "./match-model";
import { MatchRow } from "./match-row";

function dayLabel(value: string | null): string {
  const date = parseDbTime(value);
  if (!date) return "Earlier";
  const age = Date.now() - date.getTime();
  if (age >= 0 && age < 6 * 24 * 60 * 60 * 1000) return date.toLocaleDateString("en-US", { weekday: "long" });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeLabel(value: string | null): string | null {
  const date = parseDbTime(value);
  return date ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00 ", " ") : null;
}

export function MatchQueue(props: MatchQueueProps) {
  const titleId = useId();
  const resultsId = useId();
  const [expanded, setExpanded] = useState(false);
  const closed = props.tournament.status !== "active";
  const featuredId = closed ? undefined : featuredMatch(props.tournament, props.currentUserPlayerId)?.id;
  const groups = groupMatches(props.tournament.matches.filter(match => match.id !== featuredId), props.currentUserPlayerId);
  const mine = (match: Match) => isMatchPlayer(match, props.currentUserPlayerId);
  if (closed) { groups.live = []; groups.open = []; }
  const canExpandResults = !closed || (props.isHost && props.tournament.format === "round_robin");
  const decidedCount = groups.decided.length;

  // Decided matches, newest first, one day header per change of day.
  const recent = closed ? groups.decided : groups.decided.slice(0, 3);
  const days: Array<{ day: string; matches: Match[] }> = [];
  for (const match of recent) {
    const day = dayLabel(match.resolvedAt);
    const last = days.at(-1);
    if (last?.day === day) last.matches.push(match); else days.push({ day, matches: [match] });
  }

  return (
    <section id={SECTION_IDS.matches} aria-labelledby={titleId}>
      <div className="sec-h"><h2 id={titleId} className="sec-t">{closed ? "Results" : "Matches"}</h2>{!closed && <span className="sec-aux">Grouped by what each match is waiting on</span>}</div>
      {props.tournament.matches.length === 0 && <p className="small">No matches yet.</p>}
      <div className="q">
        {groups.live.length > 0 && (
          <div role="group" aria-label="Live">
            <h3 className="q-h"><LivePill /><span className="n">{groups.live.length}</span></h3>
            <div className="q-list">{groups.live.map(match => <MatchRow key={match.id} {...props} match={match} />)}</div>
          </div>
        )}
        {groups.pending.length > 0 && (
          <div role="group" aria-label="Owes a reply">
            <h3 className="q-h"><ChainMedallion size="sm" />Owes a reply <span className="n">{groups.pending.length}</span></h3>
            <div className="q-list">{groups.pending.map(match => <MatchRow key={match.id} {...props} match={match} />)}</div>
          </div>
        )}
        {groups.open.length > 0 && (
          <div role="group" aria-label="Not started">
            <h3 className="q-h">
              <span className="lamp" data-s="open" />Not started <span className="n">{groups.open.length}</span>
              {featuredId !== undefined && <span className="q-aux">besides your match</span>}
            </h3>
            <div className="q-list">{groups.open.map(match => <MatchRow key={match.id} {...props} match={match} />)}</div>
          </div>
        )}
        {decidedCount > 0 && (
          <div role="group" aria-label={closed ? "Results" : "Decided"}>
            {expanded && canExpandResults ? (
              <>
                <h3 className="q-h">
                  <span className="lamp" data-s="done" />{closed ? "Results" : "Decided"} <span className="n">{decidedCount}</span>
                  <button type="button" className="link" aria-expanded aria-controls={resultsId} onClick={() => setExpanded(false)}>{closed ? "Show results" : "Show recent"}</button>
                </h3>
                <div id={resultsId} className="q-list">{[...groups.decided, ...groups.byes].map(match => <MatchRow key={match.id} {...props} match={match} />)}</div>
              </>
            ) : decidedCount > 0 && (
              <HistoryRail
                title={`${closed ? "Results" : "Decided"} · ${decidedCount}`}
                aside={canExpandResults ? <button type="button" className="link" aria-expanded={false} onClick={() => setExpanded(true)}>Show all</button> : undefined}
              >
                {days.map(({ day, matches }) => [
                  <HistoryTurn key={`day-${day}`}>{day}</HistoryTurn>,
                  ...matches.map(match => {
                    const { winner, loser } = decidedPlayers(match);
                    const score = winnerScore(match);
                    return (
                      <HistoryRow
                        key={match.id}
                        own={mine(match) ? "me" : undefined}
                        latest={match.id === recent[0]?.id}
                        score={score ?? "W"}
                        meta={<time dateTime={match.resolvedAt ?? undefined} title={formatRecent(match.resolvedAt) ?? undefined}>{timeLabel(match.resolvedAt)}</time>}
                        data-testid={`tournament-result-${match.id}`}
                        id={matchAnchorId(match.id)}
                      >
                        <b>{winner.name}</b> beat {loser.name}
                        {!score && <small>Reported, confirmed</small>}
                      </HistoryRow>
                    );
                  }),
                ])}
              </HistoryRail>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
