import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireWebAccess } from "@/lib/web-access";
import { draftReadAccess } from "@/lib/draft-access";
import { env } from "@/lib/env";
import { createDraftService } from "@yugidraft/shared/services";
import { buildDraftResponse } from "../helpers";
import { broadcaster } from "@/lib/notify";

export const runtime = "nodejs";

const DRAFT_STATUS = {
  active: "active",
  completed: "completed",
} as const;

// Guards the bot loop; a draft has far fewer steps than this where the human can only pass.
const MAX_BOT_ROUNDS = 200;

function reportBotError(error: unknown): void {
  const message = error instanceof Error ? error.message : "";
  if (!/already picked|already finished|current pack|current wave|no card to pick|Draft must be active/.test(message)) {
    console.error("[draft] bot pick failed:", error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;

    const { slug } = await params;
    const db = getDb();
    const guildId = env.discordGuildId;
    const denied = draftReadAccess(db, slug, guildId, actor.userId);
    if (denied) return denied;

    const body = await request.json();
    const { cardId } = body as { cardId?: unknown };

    if (cardId === undefined || cardId === null || typeof cardId !== "number" || !Number.isInteger(cardId)) {
      return NextResponse.json({ error: "cardId is required and must be an integer" }, { status: 400 });
    }

    const draft = db
      .prepare("select id, guild_id, status from drafts where web_slug = ? and guild_id = ?")
      .get(slug, guildId) as { id: number; guild_id: string; status: string } | undefined;

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const player = db
      .prepare("select id from players where guild_id = ? and user_id = ?")
      .get(draft.guild_id, actor.userId) as { id: number } | undefined;

    if (!player) {
      return NextResponse.json({ error: "You are not a participant in this draft" }, { status: 400 });
    }

    if (draft.status !== "active") {
      return NextResponse.json({ error: "Draft is not active" }, { status: 400 });
    }

    const drafts = createDraftService(db);

    const currentStep = drafts.findById(draft.id);

    // alreadyPicked: true means auto-pick fired inside the transaction before the manual pick ran — that's fine, continue normally
    const { alreadyPicked: _alreadyPicked } = drafts.recordManualPick(draft.id, player.id, cardId);

    // The human pick is saved. Bot processing must still allow its broadcast.
    try {
      // Auto-pick for fake players and dev bots who haven't picked yet this step
      const fakePlayers = db
        .prepare(
          `SELECT dp.player_id FROM draft_players dp
           INNER JOIN players p ON p.id = dp.player_id
           WHERE dp.draft_id = ?
             AND (p.discord_user_id LIKE 'fake_%' OR p.discord_user_id LIKE 'bot_%')`
        )
        .all(draft.id) as Array<{ player_id: number }>;

      // Bots use legal options, including a forced pick when no swap is possible.
      // They continue through steps where the human has no pack to act on.
      for (let round = 0; round < MAX_BOT_ROUNDS; round += 1) {
        const before = drafts.findById(draft.id);
        if (before.status !== DRAFT_STATUS.active) break;
        let botPicked = false;

        for (const fake of fakePlayers) {
          try {
            const now = drafts.findById(draft.id);
            if (now.currentPackRound !== before.currentPackRound || now.currentPickStep !== before.currentPickStep) break;
            const options = drafts.pickOptions(draft.id, fake.player_id);
            if (options.length > 0) {
              const randomCard = options[Math.floor(Math.random() * options.length)];
              drafts.pickCard(draft.id, fake.player_id, randomCard.id, "auto");
              botPicked = true;
            }
          } catch (error) {
            reportBotError(error);
          }
        }

        const after = drafts.findById(draft.id);
        const humanToAct = after.status === DRAFT_STATUS.active && drafts.pickOptions(draft.id, player.id).length > 0;
        if (!botPicked || humanToAct || after.status !== DRAFT_STATUS.active) break;
      }
    } catch (error) {
      reportBotError(error);
    }

    void broadcaster.draft({
      kind: "pick",
      slug,
      playerId: player.id,
      packRound: currentStep.currentPackRound,
      pickStep: currentStep.currentPickStep,
    });

    const after = drafts.findById(draft.id);
    if (after.status === DRAFT_STATUS.completed) {
      void broadcaster.draft({ kind: "complete", slug });
    } else if (
      after.currentPackRound !== currentStep.currentPackRound ||
      after.currentPickStep !== currentStep.currentPickStep
    ) {
      void broadcaster.draft({
        kind: "resync",
        slug,
        packRound: after.currentPackRound,
        pickStep: after.currentPickStep,
      });
    }

    // Return updated draft state
    const response = await buildDraftResponse(slug, actor);

    if (!response) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof Error) {
      console.error("[api/drafts/[slug]/pick] error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[api/drafts/[slug]/pick] unexpected error:", error);
    return NextResponse.json(
      { error: "Failed to pick card" },
      { status: 500 }
    );
  }
}
