"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import useSWR from "swr";
import { isByeMatch } from "../floor/floor-model";
import { isMatchPlayer } from "./match-model";
import { remoteBlocksReport, type RemotePair, type RemoteResult } from "../remote-result";
import type { Match, TournamentDetail } from "../types";

const SLOT_POLL_MS = 20_000;
const NONE: ReadonlyMap<number, RemoteResult> = new Map();
const RemoteSlotsContext = createContext<ReadonlyMap<number, RemoteResult>>(NONE);

async function readSlot(tournamentSlug: string, match: Match): Promise<[number, RemoteResult] | null> {
  try {
    const res = await fetch(`/api/tournaments/${encodeURIComponent(tournamentSlug)}/matches/${match.id}/remote-result`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null) as { remoteResult?: RemoteResult | null } | null;
    const result = body?.remoteResult ?? null;
    // A `playing` row with no live table is an open slot again.
    if (!result || (result.status === "playing" && result.tableOpen === false)) return null;
    return [match.id, result];
  } catch {
    return null;
  }
}

/**
 * The open Remote results of a Remote tournament, for the read-only status lines of strips, the field centre and
 * rows: a paired player reads their own slots and the organizer reads every open slot. Online tournaments read nothing.
 */
export function RemoteSlotsProvider({ tournament, tournamentSlug, viewerId, isHost, children }: {
  tournament: TournamentDetail; tournamentSlug: string; viewerId: number | null; isHost: boolean; children: ReactNode;
}) {
  const remote = tournament.duelType === "remote" && tournament.status === "active";
  const slots = useMemo(
    () => !remote ? [] : tournament.matches.filter((match) => !isByeMatch(match) && match.status === "open" && match.playerTwoId !== null && (isHost || isMatchPlayer(match, viewerId))),
    [remote, tournament.matches, isHost, viewerId],
  );
  const key = slots.length ? ["remote-slots", tournamentSlug, slots.map((match) => `${match.id}:${match.status}:${match.resolvedAt ?? ""}`).join()] : null;
  const { data } = useSWR(key, async () => new Map((await Promise.all(slots.map((match) => readSlot(tournamentSlug, match)))).filter((entry): entry is [number, RemoteResult] => entry !== null)), {
    refreshInterval: (latest) => (latest && [...latest.values()].some(remoteBlocksReport) ? SLOT_POLL_MS : 0),
  });
  return <RemoteSlotsContext.Provider value={data ?? NONE}>{children}</RemoteSlotsContext.Provider>;
}

/** The open Remote result of one slot, or null (not Remote, no table yet, or not readable by this viewer). */
export function useRemoteSlot(matchId: number): RemoteResult | null {
  return useContext(RemoteSlotsContext).get(matchId) ?? null;
}

export function pairOf(match: Match): RemotePair | null {
  return match.playerTwoId === null ? null
    : { playerOneId: match.playerOneId, playerOneName: match.playerOneName, playerTwoId: match.playerTwoId, playerTwoName: match.playerTwoName ?? "Opponent" };
}
