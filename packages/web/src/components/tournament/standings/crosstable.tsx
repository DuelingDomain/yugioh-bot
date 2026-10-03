"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Mono, YouPill, ringColour } from "@/components/sheet";
import { requestMatch } from "../floor/select-match";
import type { CrosstableRow } from "./standings-model";
import styles from "./standings.module.css";

/**
 * Puts a match on your field and moves focus there. The field has one stable id (`duel-field`) whichever match
 * it shows, so the scroll never depends on the match. A match that is not an open match of yours is ignored
 * by the field; the page still scrolls to the field, or to the tables when there is no field.
 */
export function goToMatch(matchId: number) {
  requestMatch(matchId);
  const node = document.getElementById("duel-field") ?? document.getElementById("matches");
  if (!node) return;
  node.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
  node.focus({ preventScroll: true });
}

const LEGEND: Array<{ r: string; text: string; label: string | null; note: string }> = [
  { r: "w", text: "2–1", label: "won", note: "Row player won. Game score when the duel was online, W when it was reported by hand." },
  { r: "l", text: "1–2", label: "lost", note: "Row player lost." },
  { r: "live", text: "1–0", label: "game 2", note: "Being played now." },
  { r: "wait", text: "W", label: "reported", note: "Reported, waiting for the other player to confirm." },
  { r: "you", text: "Play", label: null, note: "Yours to play." },
  { r: "open", text: "·", label: null, note: "Not started." },
];

export function StandingsGrid({ rows, currentUserPlayerId, narrow }: {
  rows: CrosstableRow[];
  currentUserPlayerId: number | null;
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
                  <td className="who"><span className={styles.gridWho}>
                    {!narrow && <Mono name={row.displayName} size="sm" ring={ringColour(row.playerId)} you={me} />}
                    <Link href={`/player/${row.playerId}`} title={row.displayName}>{row.displayName}</Link>
                    {me && <YouPill />}
                  </span></td>
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
