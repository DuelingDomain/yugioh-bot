import { NextResponse } from "next/server";
import { readSavedDeckBody, requireSavedDeckActor, savedDeckErrorResponse } from "@/lib/saved-decks";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireSavedDeckActor();
  if (!actor.ok) return actor.response;
  try {
    return NextResponse.json({ decks: actor.decks.list(actor.guildId, actor.ownerUserId) });
  } catch (error) {
    return savedDeckErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const actor = await requireSavedDeckActor();
  if (!actor.ok) return actor.response;

  const body = await readSavedDeckBody(request);
  if (!body.ok) return body.response;

  try {
    const deck = actor.decks.create(actor.guildId, actor.ownerUserId, {
      name: body.name,
      mode: body.mode,
      deck: body.deck,
    });
    return NextResponse.json({ deck }, { status: 201 });
  } catch (error) {
    return savedDeckErrorResponse(error);
  }
}
