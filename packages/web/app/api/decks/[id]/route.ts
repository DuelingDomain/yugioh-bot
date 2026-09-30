import { NextResponse } from "next/server";
import {
  parseSavedDeckId,
  readSavedDeckBody,
  requireSavedDeckActor,
  savedDeckErrorResponse,
} from "@/lib/saved-decks";

export const runtime = "nodejs";

async function ownedDeckContext(params: Promise<{ id: string }>) {
  const actor = await requireSavedDeckActor();
  if (!actor.ok) return actor;
  const { id: raw } = await params;
  const id = parseSavedDeckId(raw);
  if (id instanceof NextResponse) return { ok: false as const, response: id };
  return { ok: true as const, id, actor };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await ownedDeckContext(params);
  if (!ctx.ok) return ctx.response;
  try {
    return NextResponse.json({ deck: ctx.actor.decks.get(ctx.id, ctx.actor.guildId, ctx.actor.ownerUserId) });
  } catch (error) {
    return savedDeckErrorResponse(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await ownedDeckContext(params);
  if (!ctx.ok) return ctx.response;

  const body = await readSavedDeckBody(request);
  if (!body.ok) return body.response;

  try {
    const deck = ctx.actor.decks.update(ctx.id, ctx.actor.guildId, ctx.actor.ownerUserId, {
      name: body.name,
      mode: body.mode,
      deck: body.deck,
    });
    return NextResponse.json({ deck });
  } catch (error) {
    return savedDeckErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await ownedDeckContext(params);
  if (!ctx.ok) return ctx.response;
  try {
    ctx.actor.decks.delete(ctx.id, ctx.actor.guildId, ctx.actor.ownerUserId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return savedDeckErrorResponse(error);
  }
}
