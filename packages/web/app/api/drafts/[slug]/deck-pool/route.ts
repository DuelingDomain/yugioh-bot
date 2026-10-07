import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireWebAccess } from "@/lib/web-access";
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
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;
    const guildId = env.discordGuildId;
    if (!guildId) {
      return NextResponse.json({ error: "Guild is not configured" }, { status: 500 });
    }

    const { slug } = await params;
    const db = getDb();
    const denied = draftReadAccess(db, slug, guildId, actor.userId);
    if (denied) return denied;
    const found = findDraftDeckContext(db, guildId, actor.userId, { slug });
    if (!found.ok) return found.response;
    const { draft } = found;

    const loaded = await loadDraftDeckPool(db, guildId, draft);
    if (!loaded.ok) return loaded.response;
    const { pool } = loaded;

    const saved = createSavedDeckService(db).findByDraft(guildId, actor.userId, draft.id);
    return NextResponse.json({
      draftId: draft.id,
      draftName: draft.name,
      cards: pool.cards,
      forcedCopies: Object.fromEntries(pool.forcedCopies),
      mainPoolCount: pool.mainPoolCount,
      savedDeckId: saved?.id ?? null,
      // The tournament this draft's deck is registered for, if any (pending or active tournaments only).
      registration: deckRegistrationMark(loadDeckRegistrations(guildId, actor.userId), {
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
