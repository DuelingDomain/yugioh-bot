"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { matchAnchorId, SECTION_IDS, type CrosstableProps, type PlayerRatings } from "../sheet-contracts";
import { buildCrosstable, buildPlayerFlags, buildStandings, type CrosstableRow } from "./standings-model";
import { StandingsList, StandingsPlayer } from "./standings-list";

/** Scrolls to a match row and moves focus there, the way the old link did. */
export function goToMatch(matchId: number) {
  const node = document.getElementById(matchAnchorId(matchId));
  if (!node) return;
  node.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
  node.focus({ preventScroll: true });
}

export function Crosstable({ tournament, currentUserPlayerId, ratings, narrow = false, final = false }: CrosstableProps & { narrow?: boolean; final?: boolean }) {
  const [showGrid, setShowGrid] = useState(false);
  const standings = buildStandings(tournament);
  const roundRobin = tournament.format === "round_robin";
  const gridVisible = roundRobin && (!narrow || showGrid);

  return (
    <section id={SECTION_IDS.standings} aria-label={final ? "Final standings" : "Standings"}>
      <div className="sec-h">
        <h2 className="sec-t">{final ? "Final standings" : "Standings"}</h2>
        {narrow && roundRobin
          ? <button type="button" className="btn btn-quiet btn-sm" aria-pressed={showGrid} onClick={() => setShowGrid(!showGrid)}>{showGrid ? "Show list" : "Show grid"}</button>
          : <span className="sec-aux">{roundRobin ? "Wins, then fewest losses · columns are opponents in the same order" : "Placed by wins, then fewest losses. Equal records share a place."}</span>}
      </div>
      {standings.length === 0 ? <p className="small">No players yet.</p>
        : gridVisible ? <StandingsGrid rows={buildCrosstable(tournament, currentUserPlayerId)} currentUserPlayerId={currentUserPlayerId} ratings={ratings} narrow={narrow} />
        : <StandingsList standings={standings} currentUserPlayerId={currentUserPlayerId} ratings={ratings} flags={buildPlayerFlags(tournament)} />}
    </section>
  );
}

const LEGEND: Array<{ r: string; text: string; label: string | null; note: string }> = [
  { r: "w", text: "2–1", label: "won", note: "Row player won. Game score when the duel was online, W when it was reported." },
  { r: "l", text: "1–2", label: "lost", note: "Row player lost." },
  { r: "live", text: "1–0", label: "game 2", note: "Being played now." },
  { r: "wait", text: "W", label: "reported", note: "Reported, waiting for the other player to confirm." },
  { r: "you", text: "Play", label: null, note: "Yours to play." },
  { r: "open", text: "·", label: null, note: "Not started." },
];

function StandingsGrid({ rows, currentUserPlayerId, ratings, narrow }: {
  rows: CrosstableRow[];
  currentUserPlayerId: number | null;
  ratings: PlayerRatings;
  narrow: boolean;
}) {
  return (
    <>
      <div className={`xt-wrap${narrow ? " xt-pin" : ""}`} role="region" aria-label="Standings grid" tabIndex={0}>
        <table className="xt" aria-label="Tournament crosstable">
          <thead>
            <tr>
              <th scope="col" className="l" style={{ paddingLeft: narrow ? 12 : 16 }}>#</th>
              <th scope="col" className="l">Player</th>
              {rows.map((row) => <th scope="col" key={row.playerId} className="opp"><span title={row.displayName}>{row.displayName}</span></th>)}
              {!narrow && <><th scope="col">W</th><th scope="col" style={{ paddingRight: 14 }}>L</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const me = row.playerId === currentUserPlayerId;
              return (
                <tr key={row.playerId} className={me ? "me" : undefined}>
                  <td className="pos">{row.place}</td>
                  <td className="who"><StandingsPlayer player={row} ratings={ratings} me={me} gem={!narrow} /></td>
                  {row.cells.map((cell, index) => (
                    <td key={rows[index].playerId} aria-label={cell.accessibleName}>
                      {cell.result === "you" && cell.matchId != null
                        ? <button type="button" className="cell" data-r="you" aria-label={cell.accessibleName} onClick={() => goToMatch(cell.matchId!)}>{cell.text}</button>
                        : <span className="cell" data-r={cell.result}>{cell.text}{cell.label && <small>{cell.label}</small>}</span>}
                    </td>
                  ))}
                  {!narrow && <><td className="rec w">{row.wins}</td><td className="rec l">{row.losses}</td></>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!narrow && (
          <dl className="xt-legend" aria-label="How to read a cell">
            {LEGEND.map((item) => (
              <div key={item.r}>
                <dt>{item.r === "you"
                  ? <button type="button" className="cell" data-r="you" tabIndex={-1} aria-hidden="true">{item.text}</button>
                  : <span className="cell" data-r={item.r} aria-hidden="true">{item.text}{item.label && <small>{item.label}</small>}</span>}</dt>
                <dd>{item.note}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {narrow && <p className="ph-hint"><ChevronRight className="ic sm" aria-hidden="true" />Swipe the grid. Names and places stay pinned.</p>}
    </>
  );
}
