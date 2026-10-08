"use client";

import { parseUserId } from "@/lib/user-id";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { signInHref } from "@/lib/invite-link";
import { useTournamentWebsocket } from "@/lib/hooks/use-tournament-websocket";
import { TournamentInviteGate } from "@/components/tournament/invite-gate";
import { TournamentGate } from "@/components/tournament/sheet/tournament-gate";
import { TournamentSheet } from "@/components/tournament/sheet/tournament-sheet";
import { buildPlayerRatings } from "@/components/tournament/sheet/sheet-model";
import type { PlayerRatings } from "@/components/tournament/sheet-contracts";
import type { TournamentDetail } from "@/components/tournament/types";

export default function TournamentDetailPage() {
  const params = useParams();
  const slug = typeof params.slug === "string" ? params.slug : "";
  // This is a client page: it reads the tournament and opens the live connection as soon as the body mounts. The invite
  // gate comes first, so with `?invite=` the link is redeemed before either happens. A new address mounts a new body.
  return (
    <TournamentInviteGate key={slug} slug={slug}>
      <TournamentDetailBody slug={slug} />
    </TournamentInviteGate>
  );
}

function TournamentDetailBody({ slug }: { slug: string }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const searchParams = useSearchParams();
  const [loaded, setLoaded] = useState<{ slug: string; tournament: TournamentDetail } | null>(null);
  const [error, setError] = useState<{ slug: string; status: number | null } | null>(null);
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [ratings, setRatings] = useState<PlayerRatings>(() => new Map());
  const tournamentRequest = useRef(0);
  const tournamentInFlight = useRef(false);
  const ratingsRequest = useRef(0);
  const lastStatus = useRef<string | undefined>(undefined);
  const tournament = loaded?.slug === slug ? loaded.tournament : null;

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session").then((response) => response.json()).then((session) => {
      if (active) setCurrentUserId(parseUserId(session?.user?.id));
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
        if (response.status === 401 && request === tournamentRequest.current) {
          // Sign in again and come back to this exact address.
          routerRef.current.push(signInHref());
          return;
        }
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

  // Every event refetches the tournament (onInvalidate). A match update also reloads ratings, which move with results.
  useTournamentWebsocket(slug, {
    onInvalidate: () => { void fetchTournament(); },
    onMatchUpdated: () => { void fetchRatings(); },
  });

  if (!tournament) {
    const initialError = error?.slug === slug ? error : null;
    if (!initialError) return <TournamentGate kind="loading" />;
    return (
      <TournamentGate
        kind={initialError.status === 404 ? "missing" : "error"}
        busy={loadingSlug === slug}
        onRetry={() => { if (!tournamentInFlight.current) void fetchTournament(); }}
      />
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
