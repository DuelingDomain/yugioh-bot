import { cardFetchErrorResponse } from "@/lib/card-fetch-errors";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { auth } from "@/lib/auth";
import { cubeReferenceAccess } from "@/lib/cube-access";
import { sanitizePoolSource } from "@/lib/cube-pool";
import { env } from "@/lib/env";
import { analyzeCube, prepareBoosterPool, themeDraftNumberError, createCardCatalogService, createDraftService } from "@yugidraft/shared/services";
import { buildDraftResponse } from "./helpers";
import { announcer, broadcaster } from "@/lib/notify";
import { hostThemeAssignmentError } from "@/lib/theme-draft-validation";
import { draftReadAccess } from "@/lib/draft-access";

export const runtime = "nodejs";

const DRAFT_STATUS = {
  active: "active",
  cancelled: "cancelled",
  completed: "completed",
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  let slug = "unknown";
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    slug = (await params).slug;
    const denied = draftReadAccess(getDb(), slug, env.discordGuildId, session.user.id);
    if (denied) return denied;
    const response = await buildDraftResponse(slug, session.user.id);

    if (!response) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    return NextResponse.json(response);
  } catch (error) {
    const fetchFailure = cardFetchErrorResponse(error);
    if (fetchFailure) return fetchFailure;
    console.error(`[api/drafts/${slug}] load failed:`, error);
    return NextResponse.json(
      { error: "Failed to load draft" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const db = getDb();
    const guildId = env.discordGuildId;

    const draft = db
      .prepare("select id, created_by_user_id, status from drafts where web_slug = ? and guild_id = ?")
      .get(slug, guildId) as { id: number; created_by_user_id: string; status: string } | undefined;

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.created_by_user_id !== session.user.id) {
      return NextResponse.json({ error: "Only the draft creator can cancel or delete a draft" }, { status: 403 });
    }

    if (draft.status === DRAFT_STATUS.completed || draft.status === DRAFT_STATUS.cancelled) {
      db.transaction(() => {
        db.prepare("delete from draft_passes where draft_id = ?").run(draft.id);
        db.prepare("delete from draft_picks where draft_id = ?").run(draft.id);
        db.prepare("delete from draft_cards where draft_id = ?").run(draft.id);
        db.prepare("delete from draft_packs where draft_id = ?").run(draft.id);
        db.prepare("delete from draft_undealt where draft_id = ?").run(draft.id);
        db.prepare("delete from draft_deal where draft_id = ?").run(draft.id);
        // Theme drafts reference draft_player_cube(draft_id) -> drafts(id); clear it
        // before the drafts row or the FK blocks the delete.
        db.prepare("delete from draft_player_cube where draft_id = ?").run(draft.id);
        db.prepare("delete from draft_players where draft_id = ?").run(draft.id);
        db.prepare("delete from drafts where id = ?").run(draft.id);
      })();
      void broadcaster.draft({ kind: "seats", slug });
      return NextResponse.json({ deleted: true });
    }

    const drafts = createDraftService(db);
    const cancelled = drafts.cancel(draft.id);

    void broadcaster.draft(
      { kind: "status", slug, status: DRAFT_STATUS.cancelled },
    );

    return NextResponse.json({
      id: cancelled.id,
      name: cancelled.name,
      status: cancelled.status,
      webSlug: cancelled.webSlug,
    });
  } catch (error) {
    const fetchFailure = cardFetchErrorResponse(error);
    if (fetchFailure) return fetchFailure;
    console.error("[api/drafts/[slug] DELETE] error:", error);
    return NextResponse.json(
      { error: "Failed to cancel draft" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const db = getDb();
    const guildId = env.discordGuildId;

    const draft = db
      .prepare("select id, created_by_user_id, status from drafts where web_slug = ? and guild_id = ?")
      .get(slug, guildId) as { id: number; created_by_user_id: string; status: string } | undefined;

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.created_by_user_id !== session.user.id) {
      return NextResponse.json({ error: "Only the draft creator can modify a draft" }, { status: 403 });
    }

    if (draft.status !== "pending") {
      return NextResponse.json({ error: "Can only modify pending drafts" }, { status: 400 });
    }

    const body = await request.json();
    const { name, config } = body as { name?: string; config?: unknown };

    const drafts = createDraftService(db);
    const existing = drafts.findById(draft.id);
    const sanitized = config ? sanitizePoolSource(db, guildId, config as object) : {};
    const mergedConfig = { ...existing.config, ...sanitized } as typeof existing.config;
    // A submitted poolSource that does not validate clears the stored one rather than keeping the old value.
    if (config && typeof config === "object" && "poolSource" in config && !("poolSource" in sanitized)) {
      delete mergedConfig.poolSource;
    }
    if (mergedConfig.mode === "theme") {
      const numberError = themeDraftNumberError(mergedConfig);
      if (numberError) return NextResponse.json({ error: numberError }, { status: 400 });
    }
    // Edits can retain library cubes deleted since attachment, including in the request body.
    const denied = cubeReferenceAccess(db, mergedConfig.allowedCubeIds, { allowMissing: true });
    if (denied) return denied;
    const assignmentError = hostThemeAssignmentError(db, existing.guildId, mergedConfig, drafts.players(draft.id).map((p) => p.playerId));
    if (assignmentError) {
      return NextResponse.json({ error: assignmentError }, { status: 400 });
    }

    if (name !== undefined) {
      if (!name.trim()) {
        return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      }

      const existing = db
        .prepare(
          "select id from drafts where guild_id = (select guild_id from drafts where id = ?) and name = ? and status in ('pending', 'active') and id != ?"
        )
        .get(draft.id, name, draft.id) as { id: number } | undefined;

      if (existing) {
        return NextResponse.json({ error: "A draft with that name already exists" }, { status: 400 });
      }
    }

    let analysisWarnings: ReturnType<typeof analyzeCube> | undefined;

    if (config !== undefined && mergedConfig.mode !== "theme") {
      // The submitted config redefines the pool (sets + custom passcodes), so
      // any previously materialized ids are stale. Drop them before resolving —
      // otherwise resolveCubeCardIds returns the old snapshot and edits like
      // removing a card never take effect in the saved pool.
      delete (mergedConfig as { cubeCardIds?: number[] }).cubeCardIds;
      delete (mergedConfig as { poolCardIds?: number[] }).poolCardIds;

      const cardsPerPlayer = mergedConfig.cardsPerPlayer ?? 40;
      const packSize = mergedConfig.packSize ?? 15;
      if (!Number.isInteger(cardsPerPlayer) || cardsPerPlayer < 40 || cardsPerPlayer > 60) {
        return NextResponse.json({ error: "Cards per player must be 40 to 60" }, { status: 400 });
      }
      if (!Number.isInteger(packSize) || packSize < 5 || packSize > cardsPerPlayer) {
        return NextResponse.json({ error: "Pack size must be 5 to cards per player" }, { status: 400 });
      }
      mergedConfig.packSize = packSize;
      mergedConfig.cardsPerPlayer = cardsPerPlayer;
      mergedConfig.packsPerPlayer = Math.ceil(cardsPerPlayer / packSize);

      const hasPool =
        ((mergedConfig as any).setNames?.length ?? 0) > 0 ||
        ((mergedConfig as any).customCardIds?.length ?? 0) > 0;
      if (!hasPool) {
        return NextResponse.json(
          { error: "Select at least one set or paste custom card IDs" },
          { status: 400 }
        );
      }

      const cards = createCardCatalogService(db);
      await cards.syncDraftPool({
        setNames: (mergedConfig as any).setNames ?? [],
        customCardIds: (mergedConfig as any).customCardIds ?? [],
        includeNames: (mergedConfig as any).includeNames ?? [],
        excludeNames: (mergedConfig as any).excludeNames ?? [],
      });
      const cubeCardIds = drafts.resolveCubeCardIds(mergedConfig as any);
      if (cubeCardIds.length === 0) {
        return NextResponse.json(
          { error: "No cards matched the selected sets / passcodes" },
          { status: 400 }
        );
      }

      // Advisory feasibility check at edit time (min start count = 2 players).
      // Non-blocking: startDraft is the authoritative gate.
      analysisWarnings = analyzeCube(
        prepareBoosterPool(cubeCardIds, mergedConfig, 2 * (mergedConfig.packsPerPlayer ?? 5) * (mergedConfig.packSize ?? 8)),
        2,
        (mergedConfig as any).packsPerPlayer ?? 5,
        (mergedConfig as any).packSize ?? 8,
        (mergedConfig as any).cardsPerPlayer ?? 40,
      );

      (mergedConfig as any).cubeCardIds = cubeCardIds;
    }

    // Apply edits together after validation, so a rejected pool edit cannot silently rename the draft.
    const edited = db.transaction(() => {
      const current = db.prepare("select status from drafts where id = ?").get(draft.id) as { status: string } | undefined;
      if (current?.status !== "pending") return false;
      if (name !== undefined) {
        db.prepare("update drafts set name = ? where id = ?").run(name, draft.id);
      }
      if (config !== undefined) {
        db.prepare("update drafts set config_json = ? where id = ?").run(
          JSON.stringify(mergedConfig),
          draft.id,
        );
      }
      return true;
    }).immediate();
    if (!edited) return NextResponse.json({ error: "Can only modify pending drafts" }, { status: 400 });

    const updated = db.prepare("select * from drafts where id = ?").get(draft.id) as any;
    if (name !== undefined || config !== undefined) {
      void broadcaster.draft({ kind: "seats", slug });
    }

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      status: updated.status,
      webSlug: updated.web_slug,
      config: JSON.parse(updated.config_json),
      warnings: analysisWarnings?.warnings ?? [],
      errors: analysisWarnings?.errors ?? [],
    });
  } catch (error) {
    const fetchFailure = cardFetchErrorResponse(error);
    if (fetchFailure) return fetchFailure;
    console.error("[api/drafts/[slug] PUT] error:", error);
    return NextResponse.json(
      { error: "Failed to update draft" },
      { status: 500 }
    );
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const db = getDb();
    const guildId = env.discordGuildId;

    const draft = db
      .prepare("select id, created_by_user_id, status from drafts where web_slug = ? and guild_id = ?")
      .get(slug, guildId) as { id: number; created_by_user_id: string; status: string } | undefined;

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.created_by_user_id !== session.user.id) {
      return NextResponse.json({ error: "Only the draft creator can start a draft" }, { status: 403 });
    }

    const drafts = createDraftService(db);
    const draftModel = drafts.findById(draft.id);
    // The service drops deleted library cubes; surviving references must stay in this guild.
    const denied = cubeReferenceAccess(db, draftModel.config.allowedCubeIds, { allowMissing: true });
    if (denied) return denied;
    if (draftModel.config.mode === "theme" && (draftModel.config.themeSelection ?? "player_pick") === "player_pick") {
      const claims = db.prepare("select cube_id from draft_player_cube where draft_id = ?")
        .all(draft.id) as Array<{ cube_id: number }>;
      const claimedCubeIds = claims.map((claim) => claim.cube_id);
      const deniedClaim = cubeReferenceAccess(db, claimedCubeIds);
      if (deniedClaim) return deniedClaim;
      if (claimedCubeIds.some((id) => !(draftModel.config.allowedCubeIds ?? []).includes(id))) {
        return NextResponse.json({ error: "Claimed cube is not allowed in this draft" }, { status: 400 });
      }
    }
    const cards = createCardCatalogService(db);

    if (!draftModel.config.cubeCardIds?.length && !draftModel.config.poolCardIds?.length) {
      await cards.syncDraftPool({
        setNames: draftModel.config.setNames ?? [],
        customCardIds: draftModel.config.customCardIds ?? [],
        includeNames: draftModel.config.includeNames ?? [],
        excludeNames: draftModel.config.excludeNames ?? [],
      });
    }

    const started = drafts.start(draft.id);

    void announcer.announce(
      {
        kind: "draft-started",
        draftId: started.id,
        channelId: started.channelId,
        name: started.name,
        webSlug: started.webSlug ?? "",
      },
    );

    void broadcaster.draft(
      { kind: "status", slug: started.webSlug ?? slug, status: DRAFT_STATUS.active },
    );

    return NextResponse.json({
      id: started.id,
      name: started.name,
      status: started.status,
      webSlug: started.webSlug,
    });
  } catch (error) {
    const fetchFailure = cardFetchErrorResponse(error);
    if (fetchFailure) return fetchFailure;
    console.error("[api/drafts/[slug] POST start] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start draft" },
      { status: 400 }
    );
  }
}
