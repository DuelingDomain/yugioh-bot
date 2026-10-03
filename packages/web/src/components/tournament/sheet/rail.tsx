"use client";

import Link from "next/link";
import { resultsFeed, waitingList } from "../floor/floor-model";
import { formatRecent } from "../sheet-dates";
import { SECTION_IDS } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import { MyDeckPanel } from "../my-deck-panel";
import { RailSection } from "./rail-section";
import { RulesPanel } from "./rules-panel";
import styles from "./rail.module.css";

/** "A beat B 2–1" with the score held together on one line. */
function FeedText({ text }: { text: string }) {
  const match = /^(.*) (\d+–\d+)$/.exec(text);
  if (!match) return <>{text}</>;
  return <>{match[1]} <span className={styles.nowrap}>{match[2]}</span></>;
}

function ResultsFeed({ tournament }: { tournament: TournamentDetail }) {
  const items = resultsFeed(tournament);
  if (items.length === 0) return <p className={styles.none}>No results yet.</p>;
  return (
    <ul className={styles.feed}>
      {items.map((item) => (
        <li key={item.key}>
          <span className={styles.when}>{formatRecent(item.at) ?? ""}</span>
          <span><FeedText text={item.text} /></span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Right of the standings on desktop, under them on a phone: reports waiting to be confirmed, the results,
 * the rules, your own deck, and where the tournament came from.
 */
export function Rail({ tournament, tournamentSlug, isHost, closed, onChanged }: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  isHost: boolean;
  closed: boolean;
  onChanged: () => void;
}) {
  const waiting = waitingList(tournament);
  const active = tournament.status === "active";
  return (
    <aside className={styles.rail} aria-label="Event details">
      {waiting.length > 0 && (
        <RailSection title="Waiting to confirm">
          {waiting.map((item) => <p key={item.matchId} className={styles.waitItem}>{item.text}</p>)}
        </RailSection>
      )}
      <RailSection title="Results" id={closed ? SECTION_IDS.matches : undefined}>
        <ResultsFeed tournament={tournament} />
      </RailSection>
      <RulesPanel tournament={tournament} tournamentSlug={tournamentSlug} isHost={isHost} onChanged={onChanged} />
      {active && tournament.isParticipant && (
        <section id={SECTION_IDS.myDeck} aria-label="Your deck" className={styles.myDeck}>
          <MyDeckPanel tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />
        </section>
      )}
      {tournament.draftSlug && (
        <p className={styles.fromdraft}>Made from the draft <Link href={`/draft/${tournament.draftSlug}`}>{tournament.draftSlug}</Link></p>
      )}
    </aside>
  );
}
