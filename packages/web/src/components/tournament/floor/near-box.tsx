"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BugFabLift } from "@/components/bug-report/fab-lift";
import { DeckMark, DuelAction, SheetPortal, SvButton } from "@/components/sheet";
import type { PlayerRatings } from "../sheet-contracts";
import type { Match, TournamentDetail } from "../types";
import { MatchError } from "../matches/match-controls";
import { matchProjection, matchView, opponent } from "../matches/match-model";
import { MyDeckPanel } from "../my-deck-panel";
import { ReportPanel } from "../matches/report-panel";
import { useMatchActions } from "../matches/use-match-actions";
import { signed, stakesFor } from "./floor-model";
import styles from "./floor.module.css";

/**
 * Everything under your field: the Elo at stake, the one action that moves the match along, the
 * "played off the site" report link, and your deck. On a phone the action buttons sit in a bar fixed to
 * the bottom of the screen (through SheetPortal, because a fixed bar must not live inside the .ms
 * container); an in-flow spacer keeps the last lines of the page clear of it.
 */
export function NearBox({ tournament, tournamentSlug, match, viewerId, isHost, ratings, onChanged, narrow }: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  match: Match;
  viewerId: number;
  isHost: boolean;
  ratings: PlayerRatings;
  onChanged: () => void;
  narrow: boolean;
}) {
  const actions = useMatchActions(match, tournamentSlug, onChanged);
  const view = matchView(match, viewerId, isHost, tournament, actions);
  const opp = opponent(match, viewerId);
  const hours = tournament.reportConfirmWindowHours ?? 24;
  const me = tournament.participants.find((p) => p.playerId === viewerId);
  const disabled = actions.loading !== null;
  // "Register a deck" opens the deck panel right here: the old link jumped to a rail section that
  // is already on screen on a wide page and empty until its own request finished.
  const [deckOpen, setDeckOpen] = useState(false);
  // Focus moves into the panel each time it is asked to open (the counter also covers a panel
  // that is already open, such as "My deck" in an error message).
  const [focusTick, setFocusTick] = useState(0);
  const deckHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusTick > 0) deckHost.current?.focus();
  }, [focusTick]);
  const openDeck = () => {
    setDeckOpen(true);
    setFocusTick((tick) => tick + 1);
  };

  // The server's numbers when it sent them, else the same projection the old card used.
  const stakes = stakesFor(tournament, match);
  const projection = opp.id === null ? null : matchProjection(match, viewerId, ratings);
  const win = stakes ? stakes.win : projection?.winRating ?? null;
  const lose = stakes ? stakes.loss : projection?.loseRating ?? null;
  const owes = view.state === "confirm";
  const claimsWin = match.winnerId === viewerId;

  let stakesLine: ReactNode = null;
  if (win !== null && lose !== null && (view.state === "your-open" || view.state === "live" || view.state === "between-games" || view.state === "reporting")) {
    stakesLine = (
      <p className={styles.stakes}>
        <span className={styles.up}><b>{signed(win)}</b> if you win</span>
        <span className={styles.dn}><b>{signed(lose)}</b> if you lose</span>
      </p>
    );
  } else if (owes && win !== null && lose !== null) {
    const amount = claimsWin ? win : lose;
    stakesLine = (
      <p className={styles.stakes}>
        <span className={amount < 0 ? styles.dn : styles.up}><b>{signed(amount)}</b> if you confirm</span>
      </p>
    );
  }

  let buttons: ReactNode = null;
  if (actions.reporting && view.canReport) {
    buttons = <SvButton variant="quiet" big onClick={actions.cancelReport}>Cancel</SvButton>;
  } else if (view.canOpen) {
    buttons = <DuelAction kind="open" big href={`/duels/${match.series!.currentDuelSlug}`} />;
  } else if (view.canStart) {
    buttons = <DuelAction kind="start" big disabled={disabled} onClick={actions.start} />;
  } else if (view.canConfirm) {
    buttons = (
      <>
        <SvButton variant="primary" big disabled={disabled} onClick={actions.approve}>Confirm</SvButton>
        <SvButton variant="danger" big disabled={disabled} onClick={actions.deny}>Deny</SvButton>
      </>
    );
  }

  let note: ReactNode = null;
  if (owes) note = <>If you do nothing, it approves itself after {hours} hours.</>;
  else if (view.state === "reported") note = <>{opp.name} confirms within {hours} hours, or it approves itself.</>;

  const offsite = view.canReport && !actions.reporting
    ? <p className={styles.offsite}>Played off the site? <button type="button" disabled={disabled} onClick={actions.openReport}>Report a result</button></p>
    : null;

  const bar = buttons || offsite ? (
    <div className={styles.actions}>
      {buttons && <div className={styles.abtns}>{buttons}</div>}
      {offsite}
    </div>
  ) : null;

  const deckBlock = view.state === "your-open" || view.state === "live" || view.state === "between-games" ? (
    <>
      <p className={styles.deckline}>
        {me?.deckRegistered ? <DeckMark state="in" locked={me.deckLocked} /> : <DeckMark state="none" />}
        {!me?.deckLocked && (
          <>
            {" "}
            <button
              type="button"
              className={styles.deckbtn}
              aria-expanded={deckOpen}
              aria-controls={deckOpen ? "floor-my-deck" : undefined}
              onClick={() => (deckOpen ? setDeckOpen(false) : openDeck())}
            >
              {me?.deckRegistered ? "Change deck" : "Register a deck"}
            </button>
          </>
        )}
      </p>
      {tournament.deckNote && !me?.deckLocked && (
        <p className={styles.note} data-testid="deck-note" data-level={tournament.deckNote.level}>
          {tournament.deckNote.message}
          {tournament.draftSlug && (
            <>
              {" "}
              <Link href={`/decks/draft/${tournament.draftSlug}`} className={styles.notelink}>Edit deck</Link>
            </>
          )}
        </p>
      )}
      <div id="floor-my-deck" ref={deckHost} tabIndex={-1} className={styles.deckhost}>
        {deckOpen && !me?.deckLocked && (
          <div className={styles.panel}>
            <MyDeckPanel variant="floor" tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />
          </div>
        )}
      </div>
    </>
  ) : null;

  const useBar = narrow && bar !== null;
  return (
    <div className={styles.nearbox} data-testid="near-box">
      {stakesLine}
      {useBar ? <SheetPortal><BugFabLift className={styles.actionBar}>{bar}</BugFabLift></SheetPortal> : bar}
      {note && <p className={styles.note}>{note}</p>}
      {deckBlock}
      {actions.reporting && view.canReport && projection && (
        <div className={styles.panel}>
          <ReportPanel projection={projection} opponentName={opp.name} confirmWindowHours={hours} loading={disabled} onReport={actions.report} />
        </div>
      )}
      <MatchError error={actions.error} onOpenDeck={deckBlock && !me?.deckLocked ? openDeck : undefined} />
      {useBar && <div className={styles.spacer} aria-hidden="true" />}
    </div>
  );
}
