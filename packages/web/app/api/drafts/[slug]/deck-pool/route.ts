import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { createSavedDeckService, deckRegistrationMark } from "@yugidraft/shared/services";
import { loadDeckRegistrations } from "@/lib/saved-decks";
import { findDraftDeckContext, loadDraftDeckPool } from "../../draft-deck-pool";
import { draftReadAccess } from "@/lib/draft-access";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const guildId = env.discordGuildId;
    if (!guildId) {
      return NextResponse.json({ error: "Guild is not configured" }, { status: 500 });
    }

    const { slug } = await params;
    const db = getDb();
    const denied = draftReadAccess(db, slug, guildId, session.user.id);
    if (denied) return denied;
    const found = findDraftDeckContext(db, guildId, session.user.id, { slug });
    if (!found.ok) return found.response;
    const { draft } = found;

    const loaded = await loadDraftDeckPool(db, guildId, draft);
    if (!loaded.ok) return loaded.response;
    const { pool } = loaded;

    const saved = createSavedDeckService(db).findByDraft(guildId, session.user.id, draft.id);
    return NextResponse.json({
      draftId: draft.id,
      draftName: draft.name,
      cards: pool.cards,
      mainPoolCount: pool.mainPoolCount,
      savedDeckId: saved?.id ?? null,
      // The tournament this draft's deck is registered for, if any (pending or active tournaments only).
      registration: deckRegistrationMark(loadDeckRegistrations(guildId, session.user.id), {
        savedDeckId: saved?.id ?? null,
        draftId: draft.id,
      }),
      unresolved: pool.unresolved,
    });
  } catch (error) {
    console.error("[api/drafts/[slug]/deck-pool] error:", error);
    return NextResponse.json({ error: "Failed to load the draft pool" }, { status: 500 });
  }
}
