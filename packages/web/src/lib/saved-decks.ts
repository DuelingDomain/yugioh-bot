import { NextResponse } from "next/server";
import type { SavedDeck } from "@yugidraft/shared/duels";
import {
  createPlayerService,
  createSavedDeckService,
  createTournamentRegistrationService,
  deckRegistrationMark,
  SavedDeckServiceError,
  type DeckRegistration,
  type DeckRegistrationMark,
  type SavedDeckService,
} from "@yugidraft/shared/services";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

export type SavedDeckActor =
  | { ok: true; guildId: string; ownerUserId: string; decks: SavedDeckService }
  | { ok: false; response: NextResponse };

export async function requireSavedDeckActor(): Promise<SavedDeckActor> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const guildId = env.discordGuildId;
  if (!guildId) {
    return { ok: false, response: NextResponse.json({ error: "Guild is not configured" }, { status: 500 }) };
  }
  return {
    ok: true,
    guildId,
    ownerUserId: session.user.id,
    decks: createSavedDeckService(getDb()),
  };
}

export function parseSavedDeckId(raw: string): number | NextResponse {
  if (!/^\d+$/.test(raw)) {
    return NextResponse.json({ error: "Invalid deck id" }, { status: 400 });
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "Invalid deck id" }, { status: 400 });
  }
  return id;
}

export async function readSavedDeckBody(
  request: Request,
): Promise<{ ok: true; name: unknown; mode: unknown; deck: unknown } | { ok: false; response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, response: NextResponse.json({ error: "Expected a deck object" }, { status: 400 }) };
  }
  const record = body as { name?: unknown; mode?: unknown; deck?: unknown };
  return { ok: true, name: record.name, mode: record.mode, deck: record.deck };
}

export function savedDeckErrorResponse(error: unknown) {
  if (error instanceof SavedDeckServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[api/decks]", error);
  return NextResponse.json({ error: "Failed to process deck request" }, { status: 500 });
}

/** A saved deck as the decks API returns it: the stored deck plus the tournament it is registered for, if any. */
export type SavedDeckWithRegistration = SavedDeck & { registration: DeckRegistrationMark | null };

/** The player's registered decks for pending and active tournaments (empty when they have no player row yet). */
export function loadDeckRegistrations(guildId: string, ownerUserId: string): DeckRegistration[] {
  const db = getDb();
  const player = createPlayerService(db).findByGuildAndUser(guildId, ownerUserId);
  return player ? createTournamentRegistrationService(db).deckRegistrations(player.id, guildId) : [];
}

export function withRegistration(deck: SavedDeck, registrations: readonly DeckRegistration[]): SavedDeckWithRegistration {
  return { ...deck, registration: deckRegistrationMark(registrations, { savedDeckId: deck.id }) };
}
