import { NextResponse } from "next/server";
import type Database from "better-sqlite3";
import { checkDeckAgainstPool, type DuelDeck, type SavedDeck } from "@yugidraft/shared/duels";
import { createTournamentDuelService, TournamentDuelError } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { broadcaster } from "@/lib/notify";
import { DRAFT_EXTRA_MAX, DRAFT_MAIN_MAX } from "@/components/decks/pool-model";
import {
  draftMainMinimum,
  findDraftDeckContext,
  loadDraftDeckPool,
  type DraftDeckContext,
} from "../drafts/draft-deck-pool";

/** Reads `draftId` from a JSON body without using up the request body. */
export async function readDraftId(
  request: Request,
): Promise<{ ok: true; draftId: number | undefined } | { ok: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    // The deck body reader reports bad JSON.
    return { ok: true, draftId: undefined };
  }
  const raw = body && typeof body === "object" ? (body as { draftId?: unknown }).draftId : undefined;
  if (raw === undefined || raw === null) return { ok: true, draftId: undefined };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return { ok: false, response: NextResponse.json({ error: "Draft id must be a positive integer" }, { status: 400 }) };
  }
  return { ok: true, draftId: raw };
}

function asDeck(value: unknown): DuelDeck | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { main?: unknown; extra?: unknown; side?: unknown; deckMaster?: unknown };
  const isCodes = (list: unknown): list is number[] =>
    Array.isArray(list) && list.every((code) => typeof code === "number" && Number.isInteger(code));
  if (!isCodes(raw.main) || !isCodes(raw.extra) || !isCodes(raw.side)) return null;
  const deck: DuelDeck = { main: raw.main, extra: raw.extra, side: raw.side };
  if (typeof raw.deckMaster === "number") deck.deckMaster = raw.deckMaster;
  return deck;
}

/**
 * Checks a deck against the player's draft pool: copies the pool has, 40 Main
 * Deck cards (or the whole main pool when it is smaller), at most 60 Main and
 * 15 Extra. A deck the service cannot parse passes here; the save rejects it.
 */
async function checkAgainstPool(
  db: Database.Database,
  guildId: string,
  draft: DraftDeckContext,
  rawDeck: unknown,
): Promise<NextResponse | null> {
  const loaded = await loadDraftDeckPool(db, guildId, draft);
  if (!loaded.ok) return loaded.response;
  const deck = asDeck(rawDeck);
  if (!deck) return null;
  const { pool } = loaded;

  const minimum = draftMainMinimum(pool.mainPoolCount);
  if (deck.main.length < minimum) {
    return NextResponse.json(
      { error: `A draft deck needs at least ${minimum} Main Deck cards (you have ${deck.main.length})` },
      { status: 400 },
    );
  }
  if (deck.main.length > DRAFT_MAIN_MAX) {
    return NextResponse.json({ error: `A Main Deck holds at most ${DRAFT_MAIN_MAX} cards` }, { status: 400 });
  }
  if (deck.extra.length > DRAFT_EXTRA_MAX) {
    return NextResponse.json({ error: `An Extra Deck holds at most ${DRAFT_EXTRA_MAX} cards` }, { status: 400 });
  }
  const issues = checkDeckAgainstPool(deck, pool.byCode);
  if (issues.length > 0) {
    const first = issues[0];
    return NextResponse.json(
      {
        error: `Your deck uses more copies than your draft pool has (card ${first.code}: ${first.used} used, ${first.available} in your pool)`,
        issues,
      },
      { status: 400 },
    );
  }
  return null;
}

/** Loads the draft for a draft deck write and checks the deck against the pool. */
export async function checkDraftDeckWrite(
  guildId: string,
  ownerUserId: string,
  draftId: number,
  deck: unknown,
): Promise<{ ok: true; draft: DraftDeckContext } | { ok: false; response: NextResponse }> {
  const db = getDb();
  const found = findDraftDeckContext(db, guildId, ownerUserId, { id: draftId });
  if (!found.ok) return found;
  const failure = await checkAgainstPool(db, guildId, found.draft, deck);
  if (failure) return { ok: false, response: failure };
  return { ok: true, draft: found.draft };
}

/**
 * Registers a saved draft deck for the draft's tournament when the player is a
 * participant and their deck is not locked. Returns a warning for a failure
 * other than the lock; the deck is saved either way.
 */
export function registerDraftDeck(draft: DraftDeckContext, saved: SavedDeck): string | undefined {
  if (draft.tournamentId === null) return undefined;
  const db = getDb();
  const tournamentDuels = createTournamentDuelService(db);
  try {
    const entry = tournamentDuels
      .registrations(draft.tournamentId)
      .find((row) => row.playerId === draft.playerId);
    if (!entry || entry.lockedAt) return undefined;
    tournamentDuels.registerDeck({
      tournamentId: draft.tournamentId,
      playerId: draft.playerId,
      savedDeckId: saved.id,
      deck: saved.deck,
    });
    const tournament = db.prepare("select web_slug from tournaments where id = ?")
      .get(draft.tournamentId) as { web_slug: string | null } | undefined;
    if (tournament?.web_slug) {
      void broadcaster.tournament({ kind: "match-updated", slug: tournament.web_slug });
    }
    return undefined;
  } catch (error) {
    // The first game locked the deck after the check above.
    if (error instanceof TournamentDuelError && error.status === 409 && /locked/i.test(error.message)) {
      return undefined;
    }
    const reason = error instanceof TournamentDuelError ? error.message : "unexpected error";
    console.error("[api/decks] tournament registration failed:", error);
    return `Your deck is saved, but it was not registered for the tournament: ${reason}`;
  }
}
