"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTournamentWebsocket } from "@/lib/hooks/use-tournament-websocket";
import { TournamentLobby } from "@/components/tournament/tournament-lobby";
import { TournamentSheet } from "@/components/tournament/sheet/tournament-sheet";
import { buildPlayerRatings } from "@/components/tournament/sheet/sheet-model";
import { SECTION_IDS, type PlayerRatings } from "@/components/tournament/sheet-contracts";
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
  const scrolled = useRef(false);
  const tournament = loaded?.slug === slug ? loaded.tournament : null;

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session").then((response) => response.json()).then((session) => {
      if (active && session?.user?.id) setCurrentUserId(session.user.id);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

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
    scrolled.current = false;
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

  useEffect(() => {
    if (!tournament || tournament.status === "pending" || scrolled.current) return;
    scrolled.current = true;
    const targets: Record<string, string> = { standings: SECTION_IDS.standings, all: SECTION_IDS.matches, players: "players" };
    const id = targets[searchParams.get("tab") ?? ""];
    if (!id) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView?.({ behavior: reduced ? "instant" : "smooth", block: "start" });
  }, [tournament, searchParams]);

  if (!tournament) {
    return <div><div className="mx-auto max-w-4xl p-6">
      {error?.slug === slug ? <div className="rounded-lg border border-accent-cta/20 bg-accent-cta/10 p-6 text-accent-cta">{error.message}</div> : <div className="flex items-center justify-center py-20" role="status" aria-label="Loading tournament">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
      </div>}
    </div></div>;
  }

  const isHost = currentUserId === tournament.createdByUserId;
  // The pending lobby and its header retain their current presentation.
  if (tournament.status === "pending") {
    const format = tournament.format === "round_robin" ? "Round Robin" : tournament.format === "single_elim" ? "Single Elimination" : tournament.format;
    return <div><div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <Link href="/tournaments" className="mb-4 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-secondary"><ChevronLeft className="h-4 w-4" />All Tournaments</Link>
        <div className="flex flex-wrap items-start justify-between gap-4"><div>
          <h1 className="font-display text-2xl text-text-primary sm:text-3xl">{tournament.name}</h1>
          <div className="mt-2 flex items-center gap-3"><Badge variant="warning">{tournament.status}</Badge><span className="text-sm text-text-muted">{format}</span></div>
        </div></div>
      </div>
      {error?.slug === slug && <p role="status" className="mb-4 text-sm text-text-muted">Couldn&apos;t refresh. Showing the last update.</p>}
      <TournamentLobby tournament={tournament} tournamentSlug={slug} isCreator={isHost} currentUserId={currentUserId} onChanged={fetchTournament} />
    </div></div>;
  }

  return <TournamentSheet tournament={tournament} tournamentSlug={slug} isHost={isHost} ratings={ratings} onChanged={fetchTournament} refreshFailed={error?.slug === slug} />;
}
