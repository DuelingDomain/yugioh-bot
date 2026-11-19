"use client";

import { useEffect, useMemo, useState } from "react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import type { CardSummary } from "@/lib/card-types";
import { recentReadsFor } from "@/lib/remote/recent-reads";
import { deckIdsOf, seenCardIds } from "./model";

/** Card details the table screen needs: name, type line, ATK/DEF and text. Shared by every component. */
export type CardInfo = Pick<CardSummary, "id" | "name" | "type" | "frameType" | "race" | "attribute" | "level" | "effectText" | "atk" | "def">;

const cache = new Map<number, CardInfo>();
const inflight = new Map<number, { work: Promise<void>; reportFailure: boolean }>();
/** Ids the last lookup could not resolve. They show an error with a retry instead of loading for ever. */
const failed = new Set<number>();
const listeners = new Set<() => void>();

function remember(cards: CardSummary[]) {
  for (const card of cards) { cache.set(card.id, card); failed.delete(card.id); }
}
function notify() { for (const listener of listeners) listener(); }

export function cardInfo(id: number | undefined): CardInfo | undefined { return id === undefined ? undefined : cache.get(id); }
/** True when a card could not be loaded and nothing is loading it now. */
export function cardFailed(id: number | undefined): boolean { return id !== undefined && failed.has(id) && !cache.has(id) && !inflight.has(id); }
/** Tries the cards that failed again. */
export function retryCards(ids: Iterable<number>): Promise<void> {
  for (const id of ids) failed.delete(id);
  notify();
  return loadCards(ids);
}

async function post(body: unknown): Promise<CardSummary[]> {
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Card details timed out after 10 seconds.'));},10_000);});
  try {
    // Include body decoding in the lookup deadline.
    return await Promise.race([deadline,(async()=>{
      const response = await fetch("/api/cards/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),signal:controller.signal });
      if (!response.ok) throw new Error(`Card lookup failed (${response.status})`);
      return ((await response.json()) as { cards?: CardSummary[] }).cards ?? [];
    })()]);
  }finally{clearTimeout(timer);}
}

const CHUNK = 80;

/** Loads missing card ids, 80 per request. Safe to call often. */
export function loadCards(ids: Iterable<number>, { preload = false } = {}): Promise<void> {
  const jobs = new Set<Promise<void>>();
  const missing: number[] = [];
  for (const id of new Set(ids)) {
    if (!(id > 0) || cache.has(id) || (preload && failed.has(id))) continue;
    const lookup = inflight.get(id);
    if (lookup) {
      if (!preload) lookup.reportFailure = true;
      jobs.add(lookup.work);
    } else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const work = post({ lookupIds: chunk }).then(remember).catch(() => undefined)
      .finally(() => {
        for (const id of chunk) {
          // A speculative lookup can fail while the catalog is down. Only surface it for cards in use.
          if (inflight.get(id)?.reportFailure && !cache.has(id)) failed.add(id);
          inflight.delete(id);
        }
        notify();
      });
    for (const id of chunk) inflight.set(id, { work, reportFailure: !preload });
    jobs.add(work);
  }
  return Promise.all(jobs).then(() => undefined);
}

/** Warm the card resolver as soon as a seated player opens the room. */
export function preloadRoomCards(room: RemoteRoom): Promise<void> {
  if (room.mySeat < 0) return Promise.resolve();
  const ids = [...deckIdsOf(room, room.mySeat), ...seenCardIds(room)];
  for (const card of recentReadsFor(room, room.mySeat)) ids.push(card.cardId);
  for (const { action } of room.events) {
    if (action.type === "card.identified") ids.push(action.cardId ?? action.passcode ?? 0);
    if (action.type === "twin.place") ids.push(action.card.cardId ?? action.card.passcode ?? 0);
    if (action.type === "cards.identified") {
      for (const card of action.cards) ids.push(card.cardId ?? card.passcode ?? 0);
    }
  }
  return loadCards(ids, { preload: true });
}

export async function searchCards(text: string, includeExtra = true): Promise<CardInfo[]> {
  const q = text.trim(); if (q.length < 2) return [];
  const cards = await post({ fuzzyName: q, includeExtra }).catch(() => []);
  remember(cards); notify(); return cards.slice(0, 5);
}

/**
 * Re-renders when more card facts arrive. The returned function changes identity each time new cards load,
 * so a memo that lists it as a dependency runs again.
 */
export function useCardInfo(ids: readonly (number | undefined)[]): (id: number | undefined) => CardInfo | undefined {
  const [tick, setTick] = useState(0);
  const key = ids.filter((id): id is number => id !== undefined).join(",");
  useEffect(() => {
    const listener = () => setTick(value => value + 1);
    listeners.add(listener);
    if (key) void loadCards(key.split(",").map(Number));
    return () => { listeners.delete(listener); };
  }, [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick marks "new card data arrived".
  return useMemo(() => (id: number | undefined) => cardInfo(id), [tick]);
}

/** One card's facts, its load state and a retry. Re-renders as the load settles. */
export function useCardStatus(id: number | undefined): { info: CardInfo | undefined; failed: boolean; retry: () => void } {
  const [, set] = useState(0);
  useEffect(() => {
    const listener = () => set(value => value + 1);
    listeners.add(listener);
    if (id !== undefined && id > 0 && !cache.has(id)) void loadCards([id]);
    return () => { listeners.delete(listener); };
  }, [id]);
  return { info: cardInfo(id), failed: cardFailed(id), retry: () => { if (id !== undefined) void retryCards([id]); } };
}

export const isMonsterInfo = (info: CardInfo | undefined) => !!info && /monster|token/i.test(info.type) && !/spell|trap/i.test(info.type);
/** A Trap Card that is a monster while it stands in a Monster Zone (a Level in the cdb; its ATK / DEF come with it). */
export const isTrapMonsterInfo = (info: CardInfo | undefined) => !!info && /trap/i.test(info.type) && (info.level ?? 0) > 0;
/** A card with battle stats on the field: a monster, or a Trap Monster. */
export const hasBattleStats = (info: CardInfo | undefined) => isMonsterInfo(info) || isTrapMonsterInfo(info);
export const isLinkInfo = (info: CardInfo | undefined) => !!info && (/link/i.test(info.frameType) || /link/i.test(info.type));
export const cardArt = (id: number, size: "small" | "cropped" | "full" = "small") => `/api/cards/${id}/image?variant=${size}`;
