import { useId } from "react";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { RankGem } from "@/components/rank/rank-gem";
import sheet from "@/components/sheet/sheet.module.css";
import type { PlayerRatings } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import styles from "./tournament-sheet.module.css";

export function PlayersPanel({ tournament, isHost, ratings }: { tournament: TournamentDetail; isHost: boolean; ratings: PlayerRatings }) {
  const titleId = useId();
  return <section id="players" className={`${sheet.panel} ${sheet["panel-pad"]}`} aria-labelledby={titleId}>
    <h2 className={`${sheet["panel-t"]} ${styles["players-title"]}`}><span id={titleId}>Players</span><small>{tournament.participants.length}{isHost && " · decks"}</small></h2>
    <ul className={styles.plist}>
      {tournament.participants.map((player) => <li key={player.playerId}>
        <span className={styles.nm}>
          <RankGem tier={ratings.get(player.playerId)?.rank ?? "none"} />
          <Link href={`/player/${player.playerId}`}>{player.displayName}</Link>
          {player.playerId === tournament.currentUserPlayerId && <span className={sheet.youtag}>YOU</span>}
        </span>
        {isHost && (player.deckRegistered !== undefined || player.deckLocked === true) && (
          player.deckLocked ? <span className={`${styles.deckst} ${styles.ok}`}><Lock className={`${styles.ic} ${styles.sm}`} aria-hidden="true" />Locked</span>
            : player.deckRegistered ? <span className={`${styles.deckst} ${styles.ok}`}><Check className={`${styles.ic} ${styles.sm}`} aria-hidden="true" />Registered</span>
              : <span className={`${styles.deckst} ${styles.no}`}><span className={sheet.lamp} data-s="wait" aria-hidden="true" />No deck</span>
        )}
      </li>)}
    </ul>
  </section>;
}
