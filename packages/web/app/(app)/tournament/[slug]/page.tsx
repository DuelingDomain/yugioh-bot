"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Compass, RotateCw } from "lucide-react";
import { SheetRoot } from "@/components/sheet";
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
  const [error, setError] = useState<{ slug: string; status: number | null } | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [ratings, setRatings] = useState<PlayerRatings>(() => new Map());
  const tournamentRequest = useRef(0);
  const tournamentInFlight = useRef(false);
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
    tournamentInFlight.current = true;
    setLoadingSlug(slug);
    try {
      const response = await fetch(`/api/tournaments/${slug}`);
      if (!response.ok) {
        if (request === tournamentRequest.current) setError({ slug, status: response.status });
        return;
      }
      const data: TournamentDetail = await response.json();
      if (request !== tournamentRequest.current) return;
      setLoaded({ slug, tournament: data });
      setError(null);
    } catch {
      if (request !== tournamentRequest.current) return;
      setError({ slug, status: null });
    } finally {
      if (request === tournamentRequest.current) {
        tournamentInFlight.current = false;
        setLoadingSlug(null);
      }
    }
  }, [slug]);

  useEffect(() => {
    lastStatus.current = undefined;
    void fetchTournament();
    // Invalidate requests from an old slug or a component that has unmounted.
    return () => { tournamentRequest.current++; tournamentInFlight.current = false; };
  }, [fetchTournament]);

  const fetchRatings = useCallback(async () => {
    const request = ++ratingsRequest.current;
    try {
      const response = await fetch("/api/leaderboard?scope=all");
      if (!response.ok) throw new Error("Failed to load ratings");
      const data = await response.json();
      if (request === ratingsRequest.current) setRatings(buildPlayerRatings(data.rows));
    } catch {
      // Keep the last good ratings when a refresh fails; the initial map is already empty.
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
    onMatchUpdated: () => { void fetchTournament(); void fetchRatings(); },
  });

  if (!tournament) {
    const initialError = error?.slug === slug ? error : null;
    const missing = initialError?.status === 404;
    return (
      <SheetRoot>
        <div className="nf">
          {initialError ? (
            <>
              <p className="nf-code">
                {missing ? <Compass className="ic" aria-hidden="true" /> : <AlertTriangle className="ic" style={{ color: "var(--loss-ink)" }} aria-hidden="true" />}
                {missing ? "404" : "Error"}
              </p>
              <h1 className="t-title">{missing ? "No tournament at this address" : "This tournament didn't load"}</h1>
              {missing ? (
                <p>Nothing on this server matches{" "}<code>/tournament/{slug}</code>.{" "}It may have been deleted, or the link has a typo.</p>
              ) : (
                <p>Nothing was changed. Try again, and if it keeps happening, tell whoever runs the bot.</p>
              )}
              <div className="acts">
                {missing ? (
                  <Link className="btn btn-primary" href="/tournaments">All tournaments</Link>
                ) : (
                  <button className="btn btn-primary" type="button" disabled={loadingSlug === slug} aria-busy={loadingSlug === slug} onClick={() => {
                    if (!tournamentInFlight.current) void fetchTournament();
                  }}>
                    <RotateCw className="ic" aria-hidden="true" />Try again
                  </button>
                )}
                <Link className="btn btn-quiet" href="/dashboard">Dashboard</Link>
              </div>
            </>
          ) : (
            <p className="ref" role="status" aria-label="Loading tournament">Loading tournament…</p>
          )}
        </div>
      </SheetRoot>
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
