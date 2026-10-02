"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { SheetRoot } from "@/components/sheet";
import { buildPlayerRatings } from "@/components/tournament/sheet/sheet-model";
import { StandingsSection } from "@/components/tournament/standings/standings-section";
import type { PlayerRatings } from "@/components/tournament/sheet-contracts";
import type { TournamentDetail } from "@/components/tournament/types";
import { useNarrow } from "@/components/tournament/use-narrow";

/** The standings on their own page: the same crosstable or bracket the sheet shows. */
export default function TournamentStandingsPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<PlayerRatings>(() => new Map());
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);

  useEffect(() => {
    let active = true;
    fetch(`/api/tournaments/${slug}`)
      .then((response) => { if (!response.ok) throw new Error("Failed to load tournament"); return response.json(); })
      .then((data: TournamentDetail) => { if (active) setTournament(data); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Failed to load tournament"); });
    fetch("/api/leaderboard?scope=all")
      .then((response) => response.json())
      .then((data) => { if (active) setRatings(buildPlayerRatings(data.rows)); })
      .catch(() => {});
    return () => { active = false; };
  }, [slug]);

  if (!tournament) {
    return <div className="mx-auto max-w-4xl p-6">{error ? <div className="rounded-lg border border-accent-cta/20 bg-accent-cta/10 p-6 text-accent-cta">{error}</div> : <div role="status" aria-label="Loading standings" className="py-20 text-center">Loading</div>}</div>;
  }
  const ended = tournament.status === "completed";
  return (
    <div ref={root}>
      <SheetRoot>
        <StandingsSection tournament={tournament} tournamentSlug={slug} currentUserPlayerId={tournament.currentUserPlayerId} ratings={ratings} narrow={narrow} final={ended} />
      </SheetRoot>
    </div>
  );
}
