import { withCardFetchErrors } from "@/lib/card-fetch-errors";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireWebAccess } from "@/lib/web-access";
import { normalizeBoosterDraftNumbers } from "@/lib/booster-draft-validation";
import { cubeReferenceAccess } from "@/lib/cube-access";
import { env } from "@/lib/env";
import { boosterDraftConfigError, themeDraftNumberError, createCardLookupBudget, createCardCatalogService, createDraftService, createPlayerService } from "@yugidraft/shared/services";
import { DEFAULT_LOBBY_SEATS, isValidLobbySeats } from "@yugidraft/shared/types";
import { assertDraftConfigShape, readLobbyBody, draftLobbyErrorResponse } from "./[slug]/helpers";
import type { DraftConfig } from "@yugidraft/shared/types";
import { announcer } from "@/lib/notify";
import { toUtcIso } from "@/lib/utils";
import { ensureCatalogCards, sanitizePoolSource } from "@/lib/cube-pool";
import { hostThemeAssignmentError } from "@/lib/theme-draft-validation";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;

    const userId = actor.userId;
    const db = getDb();

    const playerRows = db
      .prepare("select id from players where user_id = ? and guild_id = ?")
      .all(userId, env.discordGuildId) as Array<{ id: number }>;

    const playerIds = playerRows.map((r) => r.id);

    if (playerIds.length === 0) {
      return NextResponse.json({ active: [], pending: [], completed: [], cancelled: [] });
    }

    const placeholders = playerIds.map(() => "?").join(",");

    const drafts = db
      .prepare(
        `
        select
          d.id,
          d.guild_id,
          d.name,
          d.status,
          d.web_slug,
          d.config_json,
          d.current_wave_number,
          d.current_pick_step,
          d.created_at,
          d.ended_at,
          count(dp.player_id) as player_count
        from drafts d
        inner join draft_players dp_me on dp_me.draft_id = d.id
        left join draft_players dp on dp.draft_id = d.id
        where d.guild_id = ? and dp_me.player_id in (${placeholders})
        group by d.id
        order by
          case d.status
            when 'active' then 0
            when 'pending' then 1
            when 'completed' then 2
            when 'cancelled' then 3
          end,
          d.created_at desc
      `
      )
      .all(env.discordGuildId, ...playerIds)
      .map((row: any) => {
        let mode: "booster" | "theme" = "booster";
        try {
          if ((JSON.parse(row.config_json ?? "{}") as { mode?: string }).mode === "theme") {
            mode = "theme";
          }
        } catch {
          // malformed config_json — default to booster
        }
        return {
          id: row.id,
          guildId: row.guild_id,
          name: row.name,
          status: row.status,
          mode,
          webSlug: row.web_slug ?? undefined,
          currentPackRound: row.current_wave_number ?? 0,
          currentPickStep: row.current_pick_step ?? 0,
          playerCount: row.player_count,
          createdAt: toUtcIso(row.created_at),
          endedAt: toUtcIso(row.ended_at),
        };
      });

    const active = drafts.filter((d: any) => d.status === "active");
    const pending = drafts.filter((d: any) => d.status === "pending");
    const completed = drafts.filter((d: any) => d.status === "completed");
    const cancelled = drafts.filter((d: any) => d.status === "cancelled");

    return NextResponse.json({ active, pending, completed, cancelled });
  } catch (error) {
    console.error("[api/drafts] error:", error);
    return NextResponse.json(
      { error: "Failed to load drafts" },
      { status: 500 }
    );
  }
}

