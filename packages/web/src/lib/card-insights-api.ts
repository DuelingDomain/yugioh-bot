import type { CardInsightFormat, CardInsightOptions } from "@yugidraft/shared/services";
import { isCardEra, isReleasedRange, type CardEra } from "@yugidraft/shared/cards/effects";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { NextResponse } from "next/server";
import { readJsonBody } from "./bug-reports/read-body";

export const CARD_INSIGHT_BODY_MAX_BYTES = 64 * 1024;
export const CARD_INSIGHT_POOL_MAX = 5000;
export const CARD_INSIGHT_DECK_MAX = 500;
export const CARD_INSIGHT_SUGGEST_DECK_MAX = 100;

type Options = CardInsightOptions & { pool?: number[] };
export type CardInsightRequest =
  | { op: "summary"; passcode: number }
  | { op: "read"; text: string }
  | ({ op: "effectSearch"; text: string } & Options)
  | ({ op: "worksWith"; passcode: number } & Options)
  | ({ op: "suggest"; deck: DuelDeck | number[] } & Options)
  | { op: "poolHealth"; cards: number[]; era?: CardEra }
  | { op: "pickScore"; candidate: number; pickedPool: number[] };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const passcode = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffffffff;
const codes = (value: unknown, max: number): value is number[] => Array.isArray(value) && value.length <= max && value.every(passcode);
const format = (value: unknown): value is CardInsightFormat => typeof value === "string" && ["normal", "domain", "genesys", "genesys-domain"].includes(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 512;
const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const deck = (value: unknown): value is DuelDeck | number[] => {
  if (codes(value, CARD_INSIGHT_SUGGEST_DECK_MAX)) return true;
  if (!object(value) || Object.keys(value).some(key => !["main", "extra", "side", "deckMaster"].includes(key))) return false;
  if (!codes(value.main, CARD_INSIGHT_SUGGEST_DECK_MAX) || !codes(value.extra, CARD_INSIGHT_SUGGEST_DECK_MAX) || !codes(value.side, CARD_INSIGHT_SUGGEST_DECK_MAX)) return false;
  return value.main.length + value.extra.length + value.side.length <= CARD_INSIGHT_SUGGEST_DECK_MAX && (value.deckMaster === undefined || passcode(value.deckMaster));
};

/** Reject fields outside the operation contract, including private resource IDs and client guild authority. */
export function parseCardInsightRequest(value: unknown): CardInsightRequest | null {
  if (!object(value) || typeof value.op !== "string") return null;
  const optionKeys = ["pool", "limit", "format", "genesysRemaining", "deckMaster", "released", "sort", "era"];
  const fields: Record<string, string[]> = {
    summary: ["passcode"], read: ["text"],
    effectSearch: ["text", ...optionKeys, "exact", "omittedChips"],
    worksWith: ["passcode", ...optionKeys], suggest: ["deck", ...optionKeys],
    poolHealth: ["cards", "era"], pickScore: ["candidate", "pickedPool"],
  };
  if (!Object.hasOwn(fields, value.op)) return null;
  const keys = fields[value.op];
  if (!keys || Object.keys(value).some(key => key !== "op" && !keys.includes(key))) return null;
  if ((value.op === "summary" || value.op === "worksWith") && !passcode(value.passcode)) return null;
  if ((value.op === "read" || value.op === "effectSearch") && !text(value.text)) return null;
  if (value.op === "suggest" && !deck(value.deck)) return null;
  if (value.op === "poolHealth" && !codes(value.cards, CARD_INSIGHT_DECK_MAX)) return null;
  if (value.op === "pickScore" && (!passcode(value.candidate) || !codes(value.pickedPool, CARD_INSIGHT_DECK_MAX))) return null;
  if (value.pool !== undefined && !codes(value.pool, CARD_INSIGHT_POOL_MAX)) return null;
  if (value.limit !== undefined && !integer(value.limit, 1, 120)) return null;
  if (value.format !== undefined && !format(value.format)) return null;
  if (value.genesysRemaining !== undefined && !integer(value.genesysRemaining, 0, 1000)) return null;
  if (value.deckMaster !== undefined && !passcode(value.deckMaster)) return null;
  if (value.released !== undefined && !isReleasedRange(value.released)) return null;
  if (value.sort !== undefined && value.sort !== "match" && value.sort !== "newest") return null;
  if (value.era !== undefined && !isCardEra(value.era)) return null;
  if (value.exact !== undefined && typeof value.exact !== "boolean") return null;
  if (value.omittedChips !== undefined && (!Array.isArray(value.omittedChips) || value.omittedChips.length > 16 || value.omittedChips.some(chip => typeof chip !== "string" || !chip.length || chip.length > 256))) return null;
  return value as unknown as CardInsightRequest;
}

export async function readCardInsightRequest(request: Request): Promise<{ ok: true; value: CardInsightRequest } | { ok: false; response: NextResponse }> {
  const body = await readJsonBody(request, CARD_INSIGHT_BODY_MAX_BYTES);
  if (!body.ok) return body.response.status === 413
    ? { ok: false, response: NextResponse.json({ error: "Insight request is too large" }, { status: 413 }) }
    : body;
  const parsed = parseCardInsightRequest(body.value);
  return parsed ? { ok: true, value: parsed } : { ok: false, response: NextResponse.json({ error: "Invalid insight request" }, { status: 400 }) };
}
