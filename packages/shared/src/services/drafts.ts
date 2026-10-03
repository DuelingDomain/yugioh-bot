import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { Draft, DraftCard, DraftConfig, DraftPick, DraftPlayer } from "../types/index.js";
import { generateWebSlug } from "../util/web-slug.js";
import { MAX_COPIES_PER_PLAYER } from "./constants.js";
import { analyzeCube, buildDeal, seededShuffle, type ShuffleSeed } from "./deal.js";

export type DraftStatus = "pending" | "active" | "cancelled" | "completed";
export type { Draft, DraftCard, DraftConfig, DraftPick, DraftPlayer } from "../types/index.js";

export type DraftPoolCard = {
  draftCardId: number;
  catalogCardId: number;
  pickMethod: "manual" | "auto";
  packRound: number;
  pickStep: number;
};

type DraftCardRow = {
  wave_number: number;
  draft_pack_id: number | null;
  picked_by_player_id: number | null;
};

type CatalogRow = {
  ygoprodeck_id: number;
  name: string;
  type: string;
  frame_type: string;
  card_sets_json: string;
};

type DraftPlayerProgressRow = {
  player_id: number;
  pick_count: number;
  finished_at: string | null;
  seat_index: number | null;
};

function mapDraft(row: any): Draft {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    name: row.name,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    config: normalizeDraftConfig(JSON.parse(row.config_json)),
    currentPackRound: row.current_wave_number,
    currentPickStep: row.current_pick_step,
    pickDeadlineAt: row.pick_deadline_at,
    statusMessageId: row.status_message_id,
    webSlug: row.web_slug ?? undefined,
    tournamentId: row.tournament_id ?? undefined,
    completeMessageId: row.complete_message_id ?? undefined,
  };
}

function mapDraftCard(row: any): DraftCard {
  return {
    id: row.id,
    draftId: row.draft_id,
    waveNumber: row.wave_number,
    catalogCardId: row.catalog_card_id,
    pickedByPlayerId: row.picked_by_player_id,
  };
}

