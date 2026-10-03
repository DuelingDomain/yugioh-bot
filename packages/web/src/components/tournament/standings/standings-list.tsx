"use client";

import Link from "next/link";
import { ChainMedallion, RankGem } from "@/components/sheet";
import type { PlayerRatings } from "../sheet-contracts";
import type { PlayerFlags, Standing } from "./standings-model";

export function StandingsPlayer({ player, ratings, me, gem = true }: {
  player: Pick<Standing, "playerId" | "displayName">;
  ratings: PlayerRatings;
  me: boolean;
  gem?: boolean;
}) {
  return (
    <span>
      {gem && <RankGem tier={ratings.get(player.playerId)?.rank ?? "none"} />}
      <Link className="nm" href={`/player/${player.playerId}`} title={player.displayName}>{player.displayName}</Link>
      {me && <span className="youtag">you</span>}
    </span>
  );
}

/** The phone list: place, name, record and one marker for live or owes-a-reply. */
export function StandingsList({ standings, currentUserPlayerId, ratings, flags }: {
  standings: Standing[];
  currentUserPlayerId: number | null;
  ratings: PlayerRatings;
  flags: Map<number, PlayerFlags>;
}) {
  return (
    <ol className="mini-st" aria-label="Tournament standings">
      {standings.map((row) => {
        const me = row.playerId === currentUserPlayerId;
        const flag = flags.get(row.playerId);
        return (
          <li key={row.playerId} className={me ? "me" : undefined}>
            <span className="pos">{row.place}</span>
            <span className="nm">
              <RankGem tier={ratings.get(row.playerId)?.rank ?? "none"} />
              <Link href={`/player/${row.playerId}`} title={row.displayName}>{row.displayName}</Link>
              {me && <span className="youtag">you</span>}
            </span>
            <span className="rec">{row.wins}–{row.losses}</span>
            {flag?.live ? <span className="lamp" data-s="live" role="img" aria-label="playing now" />
              : flag?.owesReply ? <ChainMedallion size="xs" label="owes a reply" /> : <span />}
          </li>
        );
      })}
    </ol>
  );
}
