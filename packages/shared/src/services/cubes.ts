import type Database from "better-sqlite3";
import type { Card, Cube, CubeCard, CubePool, CubePools, DraftConfig } from "../types/index.js";
import { isExtraDeckFrame, type CardCatalogService } from "./card-catalog.js";
import type { CubeAnalysis } from "./deal.js";
import { DEFAULT_CUBE_COPIES, MAX_COPIES_PER_PLAYER, MAX_CUBE_COPIES, MIN_CUBE_COPIES } from "./constants.js";

export interface AnalyzeCubePoolsConfig {
  themePackSize: number;
  cardsPerPlayer: number;
  extraDeckSize: number;
  burnUnpicked: boolean;
  extraDeckEnabled: boolean;
}

function requiredPoolSize(rounds: number, themePackSize: number, burnUnpicked: boolean): number {
  return burnUnpicked ? rounds * themePackSize : rounds + (themePackSize - 1);
}

/** Cards one player can take from a pool: the per-player cap limits each card, whatever the cube holds. */
function playerReachableSize(cards: Array<{ maxCopies: number }>): number {
  return cards.reduce((sum, c) => sum + Math.min(c.maxCopies, MAX_COPIES_PER_PLAYER), 0);
}

/** Copies of one card in a cube: any whole number from 1 to MAX_CUBE_COPIES. */
function assertCubeCopies(value: number): number {
  if (!Number.isInteger(value) || value < MIN_CUBE_COPIES || value > MAX_CUBE_COPIES) {
    throw new Error(`Copies must be a whole number from ${MIN_CUBE_COPIES} to ${MAX_CUBE_COPIES}`);
  }
  return value;
}

function mapCube(row: any): Cube {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    archetype: row.archetype ?? null,
    banlist: row.banlist ?? null,
    config: JSON.parse(row.config_json ?? "{}") as DraftConfig,
    createdByUserId: row.created_by_user_id,
  };
}

function mapCubeCard(row: any): CubeCard {
  return {
    catalogCardId: row.catalog_card_id,
    pool: row.pool as CubePool,
    maxCopies: row.max_copies,
    source: row.source ?? undefined,
  };
}

/** Config keys that describe the cube itself, not a draft. Saving a draft config over a cube keeps them. */
const CUBE_META_KEYS = ["draftType"] as const;

