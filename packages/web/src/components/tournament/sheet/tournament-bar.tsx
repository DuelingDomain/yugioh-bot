"use client";

import { SlidersHorizontal } from "lucide-react";
import { PageBar } from "@/components/sheet";
import { OwnsPageBar, ShellMenuButton } from "@/components/layout/shell-bar";
import { currentRound, tournamentEnding, totalRounds } from "../floor/floor-model";
import { AnimationsControl } from "../fx/animations-control";
import type { Motion } from "../fx/use-animations";
import { formatLabel } from "../sheet-rules";
import type { TournamentDetail } from "../types";
import fx from "../fx/fx.module.css";

/** "Round robin. Best of 3. Round 3 of 5." No separators other than full stops. */
export function barSub(tournament: TournamentDetail): string {
  const parts = [formatLabel(tournament.format)];
  if (tournament.bestOf) parts.push(`Best of ${tournament.bestOf}`);
  const ending = tournamentEnding(tournament);
  if (tournament.status === "pending") {
    const n = tournament.participants.length;
    parts.push(`${n} ${n === 1 ? "player" : "players"} in`);
  } else if (ending === "cancelled") {
    parts.push("Cancelled");
  } else if (ending === "ended-early") {
    parts.push("Ended early");
  } else if (ending === "finished") {
    parts.push("Finished");
  } else {
    const total = totalRounds(tournament);
    const round = currentRound(tournament);
    if (total > 0) parts.push(tournament.format === "single_elim" && round === total ? "The final" : `Round ${round} of ${total}`);
  }
  return `${parts.join(". ")}.`;
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
      actions={
        <>
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
