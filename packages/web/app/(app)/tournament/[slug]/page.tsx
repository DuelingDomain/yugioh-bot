"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTournamentWebsocket } from "@/lib/hooks/use-tournament-websocket";
import { TournamentSheet } from "@/components/tournament/sheet/tournament-sheet";
import { buildPlayerRatings } from "@/components/tournament/sheet/sheet-model";
import type { PlayerRatings } from "@/components/tournament/sheet-contracts";
import type { TournamentDetail } from "@/components/tournament/types";

export default function TournamentDetailPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const searchParams = useSearchParams();
  const [loaded, setLoaded] = useState<{ slug: string; tournament: TournamentDetail } | null>(null);
  const [error, setError] = useState<{ slug: string; message: string } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<PlayerRatings>(() => new Map());
  const tournamentRequest = useRef(0);
  const ratingsRequest = useRef(0);
  const lastStatus = useRef<string | undefined>(undefined);
  const tournament = loaded?.slug === slug ? loaded.tournament : null;

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session").then((response) => response.json()).then((session) => {
      if (active && session?.user?.id) setCurrentUserId(session.user.id);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  // Refetching never blanks the page: the last good tournament stays until a newer one arrives.
  const fetchTournament = useCallback(async () => {
    if (!slug) return;
    const request = ++tournamentRequest.current;
    try {
      const response = await fetch(`/api/tournaments/${slug}`);
      if (!response.ok) throw new Error("Failed to load tournament");
      const data: TournamentDetail = await response.json();
      if (request !== tournamentRequest.current) return;
      setLoaded({ slug, tournament: data });
      setError(null);
    } catch (err) {
      if (request !== tournamentRequest.current) return;
      setError({ slug, message: err instanceof Error ? err.message : "Failed to load tournament" });
    }
  }, [slug]);

  useEffect(() => {
    lastStatus.current = undefined;
    void fetchTournament();
    // Invalidate requests from an old slug or a component that has unmounted.
    return () => { tournamentRequest.current++; };
  }, [fetchTournament]);

  const fetchRatings = useCallback(async () => {
    const request = ++ratingsRequest.current;
    try {
      const response = await fetch("/api/leaderboard?scope=all");
      if (!response.ok) throw new Error("Failed to load ratings");
      const data = await response.json();
      if (request === ratingsRequest.current) setRatings(buildPlayerRatings(data.rows));
    } catch {
      if (request === ratingsRequest.current) setRatings(new Map());
    }
  }, []);
  useEffect(() => {
    void fetchRatings();
    return () => { ratingsRequest.current++; };
  }, [fetchRatings]);
  // A finished tournament changes ratings, so reload them when the status moves.
  useEffect(() => {
    if (!tournament) return;
    if (lastStatus.current !== undefined && lastStatus.current !== tournament.status) void fetchRatings();
    lastStatus.current = tournament.status;
  }, [tournament, fetchRatings]);

  useTournamentWebsocket(slug, {
    onParticipantJoined: () => { void fetchTournament(); },
    onParticipantLeft: () => { void fetchTournament(); },
    onStarted: () => { void fetchTournament(); },
    onCancelled: () => { void fetchTournament(); },
    onCompleted: () => { void fetchTournament(); },
    onMatchUpdated: () => { void fetchTournament(); },
  });

  if (!tournament) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        {error?.slug === slug ? (
          <div className="rounded-lg border border-accent-cta/20 bg-accent-cta/10 p-6 text-accent-cta">{error.message}</div>
        ) : (
          <div className="flex items-center justify-center py-20" role="status" aria-label="Loading tournament">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
          </div>
        )}
      </div>
    );
  }

  return (
    <TournamentSheet
      key={slug}
      tournament={tournament}
      tournamentSlug={slug}
      isHost={currentUserId === tournament.createdByUserId}
      ratings={ratings}
      onChanged={fetchTournament}
      refreshFailed={error?.slug === slug}
      tab={searchParams.get("tab")}
    />
  );
}
