import type Database from "better-sqlite3";
import { generateWebSlug } from "../util/web-slug.js";
import type {
  DuelActorRole,
  DuelBestOf,
  DuelClockState,
  DuelCommand,
  DuelDeck,
  DuelEngineView,
  DuelFirstChoice,
  DuelHistoryScope,
  DuelListItem,
  DuelMasterRule,
  DuelMode,
  DuelRoom,
  DuelRpsMove,
  DuelSeat,
  DuelSession,
  DuelSettings,
  DuelStatus,
} from "../duels/index.js";
import {
  clockWithServerNow,
  DuelSettingsError,
  normalizeDuelClockState,
  normalizeDuelSettings,
  parseStoredDuelClock,
  parseStoredDuelSettings,
} from "../duels/settings.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
// duel-series.ts imports this module too; see the note there about the cycle.
import { createSeriesStore } from "./duel-series.js";
import {
  newOpening,
  openingNeedsSwap,
  openingView,
  parseOpening,
  settleOpening,
  submitOpeningChoice,
  submitOpeningPick,
  swapOpeningSeats,
  DuelOpeningError,
  type DuelOpeningState,
} from "../duels/opening.js";

const MAX_SEATS = 2;
const MIN_MAIN = 40;
const MAX_MAIN = 60;
const MAX_EXTRA = 15;
const MAX_SIDE = 15;
export const PRACTICE_BOT_NAME = "Practice Bot";
const ARCHIVE_DUE_CAP = 32;
const CLOCK_DUE_CAP = 32;
const HISTORY_LIMIT = 100;
/** Other players' active duels stay in Live tables this long after their last accepted input. */
export const DUEL_LIVE_IDLE_AFTER_MS = 15 * 60 * 1000;

function isTerminalStatus(status: string): status is DuelStatus {
  return status === "completed" || status === "interrupted" || status === "cancelled";
}

export function isDuelMasterRule(value: unknown): value is DuelMasterRule {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function resolveMasterRule(_mode: DuelMode, value: unknown): DuelMasterRule {
  const rule = value === undefined ? 5 : value;
  if (!isDuelMasterRule(rule)) {
    throw new DuelServiceError("Master rule must be 1, 2, 3, 4, or 5", 400);
  }
  return rule;
}

export class DuelServiceError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DuelServiceError";
    this.status = status;
  }
}

export interface DuelPrivateState {
  session: DuelSession;
  decks: DuelDeck[];
  seed: string[] | null;
  bundleVersion: string | null;
  commands: Array<{ seat: number; command: DuelCommand }>;
  clock: DuelClockState | null;
}

export interface DuelFinalSnapshots {
  public: DuelEngineView;
  seat0: DuelEngineView;
  seat1: DuelEngineView;
}

export interface DuelService {
  create(input: {
    guildId: string;
    organizerPlayerId: number;
    name: string;
    mode: DuelMode;
    masterRule?: DuelMasterRule;
    settings?: unknown;
    /** Open table match options; default Best of 1, unranked. CONTRACT: stored in duels.best_of / duels.ranked. */
    bestOf?: DuelBestOf;
    ranked?: boolean;
  }): DuelSession;
  list(
    guildId: string,
    playerId: number,
    options?: { archived?: boolean; scope?: DuelHistoryScope; idleAfterMs?: number },
  ): DuelListItem[];
  get(slug: string, guildId: string): DuelSession;
  /** Enters as a spectator; an existing player's seat is preserved. */
  join(slug: string, guildId: string, playerId: number): DuelSession;
  /** Claims an open human seat before any opening or series has started. Defaults to the first open seat. */
  takeSeat(slug: string, guildId: string, playerId: number, seat?: number): DuelSession;
  leave(slug: string, guildId: string, playerId: number): DuelSession;
  addPracticeBot(slug: string, guildId: string, organizerPlayerId: number, deck: DuelDeck): DuelSession;
  /** Takes the practice bot out of its seat (organizer only, lobby only) so a human can sit there. */
  removePracticeBot(slug: string, guildId: string, organizerPlayerId: number): DuelSession;
  setDeck(slug: string, guildId: string, playerId: number, deck: DuelDeck): DuelSession;
  room(slug: string, guildId: string, playerId: number): DuelRoom;
  privateState(slug: string, guildId: string): DuelPrivateState;
  /**
   * Marks a seated player ready with the deck already in the seat (a
   * tournament game preloads the registered deck). CONTRACT: implemented by
   * the series work; the stub throws.
   */
  markReady(slug: string, guildId: string, playerId: number): DuelSession;
  /**
   * `organizerPlayerId` null means a system start by the duel host. CONTRACT:
   * null is allowed only for a series game (duels.series_id set).
   */
  activate(
    slug: string,
    guildId: string,
    organizerPlayerId: number | null,
    seed: string[],
    bundleVersion: string,
    clock: DuelClockState | null,
  ): DuelSession;
  recordCommand(slug: string, guildId: string, seat: number, command: DuelCommand, clock: DuelClockState | null): void;
  complete(
    slug: string,
    guildId: string,
    winnerSeat: number | null,
    reason: string,
    snapshots?: DuelFinalSnapshots,
  ): DuelSession;
  interrupt(slug: string, guildId: string, reason: string, snapshots?: DuelFinalSnapshots): DuelSession;
  cancel(slug: string, guildId: string, organizerPlayerId: number): DuelSession;
  archive(slug: string, guildId: string, organizerPlayerId: number): DuelSession;
  archiveDue(limit: number, archiveAfterMs: number): DuelSession[];
  admit(slug: string, guildId: string, playerId: number, inviteCode: string): void;
  setClock(slug: string, guildId: string, clock: DuelClockState | null): void;
  dueClocks(now: number, limit: number): Array<{ slug: string; guildId: string }>;
  /**
   * Starts the rock-paper-scissors opening of a lobby duel with two ready seats. Idempotent while an
   * opening exists. `actorPlayerId` is the player who pressed Start: the organizer of an open table, or a
   * seated player of a match game.
   */
  startOpening(slug: string, guildId: string, actorPlayerId: number, at: number): DuelOpeningState;
  /** The stored opening of a duel, or null. Private: it holds the hidden picks. */
  openingState(slug: string, guildId: string): DuelOpeningState | null;
  /** A pick of one seat (a player or the practice bot). Final once made. */
  submitOpeningPick(slug: string, guildId: string, seat: number, move: DuelRpsMove, at: number): DuelOpeningState;
  /** The winner's choice. When it ends the opening, the seats are in their final order. */
  submitOpeningChoice(slug: string, guildId: string, seat: number, choice: DuelFirstChoice, at: number): DuelOpeningState;
  /** Applies the timeouts: random picks, and "go first" for a winner who did not choose. */
  settleOpening(slug: string, guildId: string, at: number, random?: () => number): DuelOpeningState | null;
  /**
   * Drops the opening of a lobby duel, so decks, seats and the bot can change again. The host uses it when the
   * duel failed to start after the opening. Seats keep the order the opening gave them.
   */
  abortOpening(slug: string, guildId: string): void;
  /** Duels whose opening phase has timed out, or whose settled opening still waits for the duel to start. */
  dueOpenings(now: number, limit: number): Array<{ slug: string; guildId: string }>;
}