function mapDraftPick(row: any): DraftPick {
  return {
    id: row.id,
    draftId: row.draft_id,
    playerId: row.player_id,
    draftCardId: row.draft_card_id,
    waveNumber: row.wave_number,
    pickStep: row.pick_step,
    pickMethod: row.pick_method,
    pickedAt: row.picked_at,
  };
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

const defaultDraftConfig = {
  packSize: 8,
  packsPerPlayer: 5,
  cardsPerPlayer: 40,
  pickSeconds: 45,
  alternatePassDirection: true,
  randomizeSeats: false,
} satisfies Required<Pick<DraftConfig, "packSize" | "packsPerPlayer" | "cardsPerPlayer" | "pickSeconds" | "alternatePassDirection" | "randomizeSeats">>;

function normalizeDraftConfig(config: DraftConfig): DraftConfig {
  const base = {
    ...config,
    packSize: config.packSize ?? defaultDraftConfig.packSize,
    packsPerPlayer: config.packsPerPlayer ?? defaultDraftConfig.packsPerPlayer,
    cardsPerPlayer: config.cardsPerPlayer ?? defaultDraftConfig.cardsPerPlayer,
    pickSeconds: config.pickSeconds ?? defaultDraftConfig.pickSeconds,
    alternatePassDirection: config.alternatePassDirection ?? defaultDraftConfig.alternatePassDirection,
    randomizeSeats: config.randomizeSeats ?? defaultDraftConfig.randomizeSeats,
  };
  if (config.mode !== "theme") {
    return base;
  }
  return {
    ...base,
    mode: "theme",
    themePackSize: config.themePackSize ?? 3,
    extraDeckEnabled: config.extraDeckEnabled ?? true,
    extraDeckSize: config.extraDeckSize ?? 15,
    burnUnpicked: config.burnUnpicked ?? false,
    themeSelection: config.themeSelection ?? "player_pick",
    uniqueThemes: config.uniqueThemes ?? true,
  };
}

/** Per-player total rounds for a theme draft: main rounds + optional extra rounds. */
export function totalThemeRounds(config: DraftConfig): number {
  const main = config.cardsPerPlayer ?? defaultDraftConfig.cardsPerPlayer;
  const extra = (config.extraDeckEnabled ?? true) ? (config.extraDeckSize ?? 15) : 0;
  return main + extra;
}

const extraDeckFrameTypes = new Set(["fusion", "synchro", "xyz", "link"]);
const pickOptionLimit = 8;

function deadlineIso(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function isExtraDeckCatalogRow(row: CatalogRow) {
  return (
    extraDeckFrameTypes.has(row.frame_type) ||
    row.type.includes("Fusion Monster") ||
    row.type.includes("Synchro Monster") ||
    row.type.includes("XYZ Monster") ||
    row.type.includes("Xyz Monster") ||
    row.type.includes("Link Monster")
  );
}

export function createDraftService(
  db: Database.Database,
  options: { random?: () => number; seedSource?: () => ShuffleSeed } = {},
) {
  const random = options.random ?? Math.random;
  // Deals, assignments and theme packs are persisted; their seeds stay in memory.
  const seedSource = options.seedSource ?? (() => randomBytes(32).toString("hex"));
  const seatOrder = (playerIds: number[], config: DraftConfig): number[] => {
    if (!config.randomizeSeats) return playerIds;

    const shuffled = playerIds.slice();
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const findById = (draftId: number): Draft => {
    const row = db.prepare("select * from drafts where id = ?").get(draftId);

    if (!row) {
      throw new Error("Draft not found");
    }

    return mapDraft(row);
  };

  const createDraft = db.transaction(
    (
      guildId: string,
      channelId: string,
      name: string,
      config: DraftConfig,
      createdByUserId: string,
      creatorPlayerId: number,
    ) => {
      const result = db
        .prepare(
          `
          insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug)
          values (?, ?, ?, 'pending', ?, ?, ?)
        `,
        )
        .run(guildId, channelId, name, createdByUserId, JSON.stringify(normalizeDraftConfig(config)), generateWebSlug());

      const draftId = Number(result.lastInsertRowid);

      db.prepare(
        `
        insert into draft_players (draft_id, player_id)
        values (?, ?)
      `,
      ).run(draftId, creatorPlayerId);

      return draftId;
    },
  );

  const assertPlayerGuild = (playerId: number, guildId: string) => {
    const row = db.prepare("select 1 from players where id = ? and guild_id = ?").get(playerId, guildId);

    if (!row) {
      throw new Error("Player must belong to the same guild as the draft");
    }
  };

  const assertJoinedPlayer = (draftId: number, playerId: number) => {
    const row = db.prepare("select 1 from draft_players where draft_id = ? and player_id = ?").get(draftId, playerId);

    if (!row) {
      throw new Error("Player has not joined this draft");
    }
  };

  const playerProgress = (draftId: number, playerId: number): { pick_count: number; finished_at: string | null } =>
    db
      .prepare(
        `
          select pick_count, finished_at from draft_players
          where draft_id = ? and player_id = ?
        `,
      )
      .get(draftId, playerId) as { pick_count: number; finished_at: string | null };

  const hasPickedCurrentStep = (draftId: number, playerId: number, packRound: number, pickStep: number) =>
    Boolean(
      db
        .prepare(
          `
            select 1 from draft_picks
            where draft_id = ? and player_id = ? and wave_number = ? and pick_step = ?
          `,
        )
        .get(draftId, playerId, packRound, pickStep),
    );

  const hasPassedStep = (draftId: number, playerId: number, packRound: number, pickStep: number) =>
    Boolean(
      db
        .prepare(
          `
            select 1 from draft_passes
            where draft_id = ? and player_id = ? and wave_number = ? and pick_step = ?
          `,
        )
        .get(draftId, playerId, packRound, pickStep),
    );

  // A step is done for a player once they picked a card or passed.
  const hasActedCurrentStep = (draftId: number, playerId: number, packRound: number, pickStep: number) =>
    hasPickedCurrentStep(draftId, playerId, packRound, pickStep) ||
    hasPassedStep(draftId, playerId, packRound, pickStep);

  // Copies of each passcode a player holds in this draft (main and extra picks together).
  const heldCopies = (draftId: number, playerId: number): Map<number, number> => {
    const rows = db
      .prepare(
        `
          select dc.catalog_card_id as catalog_card_id, count(*) as n
          from draft_picks pk
          inner join draft_cards dc on dc.id = pk.draft_card_id
          where pk.draft_id = ? and pk.player_id = ?
          group by dc.catalog_card_id
        `,
      )
      .all(draftId, playerId) as Array<{ catalog_card_id: number; n: number }>;
    return new Map(rows.map((row) => [row.catalog_card_id, row.n]));
  };

  const isCapped = (held: Map<number, number>, catalogCardId: number) =>
    (held.get(catalogCardId) ?? 0) >= MAX_COPIES_PER_PLAYER;

  const assertUnderCopyCap = (draftId: number, playerId: number, draftCardId: number) => {
    const card = db
      .prepare("select catalog_card_id from draft_cards where id = ? and draft_id = ?")
      .get(draftCardId, draftId) as { catalog_card_id: number } | undefined;
    if (card && isCapped(heldCopies(draftId, playerId), card.catalog_card_id)) {
      throw new Error(`You already have ${MAX_COPIES_PER_PLAYER} copies of this card`);
    }
  };

  const playerSeatIndex = (draftId: number, playerId: number): number => {
    const row = db
      .prepare(
        `
          select seat_index from draft_players
          where draft_id = ? and player_id = ?
        `,
      )
      .get(draftId, playerId) as { seat_index: number | null } | undefined;

    if (!row || row.seat_index === null) {
      throw new Error("Draft seat has not been assigned yet");
    }

    return row.seat_index;
  };

  const assertActiveDraft = (draft: Draft) => {
    if (draft.status !== "active") {
      throw new Error("Draft must be active");
    }
  };

  const allSeatIndexes = (draftId: number): number[] =>
    (
      db
        .prepare("select seat_index from draft_players where draft_id = ? and seat_index is not null order by seat_index")
        .all(draftId) as Array<{ seat_index: number }>
    ).map((row) => row.seat_index);

  // Every pack moves one seat, including finished seats. This is a permutation:
  // skipping seats would let two live packs converge on the same player.
  const advanceSeatIndex = (seatIndexes: number[], currentSeatIndex: number, direction: number): number => {
    const currentIndex = seatIndexes.indexOf(currentSeatIndex);
    if (currentIndex === -1 || seatIndexes.length === 0) return currentSeatIndex;
    const offset = direction >= 0 ? 1 : -1;
    return seatIndexes[(currentIndex + offset + seatIndexes.length) % seatIndexes.length];
  };

  const currentPackAtSeat = (draftId: number, waveNumber: number, seatIndex: number) =>
    db.prepare(
      `select p.id, p.pass_direction from draft_packs p
       where p.draft_id = ? and p.wave_number = ? and p.current_holder_seat_index = ?
         and exists (select 1 from draft_cards c where c.draft_pack_id = p.id and c.picked_by_player_id is null)
       order by p.id asc limit 1`,
    ).get(draftId, waveNumber, seatIndex) as { id: number; pass_direction: number } | undefined;

  const pool = (draftId: number, playerId: number): DraftPoolCard[] => {
    findById(draftId);
    assertJoinedPlayer(draftId, playerId);

    return db
      .prepare(
        `
          select
            dp.draft_card_id,
            dc.catalog_card_id,
            dp.pick_method,
            dp.wave_number,
            dp.pick_step
          from draft_picks dp
          inner join draft_cards dc on dc.id = dp.draft_card_id
          where dp.draft_id = ? and dp.player_id = ?
          order by dp.id asc
        `,
      )
      .all(draftId, playerId)
      .map((row: any) => ({
        draftCardId: row.draft_card_id,
        catalogCardId: row.catalog_card_id,
        pickMethod: row.pick_method,
        packRound: row.wave_number,
        pickStep: row.pick_step,
      }));
  };

  const exportYdk = (draftId: number, playerId: number): string => {
    findById(draftId);
    assertJoinedPlayer(draftId, playerId);

    const progress = playerProgress(draftId, playerId);

    if (progress.pick_count < 40) {
      throw new Error("Deck is not complete yet");
    }

    const mainDeckCardIds = pool(draftId, playerId).slice(0, 40).map((row) => String(row.catalogCardId));

    if (mainDeckCardIds.length < 40) {
      throw new Error("Deck is not complete yet");
    }

    return ["#main", ...mainDeckCardIds, "#extra", "", "!side", ""].join("\n");
  };

  const catalogCardIdsForDraft = (config: DraftConfig): number[] => {
    const setNames = new Set((config.setNames ?? []).map((name) => name.trim()));
    const customCardIds = config.customCardIds ?? [];
    const customCardIdSet = new Set(customCardIds);
    const includeNames = new Set((config.includeNames ?? []).map(normalizeName));
    const excludeNames = new Set((config.excludeNames ?? []).map(normalizeName));
    const hasExplicitPool = setNames.size > 0 || customCardIds.length > 0 || includeNames.size > 0;
    const rows = db
      .prepare(
        "select ygoprodeck_id, name, type, frame_type, card_sets_json from card_catalog order by ygoprodeck_id",
      )
      .all()
      .map((raw: any) => {
        const row = raw as CatalogRow;
        return { row, cardSets: JSON.parse(row.card_sets_json) as Array<{ set_name: string }> };
      })
      .filter(({ row, cardSets }) => {
        const normalizedName = normalizeName(row.name);

        if (isExtraDeckCatalogRow(row)) {
          return false;
        }

        if (excludeNames.has(normalizedName)) {
          return false;
        }

        if (!hasExplicitPool) {
          return true;
        }

        if (includeNames.has(normalizedName)) {
          return true;
        }

        if (customCardIdSet.has(row.ygoprodeck_id)) {
          return true;
        }

        return cardSets.some((cardSet) => setNames.has(cardSet.set_name));
      });

    if (!hasExplicitPool) {
      return rows.map(({ row }) => row.ygoprodeck_id);
    }

    // baseline (set/include) appears once; custom occurrences are additive and
    // preserve repeats, so total per card = baseline + count in customCardIds.
    const baseIds = new Set<number>();
    const customEligibleIds = new Set<number>();
    for (const { row, cardSets } of rows) {
      customEligibleIds.add(row.ygoprodeck_id);
      const normalizedName = normalizeName(row.name);
      if (includeNames.has(normalizedName) || cardSets.some((cardSet) => setNames.has(cardSet.set_name))) {
        baseIds.add(row.ygoprodeck_id);
      }
    }

    return [...baseIds, ...customCardIds.filter((id) => customEligibleIds.has(id))];
  };

  const activePlayerRows = (draftId: number): DraftPlayerProgressRow[] =>
    db
      .prepare(
        `
          select player_id, pick_count, finished_at, seat_index
          from draft_players
          where draft_id = ? and finished_at is null
          order by joined_at asc, rowid asc
        `,
      )
      .all(draftId)
      .map((row: any) => row as DraftPlayerProgressRow);

  const openWave = (draftId: number, waveNumber: number, playerCount: number, config: DraftConfig) => {
    const packSize = config.packSize ?? defaultDraftConfig.packSize;
    const passDirection = waveNumber % 2 === 0 && config.alternatePassDirection ? -1 : 1;
    const insertPack = db.prepare(
      `
        insert into draft_packs (
          draft_id,
          wave_number,
          origin_seat_index,
          current_holder_seat_index,
          pass_direction
        ) values (?, ?, ?, ?, ?)
      `,
    );
    const insertDraftCard = db.prepare(
      `
        insert into draft_cards (draft_id, wave_number, draft_pack_id, catalog_card_id, position)
        values (?, ?, ?, ?, ?)
      `,
    );

    const hasCube = db.prepare("select 1 from draft_deal where draft_id = ? limit 1").get(draftId);

    if (hasCube) {
      const selectSlice = db.prepare(
        "select catalog_card_id from draft_deal where draft_id = ? and position >= ? and position < ? order by position",
      );
      for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
        const globalPack = (waveNumber - 1) * playerCount + playerIndex;
        const sliceRows = selectSlice.all(
          draftId,
          globalPack * packSize,
          (globalPack + 1) * packSize,
        ) as Array<{ catalog_card_id: number }>;
        const packId = Number(
          insertPack.run(draftId, waveNumber, playerIndex, playerIndex, passDirection).lastInsertRowid,
        );
        sliceRows.forEach((row, cardIndex) => {
          insertDraftCard.run(draftId, waveNumber, packId, row.catalog_card_id, cardIndex);
        });
      }
      return;
    }

    // Legacy path: drafts already active before the cube model deployed have
    // no draft_deal rows and finish all remaining waves on the old generator.
    const catalogCardIds =
      config.cubeCardIds && config.cubeCardIds.length > 0
        ? config.cubeCardIds
        : config.poolCardIds && config.poolCardIds.length > 0
          ? config.poolCardIds
          : catalogCardIdsForDraft(config);

    if (catalogCardIds.length === 0) {
      throw new Error("Draft pool is empty");
    }

    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      const packId = Number(
        insertPack.run(draftId, waveNumber, playerIndex, playerIndex, passDirection).lastInsertRowid,
      );

      for (let cardIndex = 0; cardIndex < packSize; cardIndex += 1) {
        const catalogCardId = catalogCardIds[Math.floor(Math.random() * catalogCardIds.length)];
        insertDraftCard.run(draftId, waveNumber, packId, catalogCardId, cardIndex);
      }
    }
  };

  // Theme mode: deal each active player a private pack of `themePackSize` distinct
  // choices from their assigned theme's current-phase pool. Returns the number of
  // packs dealt this round (0 when every assigned theme's pool is exhausted).
  const openThemeRound = (draftId: number, roundNumber: number, config: DraftConfig): number => {
    const cardsPerPlayer = config.cardsPerPlayer ?? defaultDraftConfig.cardsPerPlayer;
    const themePackSize = config.themePackSize ?? 3;
    const burnUnpicked = config.burnUnpicked ?? false;
    const phase: "main" | "extra" = roundNumber <= cardsPerPlayer ? "main" : "extra";

    const insertPack = db.prepare(
      `insert into draft_packs (draft_id, wave_number, origin_seat_index, current_holder_seat_index, pass_direction)
       values (?, ?, ?, ?, ?)`,
    );
    const insertDraftCard = db.prepare(
      `insert into draft_cards (draft_id, wave_number, draft_pack_id, catalog_card_id, position) values (?, ?, ?, ?, ?)`,
    );
    const markFinished = db.prepare(
      "update draft_players set finished_at = ? where draft_id = ? and player_id = ? and finished_at is null",
    );
    const poolStmt = db.prepare(
      "select catalog_card_id, max_copies from cube_cards where cube_id = ? and pool = ?",
    );
    const burnConsumedStmt = db.prepare(
      `select dc.catalog_card_id as catalog_card_id, count(*) as n
         from draft_cards dc
         join draft_packs dp on dp.id = dc.draft_pack_id
        where dp.draft_id = ? and dp.origin_seat_index = ? and dp.wave_number < ?
        group by dc.catalog_card_id`,
    );
    const pickConsumedStmt = db.prepare(
      `select dc.catalog_card_id as catalog_card_id, count(*) as n
         from draft_picks pk
         join draft_cards dc on dc.id = pk.draft_card_id
        where pk.draft_id = ? and pk.player_id = ?
        group by dc.catalog_card_id`,
    );

    const nowIso = new Date().toISOString();
    let dealt = 0;

    for (const player of activePlayerRows(draftId)) {
      const cubeRow = db
        .prepare("select cube_id from draft_player_cube where draft_id = ? and player_id = ?")
        .get(draftId, player.player_id) as { cube_id: number } | undefined;
      const seat = player.seat_index;
      if (!cubeRow || seat === null || seat === undefined) {
        continue;
      }

      const remaining = new Map<number, number>();
      for (const row of poolStmt.all(cubeRow.cube_id, phase) as Array<{ catalog_card_id: number; max_copies: number }>) {
        remaining.set(row.catalog_card_id, row.max_copies);
      }

      const consumed = (
        burnUnpicked
          ? burnConsumedStmt.all(draftId, seat, roundNumber)
          : pickConsumedStmt.all(draftId, player.player_id)
      ) as Array<{ catalog_card_id: number; n: number }>;
      for (const row of consumed) {
        const cur = remaining.get(row.catalog_card_id);
        if (cur !== undefined) {
          remaining.set(row.catalog_card_id, Math.max(0, cur - row.n));
        }
      }

      // A player never gets a card they already hold the maximum copies of.
      const held = heldCopies(draftId, player.player_id);
      const candidates = [...remaining.entries()]
        .filter(([id, count]) => count > 0 && !isCapped(held, id))
        .map(([id]) => id);
      if (candidates.length === 0) {
        // Exhausting Main must not exclude the player from their Extra rounds.
        if (phase === "extra" || totalThemeRounds(config) === cardsPerPlayer) {
          markFinished.run(nowIso, draftId, player.player_id);
        }
        continue;
      }

      const chosen = seededShuffle(candidates, seedSource()).slice(
        0,
        themePackSize,
      );
      const packId = Number(insertPack.run(draftId, roundNumber, seat, seat, 1).lastInsertRowid);
      chosen.forEach((catalogCardId, index) => {
        insertDraftCard.run(draftId, roundNumber, packId, catalogCardId, index);
      });
      dealt += 1;
    }

    return dealt;
  };

  // Advance/complete the global round counter past any freshly-opened rounds that
  // dealt zero packs (every assigned theme's pool exhausted). Loops so several empty
  // Extra rounds in a row still terminate. Assumes the just-opened `roundNumber` is set.
  const settleThemeRound = (draftId: number, openedRound: number, dealt: number, config: DraftConfig, now: Date) => {
    let round = openedRound;
    let dealtThisRound = dealt;
    const total = totalThemeRounds(config);
    while (dealtThisRound === 0 && round < total) {
      round += 1;
      dealtThisRound = openThemeRound(draftId, round, config);
    }
    if (dealtThisRound === 0) {
      // Nothing left to deal anywhere — complete.
      db.prepare("update drafts set status = 'completed', current_wave_number = ?, ended_at = ? where id = ?").run(
        round,
        now.toISOString(),
        draftId,
      );
      return;
    }
    db.prepare(
      "update drafts set current_wave_number = ?, current_pick_step = 1, pick_deadline_at = ? where id = ?",
    ).run(round, deadlineIso(now, config.pickSeconds ?? defaultDraftConfig.pickSeconds), draftId);
  };

  const assignThemes = (draftId: number, playerIds: number[], config: DraftConfig) => {
    const requested = config.allowedCubeIds ?? [];
    // Drop any cubes that were deleted from the library after being attached.
    const existing = new Set(
      (db.prepare("select id from cubes").all() as Array<{ id: number }>).map((r) => r.id),
    );
    const allowed = requested.filter((id) => existing.has(id));
    if (allowed.length === 0) {
      throw new Error("Theme draft requires at least one allowed theme");
    }
    const uniqueThemes = config.uniqueThemes ?? true;
    const selection = config.themeSelection ?? "player_pick";

    if (uniqueThemes && allowed.length < playerIds.length) {
      throw new Error(
        `Theme draft needs at least ${playerIds.length} themes for ${playerIds.length} players when uniqueThemes is on, but only ${allowed.length} are allowed.`,
      );
    }

    const upsertTheme = db.prepare(
      `insert into draft_player_cube (draft_id, player_id, cube_id) values (?, ?, ?)
       on conflict (draft_id, player_id) do update set cube_id = excluded.cube_id`,
    );

    // Existing claims (player_pick lobby). Other modes ignore them.
    const claims = new Map<number, number>();
    if (selection === "player_pick") {
      for (const row of db
        .prepare("select player_id, cube_id from draft_player_cube where draft_id = ?")
        .all(draftId) as Array<{ player_id: number; cube_id: number }>) {
        claims.set(row.player_id, row.cube_id);
      }
    }

    const shuffled = seededShuffle(allowed, seedSource());
    const used = new Set<number>(claims.values());
    let cursor = 0;
    const nextTheme = (): number => {
      if (uniqueThemes) {
        while (cursor < shuffled.length && used.has(shuffled[cursor])) cursor += 1;
        const theme = shuffled[cursor] ?? shuffled[shuffled.length - 1];
        used.add(theme);
        cursor += 1;
        return theme;
      }
      const theme = shuffled[cursor % shuffled.length];
      cursor += 1;
      return theme;
    };

    for (const playerId of playerIds) {
      let themeId: number | undefined;
      if (selection === "host_assigned") {
        themeId = config.themeAssignments?.[String(playerId)];
        if (themeId === undefined) {
          throw new Error(`Host-assigned theme draft is missing an assignment for player ${playerId}`);
        }
      } else if (selection === "player_pick" && claims.has(playerId)) {
        themeId = claims.get(playerId);
      } else {
        themeId = nextTheme();
      }
      upsertTheme.run(draftId, playerId, themeId);
    }
  };

  const preflightThemes = (draftId: number, config: DraftConfig) => {
    const cardsPerPlayer = config.cardsPerPlayer ?? defaultDraftConfig.cardsPerPlayer;
    const themePackSize = config.themePackSize ?? 3;
    const burnUnpicked = config.burnUnpicked ?? false;
    const requiredMain = burnUnpicked ? cardsPerPlayer * themePackSize : cardsPerPlayer + (themePackSize - 1);

    const rows = db
      .prepare(
        `select dpt.cube_id as cube_id,
                coalesce(sum(tc.max_copies), 0) as main_size,
                coalesce(sum(min(tc.max_copies, ${MAX_COPIES_PER_PLAYER})), 0) as reachable_size
           from draft_player_cube dpt
           left join cube_cards tc on tc.cube_id = dpt.cube_id and tc.pool = 'main'
          where dpt.draft_id = ?
          group by dpt.cube_id`,
      )
      .all(draftId) as Array<{ cube_id: number; main_size: number; reachable_size: number }>;

    // A player never gets more than MAX_COPIES_PER_PLAYER of one card, so a cube with many
    // copies of a few cards cannot fill a deck even when the raw count looks big enough.
    // Each burned choice can consume a reachable copy too. Requiring enough
    // capped-reachable copies for all choices is conservative for any pick order.
    const requiredReachable = requiredMain;

    for (const row of rows) {
      if (row.main_size < requiredMain) {
        throw new Error(
          `Cube ${row.cube_id} has only ${row.main_size} main-pool cards but needs ${requiredMain} to fill a ${cardsPerPlayer}-card main deck.`,
        );
      }
      if (row.reachable_size < requiredReachable) {
        throw new Error(
          `Cube ${row.cube_id} gives one player only ${row.reachable_size} main-pool cards (at most ${MAX_COPIES_PER_PLAYER} copies of a card) but needs ${requiredReachable} to fill a ${cardsPerPlayer}-card main deck${burnUnpicked ? " including burned choices (burn on)" : ""}.`,
        );
      }
    }
  };

  const startThemeDraft = (draftId: number, draft: Draft, now: Date): Draft => {
    const playerIds = db
      .prepare("select player_id from draft_players where draft_id = ? order by joined_at asc, rowid asc")
      .all(draftId)
      .map((row: any) => row.player_id as number);

    if (playerIds.length < 2) {
      throw new Error("Draft requires at least two players to start");
    }

    if (draft.config.themeSelection === "host_assigned") {
      const assignments = draft.config.themeAssignments ?? {};
      const assignedCubeIds = playerIds.map((playerId) => assignments[String(playerId)]);
      const allowed = draft.config.allowedCubeIds ?? [];
      const validAssignment = (cubeId: number) => Number.isInteger(cubeId) && allowed.includes(cubeId);
      if (!assignedCubeIds.every(validAssignment)) {
        throw new Error("Host-assigned themes require an allowed theme assignment for every player. Choose Random or Players pick instead.");
      }

      const findCube = db.prepare("select id from cubes where id = ? and guild_id = ?");
      if (assignedCubeIds.some((cubeId) => !findCube.get(cubeId, draft.guildId))) {
        throw new Error("Host-assigned themes must exist in the draft's guild. Choose valid themes or switch to Random or Players pick.");
      }

      if ((draft.config.uniqueThemes ?? true) && new Set(assignedCubeIds).size !== assignedCubeIds.length) {
        throw new Error("Host-assigned themes must be distinct when uniqueThemes is enabled.");
      }
    }

    const assignSeat = db.prepare("update draft_players set seat_index = ? where draft_id = ? and player_id = ?");
    for (const [seatIndex, playerId] of seatOrder(playerIds, draft.config).entries()) {
      assignSeat.run(seatIndex, draftId, playerId);
    }

    assignThemes(draftId, playerIds, draft.config);
    preflightThemes(draftId, draft.config);

    db.prepare(
      `update drafts set status = 'active', started_at = ?, current_wave_number = 1, current_pick_step = 1, pick_deadline_at = ? where id = ?`,
    ).run(now.toISOString(), deadlineIso(now, draft.config.pickSeconds ?? defaultDraftConfig.pickSeconds), draftId);

    const dealt = openThemeRound(draftId, 1, draft.config);
    settleThemeRound(draftId, 1, dealt, draft.config, now);

    return findById(draftId);
  };

  const startDraft = db.transaction((draftId: number, now = new Date()) => {
    const draft = findById(draftId);

    if (draft.status !== "pending") {
      throw new Error("Draft must be pending to start");
    }

    if (draft.config.mode === "theme") {
      return startThemeDraft(draftId, draft, now);
    }

    const playerIds = db
      .prepare(
        `
          select player_id from draft_players
          where draft_id = ?
          order by joined_at asc, rowid asc
        `,
      )
      .all(draftId)
      .map((row: any) => row.player_id);

    if (playerIds.length < 2) {
      throw new Error("Draft requires at least two players to start");
    }

    const assignSeat = db.prepare(
      `
        update draft_players
        set seat_index = ?
        where draft_id = ? and player_id = ?
      `,
    );

    for (const [seatIndex, playerId] of seatOrder(playerIds, draft.config).entries()) {
      assignSeat.run(seatIndex, draftId, playerId);
    }

    const packSize = draft.config.packSize ?? defaultDraftConfig.packSize;
    const packsPerPlayer = draft.config.packsPerPlayer ?? defaultDraftConfig.packsPerPlayer;

    const cubeCardIds =
      draft.config.cubeCardIds && draft.config.cubeCardIds.length > 0
        ? draft.config.cubeCardIds
        : draft.config.poolCardIds && draft.config.poolCardIds.length > 0
          ? draft.config.poolCardIds
          : catalogCardIdsForDraft(draft.config);

    const players = playerIds.length;
    const waves = packsPerPlayer;
    const analysis = analyzeCube(cubeCardIds, players, waves, packSize, draft.config.cardsPerPlayer);
    if (!analysis.ok) {
      throw new Error(analysis.errors.join(" "));
    }

    const packs = buildDeal(cubeCardIds, { players, waves, packSize, seed: seedSource() });
    const insertCube = db.prepare(
      "insert into draft_deal (draft_id, position, catalog_card_id) values (?, ?, ?)",
    );
    let position = 0;
    for (const pack of packs) {
      for (const cardId of pack) {
        insertCube.run(draftId, position, cardId);
        position += 1;
      }
    }

    openWave(draftId, 1, playerIds.length, draft.config);

    db.prepare(
      `
        update drafts
        set status = 'active',
            started_at = ?,
            current_wave_number = 1,
            current_pick_step = 1,
            pick_deadline_at = ?
        where id = ?
      `,
    ).run(now.toISOString(), deadlineIso(now, draft.config.pickSeconds ?? defaultDraftConfig.pickSeconds), draftId);

    return findById(draftId);
  });

  // Whether any active player can still take a card left in the wave (not capped for them).
  const waveHasPickableCard = (draftId: number, waveNumber: number, active: DraftPlayerProgressRow[]): boolean => {
    const catalogIds = (
      db
        .prepare(
          `
            select distinct catalog_card_id from draft_cards
            where draft_id = ? and wave_number = ? and picked_by_player_id is null
          `,
        )
        .all(draftId, waveNumber) as Array<{ catalog_card_id: number }>
    ).map((row) => row.catalog_card_id);

    if (catalogIds.length === 0) {
      return false;
    }

    return active.some((row) => {
      const held = heldCopies(draftId, row.player_id);
      return catalogIds.some((id) => !isCapped(held, id));
    });
  };

  // Booster step bookkeeping, run after every pick. A player who cannot pick (every card in
  // the pack is capped for them, or the pack is empty) passes on their own: a pass row, no card.
  // The step closes once every active player picked or passed. The wave ends when no active
  // player can take any card left in it. Steps where nobody can pick are skipped in a loop.
  const settleBoosterStep = (draftId: number, now: Date) => {
    const insertPass = db.prepare(
      `
        insert or ignore into draft_passes (draft_id, player_id, wave_number, pick_step, passed_at)
        values (?, ?, ?, ?, ?)
      `,
    );
    const updatePackHolder = db.prepare("update draft_packs set current_holder_seat_index = ? where id = ?");

    for (;;) {
      const draft = findById(draftId);
      if (draft.status !== "active") {
        return;
      }

      const active = activePlayerRows(draftId);
      if (active.length === 0) {
        db.prepare("update drafts set status = 'completed', ended_at = ? where id = ?").run(now.toISOString(), draftId);
        return;
      }

      const { currentPackRound, currentPickStep } = draft;
      for (const row of active) {
        if (
          !hasActedCurrentStep(draftId, row.player_id, currentPackRound, currentPickStep) &&
          currentPackOptionsInternal(draftId, row.player_id, true).length === 0
        ) {
          insertPass.run(draftId, row.player_id, currentPackRound, currentPickStep, now.toISOString());
        }
      }

      if (active.some((row) => !hasActedCurrentStep(draftId, row.player_id, currentPackRound, currentPickStep))) {
        return;
      }

      // With all seats in rotation, every remaining pack can reach every active
      // player. End a wave only when no active player can take a remaining card.
      if (!waveHasPickableCard(draftId, currentPackRound, active)) {
        if (currentPackRound >= (draft.config.packsPerPlayer ?? defaultDraftConfig.packsPerPlayer)) {
          db.prepare("update drafts set status = 'completed', ended_at = ? where id = ?").run(now.toISOString(), draftId);
          return;
        }
        const seatCount = allSeatIndexes(draftId).length;
        openWave(draftId, currentPackRound + 1, seatCount, draft.config);
        db.prepare(
          `
            update drafts
            set current_wave_number = ?, current_pick_step = 1, pick_deadline_at = ?
            where id = ?
          `,
        ).run(
          currentPackRound + 1,
          deadlineIso(now, draft.config.pickSeconds ?? defaultDraftConfig.pickSeconds),
          draftId,
        );
        continue;
      }

      const seatIndexes = allSeatIndexes(draftId);
      const currentPacks = db
        .prepare(
          `
            select id, current_holder_seat_index, pass_direction
            from draft_packs
            where draft_id = ? and wave_number = ?
            order by id asc
          `,
        )
        .all(draftId, currentPackRound) as Array<{
        id: number;
        current_holder_seat_index: number;
        pass_direction: number;
      }>;

      for (const pack of currentPacks) {
        updatePackHolder.run(
          advanceSeatIndex(seatIndexes, pack.current_holder_seat_index, pack.pass_direction),
          pack.id,
        );
      }

      db.prepare(
        `
          update drafts
          set current_pick_step = current_pick_step + 1,
              pick_deadline_at = ?
          where id = ?
        `,
      ).run(deadlineIso(now, draft.config.pickSeconds ?? defaultDraftConfig.pickSeconds), draftId);

      // Finished seats do not gate the step; rounds with only passes rotate immediately.
    }
  };

  // Theme-mode pick: validate the card is in the player's private pack, record it,
  // and advance the global round once every player dealt a pack this round has picked.
  // Does NOT run the booster pass-the-pack logic.
  const pickThemeCard = (
    draftId: number,
    playerId: number,
    draftCardId: number,
    pickMethod: "manual" | "auto",
    now: Date,
  ): DraftPick => {
    const draft = findById(draftId);
    const config = draft.config;
    const total = totalThemeRounds(config);

    const playerRow = playerProgress(draftId, playerId);
    if (playerRow.finished_at !== null || playerRow.pick_count >= total) {
      throw new Error("Player has already finished drafting");
    }
    if (hasPickedCurrentStep(draftId, playerId, draft.currentPackRound, 1)) {
      throw new Error("Player has already picked this step");
    }

    const seat = playerSeatIndex(draftId, playerId);
    const pack = currentPackAtSeat(draftId, draft.currentPackRound, seat);
    if (!pack) {
      throw new Error("Player has no current pack");
    }
    const cardRow = db
      .prepare("select wave_number, draft_pack_id, picked_by_player_id from draft_cards where id = ? and draft_id = ?")
      .get(draftCardId, draftId) as DraftCardRow | undefined;
    if (!cardRow || cardRow.wave_number !== draft.currentPackRound) {
      throw new Error("Card is not in the current wave");
    }
    if (cardRow.draft_pack_id !== pack.id) {
      throw new Error("Card is not in your current pack");
    }
    if (cardRow.picked_by_player_id !== null) {
      throw new Error("Card has already been picked");
    }
    assertUnderCopyCap(draftId, playerId, draftCardId);

    db.prepare("update draft_cards set picked_by_player_id = ?, picked_at = ? where id = ?").run(
      playerId,
      now.toISOString(),
      draftCardId,
    );
    const result = db
      .prepare(
        `insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, pick_method, picked_at)
         values (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(draftId, playerId, draftCardId, draft.currentPackRound, pickMethod, now.toISOString());
    db.prepare(
      `update draft_players set pick_count = pick_count + 1,
              finished_at = case when pick_count + 1 >= ? then ? else finished_at end
        where draft_id = ? and player_id = ?`,
    ).run(total, now.toISOString(), draftId, playerId);

    // Advance gate: every player dealt a pack this round must have picked.
    const dealt = db
      .prepare("select count(*) as n from draft_packs where draft_id = ? and wave_number = ?")
      .get(draftId, draft.currentPackRound) as { n: number };
    const picked = db
      .prepare("select count(*) as n from draft_picks where draft_id = ? and wave_number = ?")
      .get(draftId, draft.currentPackRound) as { n: number };

    if (picked.n >= dealt.n) {
      if (draft.currentPackRound >= total) {
        db.prepare("update drafts set status = 'completed', ended_at = ? where id = ?").run(now.toISOString(), draftId);
      } else {
        const nextRound = draft.currentPackRound + 1;
        const dealtNext = openThemeRound(draftId, nextRound, config);
        settleThemeRound(draftId, nextRound, dealtNext, config, now);
      }
    }

    return mapDraftPick(db.prepare("select * from draft_picks where id = ?").get(Number(result.lastInsertRowid)));
  };

  const pickCard = db.transaction(
    (
      draftId: number,
      playerId: number,
      draftCardId: number,
      pickMethod: "manual" | "auto" = "manual",
      now = new Date(),
    ) => {
    const draft = findById(draftId);
    assertActiveDraft(draft);
    assertJoinedPlayer(draftId, playerId);

    if (draft.config.mode === "theme") {
      return pickThemeCard(draftId, playerId, draftCardId, pickMethod, now);
    }

    const playerRow = playerProgress(draftId, playerId);

    const cardsPerPlayer = draft.config.cardsPerPlayer ?? defaultDraftConfig.cardsPerPlayer;
    if (playerRow.finished_at !== null || playerRow.pick_count >= cardsPerPlayer) {
      throw new Error("Player has already finished drafting");
    }

    if (hasPickedCurrentStep(draftId, playerId, draft.currentPackRound, draft.currentPickStep)) {
      throw new Error("Player has already picked this step");
    }
    if (hasPassedStep(draftId, playerId, draft.currentPackRound, draft.currentPickStep)) {
      throw new Error("Player has no card to pick this step");
    }

    const cardRow = db
      .prepare("select wave_number, draft_pack_id, picked_by_player_id from draft_cards where id = ? and draft_id = ?")
      .get(draftCardId, draftId) as DraftCardRow | undefined;

    if (!cardRow || cardRow.wave_number !== draft.currentPackRound) {
      throw new Error("Card is not in the current wave");
    }

    const seatIndex = playerSeatIndex(draftId, playerId);
    const currentPack = currentPackAtSeat(draftId, draft.currentPackRound, seatIndex);

    if (!currentPack) {
      throw new Error("Player has no current pack");
    }

    if (cardRow.draft_pack_id !== currentPack.id) {
      throw new Error("Card is not in your current pack");
    }

    if (cardRow.picked_by_player_id !== null) {
      throw new Error("Card has already been picked");
    }
    assertUnderCopyCap(draftId, playerId, draftCardId);

    db.prepare(
      `
        update draft_cards
        set picked_by_player_id = ?, picked_at = ?
        where id = ?
      `,
    ).run(playerId, now.toISOString(), draftCardId);

    const result = db
      .prepare(
        `
          insert into draft_picks (draft_id, player_id, draft_card_id, wave_number, pick_step, pick_method, picked_at)
          values (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(draftId, playerId, draftCardId, draft.currentPackRound, draft.currentPickStep, pickMethod, now.toISOString());

    db.prepare(
      `
        update draft_players
        set pick_count = pick_count + 1,
            finished_at = case when pick_count + 1 >= ? then ? else finished_at end
        where draft_id = ? and player_id = ?
      `,
    ).run(cardsPerPlayer, now.toISOString(), draftId, playerId);

    settleBoosterStep(draftId, now);

    const pickRow = db.prepare("select * from draft_picks where id = ?").get(Number(result.lastInsertRowid));
    return mapDraftPick(pickRow);
    },
  );

  const recordManualPick = db.transaction(
    (draftId: number, playerId: number, draftCardId: number, now = new Date()): { alreadyPicked: boolean } => {
      const draftBefore = findById(draftId);
      expireCurrentPickStep(draftId, now);
      if (hasPickedCurrentStep(draftId, playerId, draftBefore.currentPackRound, draftBefore.currentPickStep)) {
        return { alreadyPicked: true };
      }
      pickCard(draftId, playerId, draftCardId, "manual", now);
      return { alreadyPicked: false };
    },
  );

  const expireCurrentPickStep = db.transaction((draftId: number, now = new Date()): { autoPickedPlayerIds: number[] } => {
    const draft = findById(draftId);

    if (draft.status !== "active" || !draft.pickDeadlineAt || new Date(draft.pickDeadlineAt).getTime() > now.getTime()) {
      return { autoPickedPlayerIds: [] };
    }

    const pendingPlayers = activePlayerRows(draftId)
      .filter((row) => !hasActedCurrentStep(draftId, row.player_id, draft.currentPackRound, draft.currentPickStep))
      .map((row) => row.player_id);
    const autoPickedPlayerIds: number[] = [];

    for (const playerId of pendingPlayers) {
      // Only cards the player may take: a card they hold the maximum copies of is never auto-picked.
      const options = currentPackOptionsInternal(draftId, playerId, true);

      if (options.length === 0) {
        continue;
      }

      const option = options[Math.floor(Math.random() * options.length)];
      pickCard(draftId, playerId, option.id, "auto", now);
      autoPickedPlayerIds.push(playerId);
    }

    // A player with nothing to pick passes; this closes the step if they were the last one waited on.
    if (draft.config.mode !== "theme") {
      settleBoosterStep(draftId, now);
    }

    return { autoPickedPlayerIds };
  });

  // pickableOnly drops cards the player holds the maximum copies of; without it the whole pack is returned.
  const currentPackOptionsInternal = (draftId: number, playerId: number, pickableOnly = false): DraftCard[] => {
    const draft = findById(draftId);
    if (draft.status === "completed") {
      return [];
    }
    assertActiveDraft(draft);
    assertJoinedPlayer(draftId, playerId);

    const playerRow = playerProgress(draftId, playerId);

    const perPlayerTotal =
      draft.config.mode === "theme"
        ? totalThemeRounds(draft.config)
        : draft.config.cardsPerPlayer ?? defaultDraftConfig.cardsPerPlayer;
    if (playerRow.finished_at !== null || playerRow.pick_count >= perPlayerTotal) {
      return [];
    }

    if (hasActedCurrentStep(draftId, playerId, draft.currentPackRound, draft.currentPickStep)) {
      return [];
    }

    const seatIndex = playerSeatIndex(draftId, playerId);
    const pack = currentPackAtSeat(draftId, draft.currentPackRound, seatIndex);

    if (!pack) {
      return [];
    }

    const cards = db
      .prepare(
        `
          select * from draft_cards
          where draft_pack_id = ? and picked_by_player_id is null
          order by position asc, id asc
        `,
      )
      .all(pack.id)
      .map(mapDraftCard);

    if (!pickableOnly) {
      return cards;
    }

    const held = heldCopies(draftId, playerId);
    return cards.filter((card) => !isCapped(held, card.catalogCardId));
  };

  return {
    create(
      guildId: string,
      channelId: string,
      name: string,
      config: DraftConfig,
      createdByUserId: string,
      creatorPlayerId: number,
    ): Draft {
      const existingCurrent = db
        .prepare(
          `
          select id from drafts
          where guild_id = ?
            and name = ?
            and status in ('pending', 'active')
          limit 1
        `,
        )
        .get(guildId, name);

      if (existingCurrent) {
        throw new Error("An active or pending draft already uses that name");
      }

      assertPlayerGuild(creatorPlayerId, guildId);

      return findById(createDraft(guildId, channelId, name, config, createdByUserId, creatorPlayerId));
    },

    findById,

    findByName(guildId: string, name: string): Draft | undefined {
      const row = db
        .prepare(
          `
          select * from drafts
          where guild_id = ? and name = ?
          order by
            case status when 'active' then 0 when 'pending' then 1 else 2 end,
            id desc
          limit 1
        `,
        )
        .get(guildId, name);

      return row ? mapDraft(row) : undefined;
    },

    listByStatus(guildId: string, statuses: DraftStatus[]): Draft[] {
      if (statuses.length === 0) {
        return [];
      }

      return db
        .prepare(
          `
          select * from drafts
          where guild_id = ?
            and status in (${statuses.map(() => "?").join(", ")})
          order by created_at asc, id asc
        `,
        )
        .all(guildId, ...statuses)
        .map(mapDraft);
    },

    listActive(): Draft[] {
      return db
        .prepare(
          `
          select * from drafts
          where status = 'active'
          order by id asc
        `,
        )
        .all()
        .map(mapDraft);
    },

    join(draftId: number, playerId: number): void {
      const draft = findById(draftId);

      if (draft.status !== "pending") {
        throw new Error("Draft is no longer accepting players");
      }

      assertPlayerGuild(playerId, draft.guildId);

      const existing = db.prepare("select 1 from draft_players where draft_id = ? and player_id = ?").get(draftId, playerId);

      if (existing) {
        throw new Error("You have already joined this draft");
      }

      db.prepare(
        `
        insert into draft_players (draft_id, player_id)
        values (?, ?)
      `,
      ).run(draftId, playerId);
    },

    players(draftId: number): DraftPlayer[] {
      return db
        .prepare(
          `
          select p.id as player_id, p.display_name, dp.seat_index
          from draft_players dp
          inner join players p on p.id = dp.player_id
          where dp.draft_id = ?
          order by dp.seat_index asc, dp.joined_at asc, dp.rowid asc
        `,
        )
        .all(draftId)
        .map((row: any) => ({
          playerId: row.player_id,
          displayName: row.display_name,
          ...(row.seat_index === null ? {} : { seatIndex: row.seat_index }),
        }));
    },

    start(draftId: number, now = new Date()): Draft {
      return startDraft(draftId, now);
    },

    currentPackOptions(draftId: number, playerId: number): DraftCard[] {
      return currentPackOptionsInternal(draftId, playerId);
    },

    currentWaveCards(draftId: number): DraftCard[] {
      const draft = findById(draftId);

      if (draft.currentPackRound === 0) {
        return [];
      }

      return db
        .prepare(
          `
            select * from draft_cards
            where draft_id = ? and wave_number = ?
            order by id asc
          `,
        )
        .all(draftId, draft.currentPackRound)
        .map(mapDraftCard);
    },

    /** The cards the player may take now: the pack without cards they hold the maximum copies of. */
    pickOptions(draftId: number, playerId: number): DraftCard[] {
      return currentPackOptionsInternal(draftId, playerId, true);
    },

    /** Copies of each passcode the player holds in this draft, for showing the per-player cap. */
    heldCopies(draftId: number, playerId: number): Record<number, number> {
      assertJoinedPlayer(draftId, playerId);
      return Object.fromEntries(heldCopies(draftId, playerId));
    },

    /** True when the player has no card to pick this step and passed (or must pass) it. */
    hasPassedStep(draftId: number, playerId: number): boolean {
      const draft = findById(draftId);
      return hasPassedStep(draftId, playerId, draft.currentPackRound, draft.currentPickStep);
    },

    pickCard(
      draftId: number,
      playerId: number,
      draftCardId: number,
      pickMethod: "manual" | "auto" = "manual",
      now = new Date(),
    ): DraftPick {
      return pickCard(draftId, playerId, draftCardId, pickMethod, now);
    },

    expireCurrentPickStep(draftId: number, now = new Date()): { autoPickedPlayerIds: number[] } {
      return expireCurrentPickStep(draftId, now);
    },

    recordManualPick(draftId: number, playerId: number, draftCardId: number, now = new Date()): { alreadyPicked: boolean } {
      return recordManualPick(draftId, playerId, draftCardId, now);
    },

    pool(draftId: number, playerId: number): DraftPoolCard[] {
      return pool(draftId, playerId);
    },

    exportYdk(draftId: number, playerId: number): string {
      return exportYdk(draftId, playerId);
    },

    picks(draftId: number): DraftPick[] {
      findById(draftId);

      return db
        .prepare(
          `
            select * from draft_picks
            where draft_id = ?
            order by id asc
          `,
        )
        .all(draftId)
        .map(mapDraftPick);
    },

    setStatusMessageId(draftId: number, messageId: string | null): void {
      findById(draftId);

      db.prepare("update drafts set status_message_id = ? where id = ?").run(messageId, draftId);
    },

    cancel(draftId: number): Draft {
      const draft = findById(draftId);

      if (draft.status === "completed" || draft.status === "cancelled") {
        throw new Error("Draft is already finished");
      }

      db.prepare("update drafts set status = 'cancelled', ended_at = current_timestamp where id = ?").run(draftId);

      return findById(draftId);
    },

    resolveCubeCardIds(config: DraftConfig): number[] {
      return config.cubeCardIds && config.cubeCardIds.length > 0
        ? config.cubeCardIds
        : config.poolCardIds && config.poolCardIds.length > 0
          ? config.poolCardIds
          : catalogCardIdsForDraft(config);
    },

    /** @deprecated use resolveCubeCardIds; retained for callers not yet migrated */
    resolvePoolCardIds(config: DraftConfig): number[] {
      return config.cubeCardIds && config.cubeCardIds.length > 0
        ? config.cubeCardIds
        : config.poolCardIds && config.poolCardIds.length > 0
          ? config.poolCardIds
          : catalogCardIdsForDraft(config);
    },

    autocomplete(input: {
      guildId: string;
      query: string;
      statuses?: DraftStatus[];
      createdByUserId?: string;
    }): Draft[] {
      const conditions = ["guild_id = ?", "lower(name) like lower(?)"];
      const params: Array<string | number> = [input.guildId, `%${input.query}%`];

      if (input.statuses && input.statuses.length > 0) {
        conditions.push(`status in (${input.statuses.map(() => "?").join(", ")})`);
        params.push(...input.statuses);
      }

      if (input.createdByUserId) {
        conditions.push("created_by_user_id = ?");
        params.push(input.createdByUserId);
      }

      return db
        .prepare(
          `
            select * from drafts
            where ${conditions.join(" and ")}
            order by created_at desc, id desc
            limit 25
          `,
        )
        .all(...params)
        .map(mapDraft);
    },
  };
}

export type DraftService = ReturnType<typeof createDraftService>;
