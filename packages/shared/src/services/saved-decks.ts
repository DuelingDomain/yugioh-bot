import type Database from "better-sqlite3";
import type { DuelDeck, DuelMode, SavedDeck } from "../duels/index.js";

const MAX_NAME_LENGTH = 100;
const MAX_SECTION_CARDS = 300;
const UINT32_MAX = 0xffff_ffff;

export class SavedDeckServiceError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SavedDeckServiceError";
    this.status = status;
  }
}

export interface SavedDeckWrite {
  name: unknown;
  mode: unknown;
  deck: unknown;
  /**
   * CONTRACT: a positive draft id marks a deck built from the owner's pool in
   * that draft (stored in saved_decks.draft_id; one per owner per draft, a
   * second create is 409). The caller checks the pool. On update, undefined
   * keeps the stored value.
   */
  draftId?: unknown;
}

export interface SavedDeckService {
  list(guildId: string, ownerUserId: string): SavedDeck[];
  get(id: number, guildId: string, ownerUserId: string): SavedDeck;
  create(guildId: string, ownerUserId: string, input: SavedDeckWrite): SavedDeck;
  update(id: number, guildId: string, ownerUserId: string, input: SavedDeckWrite): SavedDeck;
  delete(id: number, guildId: string, ownerUserId: string): void;
  /** The owner's deck for a draft, or null. */
  findByDraft(guildId: string, ownerUserId: string, draftId: number): SavedDeck | null;
}

type SavedDeckRow = {
  id: number;
  name: string;
  mode: string;
  deck_json: string;
  created_at: string;
  updated_at: string;
  draft_id: number | null;
};

function isDuelMode(value: unknown): value is DuelMode {
  return value === "normal" || value === "domain";
}

function isCardCode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= UINT32_MAX;
}

function assertCardCodes(codes: unknown, label: string): number[] {
  if (!Array.isArray(codes)) {
    throw new SavedDeckServiceError(`${label} must be a list of card codes`, 400);
  }
  if (codes.length > MAX_SECTION_CARDS) {
    throw new SavedDeckServiceError(`${label} must contain at most ${MAX_SECTION_CARDS} cards`, 400);
  }
  for (const code of codes) {
    if (!isCardCode(code)) {
      throw new SavedDeckServiceError(`${label} contains an invalid card code`, 400);
    }
  }
  return codes;
}

function normalizeName(name: unknown): string {
  if (typeof name !== "string") {
    throw new SavedDeckServiceError("Deck name is required", 400);
  }
  const trimmed = name.trim();
  if (!trimmed) {
    throw new SavedDeckServiceError("Deck name is required", 400);
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new SavedDeckServiceError(`Deck name must be at most ${MAX_NAME_LENGTH} characters`, 400);
  }
  return trimmed;
}

function normalizeMode(mode: unknown): DuelMode {
  if (!isDuelMode(mode)) {
    throw new SavedDeckServiceError("Deck mode must be normal or domain", 400);
  }
  return mode;
}

function normalizeDeck(deck: unknown): DuelDeck {
  if (!deck || typeof deck !== "object" || Array.isArray(deck)) {
    throw new SavedDeckServiceError("Deck is required", 400);
  }
  const raw = deck as { main?: unknown; extra?: unknown; side?: unknown; deckMaster?: unknown };
  const normalized: DuelDeck = {
    main: assertCardCodes(raw.main, "Main deck"),
    extra: assertCardCodes(raw.extra, "Extra deck"),
    side: assertCardCodes(raw.side, "Side deck"),
  };
  if (raw.deckMaster !== undefined) {
    if (!isCardCode(raw.deckMaster)) {
      throw new SavedDeckServiceError("Deck Master must be a valid card code", 400);
    }
    normalized.deckMaster = raw.deckMaster;
  }
  return normalized;
}

/** undefined stays undefined (callers decide the default); null clears. */
function normalizeDraftId(draftId: unknown): number | null | undefined {
  if (draftId === undefined || draftId === null) return draftId;
  if (typeof draftId !== "number" || !Number.isInteger(draftId) || draftId < 1) {
    throw new SavedDeckServiceError("Draft id must be a positive integer", 400);
  }
  return draftId;
}

/** Maps a failed write on saved_decks.draft_id to an API status. */
function rethrowDraftConstraint(error: unknown): never {
  const code = (error as { code?: string } | null)?.code;
  if (code === "SQLITE_CONSTRAINT_UNIQUE") {
    throw new SavedDeckServiceError("You already have a deck for this draft", 409);
  }
  if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    throw new SavedDeckServiceError("Draft not found", 404);
  }
  throw error;
}

