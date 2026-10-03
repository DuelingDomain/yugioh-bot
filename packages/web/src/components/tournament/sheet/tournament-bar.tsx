"use client";

import { SlidersHorizontal } from "lucide-react";
import { PageBar } from "@/components/sheet";
import { OwnsPageBar, ShellMenuButton } from "@/components/layout/shell-bar";
import { pageRound, tournamentEnding, totalRounds } from "../floor/floor-model";
import { AnimationsControl } from "../fx/animations-control";
import type { Motion } from "../fx/use-animations";
import { formatLabel } from "../sheet-rules";
import type { TournamentDetail } from "../types";
import fx from "../fx/fx.module.css";

/** "Round robin, best of 3." The state of the event sits at the right of the bar. */
export function barSub(tournament: TournamentDetail): string {
  const format = formatLabel(tournament.format);
  return tournament.bestOf ? `${format}, best of ${tournament.bestOf}.` : `${format}.`;
}

/** The right side of the bar: "Round 3 of 5", "The final", "4 players in", "Finished". */
export function BarWhere({ tournament }: { tournament: TournamentDetail }) {
  const ending = tournamentEnding(tournament);
  if (tournament.status === "pending") {
    const n = tournament.participants.length;
    return <span className={fx.where}><b>{n}</b><small>{n === 1 ? "player" : "players"} in</small></span>;
  }
  if (ending === "cancelled") return <span className={fx.where}><b>Cancelled</b></span>;
  if (ending === "ended-early") return <span className={fx.where}><b>Ended early</b></span>;
  if (ending === "finished") return <span className={fx.where}><b>Finished</b></span>;
  const total = totalRounds(tournament);
  if (total === 0) return null;
  const round = pageRound(tournament, tournament.currentUserPlayerId);
  if (tournament.format === "single_elim" && round === total) return <span className={fx.where}><b>The final</b></span>;
  return (
    <span className={fx.where}><small>Round</small><b>{round}</b><small>of {total}</small></span>
  );
}

export function TournamentBar({ tournament, isHost, hostOpen, onHostToggle, motion, reducedMotion, onMotion }: {
  tournament: TournamentDetail;
  isHost: boolean;
  hostOpen: boolean;
  onHostToggle: () => void;
  motion: Motion;
  reducedMotion: boolean;
  onMotion: (level: Motion) => void;
}) {
  const showHost = isHost && tournament.status === "active";
  return (
    <PageBar
      back={{ href: "/tournaments", label: "All tournaments" }}
      title={tournament.name}
      sub={barSub(tournament)}
      className={fx.bar}
      actions={
        <>
          <BarWhere tournament={tournament} />
          {showHost && (
            <button type="button" className={fx.barButton} aria-expanded={hostOpen} aria-controls="host-tools" aria-label="Host tools" onClick={onHostToggle}>
              <SlidersHorizontal size={17} strokeWidth={1.7} aria-hidden="true" />
              <span className={fx.barLabel}>Host tools</span>
            </button>
          )}
          <AnimationsControl motion={motion} reduced={reducedMotion} onChange={onMotion} />
          <ShellMenuButton />
          <OwnsPageBar />
        </>
      }
    />
  );
}
