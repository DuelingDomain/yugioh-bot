"use client";

import { useEffect, useState } from "react";
import { Check, Lock } from "lucide-react";
import { TierName } from "@/components/sheet";
import { matchAnchorId, SECTION_IDS, type YourMatchProps } from "../sheet-contracts";
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
  if (!registration) {
    return <p className="ym-deck"><span>No deck registered · <a className="link" href={`#${SECTION_IDS.myDeck}`}>Register a deck</a></span></p>;
  }
  const name = deckState?.savedDeckOptions.find(d => d.id === registration.savedDeckId)?.name
    ?? (deckState?.draft ? "Draft deck" : registration.savedDeckId !== null ? `Deck ${registration.savedDeckId}` : "Registered deck");
  const { main, extra, side } = registration.deck;
  return (
    <p className="ym-deck">
      <Lock className="ic sm" aria-hidden="true" />
      <span><strong>{name}</strong> · {main.length} main · {extra.length} extra · {side.length} side · {registration.lockedAt ? "locked for this event" : "registered"}</span>
    </p>
  );
}

function ActionMatch({ props, match, others, deck, narrow }: { props: YourMatchProps; match: Match; others: Match[]; deck: ReturnType<typeof useMatchDeck>; narrow: boolean }) {
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
  const hours = tournament.reportConfirmWindowHours ?? 24;
  const win = <span className="lp-d up">+{projection.winRating} if you win</span>;
  const lose = <span className="lp-d down">−{Math.abs(projection.loseRating)} if you lose</span>;
  // Carries the match anchor, so the crosstable's Play link for this match lands on the card.
  return (
    <section id={matchAnchorId(match.id)} className={`ym${narrow ? " ph" : ""}${view.lamp === "live" ? " lv" : ""}`} aria-label="Your match">
      <div className="ym-eye">
        <span><span className="lamp" data-s="you" />Your match{tournament.format === "single_elim" ? ` · Round ${match.roundNumber}` : ""}</span>
        {!narrow && others.length > 0 && (
          <span className="ym-left">
            {others.length} of your {others.length + 1} left after this ·{" "}
            {others.map((other, index) => (
              <span key={other.id}>{index > 0 && ", "}<a className="link" href={`#${matchAnchorId(other.id)}`}>vs {opponent(other, playerId).name}</a></span>
            ))}
          </span>
        )}
      </div>
      <div className="ym-face">
        <div className="ym-lp">
          <p className="ym-k">
            <b>{me}</b>
            {!narrow && <TierName tier={myRating?.rank ?? "none"}>{myRating?.rank ?? "Unrated"}</TierName>}
            <span>{myRecord.wins}–{myRecord.losses} here</span>
          </p>
          <p className="ym-n"><span className="num-d">{myRating?.rating ?? "—"}</span>{!narrow && win}</p>
        </div>
        <span className="ym-mid">vs</span>
        <div className="ym-lp r">
          <p className="ym-k">
            <span>{theirRecord.wins}–{theirRecord.losses} here</span>
            {!narrow && <TierName tier={oppRating?.rank ?? "none"}>{oppRating?.rank ?? "Unrated"}</TierName>}
            <b>{opp.name}</b>
          </p>
          <p className="ym-n">{!narrow && lose}<span className="num-d">{oppRating?.rating ?? "—"}</span></p>
        </div>
      </div>
      {narrow && <p className="ym-stakes">{win}{lose}<span>+{projection.winWinnings} winnings</span></p>}
      {view.state !== "your-open" && view.state !== "reporting" && <MatchState match={match} state={view.state} format="round_robin" hours={hours} />}
      <div className="ym-foot">
        {!narrow && <Deckline {...deck} />}
        <div className={narrow ? "acts ph-acts" : "acts"}>
          <MatchControls match={match} view={view} actions={actions} small={false} reportLabel={narrow ? "Report" : "Report a result"} waitingOn={reportNames(match).other} />
        </div>
      </div>
      {actions.reporting && view.canReport && (
        <ReportPanel projection={projection} opponentName={opp.name} confirmWindowHours={hours} loading={actions.loading !== null} onReport={actions.report} />
      )}
      <MatchError error={actions.error} />
    </section>
  );
}

export function YourMatch(props: YourMatchProps & { narrow?: boolean }) {
  const actionMatch = featuredMatch(props.tournament, props.currentUserPlayerId);
  const participant = props.tournament.isParticipant && props.currentUserPlayerId !== null;
  const deck = useMatchDeck(props, actionMatch !== null && !props.narrow);
  if (!participant) return null;
  if (!actionMatch) {
    return (
      <section aria-label="Your match" className={styles.caught}>
        <Check className="ic" aria-hidden="true" /><span>You&apos;re all caught up. Nothing needs you right now.</span>
      </section>
    );
  }
  const others = props.tournament.matches.filter(m => m.id !== actionMatch.id && isMatchPlayer(m, props.currentUserPlayerId) && (m.status === "open" || (m.status === "pending_approval" && m.reporterId !== null && m.reporterId !== props.currentUserPlayerId)));
  return <ActionMatch key={actionMatch.id} props={props} match={actionMatch} others={others} deck={deck} narrow={props.narrow ?? false} />;
}
