"use client";

import { useState, type ReactNode } from "react";
import { duration, plural } from "@/lib/admin-console/format";
import type { LiveDuel, LiveSeat, SeatOutcome, TodayData, TodayDuel, TodayResult, UserKey } from "@/lib/admin-console/types";
import type { ConsoleActions } from "../admin-console";
import { TODAY_ANCHOR, liveCounts, okData, tzLabel, type Snapshots } from "../model";
import { Avatar, Notice, SectionHead, Since, Tag, WatchLink, useNow } from "../parts";
import styles from "../admin-console.module.css";

type Filter = "all" | "duels" | "drafts";
type TodayFilter = "all" | "oneVsOne" | "multi" | "ranked";
const TODAY_FILTERS: [TodayFilter, string][] = [["all", "All"], ["oneVsOne", "1v1"], ["multi", "Multi"], ["ranked", "Ranked"]];
const OUTCOME_WORD: Record<Exclude<SeatOutcome, null>, string> = { won: "Won", lost: "Lost", draw: "Draw" };
const RESULT_WORD: Record<Exclude<TodayResult, "won">, string> = { live: "Live", draw: "Draw", interrupted: "Interrupted", cancelled: "Cancelled", idle: "Idle" };

function Seat({ seat, toPlay, outcome, onOpen }: { seat: LiveSeat; toPlay?: boolean; outcome?: SeatOutcome; onOpen: (userId: UserKey) => void }) {
  const mark: ReactNode = toPlay ? <span className={styles.toPlay}>To decide</span>
    : outcome ? <span className={styles.outcome} data-outcome={outcome}>{OUTCOME_WORD[outcome]}</span> : <span />;
  const body = (
    <>
      <Avatar name={seat.name} url={seat.avatarUrl} size="sm" bot={seat.bot} />
      <span className={styles.nm}>{seat.name}</span>
      {mark}
    </>
  );
  return seat.userId !== null
    ? <button type="button" className={styles.pl} onClick={() => onOpen(seat.userId!)} title={`Open ${seat.name}`} style={{ textAlign: "left" }}>{body}</button>
    : <div className={styles.pl}>{body}</div>;
}

function turnText(duel: LiveDuel): { big: string; small: string } {
  if (duel.status === "lobby") return { big: "Lobby", small: `${duel.players.length} seated` };
  return { big: duel.turn != null ? `T${duel.turn}` : "T–", small: duel.turn != null ? "Turn" : "Starting" };
}

/** "14:05" in the browser's time zone. */
const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

function resultText(duel: TodayDuel): string {
  if (duel.result !== "won") return RESULT_WORD[duel.result];
  const winners = duel.seats.filter((seat) => seat.outcome === "won").map((seat) => seat.name);
  return winners.length ? `${winners.join(" & ")} won` : "Won";
}

function TodayRow({ duel, onOpen, now }: { duel: TodayDuel; onOpen: (userId: UserKey) => void; now: number }) {
  const running = duel.result === "live" || duel.result === "idle";
  const facts = [duel.turns != null ? `${duel.turns} ${duel.turns === 1 ? "turn" : "turns"}` : null, duration((duel.endedAt ?? now) - duel.startedAt)].filter(Boolean).join(" · ");
  return (
    <div className={styles.tblRow} role="row">
      <div className={styles.cFmt} role="cell">
        <div className={styles.fmt}>{duel.formatLabel.replace(" duel", "")}<Tag tone={duel.ranked ? "gold" : undefined}>{duel.ranked ? "Ranked" : "Casual"}</Tag></div>
        <div className={styles.fmtSmall} title={duel.name}>{duel.genesys ? "Genesys · " : ""}{duel.name}</div>
      </div>
      <div className={`${styles.cPl} ${styles.players}`} role="cell">
        {duel.seats.map((seat, i) => <Seat key={`${seat.name}-${i}`} seat={seat} outcome={seat.outcome} onOpen={onOpen} />)}
      </div>
      <div className={`${styles.cRes} ${styles.res}`} role="cell" data-result={duel.result}>
        <b title={resultText(duel)}>{duel.result === "live" ? <span className={styles.dot} data-tone="good" /> : null}{resultText(duel)}</b>
        <small>{facts}</small>
      </div>
      <div className={`${styles.cAt} ${styles.num}`} role="cell"><time dateTime={new Date(duel.startedAt).toISOString()}>{clock(duel.startedAt)}</time></div>
      <div className={styles.cAct} role="cell">
        {running ? <WatchLink href={duel.href} label="Watch" /> : <WatchLink href={duel.href} label="Replay" icon="play" />}
      </div>
    </div>
  );
}

