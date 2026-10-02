"use client";

import { useEffect, useState } from "react";
import { Check, Lock } from "lucide-react";
import { TierName } from "@/components/rank/rank-gem";
import sheet from "@/components/sheet/sheet.module.css";
import { matchAnchorId, SECTION_IDS, type YourMatchProps } from "../sheet-contracts";
import { rulesSummary } from "../sheet-rules";
import { parseMyDeckState, type MyDeckState } from "../my-deck-model";
import type { Match } from "../types";
import { featuredMatch, isMatchPlayer, matchProjection, matchView, opponent, reportNames, tournamentRecord } from "./match-model";
import { MatchControls, MatchError } from "./match-controls";
import { MatchState } from "./match-state";
import { ReportPanel } from "./report-panel";
import { useMatchActions } from "./use-match-actions";
import styles from "./matches.module.css";

function useMatchDeck(props: YourMatchProps, enabled: boolean) {
  const { tournament, tournamentSlug, currentUserPlayerId } = props;
  const participant = tournament.participants.find(p => p.playerId === currentUserPlayerId);
  const registered = participant?.deckRegistered;
  const locked = participant?.deckLocked;
  const [deckState, setDeckState] = useState<MyDeckState | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/tournaments/${tournamentSlug}/deck`);
        const data = res.ok ? parseMyDeckState(await res.json()) : null;
        if (!cancelled) { setDeckState(data); setLoaded(true); }
      } catch { if (!cancelled) { setDeckState(null); setLoaded(true); } }
    }
    void load();
    return () => { cancelled = true; };
  }, [enabled, tournamentSlug, currentUserPlayerId, registered, locked]);
  return { deckState, loaded };
}

function Deckline({ deckState, loaded }: ReturnType<typeof useMatchDeck>) {
  if (!loaded) return null;
  const registration = deckState?.registration;
  if (!registration) return <span className={styles.deckline}>No deck registered <a className={sheet.link} href={`#${SECTION_IDS.myDeck}`}>Register a deck</a></span>;
  const name = deckState?.savedDeckOptions.find(d => d.id === registration.savedDeckId)?.name ?? (deckState?.draft ? "Draft deck" : registration.savedDeckId !== null ? `Deck ${registration.savedDeckId}` : "Registered deck");
  const { main, extra, side } = registration.deck;
  return <span className={styles.deckline}>
    <Lock size={14} aria-hidden="true" /><strong>{name}</strong> {main.length} main · {extra.length} extra · {side.length} side · {registration.lockedAt ? "locked for this tournament" : "registered"}
  </span>;
}

function ActionMatch({ props, match, others, deck }: { props: YourMatchProps; match: Match; others: Match[]; deck: ReturnType<typeof useMatchDeck> }) {
  const { tournament, tournamentSlug, currentUserPlayerId, isHost, ratings, onChanged } = props;
  const playerId = currentUserPlayerId!;
  const actions = useMatchActions(match, tournamentSlug, onChanged);
  const view = matchView(match, playerId, isHost, tournament, actions);
  const opp = opponent(match, playerId);
  const me = tournament.participants.find(p => p.playerId === playerId)?.displayName ?? (match.playerOneId === playerId ? match.playerOneName : match.playerTwoName!);
  const projection = matchProjection(match, playerId, ratings);
  const myRecord = tournamentRecord(tournament.matches, playerId);
  const theirRecord = opp.id === null ? { wins: 0, losses: 0 } : tournamentRecord(tournament.matches, opp.id);
  const myRating = ratings.get(playerId), oppRating = opp.id === null ? undefined : ratings.get(opp.id);
  // Carries the match anchor, so the crosstable's Play link for this match lands on the card.
  return <section id={matchAnchorId(match.id)} className={styles.ym} aria-label="Your match">
    <div className={styles["ym-eye"]}>
      <span><span className={sheet.lamp} data-s="you" />Your match{tournament.format === "single_elim" ? ` · Round ${match.roundNumber}` : ""}</span>
      {rulesSummary(tournament) && <span className={styles.rules}>{rulesSummary(tournament)!.line}</span>}
    </div>
    <div className={styles["ym-vs"]}>
      <div className={styles["ym-p"]}><span className={styles["ym-name"]}>{me}</span><span className={styles["ym-sub"]}>
        <TierName tier={myRating?.rank ?? "none"}>{myRating?.rank ?? "Unrated"}</TierName>
        {myRating && <span className={styles.elo}>{myRating.rating}</span>}<span>{myRecord.wins}–{myRecord.losses} here</span>
      </span></div>
      <span className={styles["ym-mid"]}>vs</span>
      <div className={`${styles["ym-p"]} ${styles.r}`}><span className={styles["ym-name"]}>{opp.name}</span><span className={styles["ym-sub"]}>
        <span>{theirRecord.wins}–{theirRecord.losses} here</span>{oppRating && <span className={styles.elo}>{oppRating.rating}</span>}
        <TierName tier={oppRating?.rank ?? "none"}>{oppRating?.rank ?? "Unrated"}</TierName>
      </span></div>
    </div>
    {view.state !== "your-open" && view.state !== "reporting" && <MatchState match={match} state={view.state} lamp={view.lamp} format="round_robin" hours={tournament.reportConfirmWindowHours ?? 24} />}
    <div className={styles["ym-foot"]}>
      <p className={styles.stakes}><span><b className={styles.up}>+{projection.winRating}</b>Elo and <b className={styles.flat}>+{projection.winWinnings}</b>winnings if you win</span><span><b className={styles.down}>−{Math.abs(projection.loseRating)}</b>Elo if you lose</span></p>
      <div className={`${sheet.acts} ${styles.controls}`}><MatchControls match={match} view={view} actions={actions} small={false} reportLabel="Report a result" waitingOn={reportNames(match).other} /></div>
    </div>
    {actions.reporting && view.canReport && <ReportPanel projection={projection} opponentName={opp.name} confirmWindowHours={tournament.reportConfirmWindowHours ?? 24} loading={actions.loading !== null} onReport={actions.report} />}
    <MatchError error={actions.error} />
    <div className={styles["ym-more"]}>
      <Deckline {...deck} />
      {others.length > 0 && <span className={styles.also}>Also yours: {others.map(other => <a key={other.id} href={`#${matchAnchorId(other.id)}`}><strong>vs {opponent(other, playerId).name}</strong></a>)}</span>}
    </div>
  </section>;
}

export function YourMatch(props: YourMatchProps) {
  const actionMatch = featuredMatch(props.tournament, props.currentUserPlayerId);
  const participant = props.tournament.isParticipant && props.currentUserPlayerId !== null;
  const deck = useMatchDeck(props, actionMatch !== null);
  if (!participant) return null;
  if (!actionMatch) return <section aria-label="Your match" className={`${sheet.panel} ${sheet["panel-pad"]} ${styles["caught-up"]}`}>
    <Check size={16} aria-hidden="true" /><span>You&apos;re all caught up. Nothing needs you right now.</span>
  </section>;
  const others = props.tournament.matches.filter(m => m.id !== actionMatch.id && isMatchPlayer(m, props.currentUserPlayerId) && (m.status === "open" || (m.status === "pending_approval" && m.reporterId !== null && m.reporterId !== props.currentUserPlayerId)));
  return <ActionMatch key={actionMatch.id} props={props} match={actionMatch} others={others} deck={deck} />;
}
