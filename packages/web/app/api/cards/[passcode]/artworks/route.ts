import { NextResponse } from "next/server";
import { requireDuelActor } from "@/lib/duel-host";
import { isPasscode, loadCardArtworkFamily, withArtworkImages } from "@/lib/card-artworks";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ passcode: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { passcode: raw } = await params;
  if (!/^\d+$/.test(raw) || !isPasscode(Number(raw))) {
    return NextResponse.json({ error: "Invalid card passcode" }, { status: 400 });
  }
  const result = await loadCardArtworkFamily({ guildId: actor.guildId, playerId: actor.playerId }, Number(raw));
  if (!result.ok) return result.response;
  return NextResponse.json(await withArtworkImages(result.family), { headers: { "Cache-Control": "private, no-store" } });
}