function mapSavedDeck(row: SavedDeckRow): SavedDeck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.deck_json);
  } catch {
    throw new SavedDeckServiceError("Saved deck is corrupt", 500);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SavedDeckServiceError("Saved deck is corrupt", 500);
  }
  const deck = parsed as DuelDeck;
  if (!Array.isArray(deck.main) || !Array.isArray(deck.extra) || !Array.isArray(deck.side)) {
    throw new SavedDeckServiceError("Saved deck is corrupt", 500);
  }
  if (!isDuelMode(row.mode)) {
    throw new SavedDeckServiceError("Saved deck is corrupt", 500);
  }
  const mapped: DuelDeck = { main: deck.main, extra: deck.extra, side: deck.side };
  if (deck.deckMaster !== undefined) mapped.deckMaster = deck.deckMaster;
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    deck: mapped,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    draftId: row.draft_id ?? null,
  };
}

export function createSavedDeckService(db: Database.Database): SavedDeckService {
  const selectOwned = db.prepare<[number, string, string], SavedDeckRow>(
    `select id, name, mode, deck_json, created_at, updated_at, draft_id
     from saved_decks
     where id = ? and guild_id = ? and owner_user_id = ?`,
  );
  const selectList = db.prepare<[string, string], SavedDeckRow>(
    `select id, name, mode, deck_json, created_at, updated_at, draft_id
     from saved_decks
     where guild_id = ? and owner_user_id = ?
     order by updated_at desc, id desc`,
  );
  const insertRow = db.prepare(
    `insert into saved_decks (guild_id, owner_user_id, name, mode, deck_json, draft_id)
     values (?, ?, ?, ?, ?, ?)`,
  );
  const updateRow = db.prepare(
    `update saved_decks
     set name = ?, mode = ?, deck_json = ?, draft_id = ?, updated_at = current_timestamp
     where id = ? and guild_id = ? and owner_user_id = ?`,
  );
  const selectByDraft = db.prepare<[string, string, number], SavedDeckRow>(
    `select id, name, mode, deck_json, created_at, updated_at, draft_id
     from saved_decks
     where guild_id = ? and owner_user_id = ? and draft_id = ?`,
  );
  // A deck linked to a draft counts as that player's draft deck: a later delete is not undone
  // by the backfill (see draft_players.deck_saved_at).
  const markDraftDeckSaved = db.prepare<[number, string, string]>(
    `update draft_players set deck_saved_at = current_timestamp
     where draft_id = ? and deck_saved_at is null
       and player_id in (select id from players where guild_id = ? and discord_user_id = ?)`,
  );
  const deleteRow = db.prepare(
    `delete from saved_decks where id = ? and guild_id = ? and owner_user_id = ?`,
  );

  const loadOwned = (id: number, guildId: string, ownerUserId: string): SavedDeck => {
    const row = selectOwned.get(id, guildId, ownerUserId);
    if (!row) throw new SavedDeckServiceError("Deck not found", 404);
    return mapSavedDeck(row);
  };

  return {
    list(guildId: string, ownerUserId: string): SavedDeck[] {
      return selectList.all(guildId, ownerUserId).map(mapSavedDeck);
    },

    get(id: number, guildId: string, ownerUserId: string): SavedDeck {
      return loadOwned(id, guildId, ownerUserId);
    },

    create(guildId: string, ownerUserId: string, input: SavedDeckWrite): SavedDeck {
      const name = normalizeName(input.name);
      const mode = normalizeMode(input.mode);
      const deck = normalizeDeck(input.deck);
      const draftId = normalizeDraftId(input.draftId) ?? null;
      let result;
      try {
        result = insertRow.run(guildId, ownerUserId, name, mode, JSON.stringify(deck), draftId);
      } catch (error) {
        rethrowDraftConstraint(error);
      }
      if (draftId !== null) markDraftDeckSaved.run(draftId, guildId, ownerUserId);
      return loadOwned(Number(result.lastInsertRowid), guildId, ownerUserId);
    },

    update(id: number, guildId: string, ownerUserId: string, input: SavedDeckWrite): SavedDeck {
      const existing = loadOwned(id, guildId, ownerUserId);
      const name = normalizeName(input.name);
      const mode = normalizeMode(input.mode);
      const deck = normalizeDeck(input.deck);
      const draftId = normalizeDraftId(input.draftId);
      try {
        updateRow.run(
          name,
          mode,
          JSON.stringify(deck),
          draftId === undefined ? (existing.draftId ?? null) : draftId,
          id,
          guildId,
          ownerUserId,
        );
      } catch (error) {
        rethrowDraftConstraint(error);
      }
      const linkedDraftId = draftId === undefined ? (existing.draftId ?? null) : draftId;
      if (linkedDraftId !== null) markDraftDeckSaved.run(linkedDraftId, guildId, ownerUserId);
      return loadOwned(id, guildId, ownerUserId);
    },

    delete(id: number, guildId: string, ownerUserId: string): void {
      const result = deleteRow.run(id, guildId, ownerUserId);
      if (result.changes === 0) {
        throw new SavedDeckServiceError("Deck not found", 404);
      }
    },

    findByDraft(guildId: string, ownerUserId: string, draftId: number): SavedDeck | null {
      const row = selectByDraft.get(guildId, ownerUserId, draftId);
      return row ? mapSavedDeck(row) : null;
    },
  };
}

