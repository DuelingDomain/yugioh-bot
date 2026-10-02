"use client";

import { useId } from "react";
import { buildStandings } from "../standings/standings-model";
import { goToMatch } from "../standings/crosstable";
import { formatRecent } from "../sheet-dates";
import type { YourMatchProps } from "../sheet-contracts";
import type { Match } from "../types";
import { featuredMatch, isMatchPlayer, matchProjection, matchScore, opponent, tournamentRecord, winnerScore } from "./match-model";

function ordinal(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** The phone's "Your row": every match of the viewer's, before the grid they would otherwise scroll. */
export function MyRow({ tournament, currentUserPlayerId, ratings }: YourMatchProps) {
  const titleId = useId();
  if (!tournament.isParticipant || currentUserPlayerId === null || tournament.format !== "round_robin") return null;
  const playerId = currentUserPlayerId;
  const mine = tournament.matches.filter((m) => isMatchPlayer(m, playerId) && m.playerTwoId !== null && m.metadata?.bye !== true);
  if (mine.length === 0) return null;
  const featuredId = featuredMatch(tournament, playerId)?.id;
  const rank = (m: Match) => (m.status === "completed" ? 1 : 0);
  const rows = [...mine].sort((a, b) => rank(a) - rank(b)
    || (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));
  const standing = buildStandings(tournament).find((row) => row.playerId === playerId);
  const record = tournamentRecord(tournament.matches, playerId);

  return (
    <section className="myrow" aria-labelledby={titleId}>
      <div className="sec-h">
        <h2 id={titleId} className="sec-t">Your row</h2>
        <span className="sec-aux">{standing ? `${ordinal(standing.place)} · ` : ""}{record.wins} W · {record.losses} L</span>
      </div>
      <ol className="hr-list hr">
        {rows.map((match) => {
          const opp = opponent(match, playerId);
          const done = match.status === "completed" && match.winnerId !== null;
          const won = match.winnerId === playerId;
          const score = done ? winnerScore(match) : matchScore(match);
          // winnerScore reads from the winner's side; the row wants the viewer's.
          const mineScore = done && score && !won ? score.split("–").reverse().join("–") : score;
          const open = match.status === "open";
          const projection = open && opp.id !== null ? matchProjection(match, playerId, ratings) : null;
          const pending = match.status === "pending_approval" || match.status === "pending";
          return (
            <li key={match.id} className="hr-row" data-own={done ? "none" : "me"}>
              {done ? <span className="cell" data-r={won ? "w" : "l"}>{mineScore ?? (won ? "W" : "L")}<small>{won ? "won" : "lost"}</small></span>
                : open ? <button type="button" className="cell" data-r="you" aria-label={`Play ${opp.name}`} onClick={() => goToMatch(match.id)}>Play</button>
                : <span className="cell" data-r={pending ? "wait" : "live"}>{pending ? (match.winnerId === playerId ? "W" : "L") : mineScore ?? "·"}<small>{pending ? "reported" : "live"}</small></span>}
              <span className="hr-tx">
                {done ? <>vs {opp.name}</> : <><b>vs {opp.name}</b><small>{match.id === featuredId ? "The match above" : open ? "Not started" : pending ? "Waiting on a reply" : "Being played now"}</small></>}
              </span>
              <span className="hr-mt">{done ? (formatRecent(match.resolvedAt)?.split(" ")[0] ?? "") : projection ? `−${Math.abs(projection.loseRating)} / +${projection.winRating}` : ""}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
