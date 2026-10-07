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
  copyLimit?: boolean;
}

/** Fully resolved catalog entries; network resolution happens before the cube transaction. */
export interface CubeImportEntry {
  id: number;
  copies: number;
  pool?: CubePool;
}

function requiredPoolSize(rounds: number, themePackSize: number, burnUnpicked: boolean): number {
  return burnUnpicked ? rounds * themePackSize : rounds + (themePackSize - 1);
}

/** Count authored copies and copies reachable under the combined artwork cap. */
export function cubePoolSizes(db: Database.Database, cubeId: number, pool: CubePool): { size: number; reachable: number } {
  return db.prepare(`
    select coalesce(sum(copies), 0) as size,
           coalesce(sum(min(copies, ${MAX_COPIES_PER_PLAYER})), 0) as reachable
    from (
      select sum(tc.max_copies) as copies
      from cube_cards tc
      left join card_catalog cc on cc.ygoprodeck_id = tc.catalog_card_id
      where tc.cube_id = ? and tc.pool = ?
      group by lower(trim(cc.name)), cc.type,
               case when cc.ygoprodeck_id is null then tc.catalog_card_id end
    )
  `).get(cubeId, pool) as { size: number; reachable: number };
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

/** A cube in the guild already has this name, ignoring case. */
export class CubeNameTakenError extends Error {
  constructor(name: string) {
    super(`A cube named "${name}" already exists`);
    this.name = "CubeNameTakenError";
  }
}

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
      if (cards.has(id) && catalog.hasCatalogRow(id)) continue;
      let card: Card | undefined;
      try {
        card = await catalog.syncCardById(id);
      } catch (error) {
        // YGOPRODeck answers HTTP 400 for a passcode it does not have. A lost connection is
        // different: stop, and nothing has been written yet.
        if (error instanceof Error && error.message.startsWith("Could not reach the card database")) throw error;
      }
      if (card && catalog.hasCatalogRow(id)) cards.set(id, card);
      else if (!cards.has(id)) unknown.push(id);
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
    /** Add copies atomically, reading existing totals inside the write transaction. */
    importResolvedCards(cubeId: number, entries: readonly CubeImportEntry[]): { added: number; copies: number } {
      return db.transaction(() => {
        const cube = findCube(cubeId);
        if (entries.length === 0) return { added: 0, copies: 0 };
        const cards = new Map(catalog.findByIds(entries.map((e) => e.id)).map((card) => [card.ygoprodeckId, card]));
        const totals = new Map<number, { copies: number; pool: CubePool }>();
        for (const { id, copies, pool } of entries) {
          assertCubeCopies(copies);
          const card = cards.get(id);
          if (!card || !catalog.hasCatalogRow(id)) throw new Error(`Card ${id} is missing from the catalog`);
          const previous = totals.get(id);
          totals.set(id, {
            copies: Math.min(MAX_CUBE_COPIES, (previous?.copies ?? 0) + copies),
            pool: pool === "extra" || previous?.pool === "extra" || isExtraDeckFrame(card) ? "extra" : "main",
          });
        }
        const pools = getCubePools(cubeId);
        const existing = new Map([...pools.main, ...pools.extra]
          .map((entry) => [entry.catalogCardId, entry.maxCopies]));
        // Config-listed IDs override pool rows when the cube drives a booster draft.
        // Move affected IDs to cube_cards so the new totals are visible to both readers.
        const configured = new Map<number, number>();
        for (const id of cube.config.customCardIds ?? []) configured.set(id, (configured.get(id) ?? 0) + 1);
        for (const [id, count] of configured) {
          if (!totals.has(id)) continue;
          // Legacy configs may exceed the row cap. Preserve them on error instead of discarding copies.
          assertCubeCopies(count);
          existing.set(id, count);
        }
        let gained = 0;
        for (const [id, entry] of totals) {
          const before = existing.get(id) ?? 0;
          const total = Math.min(MAX_CUBE_COPIES, before + entry.copies);
          upsertCard.run(cubeId, id, entry.pool, total, null);
          gained += total - before;
        }
        if ([...configured.keys()].some((id) => totals.has(id))) {
          const config = { ...cube.config, customCardIds: cube.config.customCardIds!.filter((id) => !totals.has(id)) };
          db.prepare("update cubes set config_json = ? where id = ?").run(JSON.stringify(config), cubeId);
        }
        bump(cubeId);
        return { added: totals.size, copies: gained };
      })();
    },

    /** Subtract authored copies from the requested pools in one transaction. Missing rows are harmless. */
    subtractCards(cubeId: number, entries: readonly (CubeImportEntry & { pool: CubePool })[]): void {
      if (!Array.isArray(entries)) throw new Error("entries must be a list");
      if (entries.length > 1000) throw new Error("Subtract at most 1000 entries at a time");
      for (const entry of entries) {
        if (!entry || !Number.isSafeInteger(entry.id) || entry.id <= 0) throw new Error("Each entry needs a valid id");
        assertCubeCopies(entry.copies);
        if (entry.pool !== "main" && entry.pool !== "extra") throw new Error("Each entry needs a main or extra pool");
      }
      db.transaction(() => {
        findCube(cubeId);
        const find = db.prepare("select max_copies from cube_cards where cube_id = ? and catalog_card_id = ? and pool = ?");
        const remove = db.prepare("delete from cube_cards where cube_id = ? and catalog_card_id = ? and pool = ?");
        const update = db.prepare("update cube_cards set max_copies = ? where cube_id = ? and catalog_card_id = ? and pool = ?");
        for (const { id, copies, pool } of entries) {
          const row = find.get(cubeId, id, pool) as { max_copies: number } | undefined;
          if (!row) continue;
          const remaining = Math.max(0, row.max_copies - copies);
          if (remaining === 0) remove.run(cubeId, id, pool);
          else update.run(remaining, cubeId, id, pool);
        }
        if (entries.length > 0) bump(cubeId);
      })();
    },

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

    /**
     * Create a cube with its cards in one transaction. `entries` hold distinct catalog ids
     * (all in card_catalog); Extra Deck frames go to the extra pool. `copyExtraFromCubeId`
     * copies that cube's extra-pool rows (ids and max copies) too.
     */
    createWithCards(
      guildId: string,
      name: string,
      createdByUserId: string,
      entries: CubeImportEntry[],
      opts: { copyExtraFromCubeId?: number } = {},
    ): Cube {
      return db.transaction(() => {
        // Checked here, inside the write, so two saves of the same name cannot both pass an earlier check.
        const clash = db.prepare("select 1 from cubes where guild_id = ? and lower(name) = lower(?)").get(guildId, name);
        if (clash) throw new CubeNameTakenError(name);
        const cubeId = insertCubeRow(guildId, name, createdByUserId, null, null);
        const cards = new Map(catalog.findByIds(entries.map((e) => e.id)).map((c) => [c.ygoprodeckId, c]));
        for (const { id, copies, pool } of entries) {
          const card = cards.get(id);
          if (!card) continue;
          upsertCard.run(cubeId, id, pool === "extra" || isExtraDeckFrame(card) ? "extra" : "main", assertCubeCopies(copies), null);
        }
        if (opts.copyExtraFromCubeId !== undefined) {
          const rows = db
            .prepare(
              `select cc.catalog_card_id, cc.max_copies from cube_cards cc
                 join cubes c on c.id = cc.cube_id
                where cc.cube_id = ? and cc.pool = 'extra' and c.guild_id = ? order by cc.rowid asc`,
            )
            .all(opts.copyExtraFromCubeId, guildId) as Array<{ catalog_card_id: number; max_copies: number }>;
          for (const r of rows) upsertCard.run(cubeId, r.catalog_card_id, "extra", r.max_copies, null);
        }
        bump(cubeId);
        return findCube(cubeId);
      })();
    },

    /**
     * Replace a cube's main pool. Extra-pool rows stay. Extra Deck frames in `entries` are
     * ignored (counted in `skippedExtra`); ids not in card_catalog are returned in `unknownIds`.
     * Drops `customCardIds` from the cube's config so a legacy config-backed pool is not double counted.
     */
    replaceMain(
      cubeId: number,
      entries: Array<{ id: number; copies: number }>,
    ): { skippedExtra: number; unknownIds: number[] } {
      findCube(cubeId);
      for (const e of entries) assertCubeCopies(e.copies);
      const cards = new Map(catalog.findByIds(entries.map((e) => e.id)).map((c) => [c.ygoprodeckId, c]));
      let skippedExtra = 0;
      const unknownIds: number[] = [];
      db.transaction(() => {
        db.prepare("delete from cube_cards where cube_id = ? and pool = 'main'").run(cubeId);
        for (const { id, copies } of entries) {
          const card = cards.get(id);
          if (!card) {
            unknownIds.push(id);
            continue;
          }
          if (isExtraDeckFrame(card)) {
            skippedExtra += 1;
            continue;
          }
          // A card already in the extra pool keeps that row; a main card never replaces it.
          db.prepare(
            `insert into cube_cards (cube_id, catalog_card_id, pool, max_copies, source)
             values (?, ?, 'main', ?, null)
             on conflict (cube_id, catalog_card_id) do nothing`,
          ).run(cubeId, id, copies);
        }
        const row = db.prepare("select config_json from cubes where id = ?").get(cubeId) as { config_json: string | null };
        let config: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(row.config_json ?? "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
        } catch {
          // unreadable config: nothing to keep
        }
        // The replaced main pool already holds the expanded set cards; keeping setNames would bring removed ones back.
        if ("customCardIds" in config || "setNames" in config) {
          delete config.customCardIds;
          delete config.setNames;
          db.prepare("update cubes set config_json = ? where id = ?").run(JSON.stringify(config), cubeId);
        }
        bump(cubeId);
      })();
      return { skippedExtra, unknownIds };
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
      const errors: string[] = [];
      const warnings: string[] = [];

      const { size: mainSize, reachable: mainReachable } = cubePoolSizes(db, cubeId, "main");
      const mainNeeded = requiredPoolSize(config.cardsPerPlayer, config.themePackSize, config.burnUnpicked);
      if (mainSize < mainNeeded) {
        errors.push(
          `Main pool has ${mainSize} cards but needs at least ${mainNeeded} for a ${config.cardsPerPlayer}-card main deck (${config.themePackSize} choices/pick${config.burnUnpicked ? ", burn on" : ""}).`,
        );
      } else {
        // A player never gets more than 3 copies of one card, so a few card names with many copies cannot fill a deck.
        // Burned choices also spend reachable copies; excess copies above the
        // player cap cannot stand in for the choices needed in later rounds.
        const mainReachableNeeded = mainNeeded;
        if (mainReachable < mainReachableNeeded) {
          (config.copyLimit === false ? warnings : errors).push(
            `A player can take at most ${MAX_COPIES_PER_PLAYER} copies of a card, so this main pool gives ${mainReachable} cards but a ${config.cardsPerPlayer}-card main deck needs ${mainReachableNeeded}${config.burnUnpicked ? " including burned choices (burn on)" : ""}. Add more different cards.`,
          );
        }
      }

      if (config.extraDeckEnabled) {
        const { size: extraSize, reachable: extraReachable } = cubePoolSizes(db, cubeId, "extra");
        const extraNeeded = requiredPoolSize(config.extraDeckSize, config.themePackSize, config.burnUnpicked);
        if (extraSize < extraNeeded || extraReachable < extraNeeded) {
          warnings.push(
            `Extra pool has ${Math.min(extraSize, extraReachable)} cards but needs ${extraNeeded} for a full ${config.extraDeckSize}-card Extra Deck; players may end with fewer Extra cards.`,
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
     * settings + setNames) merged over `base`. Preserve every custom copy in base
     * and the cube config, then add Main pool copies not already listed there.
     * Lets a saved cube drive a shared (non-theme) draft through the unchanged
     * resolveCubeCardIds -> buildDeal path.
     */
    applyCubeToConfig(cubeId: number, base: DraftConfig = {}): DraftConfig {
      const cube = findCube(cubeId);
      const pools = getCubePools(cubeId);
      const listedIds = [...(base.customCardIds ?? []), ...(cube.config.customCardIds ?? [])];
      const listed = new Set(listedIds);
      const flat = pools.main.filter((card) => !listed.has(card.catalogCardId))
        .flatMap((card) => Array<number>(card.maxCopies).fill(card.catalogCardId));
      const customCardIds = [...listedIds, ...flat];
      const listedExtraIds = [...(base.customExtraCardIds ?? []), ...(cube.config.customExtraCardIds ?? [])];
      const listedExtra = new Set(listedExtraIds);
      const customExtraCardIds = [...listedExtraIds, ...pools.extra.filter((card) => !listedExtra.has(card.catalogCardId))
        .flatMap((card) => Array<number>(card.maxCopies).fill(card.catalogCardId))];
      return {
        ...base,
        ...cube.config,
        customCardIds,
        customExtraCardIds,
        preservePoolCopies: true,
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
