import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createCardCatalogService, createDraftService, createSavedDeckService } from "@yugidraft/shared/services";
import { toUtcIso } from "@/lib/utils";
import { broadcaster } from "@/lib/notify";
import { lookupDraftCardTypes, type EngineCardTypes } from "@/lib/draft-engine-types";

function getTimerSeconds(pickDeadlineAt: string | null | undefined): number {
  if (!pickDeadlineAt) {
    return 0;
  }

  const remainingMs = new Date(pickDeadlineAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function mapDraftCardDetails(
  db: ReturnType<typeof getDb>,
  cards: Array<{ draftCardId: number; catalogCardId: number }>,
  engineTypes: ReadonlyMap<number, EngineCardTypes> = new Map(),
) {
  if (cards.length === 0) {
    return [];
  }

  const catalog = createCardCatalogService(db);
  const catalogCards = catalog.findByIds(cards.map((card) => card.catalogCardId));
  const catalogById = new Map(catalogCards.map((card) => [card.ygoprodeckId, card]));

  return cards.map((card) => {
    const catalogCard = catalogById.get(card.catalogCardId);
    const engine = engineTypes.get(card.catalogCardId);

    return {
      id: card.draftCardId,
      passcode: card.catalogCardId,
      name: catalogCard?.name ?? `Card ${card.catalogCardId}`,
      type: catalogCard?.type ?? "Unknown",
      frameType: catalogCard?.frameType ?? "normal",
      attribute: catalogCard?.attribute,
      archetype: catalogCard?.archetype ?? null,
      race: engine?.race ?? null,
      spellTrapType: engine?.spellTrapType ?? null,
      level: catalogCard?.level,
      effectText: catalogCard?.effectText ?? "",
      atk: catalogCard?.atk,
      def: catalogCard?.def,
      imageUrl: catalogCard?.imageUrl ?? "",
      imageUrlSmall: catalogCard?.imageUrlSmall ?? catalogCard?.imageUrl ?? "",
    };
  });
}

export async function buildDraftResponse(slug: string, userId: string) {
  const db = getDb();
  const drafts = createDraftService(db);
  const guildId = env.discordGuildId;

  const draftIdRow = db
    .prepare("select id, status from drafts where web_slug = ? and guild_id = ?")
    .get(slug, guildId) as { id: number; status: string } | undefined;

  if (!draftIdRow) {
    return null;
  }

  if (draftIdRow.status === "active") {
    const { autoPickedPlayerIds } = drafts.expireCurrentPickStep(draftIdRow.id);
    if (autoPickedPlayerIds.length > 0) {
      const updated = drafts.findById(draftIdRow.id);
      if (updated.status === "completed") {
        void broadcaster.draft({ kind: "complete", slug });
      } else {
        void broadcaster.draft({ kind: "resync", slug, packRound: updated.currentPackRound, pickStep: updated.currentPickStep });
      }
    }
  }

  const draft = db
    .prepare(
      `
        select
          d.id,
          d.guild_id,
          d.channel_id,
          d.name,
          d.status,
          d.created_by_user_id,
          d.config_json,
          d.current_wave_number,
          d.current_pick_step,
          d.pick_deadline_at,
          d.status_message_id,
          d.web_slug,
          d.created_at,
          d.started_at,
          d.ended_at,
          d.tournament_id,
          count(dp.player_id) as player_count
        from drafts d
        left join draft_players dp on dp.draft_id = d.id
        where d.id = ?
        group by d.id
      `
    )
    .get(draftIdRow.id) as any;

  if (!draft) {
    return null;
  }

  const draftModel = drafts.findById(draft.id);
  const config = { ...draftModel.config };
  if (userId !== draft.created_by_user_id) {
    delete config.themeAssignments;
  }

  const players = db
    .prepare(
      `
        select p.id as player_id, p.display_name, dp.seat_index, dp.pick_count, dp.finished_at, dp.joined_at
        from draft_players dp
        inner join players p on p.id = dp.player_id
        where dp.draft_id = ?
        order by dp.joined_at asc, dp.rowid asc
      `
    )
    .all(draft.id)
    .map((row: any) => ({
      playerId: row.player_id,
      displayName: row.display_name,
      seatIndex: row.seat_index ?? undefined,
      pickCount: row.pick_count,
      finishedAt: toUtcIso(row.finished_at),
      joinedAt: toUtcIso(row.joined_at),
    }));

  const currentPlayer = db
    .prepare("select id from players where guild_id = ? and discord_user_id = ?")
    .get(draft.guild_id, userId) as { id: number } | undefined;

  const isParticipant = currentPlayer
    ? players.some((p: any) => p.playerId === currentPlayer.id)
    : false;

  const pickedPlayerIds = new Set(
    db
      .prepare(
        `
          select player_id from draft_picks
          where draft_id = ? and wave_number = ? and pick_step = ?
        `
      )
      .all(draft.id, draftModel.currentPackRound, draftModel.currentPickStep)
      .map((row: any) => row.player_id as number)
  );

  const seats = players
    .map((player, index) => ({
      seatIndex: player.seatIndex ?? index,
      playerId: player.playerId,
      displayName: player.displayName,
      hasPicked: pickedPlayerIds.has(player.playerId),
      isCurrentPlayer: currentPlayer ? player.playerId === currentPlayer.id : false,
    }))
    .sort((a, b) => a.seatIndex - b.seatIndex);

  const currentPackCards =
    draft.status === "active" && currentPlayer
      ? drafts.currentPackOptions(draft.id, currentPlayer.id).map((card) => ({
          draftCardId: card.id,
          catalogCardId: card.catalogCardId,
        }))
      : [];

  const myPoolCards =
    currentPlayer && isParticipant
      ? drafts.pool(draft.id, currentPlayer.id).map((card) => ({
          draftCardId: card.draftCardId,
          catalogCardId: card.catalogCardId,
        }))
      : [];

  // Monster type and spell/trap kind come from the duel engine. Without it (or without a seat to ask
  // it as) the cards carry no types and the room hides those chip rows.
  const engineTypes = currentPlayer && isParticipant
    ? await lookupDraftCardTypes(
        [...currentPackCards, ...myPoolCards].map((card) => card.catalogCardId),
        { guildId: draft.guild_id, playerId: currentPlayer.id },
      )
    : new Map<number, EngineCardTypes>();
  const currentPack = mapDraftCardDetails(db, currentPackCards, engineTypes);
  const myPool = mapDraftCardDetails(db, myPoolCards, engineTypes);

  // Theme-mode extras: derived phase, progress, and lobby theme previews.
  const isTheme = draftModel.config.mode === "theme";
  const mainSize = draftModel.config.cardsPerPlayer ?? 40;
  const phase: "main" | "extra" | undefined = isTheme
    ? draftModel.currentPackRound <= mainSize
      ? "main"
      : "extra"
    : undefined;

  let allowedCubes:
    | Array<{ id: number; name: string; archetype: string | null; mainCount: number; extraCount: number; sampleImages: string[] }>
    | undefined;
  let themeProgress: { main: number; mainTotal: number; extra: number; extraTotal: number } | undefined;
  if (isTheme) {
    const ids = draftModel.config.allowedCubeIds ?? [];
    // The host's allowed theme pool is public; per-player assignments stay private.
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      const rows = db
        .prepare(`select id, name, archetype from cubes where guild_id = ? and id in (${placeholders})`)
        .all(draft.guild_id, ...ids) as Array<{ id: number; name: string; archetype: string | null }>;
      const countStmt = db.prepare("select pool, count(*) as n from cube_cards where cube_id = ? group by pool");
      const sampleStmt = db.prepare(
        "select cc.image_url_small as img from cube_cards tc join card_catalog cc on cc.ygoprodeck_id = tc.catalog_card_id where tc.cube_id = ? limit 4",
      );
      allowedCubes = rows.map((r) => {
        const counts = countStmt.all(r.id) as Array<{ pool: string; n: number }>;
        const samples = (sampleStmt.all(r.id) as Array<{ img: string }>).map((s) => s.img);
        return {
          id: r.id,
          name: r.name,
          archetype: r.archetype,
          mainCount: counts.find((c) => c.pool === "main")?.n ?? 0,
          extraCount: counts.find((c) => c.pool === "extra")?.n ?? 0,
          sampleImages: samples,
        };
      });
    }
    const picked =
      currentPlayer && isParticipant
        ? players.find((p) => p.playerId === currentPlayer.id)?.pickCount ?? 0
        : 0;
    themeProgress = {
      main: Math.min(picked, mainSize),
      mainTotal: mainSize,
      extra: Math.max(0, picked - mainSize),
      extraTotal: (draftModel.config.extraDeckEnabled ?? true) ? draftModel.config.extraDeckSize ?? 15 : 0,
    };
  }

  const timerSeconds = getTimerSeconds(draft.pick_deadline_at);
  const pickSeconds = draftModel.config.pickSeconds ?? 45;
  const isMyTurn = draft.status === "active" && currentPack.length > 0;
  const participantPickCount = currentPlayer && isParticipant
    ? players.find((player) => player.playerId === currentPlayer.id)?.pickCount
    : undefined;

  // The viewer's saved draft deck, so the results page offers Edit deck instead of Create deck.
  const myDeckId = isParticipant && draft.status === "completed"
    ? createSavedDeckService(db).findByDraft(draft.guild_id, userId, draft.id)?.id ?? null
    : null;

  return {
    id: draft.id,
    guildId: draft.guild_id,
    channelId: draft.channel_id,
    name: draft.name,
    status: draft.status,
    createdByUserId: draft.created_by_user_id,
    config,
    currentPackRound: draftModel.currentPackRound,
    currentPickStep: draftModel.currentPickStep,
    pickDeadlineAt: draft.pick_deadline_at ?? undefined,
    statusMessageId: draft.status_message_id ?? undefined,
    webSlug: draft.web_slug ?? undefined,
    createdAt: toUtcIso(draft.created_at),
    startedAt: toUtcIso(draft.started_at),
    endedAt: toUtcIso(draft.ended_at),
    playerCount: draft.player_count,
    tournamentId: draft.tournament_id ?? null,
    players,
    participantPickCount,
    myDeckId,
    isParticipant,
    currentPack,
    myPool,
    seats,
    packRound: draftModel.currentPackRound,
    pickStep: draftModel.currentPickStep,
    timerSeconds,
    isMyTurn,
    completed: draft.status === "completed",
    pickSeconds,
    phase,
    themeProgress,
    allowedCubes,
  };
}
