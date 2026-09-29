import type Database from "better-sqlite3";
import { generateWebSlug } from "../util/web-slug.js";
import type {
  DuelActorRole,
  DuelCommand,
  DuelDeck,
  DuelEngineView,
  DuelMasterRule,
  DuelMode,
  DuelRoom,
  DuelSeat,
  DuelSession,
  DuelStatus,
} from "../duels/index.js";

const MAX_SEATS = 2;
const MIN_MAIN = 40;
const MAX_MAIN = 60;
const MAX_EXTRA = 15;
const MAX_SIDE = 15;
const PRACTICE_BOT_NAME = "Practice Bot";
const ARCHIVE_DUE_CAP = 32;

function isTerminalStatus(status: string): status is DuelStatus {
  return status === "completed" || status === "interrupted" || status === "cancelled";
}

function isDuelMasterRule(value: unknown): value is DuelMasterRule {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function resolveMasterRule(mode: DuelMode, value: unknown): DuelMasterRule {
  const rule = value === undefined ? 5 : value;
  if (!isDuelMasterRule(rule)) {
    throw new DuelServiceError("Master rule must be 1, 2, 3, 4, or 5", 400);
  }
  if (mode === "domain" && rule !== 5) {
    throw new DuelServiceError("Domain Format requires master rule 5", 400);
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
}

export interface DuelFinalSnapshots {
  public: DuelEngineView;
  seat0: DuelEngineView;
  seat1: DuelEngineView;
}

export interface DuelService {
  create(input: { guildId: string; organizerPlayerId: number; name: string; mode: DuelMode; masterRule?: DuelMasterRule }): DuelSession;
  list(guildId: string, playerId: number, options?: { archived?: boolean }): DuelSession[];
  get(slug: string, guildId: string): DuelSession;
  join(slug: string, guildId: string, playerId: number): DuelSession;
  addPracticeBot(slug: string, guildId: string, organizerPlayerId: number, deck: DuelDeck): DuelSession;
  setDeck(slug: string, guildId: string, playerId: number, deck: DuelDeck): DuelSession;
  room(slug: string, guildId: string, playerId: number): DuelRoom;
  privateState(slug: string, guildId: string): DuelPrivateState;
  activate(slug: string, guildId: string, organizerPlayerId: number, seed: string[], bundleVersion: string): DuelSession;
  recordCommand(slug: string, guildId: string, seat: number, command: DuelCommand): void;
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
  winner_player_id: number | null;
  winner_seat: number | null;
  result_reason: string | null;
  snapshot_public_json: string | null;
  snapshot_seat0_json: string | null;
  snapshot_seat1_json: string | null;
};

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

function isDuelMode(value: string): value is DuelMode {
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

function validateDuelDeckShape(deck: DuelDeck): DuelDeck {
  const main = assertCardCodes(deck.main, "Main deck", MIN_MAIN, MAX_MAIN);
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
  const insertDuel = db.prepare<[string, string, string, number, DuelMode, DuelMasterRule]>(
    `
      insert into duels (guild_id, web_slug, name, organizer_player_id, mode, master_rule, status)
      values (?, ?, ?, ?, ?, ?, 'lobby')
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
  const nextCommandSeq = db.prepare<[number], { next_seq: number }>(
    "select coalesce(max(seq), 0) + 1 as next_seq from duel_commands where duel_id = ?",
  );
  const insertCommand = db.prepare<[number, number, number, string]>(
    "insert into duel_commands (duel_id, seq, seat, command_json) values (?, ?, ?, ?)",
  );
  const listLive = db.prepare<[string], DuelRow>(
    "select * from duels where guild_id = ? and archived_at is null order by datetime(created_at) desc, id desc",
  );
  const listArchived = db.prepare<[string], DuelRow>(
    `
      select * from duels
      where guild_id = ? and archived_at is not null
      order by datetime(archived_at) desc, id desc
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
      seats: seatRows(row.id).map(mapSeat),
      createdAt: row.created_at,
      endedAt: row.ended_at,
      archivedAt: row.archived_at,
      winnerPlayerId: row.winner_player_id,
      winnerSeat: row.winner_seat ?? null,
      resultReason: row.result_reason,
    };
  };

  const ownDeck = (duelId: number, playerId: number): DuelDeck | null => {
    const row = seatRows(duelId).find((seat) => seat.player_id === playerId);
    return row ? parseDeck(row.deck_json) : null;
  };

  const createTx = db.transaction((input: { guildId: string; organizerPlayerId: number; name: string; mode: DuelMode; masterRule?: DuelMasterRule }) => {
    const name = input.name.trim();
    if (!name) throw new DuelServiceError("Duel name is required", 400);
    if (!isDuelMode(input.mode)) throw new DuelServiceError("Duel mode must be normal or domain", 400);
    assertPlayerGuild(input.organizerPlayerId, input.guildId);
    const masterRule = resolveMasterRule(input.mode, input.masterRule);

    const result = insertDuel.run(input.guildId, generateWebSlug(), name, input.organizerPlayerId, input.mode, masterRule);
    const duelId = Number(result.lastInsertRowid);
    insertSeat.run(duelId, 0, input.organizerPlayerId);
    const created = selectDuelById.get(duelId);
    if (!created) throw new DuelServiceError("Duel record is invalid", 500);
    return mapSession(created);
  });

  const joinTx = db.transaction((slug: string, guildId: string, playerId: number) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(playerId, guildId);

    const seats = seatRows(row.id);
    if (seats.some((seat) => seat.player_id === playerId)) {
      return mapSession(row);
    }
    if (row.status !== "lobby") throw new DuelServiceError("Duel is not open to join", 400);
    if (seats.length >= MAX_SEATS) {
      throw new DuelServiceError("Duel is full", 409);
    }

    const used = new Set(seats.map((seat) => seat.seat));
    let seat = 0;
    while (used.has(seat) && seat < MAX_SEATS) seat += 1;
    if (seat >= MAX_SEATS) throw new DuelServiceError("Duel is full", 409);

    try {
      insertSeat.run(row.id, seat, playerId);
    } catch (error) {
      if (isConstraintError(error)) throw new DuelServiceError("Duel is full", 409);
      throw error;
    }
    return mapSession(row);
  });

  const addPracticeBotTx = db.transaction((slug: string, guildId: string, organizerPlayerId: number, deck: DuelDeck) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(organizerPlayerId, guildId);
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

    const normalized = validateDuelDeckShape(deck);
    try {
      insertBotSeat.run(row.id, seat, JSON.stringify(normalized));
    } catch (error) {
      if (isConstraintError(error)) throw new DuelServiceError("Duel needs an empty opponent seat", 409);
      throw error;
    }
    return mapSession(row);
  });

  const setDeckTx = db.transaction((slug: string, guildId: string, playerId: number, deck: DuelDeck) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(playerId, guildId);
    if (row.status !== "lobby") throw new DuelServiceError("Decks can only be set before the duel starts", 400);

    const seat = seatRows(row.id).find((entry) => entry.player_id === playerId);
    if (!seat) throw new DuelServiceError("You are not seated in this duel", 403);

    const normalized = validateDuelDeckShape(deck);
    updateDeck.run(JSON.stringify(normalized), row.id, playerId);
    return mapSession(row);
  });

  const activateTx = db.transaction(
    (slug: string, guildId: string, organizerPlayerId: number, seed: string[], bundleVersion: string) => {
      const row = loadDuelRow(slug, guildId);
      if (row.status !== "lobby") throw new DuelServiceError("Duel is not in lobby", 400);
      if (row.organizer_player_id !== organizerPlayerId) {
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

      db.prepare<[string, string, number]>(
        "update duels set status = 'active', seed_json = ?, bundle_version = ? where id = ? and status = 'lobby'",
      ).run(JSON.stringify(seed), bundleVersion, row.id);
      const updated = selectDuelById.get(row.id);
      if (!updated || updated.status !== "active") throw new DuelServiceError("Duel is not in lobby", 400);
      return mapSession(updated);
    },
  );

  const recordCommandTx = db.transaction((slug: string, guildId: string, seat: number, command: DuelCommand) => {
    const row = loadDuelRow(slug, guildId);
    if (row.status !== "active") throw new DuelServiceError("Duel is not active", 400);
    if (!Number.isInteger(seat) || !seatRows(row.id).some((entry) => entry.seat === seat)) {
      throw new DuelServiceError("Seat is not occupied", 400);
    }
    const next = nextCommandSeq.get(row.id);
    if (!next) throw new DuelServiceError("Duel record is invalid", 500);
    insertCommand.run(row.id, next.next_seq, seat, JSON.stringify(command));
  });

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
      if (nextStatus === "completed" && winnerSeat !== null) {
        const winner = seatRows(row.id).find((entry) => entry.seat === winnerSeat);
        if (!winner) throw new DuelServiceError("Winner seat is not occupied", 400);
        winnerPlayerId = winner.player_id;
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
          set status = ?, ended_at = datetime('now'), winner_player_id = ?, winner_seat = ?, result_reason = ?,
              snapshot_public_json = ?, snapshot_seat0_json = ?, snapshot_seat1_json = ?
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
      return mapSession(updated);
    },
  );

  const cancelTx = db.transaction((slug: string, guildId: string, organizerPlayerId: number) => {
    const row = loadDuelRow(slug, guildId);
    assertPlayerGuild(organizerPlayerId, guildId);
    if (row.organizer_player_id !== organizerPlayerId) {
      throw new DuelServiceError("Only the organizer can cancel this duel", 403);
    }
    if (row.status === "cancelled") return mapSession(row);
    if (row.status !== "lobby") throw new DuelServiceError("Only a lobby can be cancelled", 409);

    db.prepare<[number]>(
      `
        update duels
        set status = 'cancelled', ended_at = datetime('now'), winner_player_id = null, winner_seat = null, result_reason = 'Cancelled'
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
      const rows = options?.archived ? listArchived.all(guildId) : listLive.all(guildId);
      return rows.map(mapSession);
    },

    get(slug, guildId) {
      return mapSession(loadDuelRow(slug, guildId));
    },

    join(slug, guildId, playerId) {
      return joinTx(slug, guildId, playerId);
    },

    addPracticeBot(slug, guildId, organizerPlayerId, deck) {
      return addPracticeBotTx(slug, guildId, organizerPlayerId, deck);
    },

    setDeck(slug, guildId, playerId, deck) {
      return setDeckTx(slug, guildId, playerId, deck);
    },

    room(slug, guildId, playerId) {
      const row = loadDuelRow(slug, guildId);
      assertPlayerGuild(playerId, guildId);
      const session = mapSession(row);
      const seated = session.seats.find((seat) => seat.playerId === playerId);
      const role: DuelActorRole = seated ? "player" : "spectator";
      const mySeat = seated ? seated.seat : null;
      const terminal = isTerminalStatus(session.status);
      const engine = terminal ? snapshotForRole(row, mySeat) : null;
      return {
        session,
        role,
        mySeat,
        myDeck: seated ? ownDeck(row.id, playerId) : null,
        engine,
        metadataOnly: terminal && engine === null,
      };
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
      };
    },

    activate(slug, guildId, organizerPlayerId, seed, bundleVersion) {
      return activateTx(slug, guildId, organizerPlayerId, seed, bundleVersion);
    },

    recordCommand(slug, guildId, seat, command) {
      recordCommandTx(slug, guildId, seat, command);
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

    archive(slug, guildId, organizerPlayerId) {
      return archiveTx(slug, guildId, organizerPlayerId);
    },

    archiveDue(limit, archiveAfterMs) {
      return archiveDueTx(limit, archiveAfterMs);
    },
  };
}