type DuelRow = {
  id: number;
  guild_id: string;
  web_slug: string;
  name: string;
  organizer_player_id: number;
  mode: string;
  master_rule: number;
  status: string;
  seed_json: string | null;
  bundle_version: string | null;
  created_at: string;
  ended_at: string | null;
  archived_at: string | null;
  last_activity_at: string | null;
  winner_player_id: number | null;
  winner_seat: number | null;
  result_reason: string | null;
  snapshot_public_json: string | null;
  snapshot_seat0_json: string | null;
  snapshot_seat1_json: string | null;
  settings_json: string | null;
  clock_json: string | null;
  invite_code: string | null;
  series_id: number | null;
  game_number: number | null;
  best_of: number;
  ranked: number;
  opening_json: string | null;
};


type DuelListItemRow = DuelRow & { my_seat: number | null };

type SeatRow = {
  seat: number;
  player_id: number | null;
  is_bot: number;
  display_name: string | null;
  ready: number;
  deck_json: string | null;
};

function isConstraintError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return String(error.code).startsWith("SQLITE_CONSTRAINT");
}

export function isDuelMode(value: string): value is DuelMode {
  return value === "normal" || value === "domain";
}

function isDuelStatus(value: string): value is DuelStatus {
  return value === "lobby" || value === "active" || value === "completed" || value === "interrupted" || value === "cancelled";
}

function emptyDeck(): DuelDeck {
  return { main: [], extra: [], side: [] };
}

function assertCardCodes(codes: unknown, label: string, min: number, max: number): number[] {
  if (!Array.isArray(codes)) {
    throw new DuelServiceError(`${label} must be a list of card codes`, 400);
  }
  if (codes.length < min || codes.length > max) {
    throw new DuelServiceError(`${label} must contain between ${min} and ${max} cards`, 400);
  }
  const parsed: number[] = [];
  for (const code of codes) {
    if (typeof code !== "number" || !Number.isInteger(code) || code < 1) {
      throw new DuelServiceError(`${label} contains an invalid card code`, 400);
    }
    parsed.push(code);
  }
  return parsed;
}

export function validateDuelDeckShape(deck: DuelDeck, competitive: boolean): DuelDeck {
  const mainMin = competitive ? MIN_MAIN : 0;
  const main = assertCardCodes(deck.main, "Main deck", mainMin, MAX_MAIN);
  const extra = assertCardCodes(deck.extra, "Extra deck", 0, MAX_EXTRA);
  const side = assertCardCodes(deck.side, "Side deck", 0, MAX_SIDE);
  const normalized: DuelDeck = { main, extra, side };
  if (deck.deckMaster !== undefined) {
    if (!Number.isInteger(deck.deckMaster) || deck.deckMaster < 1) {
      throw new DuelServiceError("Deck Master must be a valid card code", 400);
    }
    normalized.deckMaster = deck.deckMaster;
  }
  return normalized;
}

function parseDeck(raw: string | null): DuelDeck | null {
  if (!raw) return null;
  let parsed: DuelDeck;
  try {
    parsed = JSON.parse(raw) as DuelDeck;
  } catch {
    throw new DuelServiceError("Saved duel deck is corrupt", 500);
  }
  if (!parsed || !Array.isArray(parsed.main) || !Array.isArray(parsed.extra) || !Array.isArray(parsed.side)) {
    throw new DuelServiceError("Saved duel deck is corrupt", 500);
  }
  return parsed;
}

function parseSeed(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const seed: string[] = [];
    for (const value of parsed) {
      if (typeof value !== "string") return null;
      seed.push(value);
    }
    return seed;
  } catch {
    return null;
  }
}

function parseEngineView(raw: string | null): DuelEngineView | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DuelEngineView;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.seats)) return null;
    return { ...parsed, prompt: null };
  } catch {
    return null;
  }
}

function freezeSnapshot(view: DuelEngineView, result: { winnerSeat: number | null; reason: string }): string {
  const frozen: DuelEngineView = { ...view, prompt: null, result };
  return JSON.stringify(frozen);
}

function snapshotForRole(row: DuelRow, mySeat: number | null): DuelEngineView | null {
  if (mySeat === 0) return parseEngineView(row.snapshot_seat0_json);
  if (mySeat === 1) return parseEngineView(row.snapshot_seat1_json);
  return parseEngineView(row.snapshot_public_json);
}

function mapSeat(row: SeatRow): DuelSeat {
  const deck = parseDeck(row.deck_json);
  const isBot = row.is_bot === 1;
  const seat: DuelSeat = {
    seat: row.seat,
    playerId: row.player_id,
    displayName: isBot ? PRACTICE_BOT_NAME : (row.display_name ?? ""),
    ready: row.ready === 1,
    isBot,
  };
  if (deck?.deckMaster) seat.deckMaster = deck.deckMaster;
  return seat;
}

export function wrapSettingsError<T>(work: () => T, status = 400): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof DuelSettingsError) throw new DuelServiceError(error.message, status);
    throw error;
  }
}

