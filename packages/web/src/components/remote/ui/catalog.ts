"use client";

import { useEffect, useMemo, useState } from "react";
import type { CardSummary } from "@/lib/card-types";

/** Card details the table screen needs: name, type line, ATK/DEF and text. Shared by every component. */
export type CardInfo = Pick<CardSummary, "id" | "name" | "type" | "frameType" | "race" | "attribute" | "level" | "effectText" | "atk" | "def">;

const cache = new Map<number, CardInfo>();
const inflight = new Map<number, Promise<void>>();
const listeners = new Set<() => void>();

function remember(cards: CardSummary[]) {
  for (const card of cards) cache.set(card.id, card);
  for (const listener of listeners) listener();
}

export function cardInfo(id: number | undefined): CardInfo | undefined { return id === undefined ? undefined : cache.get(id); }

async function post(body: unknown): Promise<CardSummary[]> {
  const response = await fetch("/api/cards/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) return [];
  return ((await response.json()) as { cards?: CardSummary[] }).cards ?? [];
}

const CHUNK = 80;

/** Loads missing card ids, 80 per request. Safe to call often. */
export function loadCards(ids: Iterable<number>): Promise<void> {
  const needed=[...new Set(ids)].filter(id=>id>0&&!cache.has(id));
  const jobs=[...new Set(needed.map(id=>inflight.get(id)).filter((work):work is Promise<void>=>!!work))];
  const missing=needed.filter(id=>!inflight.has(id));
  if(!missing.length)return Promise.all(jobs).then(()=>undefined);
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK);
    const work = post({ customCardIds: chunk }).then(remember).catch(() => undefined)
      .finally(() => { for (const id of chunk) inflight.delete(id); });
    for (const id of chunk) inflight.set(id, work);
    jobs.push(work);
  }
  return Promise.all(jobs).then(() => undefined);
}

export async function searchCards(text: string, includeExtra = true): Promise<CardInfo[]> {
  const q = text.trim(); if (q.length < 2) return [];
  const cards = await post({ fuzzyName: q, includeExtra });
  remember(cards); return cards.slice(0, 5);
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

export const isMonsterInfo = (info: CardInfo | undefined) => !!info && info.atk !== undefined && !/spell|trap/i.test(info.type);
export const cardArt = (id: number, size: "small" | "cropped" | "full" = "small") => `/api/cards/${id}/image?variant=${size}`;
