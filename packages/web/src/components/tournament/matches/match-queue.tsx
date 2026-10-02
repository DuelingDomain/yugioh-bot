"use client";

import { useId, useState } from "react";
import sheet from "@/components/sheet/sheet.module.css";
import { SECTION_IDS, type MatchQueueProps } from "../sheet-contracts";
import { formatRecent } from "../sheet-dates";
import { decidedPlayers, featuredMatch, groupMatches, winnerScore } from "./match-model";
import { MatchRow } from "./match-row";
import styles from "./matches.module.css";

export function MatchQueue(props: MatchQueueProps) {
  const titleId = useId();
  const resultsId = useId();
  const [expanded, setExpanded] = useState(false);
  const featuredId = featuredMatch(props.tournament, props.currentUserPlayerId)?.id;
  const groups = groupMatches(props.tournament.matches.filter(match => match.id !== featuredId), props.currentUserPlayerId);
  const queue = [
    { key: "live", title: "Live", lamp: "live", matches: groups.live },
    { key: "pending", title: "Awaiting confirmation", lamp: "wait", matches: groups.pending },
    { key: "open", title: "Not started", lamp: "open", matches: groups.open },
  ];
  return <section id={SECTION_IDS.matches} aria-labelledby={titleId}>
    <div className={sheet["sec-h"]}><h3 id={titleId} className={sheet["sec-t"]}>Matches</h3><span className={sheet["sec-aux"]}>Grouped by what each match is waiting on</span></div>
    {props.tournament.matches.length === 0 && <p className={sheet.small}>No matches yet.</p>}
    <div className={styles.q}>
      {queue.map(group => group.matches.length === 0 ? null : <div key={group.key} role="group" aria-label={group.title}>
        <h4 className={styles["q-h"]}><span className={sheet.lamp} data-s={group.lamp} />{group.title} <span className={styles.n}>{group.matches.length}</span></h4>
        <div className={styles["q-list"]}>{group.matches.map(match => <MatchRow key={match.id} {...props} match={match} />)}</div>
      </div>)}
      {(groups.decided.length > 0 || groups.byes.length > 0) && <div role="group" aria-label="Decided">
        <h4 className={styles["q-h"]}><span className={sheet.lamp} data-s="done" />Decided <span className={styles.n}>{groups.decided.length}</span>
          <button type="button" className={`${sheet.link} ${styles.expand}`} aria-expanded={expanded} aria-controls={resultsId} onClick={() => setExpanded(value => !value)}>{expanded ? "Show recent" : `Show all ${groups.decided.length}`}</button>
        </h4>
        <div id={resultsId}>
          {expanded ? <div className={styles["q-list"]}>{[...groups.decided, ...groups.byes].map(match => <MatchRow key={match.id} {...props} match={match} />)}</div> : <ul className={styles.results}>
            {groups.decided.slice(0, 3).map(match => {
              const { winner, loser } = decidedPlayers(match);
              const score = winnerScore(match);
              return <li key={match.id}><span>
                <span className={styles.w}>{winner.name}</span>{" "}<span className={styles.def}>def.</span>{" "}
                <span className={styles.l}>{loser.name}</span>
                <span className={`${styles.sc} ${score ? "" : styles.reported}`}>{score ?? "reported"}</span>
              </span><time dateTime={match.resolvedAt ?? undefined}>{formatRecent(match.resolvedAt)}</time></li>;
            })}
          </ul>}
        </div>
      </div>}
    </div>
  </section>;
}