export function createCubeService(db: Database.Database, catalog: CardCatalogService) {
  const touch = db.prepare("update cubes set updated_at = ? where id = ?");
  const bump = (cubeId: number) => touch.run(new Date().toISOString(), cubeId);

  const findCube = (cubeId: number): Cube => {
    const row = db.prepare("select * from cubes where id = ?").get(cubeId);
    if (!row) {
      throw new Error(`Cube ${cubeId} not found`);
    }
    return mapCube(row);
  };

  const insertCubeRow = (
    guildId: string,
    name: string,
    createdByUserId: string,
    archetype: string | null,
    banlist: string | null,
  ): number => {
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `insert into cubes (guild_id, name, archetype, banlist, created_by_user_id, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(guildId, name, archetype, banlist, createdByUserId, now, now);
    return Number(result.lastInsertRowid);
  };

  const upsertCard = db.prepare(
    `
      insert into cube_cards (cube_id, catalog_card_id, pool, max_copies, source)
      values (?, ?, ?, ?, ?)
      on conflict (cube_id, catalog_card_id) do update set
        pool = excluded.pool,
        max_copies = excluded.max_copies,
        source = excluded.source
    `,
  );

  const existingCardIds = (cubeId: number): Set<number> =>
    new Set(
      (db.prepare("select catalog_card_id from cube_cards where cube_id = ?").all(cubeId) as Array<{
        catalog_card_id: number;
      }>).map((r) => r.catalog_card_id),
    );

  const getCubePools = (cubeId: number): CubePools => {
    const rows = db
      .prepare(
        "select catalog_card_id, pool, max_copies, source from cube_cards where cube_id = ? order by rowid asc",
      )
      .all(cubeId)
      .map(mapCubeCard);
    return {
      main: rows.filter((c) => c.pool === "main"),
      extra: rows.filter((c) => c.pool === "extra"),
    };
  };

  /**
   * Import several passcode lists in one go. Every passcode is looked up first, then all the
   * cards are written in one transaction, so a failed lookup writes nothing. A passcode the card
   * database rejects or does not know is returned in `unknown`. One copy per occurrence, capped
   * at MAX_CUBE_COPIES; a card sits in one pool, so a later group wins.
   */
  const importPasscodeGroups = async (
    cubeId: number,
    groups: Array<{ codes: number[]; pool?: CubePool }>,
  ): Promise<{ added: number; unknown: number[] }> => {
    const cards = new Map<number, Card>();
    const unknown: number[] = [];
    const ids = [...new Set(groups.flatMap((g) => g.codes))];
    for (const card of catalog.findByIds(ids)) cards.set(card.ygoprodeckId, card);
    for (const id of ids) {
      if (cards.has(id)) continue;
      let card: Card | undefined;
      try {
        card = await catalog.syncCardById(id);
      } catch (error) {
        // YGOPRODeck answers HTTP 400 for a passcode it does not have. A lost connection is
        // different: stop, and nothing has been written yet.
        if (error instanceof Error && error.message.startsWith("Could not reach the card database")) throw error;
      }
      if (card) cards.set(id, card);
      else unknown.push(id);
    }

    const written = new Set<number>();
    db.transaction(() => {
      for (const { codes, pool } of groups) {
        const counts = new Map<number, number>();
        for (const id of codes) counts.set(id, (counts.get(id) ?? 0) + 1);
        for (const [id, count] of counts) {
          const card = cards.get(id);
          if (!card) continue;
          upsertCard.run(
            cubeId,
            id,
            pool ?? (isExtraDeckFrame(card) ? "extra" : "main"),
            Math.min(count, MAX_CUBE_COPIES),
            null,
          );
          written.add(id);
        }
      }
      bump(cubeId);
    })();
    return { added: written.size, unknown };
  };

  return {
    createBlank(guildId: string, name: string, createdByUserId: string): Cube {
      return findCube(insertCubeRow(guildId, name, createdByUserId, null, null));
    },

    async createFromArchetype(
      guildId: string,
      archetype: string,
      createdByUserId: string,
      opts: {
        name?: string;
        banlist?: string;
        maxCopies?: number;
      } = {},
    ): Promise<Cube> {
      const {
        name = archetype,
        banlist,
        maxCopies = DEFAULT_CUBE_COPIES,
      } = opts;
      assertCubeCopies(maxCopies);

      const { main, extra } = await catalog.syncByArchetype(archetype, { banlist });
      const cubeId = insertCubeRow(guildId, name, createdByUserId, archetype, banlist ?? null);

      for (const card of main) {
        upsertCard.run(cubeId, card.ygoprodeckId, "main", maxCopies, null);
      }
      for (const card of extra) {
        upsertCard.run(cubeId, card.ygoprodeckId, "extra", maxCopies, null);
      }

      bump(cubeId);
      return findCube(cubeId);
    },

    addCard(
      cubeId: number,
      catalogCardId: number,
      pool: CubePool,
      maxCopies = DEFAULT_CUBE_COPIES,
      source: string | null = null,
    ): void {
      assertCubeCopies(maxCopies);
      upsertCard.run(cubeId, catalogCardId, pool, maxCopies, source);
      bump(cubeId);
    },

    removeCard(cubeId: number, catalogCardId: number): void {
      db.prepare("delete from cube_cards where cube_id = ? and catalog_card_id = ?").run(cubeId, catalogCardId);
      bump(cubeId);
    },

    setMaxCopies(cubeId: number, catalogCardId: number, maxCopies: number): void {
      assertCubeCopies(maxCopies);
      db.prepare("update cube_cards set max_copies = ? where cube_id = ? and catalog_card_id = ?").run(
        maxCopies,
        cubeId,
        catalogCardId,
      );
      bump(cubeId);
    },

    async importPasscodes(
      cubeId: number,
      codes: number[],
      opts: { pool?: CubePool } = {},
    ): Promise<{ added: number; unknown: number[] }> {
      return importPasscodeGroups(cubeId, [{ codes, pool: opts.pool }]);
    },

    importPasscodeGroups,

    async seedArchetypeInto(
      cubeId: number,
      archetype: string,
      opts: { banlist?: string; maxCopies?: number } = {},
    ): Promise<{ added: number }> {
      const { main, extra } = await catalog.syncByArchetype(archetype, { banlist: opts.banlist });
      const present = existingCardIds(cubeId);
      const maxCopies = assertCubeCopies(opts.maxCopies ?? DEFAULT_CUBE_COPIES);
      let added = 0;
      for (const card of main) {
        if (!present.has(card.ygoprodeckId)) {
          upsertCard.run(cubeId, card.ygoprodeckId, "main", maxCopies, null);
          present.add(card.ygoprodeckId);
          added += 1;
        }
      }
      for (const card of extra) {
        if (!present.has(card.ygoprodeckId)) {
          upsertCard.run(cubeId, card.ygoprodeckId, "extra", maxCopies, null);
          present.add(card.ygoprodeckId);
          added += 1;
        }
      }
      bump(cubeId);
      return { added };
    },

    analyzeCubePools(cubeId: number, config: AnalyzeCubePoolsConfig): CubeAnalysis {
      const pools = getCubePools(cubeId);
      const errors: string[] = [];
      const warnings: string[] = [];

      const mainSize = pools.main.reduce((sum, c) => sum + c.maxCopies, 0);
      const mainNeeded = requiredPoolSize(config.cardsPerPlayer, config.themePackSize, config.burnUnpicked);
      if (mainSize < mainNeeded) {
        errors.push(
          `Main pool has ${mainSize} cards but needs at least ${mainNeeded} for a ${config.cardsPerPlayer}-card main deck (${config.themePackSize} choices/pick${config.burnUnpicked ? ", burn on" : ""}).`,
        );
      } else {
        // A player never gets more than 3 copies of one card, so a few card names with many copies cannot fill a deck.
        const mainReachable = playerReachableSize(pools.main);
        // Burned choices also spend reachable copies; excess copies above the
        // player cap cannot stand in for the choices needed in later rounds.
        const mainReachableNeeded = mainNeeded;
        if (mainReachable < mainReachableNeeded) {
          errors.push(
            `A player can take at most ${MAX_COPIES_PER_PLAYER} copies of a card, so this main pool gives ${mainReachable} cards but a ${config.cardsPerPlayer}-card main deck needs ${mainReachableNeeded}${config.burnUnpicked ? " including burned choices (burn on)" : ""}. Add more different cards.`,
          );
        }
      }

      if (config.extraDeckEnabled) {
        const extraSize = pools.extra.reduce((sum, c) => sum + c.maxCopies, 0);
        const extraNeeded = requiredPoolSize(config.extraDeckSize, config.themePackSize, config.burnUnpicked);
        if (extraSize < extraNeeded) {
          warnings.push(
            `Extra pool has ${extraSize} cards but needs ${extraNeeded} for a full ${config.extraDeckSize}-card Extra Deck; players may end with fewer Extra cards.`,
          );
        }
      }

      return { ok: errors.length === 0, errors, warnings };
    },

    /** Rename a cube. Centralizes what used to be inline SQL in the web theme route. */
    renameCube(cubeId: number, name: string): { ok: true } | { error: string } {
      const trimmed = name.trim();
      if (!trimmed) {
        return { error: "name is required" };
      }
      const dupe = db
        .prepare(
          "select id from cubes where guild_id = (select guild_id from cubes where id = ?) and name = ? and id != ?",
        )
        .get(cubeId, trimmed, cubeId) as { id: number } | undefined;
      if (dupe) {
        return { error: `A cube named "${trimmed}" already exists` };
      }
      const result = db
        .prepare("update cubes set name = ?, updated_at = ? where id = ?")
        .run(trimmed, new Date().toISOString(), cubeId);
      return result.changes === 0 ? { error: "Cube not found" } : { ok: true };
    },

    /** Delete a cube and its cards. */
    deleteCube(cubeId: number): void {
      db.prepare("delete from cube_cards where cube_id = ?").run(cubeId);
      db.prepare("delete from cubes where id = ?").run(cubeId);
    },

    /**
     * Flatten a cube into a shared-draft config: the cube's own config (pack/mode
     * settings + setNames) merged over `base`, with `customCardIds` unioned from
     * base, the cube's config, and every explicit cube_cards entry (main + extra).
     * Lets a saved cube drive a shared (non-theme) draft through the unchanged
     * resolveCubeCardIds -> buildDeal path.
     */
    applyCubeToConfig(cubeId: number, base: DraftConfig = {}): DraftConfig {
      const cube = findCube(cubeId);
      const pools = getCubePools(cubeId);
      const flat = [...pools.main, ...pools.extra].map((c) => c.catalogCardId);
      const customCardIds = Array.from(
        new Set([...(base.customCardIds ?? []), ...(cube.config.customCardIds ?? []), ...flat]),
      );
      return {
        ...base,
        ...cube.config,
        customCardIds,
        setNames: cube.config.setNames ?? base.setNames,
      };
    },

    getCubePools,

    findCube,

    listCubes(guildId: string): Cube[] {
      return db
        .prepare("select * from cubes where guild_id = ? order by name asc")
        .all(guildId)
        .map(mapCube);
    },

    // ----- Discord draft-template-compatible ops (ported from the bot's
    // draft-template service; identical signatures so bot call sites are unchanged) -----

    save(guildId: string, name: string, config: DraftConfig, createdByUserId: string): Cube {
      const trimmed = name.trim();
      // Saving over an existing cube replaces its draft config but keeps what the cube is for.
      const previous = db.prepare("select config_json from cubes where guild_id = ? and name = ?").get(guildId, trimmed) as
        | { config_json: string | null }
        | undefined;
      if (previous) {
        let old: Record<string, unknown> = {};
        try {
          old = JSON.parse(previous.config_json ?? "{}") as Record<string, unknown>;
        } catch {
          // An unreadable old config has nothing to keep.
        }
        const kept: Record<string, unknown> = {};
        for (const key of CUBE_META_KEYS) if (old[key] !== undefined && !(key in config)) kept[key] = old[key];
        config = { ...kept, ...config };
      }
      db.prepare(
        `
          insert into cubes (guild_id, name, config_json, created_by_user_id)
          values (?, ?, ?, ?)
          on conflict(guild_id, name) do update set
            config_json = excluded.config_json,
            created_by_user_id = excluded.created_by_user_id,
            updated_at = current_timestamp
        `,
      ).run(guildId, trimmed, JSON.stringify(config), createdByUserId);
      const row = db.prepare("select * from cubes where guild_id = ? and name = ?").get(guildId, trimmed);
      return mapCube(row);
    },

    findByName(guildId: string, name: string): Cube | undefined {
      const row = db.prepare("select * from cubes where guild_id = ? and name = ?").get(guildId, name);
      return row ? mapCube(row) : undefined;
    },

    list(guildId: string): Cube[] {
      return db
        .prepare("select * from cubes where guild_id = ? order by name asc")
        .all(guildId)
        .map(mapCube);
    },

    delete(guildId: string, name: string): void {
      db.prepare(
        "delete from cube_cards where cube_id in (select id from cubes where guild_id = ? and name = ?)",
      ).run(guildId, name);
      db.prepare("delete from cubes where guild_id = ? and name = ?").run(guildId, name);
    },
  };
}

export type CubeService = ReturnType<typeof createCubeService>;
