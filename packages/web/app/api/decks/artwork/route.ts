import { NextResponse } from "next/server";
import type { DeckArtworkSwapRequest, DuelDeck } from "@yugidraft/shared/duels";
import { requireDuelActor } from "@/lib/duel-host";
import { isPasscode, loadCardArtworkFamily } from "@/lib/card-artworks";

export const runtime = "nodejs";

/** Validates an edit to the caller's working deck; persistence uses the normal owned-deck save. */
export async function POST(request: Request) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const body = await request.json().catch(() => null) as DeckArtworkSwapRequest | null;
  const invalid = () => NextResponse.json({ error: "Invalid artwork swap" }, { status: 400 });
  if (!body || !body.deck || !isPasscode(body.from) || !isPasscode(body.to)
    || !["main", "extra", "side", "deckMaster"].includes(body.section)
    || !Number.isSafeInteger(body.index) || body.index < 0) return invalid();
  const raw = body.deck;
  if (![raw.main, raw.extra, raw.side].every(codes => Array.isArray(codes) && codes.length <= 200 && codes.every(isPasscode))
    || (raw.deckMaster !== undefined && !isPasscode(raw.deckMaster))) return invalid();
  const section = body.section;
  if (section === "deckMaster" ? body.index !== 0 || raw.deckMaster === undefined : body.index >= raw[section].length) return invalid();
  const current = section === "deckMaster" ? raw.deckMaster : raw[section][body.index];
  if (current !== body.from) return NextResponse.json({ error: "The selected deck entry changed" }, { status: 409 });
  const result = await loadCardArtworkFamily({ guildId: actor.guildId, playerId: actor.playerId }, body.from);
  if (!result.ok) return result.response;
  if (!result.family.artworks.some(art => art.passcode === body.to)) {
    return NextResponse.json({ error: "Artwork must be an engine-known member of the same card family" }, { status: 400 });
  }
  const deck: DuelDeck = { main: [...raw.main], extra: [...raw.extra], side: [...raw.side],
    ...(raw.deckMaster === undefined ? {} : { deckMaster: raw.deckMaster }) };
  if (section === "deckMaster") deck.deckMaster = body.to;
  else deck[section][body.index] = body.to;
  return NextResponse.json({ deck });
}