/** Every duel that started today (owner's local day), newest first, with the result per player and a replay. */
function TodaySection({ today, failed, actions, flush }: { today: TodayData | null; failed: string | null; actions: ConsoleActions; flush?: boolean }) {
  const [filter, setFilter] = useState<TodayFilter>("all");
  const now = useNow();
  const duels = (today?.duels ?? []).filter((d) => filter === "all" ? true
    : filter === "oneVsOne" ? d.format === "1v1" : filter === "multi" ? d.format !== "1v1" : d.ranked);
  const total = today ? today.counts[filter] : 0;
  const zone = today ? tzLabel(today.tzOffsetMinutes) : null;
  return (
    <div id={TODAY_ANCHOR} className={styles.anchor}>
      <SectionHead title="Today" n={today ? plural(today.counts.all, "duel", "duels") : undefined} flush={flush}
        aside={<span className={styles.aside}>{zone ? `Since 00:00 ${zone}` : null}</span>} />
      {failed ? <Notice tone="warn" title="The duels of today are not available">{failed}</Notice> : (
        <>
          <div className={`${styles.toolbar} ${styles.toolbarTight}`}>
            <div className={styles.seg} role="group" aria-label="Filter duels of today">
              {TODAY_FILTERS.map(([key, label]) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{today ? today.counts[key] : 0}</span></button>
              ))}
            </div>
            <span className={`${styles.aside} ${styles.toolbarEnd}`}>
              {today && duels.length < total ? `Showing ${duels.length} of ${total} · ` : ""}Replays open in a new tab
            </span>
          </div>
          <div className={styles.todayTbl} role="table" aria-label="Duels today">
            <div className={styles.tblHead} role="row">
              <span role="columnheader">Format</span><span role="columnheader">Players</span><span role="columnheader">Result</span>
              <span role="columnheader" className={styles.hAt}>Started</span><span />
            </div>
            {duels.length === 0
              ? <div className={`${styles.empty} ${styles.emptySm}`}>{!today ? "Loading" : today.counts.all === 0 ? "No duel started today." : "No duel of today fits this filter."}</div>
              : duels.map((d) => <TodayRow key={d.slug} duel={d} onOpen={actions.openPerson} now={now} />)}
          </div>
        </>
      )}
    </div>
  );
}

export function DuelsView({ s, actions }: { s: Snapshots; actions: ConsoleActions }) {
  const [filter, setFilter] = useState<Filter>("all");
  const result = s.live.result;
  const live = okData(s.live);
  const counts = liveCounts(live);
  if (result && result.state !== "ok") return <Notice tone={result.state === "error" ? "warn" : "info"} title="Live tables are not available">{result.message}</Notice>;
  const duels = live?.duels ?? [];
  const drafts = live?.drafts ?? [];
  const showDuels = filter !== "drafts";
  const showDrafts = filter !== "duels";

  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.seg} role="group" aria-label="Filter tables">
          {([["all", "All", duels.length + drafts.length], ["duels", "Duels", duels.length], ["drafts", "Drafts", drafts.length]] as const).map(([key, label, n]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{n}</span></button>
          ))}
        </div>
        <span className={`${styles.aside} ${styles.toolbarEnd}`}>Watch opens the table in a new tab</span>
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
                  <div className={styles.fmtSmall} title={d.name}>{d.genesys ? "Genesys · " : ""}{d.name}</div>
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
                <div className={styles.cAct} role="cell"><WatchLink href={d.watchHref} label={d.status === "lobby" ? "Open" : "Watch"} /></div>
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
                    <div className={styles.fmt}>{d.name}<Tag>{d.modeLabel ?? "Draft"}</Tag></div>
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
                  <div className={styles.cAct} role="cell"><WatchLink href={d.href} label="Open" /></div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {showDuels ? (
        <TodaySection today={okData(s.today)} actions={actions}
          failed={s.today.result && s.today.result.state !== "ok" ? s.today.result.message : null} />
      ) : null}
    </>
  );
}