export function generateInviteCode(): string {
  return randomBytes(32).toString("base64url");
}

function inviteCodeMatches(stored: string, provided: string): boolean {
  const expected = Buffer.from(stored);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) {
    timingSafeEqual(expected, Buffer.alloc(expected.length));
    return false;
  }
  return timingSafeEqual(expected, actual);
}

function serializeClock(clock: DuelClockState | null): string | null {
  return clock ? JSON.stringify(clock) : null;
}

function rowSettings(row: DuelRow): DuelSettings {
  return wrapSettingsError(() => parseStoredDuelSettings(row.settings_json), 500);
}

function rowClock(row: DuelRow): DuelClockState | null {
  return wrapSettingsError(() => parseStoredDuelClock(row.clock_json), 500);
}

const LIST_ACCESS_SQL = `
  (
    organizer_player_id = @viewer
    or exists (select 1 from duel_seats s where s.duel_id = duels.id and s.player_id = @viewer)
    or exists (select 1 from duel_invite_grants g where g.duel_id = duels.id and g.player_id = @viewer)
    or coalesce(json_extract(settings_json, '$.visibility'), 'public') != 'private'
  )
`;


export function createDuelService(db: Database.Database): DuelService {
  const selectDuelById = db.prepare<[number], DuelRow>("select * from duels where id = ?");
  const selectDuelBySlug = db.prepare<[string, string], DuelRow>("select * from duels where web_slug = ? and guild_id = ?");
  const selectSeats = db.prepare<[number], SeatRow>(
    `
      select s.seat, s.player_id, s.is_bot, s.ready, s.deck_json,
        case when s.is_bot = 1 then 'Practice Bot' else p.display_name end as display_name
      from duel_seats s
      left join players p on p.id = s.player_id
      where s.duel_id = ?
      order by s.seat
    `,
  );
  const selectCommands = db.prepare<[number], { seat: number; command_json: string }>(
    "select seat, command_json from duel_commands where duel_id = ? order by seq",
  );
  const selectPlayerGuild = db.prepare<[number, string], { ok: number }>(
    "select 1 as ok from players where id = ? and guild_id = ?",
  );
  const series = createSeriesStore(db);
  const insertDuel = db.prepare<[string, string, string, number, DuelMode, DuelMasterRule, string, string | null, number, number]>(
    `
      insert into duels (guild_id, web_slug, name, organizer_player_id, mode, master_rule, status, settings_json, invite_code, best_of, ranked)
      values (?, ?, ?, ?, ?, ?, 'lobby', ?, ?, ?, ?)
    `,
  );
  const insertSeat = db.prepare<[number, number, number]>(
    "insert into duel_seats (duel_id, seat, player_id, is_bot, ready) values (?, ?, ?, 0, 0)",
  );
  const insertBotSeat = db.prepare<[number, number, string]>(
    "insert into duel_seats (duel_id, seat, player_id, is_bot, ready, deck_json) values (?, ?, null, 1, 1, ?)",
  );
  const updateDeck = db.prepare<[string, number, number]>(
    "update duel_seats set deck_json = ?, ready = 1 where duel_id = ? and player_id = ?",
  );
  const updateReady = db.prepare<[number, number]>("update duel_seats set ready = 1 where duel_id = ? and player_id = ?");
  const nextCommandSeq = db.prepare<[number], { next_seq: number }>(
    "select coalesce(max(seq), 0) + 1 as next_seq from duel_commands where duel_id = ?",
  );
  const insertCommand = db.prepare<[number, number, number, string]>(
    "insert into duel_commands (duel_id, seq, seat, command_json) values (?, ?, ?, ?)",
  );
  const insertGrant = db.prepare<[number, number]>(
    "insert or ignore into duel_invite_grants (duel_id, player_id) values (?, ?)",
  );
  const selectGrant = db.prepare<[number, number], { ok: number }>(
    "select 1 as ok from duel_invite_grants where duel_id = ? and player_id = ?",
  );
  const touchActivity = db.prepare<[number]>("update duels set last_activity_at = datetime('now') where id = ?");
  const updateClock = db.prepare<[string | null, number]>("update duels set clock_json = ? where id = ?");
  const listLive = db.prepare<Record<string, string | number>, DuelListItemRow>(
    `
      select duels.*,
        (select s.seat from duel_seats s where s.duel_id = duels.id and s.player_id = @viewer) as my_seat
      from duels
      where guild_id = @guild
        and status in ('lobby', 'active')
        and archived_at is null
        and ${LIST_ACCESS_SQL}
        and (
          organizer_player_id = @viewer
          or exists (select 1 from duel_seats s where s.duel_id = duels.id and s.player_id = @viewer)
          or status = 'lobby'
          or (status = 'active' and datetime(coalesce(last_activity_at, created_at)) >= datetime('now', @idle))
        )
      order by
        case when organizer_player_id = @viewer
          or exists (select 1 from duel_seats s where s.duel_id = duels.id and s.player_id = @viewer) then 0 else 1 end,
        datetime(coalesce(last_activity_at, created_at)) desc,
        id desc
    `,
  );
  const listHistory = db.prepare<Record<string, string | number>, DuelListItemRow>(
    `
      select duels.*,
        (select s.seat from duel_seats s where s.duel_id = duels.id and s.player_id = @viewer) as my_seat
      from duels
      where guild_id = @guild
        and status in ('completed', 'interrupted')
        and ${LIST_ACCESS_SQL}
        and (@all = 1 or exists (select 1 from duel_seats s where s.duel_id = duels.id and s.player_id = @viewer))
      order by datetime(coalesce(ended_at, created_at)) desc, id desc
      limit ${HISTORY_LIMIT}
    `,
  );
  const selectDue = db.prepare<[string, number], DuelRow>(
    `
      select * from duels
      where archived_at is null
        and status in ('completed', 'interrupted', 'cancelled')
        and ended_at is not null
        and datetime(ended_at) <= datetime('now', ?)
      order by datetime(ended_at) asc, id asc
      limit ?
    `,
  );
  const selectDueClocks = db.prepare<[number, number], { slug: string; guildId: string }>(
    `
      select web_slug as slug, guild_id as guildId
      from duels
      where status = 'active'
        and clock_json is not null
        and json_extract(clock_json, '$.startedAt') is not null
        and json_extract(clock_json, '$.activeSeat') in (0, 1)
        and (
          json_extract(clock_json, '$.startedAt')
          + json_extract(clock_json, '$.remainingMs[' || json_extract(clock_json, '$.activeSeat') || ']')
        ) <= ?
      order by datetime(created_at) asc, id asc
      limit ?
    `,
  );

  const selectDueOpenings = db.prepare<[number, number], { slug: string; guildId: string }>(
    `
      select web_slug as slug, guild_id as guildId
      from duels
      where status = 'lobby'
        and opening_json is not null
        and json_extract(opening_json, '$.deadline') <= ?
      order by id asc
      limit ?
    `,
  );

  const assertPlayerGuild = (playerId: number, guildId: string) => {
    if (!selectPlayerGuild.get(playerId, guildId)) {
      throw new DuelServiceError("Player must belong to the same guild as the duel", 400);
    }
  };

  const loadDuelRow = (slug: string, guildId: string): DuelRow => {
    const row = selectDuelBySlug.get(slug, guildId);
    if (!row) throw new DuelServiceError("Duel not found", 404);
    return row;
  };

  const seatRows = (duelId: number): SeatRow[] => selectSeats.all(duelId);

  const mapSession = (row: DuelRow): DuelSession => {
    if (!isDuelMode(row.mode) || !isDuelStatus(row.status) || !isDuelMasterRule(row.master_rule)) {
      throw new DuelServiceError("Duel record is invalid", 500);
    }
    return {
      id: row.id,
      slug: row.web_slug,
      name: row.name,
      guildId: row.guild_id,
      organizerPlayerId: row.organizer_player_id,
      mode: row.mode,
      masterRule: row.master_rule,
      status: row.status,
      settings: rowSettings(row),
      seats: seatRows(row.id).map(mapSeat),
      createdAt: row.created_at,
      endedAt: row.ended_at,
      archivedAt: row.archived_at,
      winnerPlayerId: row.winner_player_id,
      winnerSeat: row.winner_seat ?? null,
      resultReason: row.result_reason,
      bestOf: row.best_of === 3 ? 3 : 1,
      ranked: row.ranked === 1,
      seriesId: row.series_id ?? null,
      gameNumber: row.game_number ?? null,
    };
  };

  const ownDeck = (duelId: number, playerId: number): DuelDeck | null => {
    const row = seatRows(duelId).find((seat) => seat.player_id === playerId);
    return row ? parseDeck(row.deck_json) : null;
  };

  const hasPrivateAccess = (row: DuelRow, playerId: number): boolean => {
    if (rowSettings(row).visibility !== "private") return true;
    if (row.organizer_player_id === playerId) return true;
    if (seatRows(row.id).some((seat) => seat.player_id === playerId)) return true;
    return !!selectGrant.get(row.id, playerId);
  };

  const assertRoomAccess = (row: DuelRow, playerId: number) => {
    if (!hasPrivateAccess(row, playerId)) {
      throw new DuelServiceError("Duel is invite-only", 403);
    }
  };

  /** Decks, seats and the bot are fixed once the rock-paper-scissors opening runs. */
  const assertNoOpening = (row: DuelRow) => {
    if (row.opening_json) throw new DuelServiceError("The duel is about to start. Seats and decks are fixed.", 409);
  };

  const requireOpening = (row: DuelRow): DuelOpeningState => {
    const state = parseOpening(row.opening_json);
    if (!state) throw new DuelServiceError("There is no rock-paper-scissors game for this duel", 409);
    return state;
  };

  const storeOpening = (duelId: number, state: DuelOpeningState | null) => {
    db.prepare<[string | null, number]>("update duels set opening_json = ? where id = ?")
      .run(state ? JSON.stringify(state) : null, duelId);
  };

  /** The opening just settled the order: put the seats in their final order and flip the seat-indexed fields. */
  const settleOrder = (duelId: number, before: DuelOpeningState, after: DuelOpeningState): DuelOpeningState => {
    if (before.phase === "start" || after.phase !== "start" || !openingNeedsSwap(after)) return after;
    // Two statements: the primary key (duel_id, seat) must stay unique after every row update.
    db.prepare<[number]>("update duel_seats set seat = seat + 2 where duel_id = ?").run(duelId);
    db.prepare<[number]>("update duel_seats set seat = 3 - seat where duel_id = ?").run(duelId);
    return swapOpeningSeats(after);
  };

  const runOpening = <T>(work: () => T): T => {
    try {
      return work();
    } catch (error) {
      if (error instanceof DuelOpeningError) throw new DuelServiceError(error.message, error.status);
      throw error;
    }
  };

  const startOpeningTx = db.transaction((slug: string, guildId: string, actorPlayerId: number, at: number) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(actorPlayerId, guildId);
    if (row.status !== "lobby") throw new DuelServiceError("Duel already started", 409);
    const existing = parseOpening(row.opening_json);
    if (existing) return existing;
    const seats = seatRows(row.id);
    if (seats.length !== MAX_SEATS || seats.some((seat) => seat.ready !== 1)) {
      throw new DuelServiceError("Duel needs exactly two ready players to start", 400);
    }
    if (row.series_id !== null) {
      const linked = series.byId(row.series_id);
      if (!linked || series.playerIndex(linked, actorPlayerId) === null) {
        throw new DuelServiceError("Only a player in this match can start this duel", 403);
      }
    } else if (row.organizer_player_id !== actorPlayerId) {
      throw new DuelServiceError("Only the organizer can start this duel", 403);
    }
    const state = newOpening(actorPlayerId, at);
    storeOpening(row.id, state);
    return state;
  });

  const openingStepTx = db.transaction(
    (slug: string, guildId: string, step: (state: DuelOpeningState, seatCount: number) => DuelOpeningState) => {
      const row = loadDuelRow(slug, guildId);
      if (row.status !== "lobby") throw new DuelServiceError("The duel is not in its opening", 409);
      const before = requireOpening(row);
      const stepped = runOpening(() => step(before, seatRows(row.id).length));
      const after = settleOrder(row.id, before, stepped);
      if (after !== before) storeOpening(row.id, after);
      return after;
    },
  );

  const createTx = db.transaction(
    (input: {
      guildId: string;
      organizerPlayerId: number;
      name: string;
      mode: DuelMode;
      masterRule?: DuelMasterRule;
      settings?: unknown;
      bestOf?: DuelBestOf;
      ranked?: boolean;
    }) => {
      const name = input.name.trim();
      if (!name) throw new DuelServiceError("Duel name is required", 400);
      if (!isDuelMode(input.mode)) throw new DuelServiceError("Duel mode must be normal or domain", 400);
      assertPlayerGuild(input.organizerPlayerId, input.guildId);
      const masterRule = resolveMasterRule(input.mode, input.masterRule);
      const settings = wrapSettingsError(() => normalizeDuelSettings(input.mode, input.settings));
      const inviteCode = settings.visibility === "private" ? generateInviteCode() : null;
      const bestOf = input.bestOf === undefined ? 1 : input.bestOf;
      if (bestOf !== 1 && bestOf !== 3) throw new DuelServiceError("Best of must be 1 or 3", 400);
      const ranked = input.ranked === undefined ? false : input.ranked;
      if (typeof ranked !== "boolean") throw new DuelServiceError("Ranked must be true or false", 400);

      const result = insertDuel.run(
        input.guildId,
        generateWebSlug(),
        name,
        input.organizerPlayerId,
        input.mode,
        masterRule,
        JSON.stringify(settings),
        inviteCode,
        bestOf,
        ranked ? 1 : 0,
      );
      const duelId = Number(result.lastInsertRowid);
      insertSeat.run(duelId, 0, input.organizerPlayerId);
      const created = selectDuelById.get(duelId);
      if (!created) throw new DuelServiceError("Duel record is invalid", 500);
      return mapSession(created);
    },
  );

  const takeSeatTx = db.transaction((slug: string, guildId: string, playerId: number, requestedSeat?: number) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(playerId, guildId);
    assertRoomAccess(row, playerId);
    if (row.status !== "lobby") throw new DuelServiceError("Seats can only be taken before the duel starts", 409);
    assertNoOpening(row);
    if (row.series_id !== null) {
      throw new DuelServiceError("This match is between two players; seats are fixed", 409);
    }
    if (requestedSeat !== undefined && (!Number.isInteger(requestedSeat) || requestedSeat < 0 || requestedSeat >= MAX_SEATS)) {
      throw new DuelServiceError("Seat must be 0 or 1", 400);
    }

    const seats = seatRows(row.id);
    const mine = seats.find((seat) => seat.player_id === playerId);
    if (mine) {
      if (requestedSeat !== undefined && mine.seat !== requestedSeat) {
        throw new DuelServiceError("You are already seated in this duel", 409);
      }
      return mapSession(row);
    }

    const used = new Set(seats.map((seat) => seat.seat));
    const seat = requestedSeat ?? [0, 1].find((index) => !used.has(index));
    if (seat === undefined || used.has(seat)) {
      throw new DuelServiceError("That seat is already taken. You are still watching; choose another open seat.", 409);
    }

    try {
      insertSeat.run(row.id, seat, playerId);
    } catch (error) {
      if (isConstraintError(error)) throw new DuelServiceError("That seat is already taken. You are still watching; choose another open seat.", 409);
      throw error;
    }
    return mapSession(row);
  });

  const addPracticeBotTx = db.transaction((slug: string, guildId: string, organizerPlayerId: number, deck: DuelDeck) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(organizerPlayerId, guildId);
    assertRoomAccess(row, organizerPlayerId);
    if (row.status !== "lobby") throw new DuelServiceError("Duel is not in lobby", 400);
    if (row.organizer_player_id !== organizerPlayerId) {
      throw new DuelServiceError("Only the organizer can add a practice bot", 403);
    }

    const seats = seatRows(row.id);
    if (seats.length !== 1) {
      throw new DuelServiceError("Duel needs an empty opponent seat", 409);
    }

    const used = new Set(seats.map((seat) => seat.seat));
    let seat = 0;
    while (used.has(seat) && seat < MAX_SEATS) seat += 1;
    if (seat >= MAX_SEATS) throw new DuelServiceError("Duel needs an empty opponent seat", 409);

    const normalized = validateDuelDeckShape(deck, rowSettings(row).validateDeck);
    try {
      insertBotSeat.run(row.id, seat, JSON.stringify(normalized));
    } catch (error) {
      if (isConstraintError(error)) throw new DuelServiceError("Duel needs an empty opponent seat", 409);
      throw error;
    }
    return mapSession(row);
  });

  const removePracticeBotTx = db.transaction((slug: string, guildId: string, organizerPlayerId: number) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(organizerPlayerId, guildId);
    assertRoomAccess(row, organizerPlayerId);
    if (row.status !== "lobby") throw new DuelServiceError("A practice bot can only be removed before the duel starts", 409);
    assertNoOpening(row);
    if (row.organizer_player_id !== organizerPlayerId) {
      throw new DuelServiceError("Only the organizer can remove a practice bot", 403);
    }
    // The bot's seat row holds everything the add created (ready flag and deck), so deleting it clears it all.
    const removed = db.prepare<[number]>("delete from duel_seats where duel_id = ? and is_bot = 1").run(row.id);
    if (removed.changes === 0) throw new DuelServiceError("This table has no practice bot", 409);
    return mapSession(row);
  });

  const setDeckTx = db.transaction((slug: string, guildId: string, playerId: number, deck: DuelDeck) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(playerId, guildId);
    assertRoomAccess(row, playerId);
    if (row.status !== "lobby") throw new DuelServiceError("Decks can only be set before the duel starts", 400);
    assertNoOpening(row);

    const seat = seatRows(row.id).find((entry) => entry.player_id === playerId);
    if (!seat) throw new DuelServiceError("You are not seated in this duel", 403);

    const normalized = validateDuelDeckShape(deck, rowSettings(row).validateDeck);
    updateDeck.run(JSON.stringify(normalized), row.id, playerId);
    return mapSession(row);
  });

  const leaveTx = db.transaction((slug: string, guildId: string, playerId: number) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(playerId, guildId);
    const seat = seatRows(row.id).find((entry) => entry.player_id === playerId);
    if (!seat) throw new DuelServiceError("You are not seated in this duel", 403);
    if (row.series_id !== null) {
      throw new DuelServiceError("Seats are fixed in a match between two players. Cancel the match instead.", 409);
    }
    if (row.status !== "lobby") throw new DuelServiceError("You can only leave a table before the duel starts", 409);
    assertNoOpening(row);
    if (row.organizer_player_id === playerId) {
      throw new DuelServiceError("The organizer cannot leave. Cancel the table instead.", 409);
    }
    db.prepare<[number, number]>("delete from duel_seats where duel_id = ? and player_id = ?").run(row.id, playerId);
    const updated = selectDuelById.get(row.id);
    if (!updated) throw new DuelServiceError("Duel record is invalid", 500);
    return mapSession(updated);
  });

  const markReadyTx = db.transaction((slug: string, guildId: string, playerId: number) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(playerId, guildId);
    assertRoomAccess(row, playerId);
    if (row.status !== "lobby") throw new DuelServiceError("Duel is not in lobby", 400);
    assertNoOpening(row);
    const seat = seatRows(row.id).find((entry) => entry.player_id === playerId);
    if (!seat) throw new DuelServiceError("You are not seated in this duel", 403);
    if (!seat.deck_json) throw new DuelServiceError("Choose a deck before you ready up", 400);
    updateReady.run(row.id, playerId);
    return mapSession(row);
  });

  const activateTx = db.transaction(
    (
      slug: string,
      guildId: string,
      organizerPlayerId: number | null,
      seed: string[],
      bundleVersion: string,
      clock: DuelClockState | null,
    ) => {
      const row = loadDuelRow(slug, guildId);
      if (row.status !== "lobby") throw new DuelServiceError("Duel is not in lobby", 400);
      if (row.series_id !== null) {
        // A series game: the host starts it (null), or any player of the series.
        if (organizerPlayerId !== null) {
          const linked = series.byId(row.series_id);
          if (!linked || series.playerIndex(linked, organizerPlayerId) === null) {
            throw new DuelServiceError("Only a player in this match can start this duel", 403);
          }
        }
      } else if (organizerPlayerId === null) {
        throw new DuelServiceError("Only a match game can be started by the system", 403);
      } else if (row.organizer_player_id !== organizerPlayerId) {
        throw new DuelServiceError("Only the organizer can start this duel", 403);
      }
      if (!Array.isArray(seed) || seed.some((value) => typeof value !== "string")) {
        throw new DuelServiceError("Duel seed is invalid", 400);
      }
      if (!bundleVersion.trim()) throw new DuelServiceError("Bundle version is required", 400);

      const seats = seatRows(row.id);
      if (seats.length !== MAX_SEATS || seats.some((seat) => seat.ready !== 1)) {
        throw new DuelServiceError("Duel needs exactly two ready players to start", 400);
      }

      const storedClock = clock === null ? null : wrapSettingsError(() => normalizeDuelClockState(clock));
      db.prepare<[string, string, string | null, number]>(
        "update duels set status = 'active', seed_json = ?, bundle_version = ?, clock_json = ?, opening_json = null, last_activity_at = datetime('now') where id = ? and status = 'lobby'",
      ).run(JSON.stringify(seed), bundleVersion, serializeClock(storedClock), row.id);
      const updated = selectDuelById.get(row.id);
      if (!updated || updated.status !== "active") throw new DuelServiceError("Duel is not in lobby", 400);
      series.onActivate(updated, rowSettings(updated));
      const attached = selectDuelById.get(row.id);
      return mapSession(attached ?? updated);
    },
  );

  const recordCommandTx = db.transaction(
    (slug: string, guildId: string, seat: number, command: DuelCommand, clock: DuelClockState | null) => {
      const row = loadDuelRow(slug, guildId);
      if (row.status !== "active") throw new DuelServiceError("Duel is not active", 400);
      if (!Number.isInteger(seat) || !seatRows(row.id).some((entry) => entry.seat === seat)) {
        throw new DuelServiceError("Seat is not occupied", 400);
      }
      const storedClock = clock === null ? null : wrapSettingsError(() => normalizeDuelClockState(clock));
      const next = nextCommandSeq.get(row.id);
      if (!next) throw new DuelServiceError("Duel record is invalid", 500);
      insertCommand.run(row.id, next.next_seq, seat, JSON.stringify(command));
      updateClock.run(serializeClock(storedClock), row.id);
      touchActivity.run(row.id);
    },
  );

  const finalizeTx = db.transaction(
    (
      slug: string,
      guildId: string,
      nextStatus: "completed" | "interrupted",
      winnerSeat: number | null,
      reason: string,
      snapshots: DuelFinalSnapshots | undefined,
    ) => {
      const row = loadDuelRow(slug, guildId);
      if (row.status === "completed" || row.status === "interrupted" || row.status === "cancelled") {
        return mapSession(row);
      }
      if (row.status !== "active") throw new DuelServiceError("Duel is not active", 400);

      let winnerPlayerId: number | null = null;
      let winnerIsBot = false;
      if (nextStatus === "completed" && winnerSeat !== null) {
        const winner = seatRows(row.id).find((entry) => entry.seat === winnerSeat);
        if (!winner) throw new DuelServiceError("Winner seat is not occupied", 400);
        winnerPlayerId = winner.player_id;
        winnerIsBot = winner.is_bot === 1;
      }

      const result = { winnerSeat: nextStatus === "completed" ? winnerSeat : null, reason };
      const publicJson = snapshots ? freezeSnapshot(snapshots.public, result) : null;
      const seat0Json = snapshots ? freezeSnapshot(snapshots.seat0, result) : null;
      const seat1Json = snapshots ? freezeSnapshot(snapshots.seat1, result) : null;

      db.prepare<
        ["completed" | "interrupted", number | null, number | null, string, string | null, string | null, string | null, number]
      >(
        `
          update duels
          set status = ?, ended_at = datetime('now'), archived_at = coalesce(archived_at, datetime('now')), winner_player_id = ?, winner_seat = ?, result_reason = ?,
              snapshot_public_json = ?, snapshot_seat0_json = ?, snapshot_seat1_json = ?, clock_json = null
          where id = ? and status = 'active'
        `,
      ).run(
        nextStatus,
        winnerPlayerId,
        nextStatus === "completed" ? winnerSeat : null,
        reason,
        publicJson,
        seat0Json,
        seat1Json,
        row.id,
      );
      const updated = selectDuelById.get(row.id);
      if (!updated) throw new DuelServiceError("Duel record is invalid", 500);
      series.onGameFinished(updated, nextStatus, winnerPlayerId, winnerIsBot);
      return mapSession(updated);
    },
  );

  const cancelTx = db.transaction((slug: string, guildId: string, organizerPlayerId: number) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(organizerPlayerId, guildId);
    assertRoomAccess(row, organizerPlayerId);
    const linked = row.series_id !== null ? series.byId(row.series_id) : undefined;
    if (linked) {
      // Either player of a match can cancel its lobby; that cancels the whole series.
      if (series.playerIndex(linked, organizerPlayerId) === null) {
        throw new DuelServiceError("Only a player in this match can cancel this duel", 403);
      }
      if (row.status === "cancelled") return mapSession(row);
      if (row.status !== "lobby") throw new DuelServiceError("Only a lobby can be cancelled", 409);
      // Cancelling a lobby cancels the whole series. That is only fine for game 1 of a casual
      // series; later games and tournament matches already have wins to protect.
      if (linked.tournament_match_id !== null || (row.game_number ?? 1) > 1) {
        throw new DuelServiceError(
          linked.tournament_match_id !== null
            ? "A tournament match cannot be cancelled from its lobby. The tournament organizer cancels the series."
            : "Game 2 or later cannot be cancelled from its lobby because it would erase the series wins. Cancel the series instead.",
          403,
        );
      }
      series.cancel(linked.id, guildId);
      const cancelled = selectDuelById.get(row.id);
      if (!cancelled) throw new DuelServiceError("Duel record is invalid", 500);
      return mapSession(cancelled);
    }
    if (row.organizer_player_id !== organizerPlayerId) {
      throw new DuelServiceError("Only the organizer can cancel this duel", 403);
    }
    if (row.status === "cancelled") return mapSession(row);
    if (row.status !== "lobby") throw new DuelServiceError("Only a lobby can be cancelled", 409);

    db.prepare<[number]>(
      `
        update duels
        set status = 'cancelled', ended_at = datetime('now'), archived_at = coalesce(archived_at, datetime('now')), winner_player_id = null, winner_seat = null,
            result_reason = 'Cancelled', clock_json = null
        where id = ? and status = 'lobby'
      `,
    ).run(row.id);
    const updated = selectDuelById.get(row.id);
    if (!updated) throw new DuelServiceError("Duel record is invalid", 500);
    return mapSession(updated);
  });

  const archiveTx = db.transaction((slug: string, guildId: string, organizerPlayerId: number) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(organizerPlayerId, guildId);
    assertRoomAccess(row, organizerPlayerId);
    if (row.organizer_player_id !== organizerPlayerId) {
      throw new DuelServiceError("Only the organizer can archive this duel", 403);
    }
    if (row.archived_at) return mapSession(row);
    if (!isTerminalStatus(row.status)) {
      throw new DuelServiceError("Only finished duels can be archived", 409);
    }

    db.prepare<[number]>("update duels set archived_at = datetime('now') where id = ? and archived_at is null").run(row.id);
    const updated = selectDuelById.get(row.id);
    if (!updated) throw new DuelServiceError("Duel record is invalid", 500);
    return mapSession(updated);
  });

  const archiveDueTx = db.transaction((limit: number, archiveAfterMs: number) => {
    const cap = Math.min(Math.max(1, Math.floor(limit)), ARCHIVE_DUE_CAP);
    const seconds = Math.max(0, Math.ceil(archiveAfterMs / 1000));
    const due = selectDue.all(`-${seconds} seconds`, cap);
    const archived: DuelSession[] = [];
    const stamp = db.prepare<[number]>("update duels set archived_at = datetime('now') where id = ? and archived_at is null");
    for (const row of due) {
      if (!isTerminalStatus(row.status)) continue;
      stamp.run(row.id);
      const updated = selectDuelById.get(row.id);
      if (updated?.archived_at) archived.push(mapSession(updated));
    }
    return archived;
  });

  return {
    create(input) {
      return createTx(input);
    },

    list(guildId, playerId, options) {
      assertPlayerGuild(playerId, guildId);
      const toItem = (row: DuelListItemRow): DuelListItem => ({
        ...mapSession(row),
        mySeat: row.my_seat,
        lastActivityAt: row.last_activity_at ?? row.created_at,
        series: row.series_id === null ? null : series.summaryById(row.series_id),
      });
      if (options?.archived) {
        const scope: DuelHistoryScope = options.scope ?? "mine";
        return listHistory.all({ guild: guildId, viewer: playerId, all: scope === "all" ? 1 : 0 }).map(toItem);
      }
      const idleMs = options?.idleAfterMs ?? DUEL_LIVE_IDLE_AFTER_MS;
      const idleSeconds = Math.max(0, Math.ceil(idleMs / 1000));
      return listLive
        .all({ guild: guildId, viewer: playerId, idle: `-${idleSeconds} seconds` })
        .map(toItem);
    },

    get(slug, guildId) {
      return mapSession(loadDuelRow(slug, guildId));
    },

    join(slug, guildId, playerId) {
      const row = loadDuelRow(slug, guildId);
      assertPlayerGuild(playerId, guildId);
      assertRoomAccess(row, playerId);
      return mapSession(row);
    },

    takeSeat(slug, guildId, playerId, seat) {
      // Reserve the writer lock before checking occupancy, including claims from another process.
      return takeSeatTx.immediate(slug, guildId, playerId, seat);
    },

    leave(slug, guildId, playerId) {
      return leaveTx(slug, guildId, playerId);
    },

    addPracticeBot(slug, guildId, organizerPlayerId, deck) {
      return addPracticeBotTx(slug, guildId, organizerPlayerId, deck);
    },

    removePracticeBot(slug, guildId, organizerPlayerId) {
      return removePracticeBotTx(slug, guildId, organizerPlayerId);
    },

    setDeck(slug, guildId, playerId, deck) {
      return setDeckTx(slug, guildId, playerId, deck);
    },

    room(slug, guildId, playerId) {
      const row = loadDuelRow(slug, guildId);
      assertPlayerGuild(playerId, guildId);
      assertRoomAccess(row, playerId);
      const session = mapSession(row);
      const seated = session.seats.find((seat) => seat.playerId === playerId);
      const role: DuelActorRole = seated ? "player" : "spectator";
      const mySeat = seated ? seated.seat : null;
      const terminal = isTerminalStatus(session.status);
      const engine = terminal ? snapshotForRole(row, mySeat) : null;
      const room: DuelRoom = {
        session,
        role,
        mySeat,
        myDeck: seated ? ownDeck(row.id, playerId) : null,
        engine,
        clock: clockWithServerNow(rowClock(row)),
        metadataOnly: terminal && engine === null,
      };
      if (session.settings.visibility === "private" && playerId === session.organizerPlayerId && row.invite_code) {
        room.inviteCode = row.invite_code;
      }
      const linked = row.series_id === null ? undefined : series.byId(row.series_id);
      room.series = linked ? series.summarize(linked) : null;
      const opening = row.status === "lobby" ? parseOpening(row.opening_json) : null;
      room.opening = opening ? openingView(opening, mySeat) : null;
      room.mySide = null;
      if (linked && seated && series.playerIndex(linked, playerId) !== null) {
        const own = ownDeck(row.id, playerId);
        room.mySide = series.sideState(linked, playerId) ?? (own ? { baseDeck: own, currentDeck: own } : null);
      }
      return room;
    },

    privateState(slug, guildId) {
      const row = loadDuelRow(slug, guildId);
      const seats = seatRows(row.id);
      return {
        session: mapSession(row),
        decks: seats.map((seat) => parseDeck(seat.deck_json) ?? emptyDeck()),
        seed: parseSeed(row.seed_json),
        bundleVersion: row.bundle_version,
        commands: selectCommands.all(row.id).map((entry) => ({
          seat: entry.seat,
          command: JSON.parse(entry.command_json) as DuelCommand,
        })),
        clock: rowClock(row),
      };
    },

    markReady(slug, guildId, playerId) {
      return markReadyTx(slug, guildId, playerId);
    },

    activate(slug, guildId, organizerPlayerId, seed, bundleVersion, clock) {
      return activateTx(slug, guildId, organizerPlayerId, seed, bundleVersion, clock);
    },

    recordCommand(slug, guildId, seat, command, clock) {
      recordCommandTx(slug, guildId, seat, command, clock);
    },

    complete(slug, guildId, winnerSeat, reason, snapshots) {
      return finalizeTx(slug, guildId, "completed", winnerSeat, reason, snapshots);
    },

    interrupt(slug, guildId, reason, snapshots) {
      return finalizeTx(slug, guildId, "interrupted", null, reason, snapshots);
    },

    cancel(slug, guildId, organizerPlayerId) {
      return cancelTx(slug, guildId, organizerPlayerId);
    },

    startOpening(slug, guildId, actorPlayerId, at) {
      return startOpeningTx(slug, guildId, actorPlayerId, at);
    },

    openingState(slug, guildId) {
      return parseOpening(loadDuelRow(slug, guildId).opening_json);
    },

    submitOpeningPick(slug, guildId, seat, move, at) {
      return openingStepTx(slug, guildId, (state) => submitOpeningPick(state, seat, move, at));
    },

    submitOpeningChoice(slug, guildId, seat, choice, at) {
      return openingStepTx(slug, guildId, (state) => submitOpeningChoice(state, seat, choice, at));
    },

    settleOpening(slug, guildId, at, random) {
      const row = loadDuelRow(slug, guildId);
      if (row.status !== "lobby" || !parseOpening(row.opening_json)) return parseOpening(row.opening_json);
      return openingStepTx(slug, guildId, (state) => settleOpening(state, at, random));
    },

    abortOpening(slug, guildId) {
      const row = loadDuelRow(slug, guildId);
      if (row.status === "lobby" && row.opening_json) storeOpening(row.id, null);
    },

    dueOpenings(now, limit) {
      return selectDueOpenings.all(Math.floor(now), limit);
    },

    archive(slug, guildId, organizerPlayerId) {
      return archiveTx(slug, guildId, organizerPlayerId);
    },

    archiveDue(limit, archiveAfterMs) {
      return archiveDueTx(limit, archiveAfterMs);
    },

    admit(slug, guildId, playerId, inviteCode) {
      const row = loadDuelRow(slug, guildId);
      assertPlayerGuild(playerId, guildId);
      if (rowSettings(row).visibility !== "private" || !row.invite_code) {
        throw new DuelServiceError("Duel is not invite-only", 400);
      }
      if (typeof inviteCode !== "string" || inviteCode.length === 0) {
        throw new DuelServiceError("Invite code is required", 400);
      }
      if (!inviteCodeMatches(row.invite_code, inviteCode)) {
        throw new DuelServiceError("Invite code is invalid", 403);
      }
      insertGrant.run(row.id, playerId);
    },

    setClock(slug, guildId, clock) {
      const row = loadDuelRow(slug, guildId);
      const storedClock = clock === null ? null : wrapSettingsError(() => normalizeDuelClockState(clock));
      updateClock.run(serializeClock(storedClock), row.id);
    },

    dueClocks(now, limit) {
      const cap = Math.min(Math.max(1, Math.floor(limit)), CLOCK_DUE_CAP);
      const instant = Math.floor(now);
      return selectDueClocks.all(instant, cap);
    },
  };
}
