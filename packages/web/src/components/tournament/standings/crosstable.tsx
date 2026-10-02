"use client";

import { useState } from "react";
import sheet from "@/components/sheet/sheet.module.css";
import { matchAnchorId, SECTION_IDS, type CrosstableProps, type PlayerRatings } from "../sheet-contracts";
import { buildCrosstable, buildStandings, type CrosstableRow } from "./standings-model";
import { StandingsList, StandingsPlayer } from "./standings-list";
import styles from "./standings.module.css";

export function Crosstable({ tournament, currentUserPlayerId, ratings }: CrosstableProps) {
  const [showGrid, setShowGrid] = useState(false);
  const standings = buildStandings(tournament);
  const roundRobin = tournament.format === "round_robin";
  const canToggle = roundRobin && standings.length > 12;
  const gridVisible = roundRobin && (!canToggle || showGrid);

  return <section id={SECTION_IDS.standings} aria-label="Standings" className={styles.section}>
    <div className={sheet["sec-h"]}>
      <h3 className={sheet["sec-t"]}>Standings</h3>
      <span className={sheet["sec-aux"]}>Placed by wins, then fewest losses. Equal records share a place.</span>
      {canToggle && <button type="button" className={`${sheet.link} ${styles.toggle}`} aria-pressed={showGrid} onClick={() => setShowGrid(!showGrid)}>
        {showGrid ? "Show list" : "Show grid"}
      </button>}
    </div>
    {standings.length === 0 ? <p className={sheet.small}>No players yet.</p> : gridVisible ?
      <StandingsGrid rows={buildCrosstable(tournament, currentUserPlayerId)} currentUserPlayerId={currentUserPlayerId} ratings={ratings} /> :
      <StandingsList standings={standings} currentUserPlayerId={currentUserPlayerId} ratings={ratings} />}
  </section>;
}

function StandingsGrid({ rows, currentUserPlayerId, ratings }: {
  rows: CrosstableRow[];
  currentUserPlayerId: number | null;
  ratings: PlayerRatings;
}) {
  return <div className={styles["xt-wrap"]} role="region" aria-label="Standings grid" tabIndex={0}>
    <table className={styles.xt} aria-label="Tournament crosstable">
      <thead><tr>
        <th scope="col" className={`${styles.l} ${styles["place-head"]}`}>#</th>
        <th scope="col" className={styles.l}>Player</th>
        {rows.map((row) => <th scope="col" key={row.playerId} className={styles.opp}>
          <span title={row.displayName}>{row.displayName}</span>
        </th>)}
        <th scope="col">W</th><th scope="col" className={styles["loss-head"]}>L</th>
      </tr></thead>
      <tbody>{rows.map((row) => {
        const me = row.playerId === currentUserPlayerId;
        return <tr key={row.playerId} className={me ? styles.me : undefined}>
          <td className={styles.pos}>{row.place}</td>
          <td className={styles.who}><StandingsPlayer player={row} ratings={ratings} me={me} /></td>
          {row.cells.map((cell, index) => <td key={rows[index].playerId} aria-label={cell.accessibleName}>
            {cell.result === "you" && cell.matchId != null ?
              <a className={styles.cell} data-r="you" href={`#${matchAnchorId(cell.matchId)}`} aria-label={cell.accessibleName}>{cell.text}</a> :
              <span className={styles.cell} data-r={cell.result}>{cell.text}{cell.label && <small>{cell.label}</small>}</span>}
          </td>)}
          <td className={`${styles.rec} ${styles.w}`}>{row.wins}</td>
          <td className={`${styles.rec} ${styles.l}`}>{row.losses}</td>
        </tr>;
      })}</tbody>
    </table>
    <div className={styles["xt-key"]} role="group" aria-label="Crosstable key">
      <span><span className={styles.cell} data-r="w" aria-hidden="true">W</span>won · game score when played online</span>
      <span><span className={styles.cell} data-r="l" aria-hidden="true">L</span>lost</span>
      <span><span className={styles.cell} data-r="live" aria-hidden="true">·</span>live now</span>
      <span><span className={styles.cell} data-r="wait" aria-hidden="true">·</span>reported, not confirmed</span>
      <span><span className={styles.cell} data-r="open" aria-hidden="true">·</span>not started</span>
      <span>Columns are opponents, in standings order</span>
    </div>
  </div>;
}
