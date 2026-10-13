import { assertExtraDeckCards, ExtraDeckCardError, isExtraDeckCard, type DeckSectionMove } from "../duels/extra-deck.js";
import { createDeckTypeLookup, hasKnownDeckCardType } from "./deck-sections.js";
import type { CardIdentityCatalog } from "../duels/pool.js";
import type Database from "better-sqlite3";
import type { DuelDeck, DuelMode, SavedDeck } from "../duels/index.js";

const MAX_NAME_LENGTH = 100;
const MAX_SECTION_CARDS = 300;
const UINT32_MAX = 0xffff_ffff;

export class SavedDeckServiceError extends Error {
  readonly status: number;

  constructor(message: string, status: number, readonly code?: string) {
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
  list(guildId: string, ownerUserId: number): SavedDeck[];
  get(id: number, guildId: string, ownerUserId: number): SavedDeck;
  create(guildId: string, ownerUserId: number, input: SavedDeckWrite): SavedDeck;
  update(id: number, guildId: string, ownerUserId: number, input: SavedDeckWrite): SavedDeck;
  delete(id: number, guildId: string, ownerUserId: number): void;
  /** The owner's deck for a draft, or null. */
  findByDraft(guildId: string, ownerUserId: number, draftId: number): SavedDeck | null;
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

/** Validate storage rules without a write, so previews and saves use the same limits. */
export function validateSavedDeckWrite(input: SavedDeckWrite): { name: string; mode: DuelMode; deck: DuelDeck } {
  return { name: normalizeName(input.name), mode: normalizeMode(input.mode), deck: normalizeDeck(input.deck) };
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
  const deck = parsed as DuelDeck & { extraDeckRepair?: SavedDeck["extraDeckRepair"] };
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
    ...(deck.extraDeckRepair ? { extraDeckRepair: deck.extraDeckRepair } : {}),
  };
}

export function createSavedDeckService(db: Database.Database, engine?: CardIdentityCatalog): SavedDeckService {
  const findCard = createDeckTypeLookup(db, engine);
  const validateExtra = (deck: DuelDeck) => {
    try { assertExtraDeckCards(deck, findCard.snapshot()); }
    catch (error) {
      if (error instanceof ExtraDeckCardError) throw new SavedDeckServiceError(error.message, error.status, error.code);
      throw error;
    }
  };
  // Inspect without a lock. Unknown codes stay put until type evidence is available.
  const inspectRow = (row: SavedDeckRow, lookup: ReturnType<typeof findCard.snapshot>): { saved: SavedDeck; repairedJson?: string } => {
    const saved = mapSavedDeck(row);
    const cards = new Map([...new Set(saved.deck.extra)].map(code => [code, lookup(code)]));
    const extra: number[] = [];
    const moves: DeckSectionMove[] = [];
    for (const code of saved.deck.extra) {
      const card = cards.get(code);
      if (hasKnownDeckCardType(card) && !isExtraDeckCard(card)) {
        moves.push({ code, name: card?.name ?? `card ${code}`, from: "extra", to: "main" });
      } else extra.push(code);
    }
    if (!moves.length) return { saved };
    const mainCount = saved.deck.main.length + moves.length;
    const applied = mainCount <= MAX_SECTION_CARDS;
    const count = `${moves.length} ${moves.length === 1 ? "card" : "cards"}`;
    const message = applied
      ? `${count} moved from Extra Deck to Main Deck.${mainCount > 60 ? ` Main Deck now has ${mainCount} cards; trim it to 60 or fewer before playing.` : ""}`
      : `${count} in Extra Deck belong in Main Deck. Moving them would make ${mainCount} Main cards, above the ${MAX_SECTION_CARDS}-card save limit. Move cards to Side Deck or remove cards before saving.`;
    saved.extraDeckRepair = { applied, moves, mainCount, message };
    if (!applied) return { saved };
    saved.deck = { ...saved.deck, main: [...saved.deck.main, ...moves.map(move => move.code)], extra };
    return { saved, repairedJson: JSON.stringify({ ...JSON.parse(row.deck_json), ...saved.deck, extraDeckRepair: saved.extraDeckRepair }) };
  };
  const selectOwned = db.prepare<[number, string, number], SavedDeckRow>(
    `select id, name, mode, deck_json, created_at, updated_at, draft_id
     from saved_decks
     where id = ? and guild_id = ? and owner_user_id = ?`,
  );
  const selectList = db.prepare<[string, number], SavedDeckRow>(
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
  const selectByDraft = db.prepare<[string, number, number], SavedDeckRow>(
    `select id, name, mode, deck_json, created_at, updated_at, draft_id
     from saved_decks
     where guild_id = ? and owner_user_id = ? and draft_id = ?`,
  );
  // A deck linked to a draft counts as that player's draft deck: a later delete is not undone
  // by the backfill (see draft_players.deck_saved_at).
  const markDraftDeckSaved = db.prepare<[number, string, number]>(
    `update draft_players set deck_saved_at = current_timestamp
     where draft_id = ? and deck_saved_at is null
       and player_id in (select id from players where guild_id = ? and user_id = ?)`,
  );
  const deleteRow = db.prepare(
    `delete from saved_decks where id = ? and guild_id = ? and owner_user_id = ?`,
  );

  const guardedRepair = db.prepare("update saved_decks set deck_json = ? where id = ? and deck_json = ?");
  const repairRow = (row: SavedDeckRow, lookup: ReturnType<typeof findCard.snapshot>): SavedDeck => {
    const { saved, repairedJson } = inspectRow(row, lookup);
    if (repairedJson !== undefined) {
      const result = guardedRepair.run(repairedJson, row.id, row.deck_json);
      if (result.changes !== 1) throw new SavedDeckServiceError("Deck changed during repair; read it again", 409);
      console.info(`[saved-decks] Moved ${saved.extraDeckRepair!.moves.length} Extra cards to Main.`);
    }
    return saved;
  };
  const loadOwned = (id: number, guildId: string, ownerUserId: number): SavedDeck => {
    const row = selectOwned.get(id, guildId, ownerUserId);
    if (!row) throw new SavedDeckServiceError("Deck not found", 404);
    const lookup = findCard.snapshot();
    const inspection = inspectRow(row, lookup);
    if (inspection.repairedJson === undefined) return inspection.saved;
    return db.transaction(() => {
      const current = selectOwned.get(id, guildId, ownerUserId);
      if (!current) throw new SavedDeckServiceError("Deck not found", 404);
      return repairRow(current, lookup);
    }).immediate();
  };

  return {
    list(guildId: string, ownerUserId: number): SavedDeck[] {
      const lookup = findCard.snapshot();
      const inspections = selectList.all(guildId, ownerUserId).map(row => inspectRow(row, lookup));
      if (inspections.every(result => result.repairedJson === undefined)) return inspections.map(result => result.saved);
      return db.transaction(() => selectList.all(guildId, ownerUserId).map(row => repairRow(row, lookup))).immediate();
    },

    get(id: number, guildId: string, ownerUserId: number): SavedDeck {
      return loadOwned(id, guildId, ownerUserId);
    },

    create(guildId: string, ownerUserId: number, input: SavedDeckWrite): SavedDeck {
      const { name, mode, deck } = validateSavedDeckWrite(input);
      validateExtra(deck);
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

    update(id: number, guildId: string, ownerUserId: number, input: SavedDeckWrite): SavedDeck {
      const existing = loadOwned(id, guildId, ownerUserId);
      const { name, mode, deck } = validateSavedDeckWrite(input);
      validateExtra(deck);
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

    delete(id: number, guildId: string, ownerUserId: number): void {
      const result = deleteRow.run(id, guildId, ownerUserId);
      if (result.changes === 0) {
        throw new SavedDeckServiceError("Deck not found", 404);
      }
    },

    findByDraft(guildId: string, ownerUserId: number, draftId: number): SavedDeck | null {
      const row = selectByDraft.get(guildId, ownerUserId, draftId);
      if (!row) return null;
      const lookup = findCard.snapshot();
      const inspection = inspectRow(row, lookup);
      if (inspection.repairedJson === undefined) return inspection.saved;
      return db.transaction(() => {
        const current = selectByDraft.get(guildId, ownerUserId, draftId);
        return current ? repairRow(current, lookup) : null;
      }).immediate();
    },
  };
}
