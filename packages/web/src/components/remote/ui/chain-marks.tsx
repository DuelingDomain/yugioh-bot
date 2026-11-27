"use client";

import { useEffect, useReducer } from "react";
import { openRemoteChainLink, REMOTE_CHAIN_GAP_MS, type RemoteEvent } from "@yugidraft/shared/remote";
import { serverNow } from "./api";
import type { chainOf } from "./think-model";

/**
 * A card that was activated while its chain is still open. Display only: the chain comes from `chainOf`, so it clears
 * when the chain closes (everyone said OK, the phase or turn moved on, an attack, a life point change, a new play).
 * `ref` is empty when the activation named no card (an effect from the hand without a placed card).
 */
export type ChainMark = { ref: string; n: number; at: number; seat: number };

/** The "Effect activated · Chain N" label shows this long, then only the small "Chain N" badge stays. */
export const MARK_FRESH_MS = 1200;
/** A chain nobody closed is dropped from the screen after this long. */
export const MARK_LIFE_MS = REMOTE_CHAIN_GAP_MS;

/** The opponent link available to a Respond control, including expiry while the table is idle. */
export function useOpenChainLink(events: readonly RemoteEvent[], alive: readonly number[], seat: number) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const current = openRemoteChainLink(events, alive, seat, serverNow());
  const expires = current?.expiresAt;
  useEffect(() => {
    if (expires === undefined) return;
    const timer = setTimeout(tick, Math.max(0, expires - serverNow()) + 30);
    return () => clearTimeout(timer);
  }, [expires]);
  return current;
}

export function chainMarksOf(chain: ReturnType<typeof chainOf>): ChainMark[] {
  const marks: ChainMark[] = [];
  for (const event of chain.open) marks.push(...markOf(event, chain.links.get(event.id)?.n));
  return marks;
}
const markOf = (event: RemoteEvent, n: number | undefined): ChainMark[] =>
  event.action.type === "effect.activated" && event.actorSeat !== null && n ? [{ ref: event.action.source.cardRef ?? "", n, at: event.at, seat: event.actorSeat }] : [];

/** Marks that are still on the screen, and the server time they were judged at. The caller re-renders at each point where a label changes or ends. */
export function useLiveMarks(marks: readonly ChainMark[] | undefined): { live: ChainMark[]; now: number } {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const now = serverNow();
  const live = (marks ?? []).filter(mark => now - mark.at < MARK_LIFE_MS);
  const next = live.reduce((soonest, mark) => {
    const age = now - mark.at;
    return Math.min(soonest, age < MARK_FRESH_MS ? MARK_FRESH_MS - age : MARK_LIFE_MS - age);
  }, Infinity);
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(tick, next + 30); return () => clearTimeout(timer);
  });
  return { live, now };
}

export const isFresh = (mark: ChainMark, now: number) => now - mark.at < MARK_FRESH_MS;
export const markLabel = (mark: ChainMark, now: number) => isFresh(mark, now) ? `Effect activated · Chain ${mark.n}` : `Chain ${mark.n}`;

/** Puts a lasting "Chain N" badge on each marked card of the virtual board. The badge is drawn by CSS from `data-chain`. */
export function ChainBadges({ marks }: { marks: readonly ChainMark[] | undefined }) {
  const { live } = useLiveMarks(marks);
  const key = live.map(mark => `${mark.ref}:${mark.n}`).join("|");
  useEffect(() => {
    for (const mark of live) {
      if (!mark.ref) continue;
      document.querySelectorAll<HTMLElement>(`[data-zone][data-ref="${CSS.escape(mark.ref)}"]`).forEach(el => el.setAttribute("data-chain", String(mark.n)));
    }
    // Cleanup sweeps every tagged element, including the ones the interval below tagged after a card moved.
    return () => document.querySelectorAll<HTMLElement>("[data-chain]").forEach(el => el.removeAttribute("data-chain"));
    // The key stands for the live marks; the effect also runs again when the board draws new cards (see the interval below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // A card element the board re-creates (a move, a flip) loses the attribute; apply it again twice a second while a chain is open.
  useEffect(() => {
    if (!live.length) return;
    const timer = setInterval(() => {
      for (const mark of live) if (mark.ref) document.querySelectorAll<HTMLElement>(`[data-zone][data-ref="${CSS.escape(mark.ref)}"]:not([data-chain])`).forEach(el => el.setAttribute("data-chain", String(mark.n)));
    }, 500);
    return () => clearInterval(timer);
  }, [key, live]);
  return null;
}
