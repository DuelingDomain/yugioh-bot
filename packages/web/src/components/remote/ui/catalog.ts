"use client";

import { useEffect, useState } from "react";
import type { CardSummary } from "@/lib/card-types";

/** Card details the table screen needs: name, type line, ATK/DEF and text. Shared by every component. */
export type CardInfo = Pick<CardSummary, "id" | "name" | "type" | "frameType" | "attribute" | "level" | "effectText" | "atk" | "def">;

const cache = new Map<number, CardInfo>();
const inflight = new Map<number, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

function remember(cards: CardSummary[]) {
  for (const card of cards) cache.set(card.id, card);
  version++; for (const listener of listeners) listener();
}

export function cardInfo(id: number | undefined): CardInfo | undefined { return id === undefined ? undefined : cache.get(id); }

async function post(body: unknown): Promise<CardSummary[]> {
  const response = await fetch("/api/cards/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) return [];
  return ((await response.json()) as { cards?: CardSummary[] }).cards ?? [];
}

/** Loads missing card ids in one request. Safe to call often. */
export function loadCards(ids: Iterable<number>): Promise<void> {
  const missing = [...new Set(ids)].filter(id => id > 0 && !cache.has(id) && !inflight.has(id)).slice(0, 80);
  if (!missing.length) return Promise.resolve();
  const work = post({ customCardIds: missing }).then(remember).catch(() => undefined)
    .finally(() => { for (const id of missing) inflight.delete(id); });
  for (const id of missing) inflight.set(id, work);
  return work;
}

export async function searchCards(text: string, includeExtra = true): Promise<CardInfo[]> {
  const q = text.trim(); if (q.length < 2) return [];
  const cards = await post({ fuzzyName: q, includeExtra });
  remember(cards); return cards.slice(0, 5);
}

/** Re-renders when more card facts arrive. */
export function useCardInfo(ids: readonly (number | undefined)[]): (id: number | undefined) => CardInfo | undefined {
  const [, setTick] = useState(0);
  const key = ids.filter((id): id is number => id !== undefined).join(",");
  useEffect(() => {
    const listener = () => setTick(value => value + 1);
    listeners.add(listener);
    if (key) void loadCards(key.split(",").map(Number));
    return () => { listeners.delete(listener); };
  }, [key]);
  void version;
  return cardInfo;
}

export const isMonsterInfo = (info: CardInfo | undefined) => !!info && info.atk !== undefined && !/spell|trap/i.test(info.type);
export const cardArt = (id: number, size: "small" | "cropped" | "full" = "small") => `/api/cards/${id}/image?variant=${size}`;
