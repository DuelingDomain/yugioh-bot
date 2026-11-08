"use client";

import { useState } from "react";
import { plural } from "@/lib/admin-console/format";
import type { LiveDuel } from "@/lib/admin-console/types";
import type { ConsoleActions } from "../admin-console";
import { liveCounts, okData, type Snapshots } from "../model";
import { Notice, SectionHead, Since, Tag, WatchLink } from "../parts";
import styles from "../admin-console.module.css";
import { DuelRangeSection } from "./duel-range";
import { Seat } from "./duel-parts";

type Filter = "all" | "duels" | "drafts";
function turnText(duel: LiveDuel): { big: string; small: string } {
  if (duel.status === "lobby") return { big: "Lobby", small: `${duel.players.length} seated` };
  return { big: duel.turn != null ? `T${duel.turn}` : "T–", small: duel.turn != null ? "Turn" : "Starting" };
}

export function DuelsView({ s, actions }: { s: Snapshots; actions: ConsoleActions }) {
  const [filter, setFilter] = useState<Filter>("all");
  const result = s.live.result;
  const live = okData(s.live);
  const counts = liveCounts(live);
  // The duel history has its own requests, so it shows even when the live tables do not.
  const todaySection = <DuelRangeSection onOpen={actions.openPerson} />;
  if (result && result.state !== "ok") {
    return <><Notice tone={result.state === "error" ? "warn" : "info"} title="Live tables are not available">{result.message}</Notice>{todaySection}</>;
  }
  const duels = live?.duels ?? [];
  const drafts = live?.drafts ?? [];
  const showDuels = filter !== "drafts";
  const showDrafts = filter !== "duels";

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.seg} role="group" aria-label="Filter tables">
          {([["all", "All", duels.length + drafts.length], ["duels", "Duels", duels.length], ["drafts", "Drafts", drafts.length]] as const).map(([key, label, n]) => (
            <button key={key} type="button" aria-pressed={filter === key} aria-label={`${label}, ${n}`} onClick={() => setFilter(key)}>{label}<span>{n}</span></button>
          ))}
        </div>
        <span className={`${styles.aside} ${styles.toolbarEnd}`}>Watch opens a read-only player view in a new tab</span>
      </div>

      {showDuels ? (
        <div className={styles.duelTbl} role="table" aria-label="Live duels">
          <div className={styles.tblHead} role="row">
            <span role="columnheader">Format</span><span role="columnheader">Players</span><span role="columnheader">Turn</span>
            <span role="columnheader" className={styles.hAgo}>Started</span><span />
          </div>
          {duels.length === 0 ? <div className={styles.empty}>{live ? "No duel is running." : "Loading"}</div> : duels.map((d) => {
            const turn = turnText(d);
            return (
              <div key={d.slug} className={styles.tblRow} role="row">
                <div className={styles.cFmt} role="cell">
                  <div className={styles.fmt}>{d.formatLabel.replace(" duel", "")}<Tag tone={d.ranked ? "gold" : undefined}>{d.ranked ? "Ranked" : "Casual"}</Tag></div>
                  <div className={styles.fmtSmall} title={d.name}>{d.modeLabel ? `${d.modeLabel} · ` : ""}{d.genesys ? "Genesys · " : ""}{d.name}{d.visibility === "private" ? " · Private" : ""}</div>
                </div>
                <div className={`${styles.cPl} ${styles.players}`} role="cell">
                  {(d.seats ?? d.players.map((name) => ({ name, avatarUrl: null, bot: false, userId: null }))).map((seat, i) => (
                    <Seat key={`${seat.name}-${i}`} seat={seat} toPlay={d.activeSeat === i} onOpen={actions.openPerson} />
                  ))}
                </div>
                <div className={`${styles.cTurn} ${styles.turn}`} role="cell">
                  <b>{turn.big}</b><small>{turn.small}</small>
                  <small className={styles.ago}>{d.startedAt ? <><Since at={d.startedAt} /> playing</> : <>open <Since at={d.createdAt} /></>}</small>
                </div>
                <div className={`${styles.cAgo} ${styles.num}`} role="cell"><Since at={d.startedAt ?? d.createdAt} suffix=" ago" /></div>
                <div className={styles.cAct} role="cell"><WatchLink href={d.watchHref} label="Watch" title={d.status === "lobby" ? "Waiting table: opens the seat list" : undefined} /></div>
              </div>
            );
          })}
        </div>
      ) : null}

      {showDrafts ? (
        <>
          <SectionHead title="Drafts" n={`${counts.drafts.length} live${counts.draftLobbies ? ` · ${counts.draftLobbies} in lobby` : ""}`} flush={!showDuels} />
          <div className={styles.draftTbl} role="table" aria-label="Live drafts">
            <div className={styles.tblHead} role="row">
              <span role="columnheader">Draft</span><span role="columnheader">Players</span><span role="columnheader">Progress</span>
              <span role="columnheader" className={styles.hAgo}>Started</span><span />
            </div>
            {drafts.length === 0 ? <div className={styles.empty}>{live ? "No draft is running." : "Loading"}</div> : drafts.map((d) => {
              const pct = d.picksTotal ? Math.min(100, ((d.picksMade ?? 0) / d.picksTotal) * 100) : 0;
              return (
                <div key={d.slug} className={styles.tblRow} role="row">
                  <div className={styles.cFmt} role="cell">
                    <div className={styles.fmt}>{d.name}<Tag>{d.modeLabel ?? "Draft"}</Tag>{d.visibility === "private" ? <Tag>Private</Tag> : null}</div>
                    {d.cubeName ? <div className={styles.fmtSmall}>{d.cubeName}</div> : null}
                  </div>
                  <div className={`${styles.cPl} ${styles.players}`} role="cell">
                    {(d.seats ?? d.players.map((name) => ({ name, avatarUrl: null, bot: false, userId: null }))).map((seat, i) => <Seat key={`${seat.name}-${i}`} seat={seat} onOpen={actions.openPerson} />)}
                  </div>
                  <div className={`${styles.cProg} ${styles.prog}`} role="cell">
                    <div className={styles.progT}>{d.status === "pending" ? "In the lobby" : d.progress ?? "Starting"}{d.picksTotal ? <span>{d.picksMade ?? 0} of {d.picksTotal} picks</span> : null}</div>
                    <div className={styles.bar}><span style={{ width: `${pct}%` }} /></div>
                  </div>
                  <div className={`${styles.cAgo} ${styles.num}`} role="cell"><Since at={d.startedAt ?? d.createdAt} suffix=" ago" /></div>
                  <div className={styles.cAct} role="cell"><WatchLink href={d.href} label="Watch" title={d.status === "pending" ? "Waiting lobby: opens the player list" : undefined} /></div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {showDuels ? todaySection : null}
    </>
  );
}