async function handlePOST(request: NextRequest) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;

  const body = await readLobbyBody(request);
  const { name, channelId, config: rawConfig } = body as {
    name: string;
    channelId?: string;
    config: DraftConfig;
  };
  const discordEnabled = env.discordBotEnabled;

  if (typeof name !== "string" || !name.trim() || !rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)
    || (discordEnabled && channelId !== undefined && typeof channelId !== "string")) {
    return NextResponse.json({ error: "name and config are required", code: "INVALID_BODY" }, { status: 400 });
  }
  assertDraftConfigShape(rawConfig);
  const lobbySeats = rawConfig.lobbySeats === undefined ? DEFAULT_LOBBY_SEATS : rawConfig.lobbySeats;
  if (!isValidLobbySeats(lobbySeats)) {
    return NextResponse.json({ error: "lobbySeats must be an integer from 2 to 8", code: "INVALID_LOBBY_SEATS" }, { status: 400 });
  }
  const guildId = env.discordGuildId;
  // Drafts can be created without a Discord channel.
  const resolvedChannelId = discordEnabled ? channelId || env.discordDefaultChannelId || null : null;

  if (!guildId) {
    return NextResponse.json(
      { error: "Server not configured for draft creation" },
      { status: 500 }
    );
  }

  const db = getDb();
  const config = sanitizePoolSource(db, guildId, { ...rawConfig, lobbySeats });
  const denied = cubeReferenceAccess(db, config?.allowedCubeIds);
  if (denied) return denied;

  // Theme mode: no card-pool sync — the pool lives in the theme cubes, which the
  // host adds inside the draft after creation. So a theme draft starts blank.
  if (config?.mode === "theme") {
    const extraIdsError = boosterDraftConfigError({ customExtraCardIds: config.customExtraCardIds });
    if (extraIdsError) return NextResponse.json({ error: extraIdsError }, { status: 400 });
    const numberError = themeDraftNumberError(config);
    if (numberError) return NextResponse.json({ error: numberError }, { status: 400 });
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const players = createPlayerService(db);
    const player = players.findOrCreate(guildId, actor.userId, actor.userName);
    const assignmentError = hostThemeAssignmentError(db, guildId, config, [player.id]);
    if (assignmentError) {
      return NextResponse.json({ error: assignmentError }, { status: 400 });
    }
    const drafts = createDraftService(db);
    const draft = drafts.create(
      guildId,
      resolvedChannelId,
      name,
      { ...config, allowedCubeIds: config.allowedCubeIds ?? [] },
      actor.userId,
      player.id,
    );

    if (discordEnabled && draft.channelId) {
      void announcer.announce({
        kind: "draft-created",
        draftId: draft.id,
        channelId: draft.channelId,
        name: draft.name,
        webSlug: draft.webSlug ?? "",
      });
    }

    return NextResponse.json(
      { id: draft.id, name: draft.name, status: draft.status, webSlug: draft.webSlug, warnings: [], errors: [] },
      { status: 201 },
    );
  }

  if (!name || (!config?.setNames?.length && !config?.customCardIds?.length)) {
    return NextResponse.json(
      { error: "name and a draft pool are required" },
      { status: 400 }
    );
  }
  const numberError = boosterDraftConfigError(config) ?? normalizeBoosterDraftNumbers(config);
  if (numberError) return NextResponse.json({ error: numberError }, { status: 400 });

  const players = createPlayerService(db);
  const player = players.findOrCreate(guildId, actor.userId, actor.userName);
  const drafts = createDraftService(db);

  const cards = createCardCatalogService(db);
  const lookupBudget = createCardLookupBudget();
  await cards.syncDraftPool({
    setNames: config.setNames ?? [],
    customCardIds: config.customCardIds ?? [],
    includeNames: config.includeNames ?? [],
    excludeNames: config.excludeNames ?? [],
  }, { lookupBudget });
  const unknownExtraIds = await ensureCatalogCards(cards, config.customExtraCardIds ?? [], lookupBudget);
  const unknownIds = [...new Set([...(config.customCardIds ?? []).filter((id) => !cards.hasCatalogRow(id)), ...unknownExtraIds])];
  const cubeCardIds = drafts.resolveCubeCardIds(config);
  if (cubeCardIds.length === 0) {
    return NextResponse.json(
      {
        error: "No cards matched the selected sets / passcodes",
        ...(lookupBudget.lookupLimited ? { lookupLimited: true } : {}),
        ...(unknownIds.length ? { unknownIds } : {}),
      },
      { status: 400 }
    );
  }

  // Advisory demand uses the real target; manual starts may use fewer seats.
  const expectedPlayers = lobbySeats;
  const analysis = drafts.analyzeBoosterDraft({ ...config, cubeCardIds }, expectedPlayers, guildId);

  const configWithPool: typeof config = { ...config, cubeCardIds };

  const draft = drafts.create(
    guildId,
    resolvedChannelId,
    name,
    configWithPool,
    actor.userId,
    player.id,
  );

  if (discordEnabled && draft.channelId) {
    void announcer.announce(
      {
        kind: "draft-created",
        draftId: draft.id,
        channelId: draft.channelId,
        name: draft.name,
        webSlug: draft.webSlug ?? "",
      },
    );
  }

  return NextResponse.json(
    {
      id: draft.id,
      name: draft.name,
      status: draft.status,
      webSlug: draft.webSlug,
      config: draft.config,
      warnings: analysis.warnings,
      errors: analysis.errors,
      ...(lookupBudget.lookupLimited ? { lookupLimited: true } : {}),
      ...(unknownIds.length ? { unknownIds } : {}),
    },
    { status: 201 }
  );
}

export const POST = withCardFetchErrors(async (request: NextRequest) => {
  try { return await handlePOST(request); }
  catch (error) { return draftLobbyErrorResponse(error); }
});
