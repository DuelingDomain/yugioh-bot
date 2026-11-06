import type { RemoteRevealedHand, RemoteVisibility } from "../remote/types.js";
import { remoteUndoLabel } from "../remote/undo.js";
import { projectRemoteSnapshot, projectRemoteSpectator, projectRemoteState, projectRemoteTable } from "../remote/privacy.js";
import { randomUUID } from "node:crypto";
import { applyRemoteFormat, initialDeckChecks, isInRemoteDeck, normalizeRemoteFormat, proposeRemoteDeckAddition, REMOTE_OPEN_FORMATS, type RemoteDeckRegistration, type RemoteFormat, type RemoteReductionContext } from "../remote/deck-checks.js";
import { createSavedDeckService } from "./saved-decks.js";
import { createRemoteDeckRules } from "./remote-deck-rules.js";
import { initializeRemoteHandCounts } from "../remote/hand.js";
import type Database from "better-sqlite3";
import { isOwnerUser } from "../access/owner-access.js";
import { generateWebSlug } from "../util/web-slug.js";
import { REMOTE_DEFAULT_VISIBILITY, getRemoteGame, remoteActionSchema, remoteAssert, type RemoteAction, type RemoteEvent, type RemoteRoom, type RemoteSeat, type RemoteState, type RemoteStatus, type RemoteSystemAction, type RemoteTable, type SeatCount } from "../remote/index.js";

import { ensureRemoteMatch, initialRemoteMatch, remoteSideTimeoutDue, validateRemoteSideChange } from "../remote/match.js";
import type { RemoteBestOf, RemoteMatch } from "../remote/match-contract.js";

export const REMOTE_IDLE_WARNING_MS = 8 * 60_000;
export const REMOTE_IDLE_CLOSE_MS = 10 * 60_000;
/** Spectators on one table. Each one is a video stream per camera from the SFU; see docs/remote-duels/contract.md. */
export const REMOTE_SPECTATOR_CAP = 10;
/** A slot is free this long after the viewer's last room poll (30 s while connected), for a browser that left without saying so. */
export const REMOTE_SPECTATOR_SLOT_MS = 90_000;
type TableRow = { id: number; slug: string; guild_id: string; game_id: string; seat_count: SeatCount; status: RemoteStatus; solo: number;
  created_by: number; best_of: RemoteBestOf | null; last_seq: number; created_at: number; started_at: number | null; ended_at: number | null;
  last_event_at: number; idle_warning_at: number | null; end_reason: string | null; format_json: string | null; show_cards_set_from_deck: number; visibility: RemoteVisibility; revealed_hand?: RemoteRevealedHand | null };
type Row = TableRow & { state_json: string };
// Lists and idle notifications need metadata, never board/undo snapshots or event replay.
const tableColumns = "id,slug,guild_id,game_id,seat_count,status,solo,created_by,last_seq,created_at,started_at,ended_at,last_event_at,idle_warning_at,end_reason,format_json,show_cards_set_from_deck,visibility"
  .split(",").map(column => `t.${column}`).join(",") + ",json_extract(t.state_json,'$.match.bestOf') as best_of,json_extract(t.state_json,'$.revealedHand') as revealed_hand";
type EventRow = { seq: number; idempotency_key: string; actor_seat: number | null; user_id: number | null; action_json: string; created_at: number; effects_json: string | null; messages_json: string | null };
type EventMessage = { seat: number; text: string };
const event = (e: EventRow, seats: RemoteSeat[]): RemoteEvent => ({ id: e.idempotency_key, seq: e.seq, actorSeat: e.actor_seat, userId: e.user_id, at: e.created_at, action: JSON.parse(e.action_json),
  ...(e.effects_json ? { effects: JSON.parse(e.effects_json) } : {}),
  ...(e.messages_json ? { messages: (JSON.parse(e.messages_json) as EventMessage[]).map(message =>
    (seats.find(s => s.seat === message.seat)?.displayName ?? "Seat " + (message.seat + 1)) + message.text) } : {}) });

/** All writes serialize through BEGIN IMMEDIATE; a successful return is already committed. */
export function createRemoteDuelService(db: Database.Database, options: { dataDirectory?: string; openFormats?: readonly string[] } = {}) {
  const deckRules = createRemoteDeckRules(db, options.dataDirectory);
  const openFormats = options.openFormats ?? REMOTE_OPEN_FORMATS;
  /** A room can stay on the format it already has. Only a change to a format that is not open is refused. */
  const assertFormatOpen = (id: unknown, current?: string) =>
    remoteAssert(id === undefined || id === current || openFormats.includes(id as string), "This duel format is not open for Remote Duels yet");
  const transaction = <T>(work: () => T): T => db.transaction(work).immediate();
  function load(slug: string, guildId: string): Row {
    const row = db.prepare("select *,json_extract(state_json,'$.match.bestOf') as best_of,json_extract(state_json,'$.revealedHand') as revealed_hand from remote_tables where slug=? and guild_id=?").get(slug, guildId) as Row | undefined;
    remoteAssert(row, "Remote table not found", 404, "REMOTE_NOT_FOUND"); return row;
  }
  function loadTable(slug: string, guildId: string): TableRow {
    const row = db.prepare(`select ${tableColumns} from remote_tables t where t.slug=? and t.guild_id=?`).get(slug, guildId) as TableRow | undefined;
    remoteAssert(row, "Remote table not found", 404, "REMOTE_NOT_FOUND"); return row;
  }
  function seats(row: Pick<TableRow, "id">): RemoteSeat[] {
    return (db.prepare(`select seat,user_id,display_name,ready,0 as bot,deck_json from remote_seats where table_id=?
      union all select seat,null,display_name,1,1,deck_json from remote_bot_seats where table_id=? order by seat`).all(row.id, row.id) as
      { seat: number; user_id: number | null; display_name: string; ready: number; bot: number; deck_json: string | null }[])
      .map(s => ({ seat: s.seat, userId: s.user_id, bot: !!s.bot, displayName: s.display_name, ready: !!s.ready, deck: s.deck_json ? JSON.parse(s.deck_json) : null }));
  }
  function member(row: Row, userId: number): RemoteSeat {
    const seat = seats(row).find(s => s.userId === userId);
    if (!seat && db.prepare("select 1 from remote_spectators where table_id=? and user_id=?").get(row.id, userId)) remoteAssert(false, "Spectators cannot act at this table", 403, "SPECTATOR_READ_ONLY");
    remoteAssert(seat, "Remote table not found", 404, "REMOTE_NOT_FOUND"); return seat;
  }
  const spectatorCount = (row: Pick<TableRow, "id">, now = Date.now()) =>
    (db.prepare("select count(*) as n from remote_spectators where table_id=? and last_seen_at>?").get(row.id, now - REMOTE_SPECTATOR_SLOT_MS) as { n: number }).n;
  /** The last events, the same window as the socket snapshot, and always the spectator projection. */
  function spectatorView(row: Row) {
    const metadata = table(row);
    return projectRemoteSpectator({ table: metadata, state: readState(row),
      events: (db.prepare("select * from remote_events where table_id=? and seq>? order by seq").all(row.id, Math.max(0, row.last_seq - 50)) as EventRow[]).map(e => event(e, metadata.seats)) });
  }
  function assertWatchable(row: Pick<TableRow, "visibility" | "solo">) {
    remoteAssert(!row.solo, "Remote table not found", 404, "REMOTE_NOT_FOUND");
    remoteAssert(row.visibility === "public", "This table is private. No spectators.", 403, "TABLE_PRIVATE");
  }
  function table(row: TableRow): RemoteTable {
    return { bestOf: row.best_of ?? 1, slug: row.slug, guildId: row.guild_id, gameId: row.game_id, seatCount: row.seat_count, status: row.status, solo: !!row.solo, createdBy: row.created_by,
      createdAt: row.created_at, startedAt: row.started_at, endedAt: row.ended_at, lastEventAt: row.last_event_at,
      lastSeq: row.last_seq, endReason: row.end_reason, idleWarningAt: row.idle_warning_at, seats: seats(row), format: format(row), showCardsSetFromDeck: !!row.show_cards_set_from_deck, revealedHand: row.revealed_hand ?? "until-played", visibility: row.visibility };
  }
  const format = (row: TableRow): RemoteFormat => row.format_json ? JSON.parse(row.format_json) : normalizeRemoteFormat();
  function applyTableRule(state:RemoteState,row:Row):RemoteState {
    state.showCardsSetFromDeck=!!row.show_cards_set_from_deck;
    if(state.undo) state.undo.before.showCardsSetFromDeck=state.showCardsSetFromDeck;
    for (const entry of state.undoHistory ?? []) {
      if (entry.before) entry.before.showCardsSetFromDeck=state.showCardsSetFromDeck;
      if (entry.after) entry.after.showCardsSetFromDeck=state.showCardsSetFromDeck;
    }
    return state;
  }
  function readState(row: Row): RemoteState {
    const state = ensureRemoteMatch(JSON.parse(row.state_json) as RemoteState);
    state.deckChecks ??= initialDeckChecks(format(row));
    return state.undo && (!state.undoHistory || state.undoHistory.some(e=>!e.undone && !e.before)) ? replayState(row) : applyTableRule(state,row);
  }
  function replayState(row: Row): RemoteState {
    const game = getRemoteGame(row.game_id); let state = game.initialState({ seatCount: row.seat_count, bestOf: 1 });
    for (const e of db.prepare("select * from remote_events where table_id=? order by seq").all(row.id) as EventRow[]) {
      const action: RemoteEvent["action"] = JSON.parse(e.action_json);
      if (remoteActionSchema.safeParse(action).success) {
        const effects:RemoteReductionContext|undefined=e.effects_json ? JSON.parse(e.effects_json) : undefined;
        if(effects?.showCardsSetFromDeck!==undefined) state.showCardsSetFromDeck=effects.showCardsSetFromDeck;
        state = game.reduce(state, action as RemoteAction, {...effects,replay:true});
      }
      else if (action.type === "table.created") {
        state.match = initialRemoteMatch(row.seat_count, action.bestOf ?? 1);
        if(action.format) state = applyRemoteFormat(state, action.format);
        state.showCardsSetFromDeck = action.showCardsSetFromDeck ?? false;
        state.revealedHand = action.revealedHand ?? "until-played";
      }
      else if (action.type === "table.configured") {
        state = applyRemoteFormat(state, action.format); state.deckChecks.registrations = action.registrations;
        if (action.bestOf !== undefined) state.match = initialRemoteMatch(row.seat_count, action.bestOf);
        state.showCardsSetFromDeck = action.showCardsSetFromDeck ?? state.showCardsSetFromDeck ?? true;
        state.revealedHand = action.revealedHand ?? state.revealedHand ?? "until-played";
      }
      else if (action.type === "table.started" && action.handCounts===1) initializeRemoteHandCounts(state);
      else if (action.type === "seat.deck") { state.deckChecks.registrations[action.seat] = action.registration; state.undo = null; delete state.undoHistory; }
      else if (action.type === "seat.left") delete state.deckChecks.registrations[action.seat];
    }
    return applyTableRule(state,row);
  }
  function syncDecks(row: Row, state: RemoteState) {
    for (const seat of seats(row)) {
      const deck = state.deckChecks.registrations[seat.seat] ?? null;
      db.prepare("update " + (seat.bot ? "remote_bot_seats" : "remote_seats") + " set saved_deck_id=?,deck_json=? where table_id=? and seat=?")
        .run(deck?.savedDeckId ?? null, deck ? JSON.stringify(deck) : null, row.id, seat.seat);
    }
  }
  function assertDeckReady(row: Row, seat: RemoteSeat) {
    if (seat.deck) {
      const report = deckRules.inspect(format(row), seat.deck.deck);
      remoteAssert(!report.issues.length, report.issues.map(i => i.message).join("\n"), 409, "DECK_INVALID");
    }
  }
  function room(row: Row, userId: number, afterSeq?: number, knownState?: RemoteState): RemoteRoom {
    const viewer = member(row, userId);
    remoteAssert(afterSeq === undefined || (Number.isSafeInteger(afterSeq) && afterSeq >= 0), "Invalid event cursor");
    const events = db.prepare(`select * from remote_events where table_id=? and seq>? order by seq limit 200`)
      .all(row.id, afterSeq ?? Math.max(0, row.last_seq - 50)) as EventRow[];
    const metadata = table(row);
    const projected=projectRemoteSnapshot({table:metadata,state:knownState ?? readState(row),events:events.map(e=>event(e,metadata.seats))}, privateSeats(row,userId));
    return {...projected.table,mySeat:viewer.seat,state:projected.state,events:projected.events,isDeveloper:isOwnerUser(userId),spectatorCount:spectatorCount(row)};
  }
  function privateSeats(row:Row,userId:number):Set<number> {
    return new Set(seats(row).filter(s=>s.userId===userId || (!!row.solo && row.created_by===userId && s.bot)).map(s=>s.seat));
  }
  function append(row: TableRow, action: RemoteAction | RemoteSystemAction, at: number, userId: number | null = null, actorSeat: number | null = null, activity = true, effects?: RemoteReductionContext, messages?: EventMessage[]) {
    const id = "idempotencyKey" in action ? action.idempotencyKey : `sys:${randomUUID()}`;
    db.prepare("insert into remote_events(table_id,seq,idempotency_key,actor_seat,user_id,action_json,created_at,effects_json,messages_json) values(?,?,?,?,?,?,?,?,?)")
      .run(row.id, row.last_seq + 1, id, actorSeat, userId, JSON.stringify(action), at, effects ? JSON.stringify(effects) : null, messages?.length ? JSON.stringify(messages) : null);
    db.prepare(`update remote_tables set last_seq=last_seq+1${activity ? ",last_event_at=?,idle_warning_at=null" : ""} where id=?`)
      .run(...(activity ? [at, row.id] : [row.id]));
  }
  function assertOpen(row: Row, now: number) {
    remoteAssert(row.status !== "ended", "Remote table has ended", 409, "TABLE_ENDED");
    remoteAssert(now - row.last_event_at < REMOTE_IDLE_CLOSE_MS, "Remote table expired from inactivity", 409, "TABLE_IDLE");
  }
  function name(value: string) { remoteAssert(typeof value === "string" && value.trim().length > 0 && value.length <= 100, "Invalid display name"); return value.trim(); }
  const api = {
    create(input: { guildId: string; userId: number; displayName: string; gameId: string; seatCount: SeatCount; bestOf?: RemoteBestOf; solo?: boolean; format?: unknown; rules?: unknown; showCardsSetFromDeck?: boolean; revealedHand?: RemoteRevealedHand; visibility?: RemoteVisibility }, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const game = getRemoteGame(input.gameId);
        remoteAssert(input.visibility === undefined || input.visibility === "public" || input.visibility === "private", "Invalid visibility");
        remoteAssert(game.seatsAllowed.includes(input.seatCount) && input.guildId, "Invalid table settings");
        remoteAssert(input.solo === undefined || typeof input.solo === "boolean", "Invalid solo setting");
        remoteAssert(input.revealedHand === undefined || input.revealedHand === 'until-played' || input.revealedHand === 'one-turn', 'Invalid revealed hand setting');
        remoteAssert(input.showCardsSetFromDeck === undefined || typeof input.showCardsSetFromDeck === "boolean", "Invalid Deck publicity setting");
        const displayName = name(input.displayName);
        remoteAssert(db.prepare("select 1 from users where id=?").get(input.userId), "User not found", 404);
        const slug = generateWebSlug();
        assertFormatOpen(input.format);
        const chosenFormat = normalizeRemoteFormat(input.format, input.rules,input.seatCount);
        const initial = applyRemoteFormat(game.initialState({ seatCount: input.seatCount, bestOf: input.bestOf ?? (input.solo ? 1 : input.seatCount === 2 ? 3 : 1) }), chosenFormat);
        initial.showCardsSetFromDeck = input.showCardsSetFromDeck ?? true;
        initial.revealedHand = input.revealedHand ?? "until-played";
        db.prepare("insert into remote_tables(slug,guild_id,game_id,seat_count,status,created_by,state_json,created_at,last_event_at,solo,format_json,show_cards_set_from_deck,visibility) values(?,?,?,?,'lobby',?,?,?,?,?,?,?,?)")
          // Same default as normal duels: public. A solo test table is always private, as a test duel is.
          .run(slug, input.guildId, input.gameId, input.seatCount, input.userId, JSON.stringify(initial), now, now, Number(input.solo ?? false), JSON.stringify(chosenFormat), Number(initial.showCardsSetFromDeck), input.solo ? "private" : input.visibility ?? REMOTE_DEFAULT_VISIBILITY);
        const row = load(slug, input.guildId);
        db.prepare("insert into remote_seats(table_id,seat,user_id,display_name) values(?,0,?,?)").run(row.id, input.userId, displayName);
        append(row, { type: "table.created", gameId: input.gameId, seatCount: input.seatCount, bestOf: initial.match.bestOf, solo: input.solo ?? false, format: chosenFormat, showCardsSetFromDeck: initial.showCardsSetFromDeck, revealedHand: initial.revealedHand }, now, input.userId, 0);
        append(load(slug, input.guildId), { type: "seat.joined", seat: 0, userId: input.userId }, now, input.userId, 0);
        if (input.solo) for (let seat = 1; seat < input.seatCount; seat++) {
          db.prepare("insert into remote_bot_seats(table_id,seat,display_name) values(?,?,?)").run(row.id, seat, `Test Bot ${seat}`);
          append(load(slug, input.guildId), { type: "seat.joined", seat, userId: null, bot: true }, now, input.userId, 0);
        }
        return room(load(slug, input.guildId), input.userId);
      });
    },
    configure(slug: string, guildId: string, userId: number, input: { format?: unknown; bestOf?: RemoteBestOf; rules?: unknown; showCardsSetFromDeck?: boolean; revealedHand?: RemoteRevealedHand }, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId); const viewer = member(row, userId); assertOpen(row, now);
        remoteAssert(row.created_by === userId, "Only the host can choose rules", 403);
        remoteAssert(row.status === "lobby", "Rules can only change in the lobby", 409);
        remoteAssert(input.revealedHand === undefined || input.revealedHand === 'until-played' || input.revealedHand === 'one-turn', 'Invalid revealed hand setting');
        remoteAssert(input.showCardsSetFromDeck === undefined || typeof input.showCardsSetFromDeck === "boolean", "Invalid Deck publicity setting");
        assertFormatOpen(input.format, format(row).id);
        const chosenFormat = input.format === undefined && input.rules === undefined ? format(row) : normalizeRemoteFormat(input.format ?? format(row).id, input.rules,row.seat_count);
        const state = applyRemoteFormat(readState(row), chosenFormat);
        if (input.bestOf !== undefined) state.match = initialRemoteMatch(row.seat_count, input.bestOf);
        state.showCardsSetFromDeck = input.showCardsSetFromDeck ?? !!row.show_cards_set_from_deck;
        state.revealedHand = input.revealedHand ?? state.revealedHand ?? "until-played";
        for (const registration of Object.values(state.deckChecks.registrations))
          if (registration) registration.validation = deckRules.inspect(chosenFormat, registration.deck);
        db.prepare("update remote_tables set format_json=?,state_json=?,show_cards_set_from_deck=? where id=?").run(JSON.stringify(chosenFormat), JSON.stringify(state), Number(state.showCardsSetFromDeck), row.id);
        db.prepare("update remote_seats set ready=0 where table_id=?").run(row.id);
        syncDecks(row, state);
        append(row, { type: "table.configured", format: chosenFormat, bestOf: state.match.bestOf, registrations: state.deckChecks.registrations, showCardsSetFromDeck: state.showCardsSetFromDeck, revealedHand: state.revealedHand }, now, userId, viewer.seat);
        return room(load(slug, guildId), userId);
      });
    },
    selectDeck(slug: string, guildId: string, userId: number, input: { savedDeckId: number | null; seat?: number }, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId); const viewer = member(row, userId); assertOpen(row, now);
        remoteAssert(row.status === "lobby", "Choose saved decks in the lobby", 409);
        const target = seats(row).find(s => s.seat === (input.seat ?? viewer.seat));
        remoteAssert(target && (target.userId === userId || (row.solo && row.created_by === userId && target.bot)), "Only the seat owner can select its deck", 403);
        remoteAssert(input.savedDeckId === null || (Number.isSafeInteger(input.savedDeckId) && input.savedDeckId > 0), "Invalid saved deck");
        let registration: RemoteDeckRegistration | null = null;
        if (input.savedDeckId !== null) {
          remoteAssert(db.prepare("select 1 from saved_decks where id=? and guild_id=? and owner_user_id=?").get(input.savedDeckId, guildId, userId), "Saved deck not found", 404);
          const saved = createSavedDeckService(db).get(input.savedDeckId, guildId, userId);
          registration = { savedDeckId: saved.id, name: saved.name, deck: structuredClone(saved.deck), validation: deckRules.inspect(format(row), saved.deck) };
        }
        const state = readState(row); state.deckChecks.registrations[target.seat] = registration; state.undo = null; delete state.undoHistory;
        db.prepare("update remote_tables set state_json=? where id=?").run(JSON.stringify(state), row.id);
        if (!target.bot) db.prepare("update remote_seats set ready=0 where table_id=? and seat=?").run(row.id, target.seat);
        syncDecks(row, state);
        append(row, { type: "seat.deck", seat: target.seat, registration }, now, userId, viewer.seat);
        return room(load(slug, guildId), userId);
      });
    },
    get(slug: string, guildId: string, userId: number, afterSeq?: number): RemoteRoom {
      return db.transaction(() => room(load(slug, guildId), userId, afterSeq))();
    },
    searchCandidates(slug: string, guildId: string, userId: number, seat: number, recentCardId: number) {
      const row = load(slug, guildId); member(row, userId);
      remoteAssert(privateSeats(row, userId).has(seat), 'Only the seat owner can query its deck', 403);
      remoteAssert(Number.isSafeInteger(recentCardId) && recentCardId > 0 && recentCardId <= 0xffffffff, 'Invalid source card');
      return deckRules.search(readState(row), seat, recentCardId);
    },
    /**
     * Opens the table for a person with no seat, and keeps their slot while they poll. A seated person gets their normal room.
     * It writes only remote_spectators: no event, no seat change, no idle clock, so a spectator never holds a table open.
     */
    spectate(slug: string, guildId: string, userId: number, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId);
        if (seats(row).some(s => s.userId === userId)) return room(row, userId);
        assertWatchable(row);
        if (row.status !== "ended" && now - row.last_event_at < REMOTE_IDLE_CLOSE_MS) {
          db.prepare("delete from remote_spectators where table_id=? and last_seen_at<=?").run(row.id, now - REMOTE_SPECTATOR_SLOT_MS);
          const holding = db.prepare("select 1 from remote_spectators where table_id=? and user_id=?").get(row.id, userId);
          remoteAssert(holding || spectatorCount(row, now) < REMOTE_SPECTATOR_CAP, `This table has reached its limit of ${REMOTE_SPECTATOR_CAP} spectators. Try again soon.`, 409, "SPECTATORS_FULL");
          db.prepare("insert into remote_spectators(table_id,user_id,last_seen_at) values(?,?,?) on conflict(table_id,user_id) do update set last_seen_at=excluded.last_seen_at").run(row.id, userId, now);
        }
        const view = spectatorView(row);
        return { ...view.table, state: view.state, events: view.events, mySeat: -1, spectator: true, isDeveloper: false, spectatorCount: spectatorCount(row, now) };
      });
    },
    stopSpectating(slug: string, guildId: string, userId: number): void {
      const row = loadTable(slug, guildId);
      db.prepare("delete from remote_spectators where table_id=? and user_id=?").run(row.id, userId);
    },
    /** For the video and socket routes: the seat, null for a spectator with a live slot, a refusal for anyone else. */
    connectionAccess(slug: string, guildId: string, userId: number, now = Date.now()) {
      const row = loadTable(slug, guildId);
      const seat = seats(row).find(s => s.userId === userId);
      if (!seat) {
        remoteAssert(row.visibility === "public" && !row.solo && db.prepare("select 1 from remote_spectators where table_id=? and user_id=? and last_seen_at>?").get(row.id, userId, now - REMOTE_SPECTATOR_SLOT_MS), "Remote table not found", 404, "REMOTE_NOT_FOUND");
      }
      return { slug: row.slug, status: row.status, solo: !!row.solo, lastEventAt: row.last_event_at, seat: seat?.seat ?? null, displayName: seat?.displayName ?? "Spectator" };
    },
    /**
     * Who may hold LiveKit media now, for non-solo tables that are live or ended in the last 15 minutes: the seated users and the live spectator slots.
     * A private table has no slots, but a player who leaves its lobby must still lose the rooms.
     */
    mediaRosters(now = Date.now(), slug?: string): { slug: string; seated: number[]; slots: number[] }[] {
      const rows = db.prepare(`select id,slug,status,visibility from remote_tables where solo=0 and (status!='ended' or ended_at>?)${slug ? " and slug=?" : ""}`)
        .all(...(slug ? [now - 15 * 60_000, slug] : [now - 15 * 60_000])) as { id: number; slug: string; status: string; visibility: string }[];
      return rows.map(row => ({
        slug: row.slug,
        seated: (db.prepare("select user_id from remote_seats where table_id=?").all(row.id) as { user_id: number }[]).map(seat => seat.user_id),
        slots: row.status === "ended" || row.visibility !== "public" ? [] : (db.prepare("select user_id from remote_spectators where table_id=? and last_seen_at>?").all(row.id, now - REMOTE_SPECTATOR_SLOT_MS) as { user_id: number }[]).map(slot => slot.user_id),
      }));
    },
    list(guildId: string, userId: number, scope: "mine" | "open" | "live" = "mine"): RemoteTable[] {
      // "open": what a person can join or watch, as in the normal duel list. A private table is reached only by its invite.
      const rows = db.prepare(`select ${tableColumns} from remote_tables t where t.guild_id=? and ${scope === "open"
        ? "t.solo=0 and t.visibility='public' and t.status!='ended'"
        : `exists(select 1 from remote_seats s where s.table_id=t.id and s.user_id=?)${scope === "live" ? " and t.status!='ended'" : ""}`} order by t.created_at desc,t.id desc limit 100`)
        .all(...(scope === "open" ? [guildId] : [guildId, userId])) as TableRow[];
      return rows.map(row => projectRemoteTable(table(row)));
    },
    join(slug: string, guildId: string, userId: number, displayName: string, requestedSeat?: number, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId); assertOpen(row, now);
        if (seats(row).some(s => s.userId === userId)) return room(row, userId);
        remoteAssert(!row.solo, "Solo tables only accept their owner", 403, "SOLO_OWNER_ONLY");
        remoteAssert(row.status === "lobby", "Table is no longer in its lobby", 409);
        const occupied = seats(row).map(s => s.seat);
        const seat = requestedSeat ?? Array.from({ length: row.seat_count }, (_, n) => n).find(n => !occupied.includes(n));
        remoteAssert(seat !== undefined && Number.isInteger(seat) && seat >= 0 && seat < row.seat_count && !occupied.includes(seat), "Seat is unavailable", 409, "SEAT_UNAVAILABLE");
        const display = name(displayName);
        db.prepare("insert into remote_seats(table_id,seat,user_id,display_name) values(?,?,?,?)").run(row.id, seat, userId, display);
        db.prepare("delete from remote_spectators where table_id=? and user_id=?").run(row.id, userId);
        append(row, { type: "seat.joined", seat, userId }, now, userId, seat);
        return room(load(slug, guildId), userId);
      });
    },
    leave(slug: string, guildId: string, userId: number, now = Date.now()): RemoteTable {
      return transaction(() => {
        const row = load(slug, guildId); const s = member(row, userId); assertOpen(row, now);
        remoteAssert(row.status === "lobby", "Use player.concede to leave an active game", 409);
        if (row.created_by === userId) {
          append(row, { type: "table.ended", reason: "creator-left" }, now, userId, s.seat);
          db.prepare("update remote_tables set status='ended',ended_at=?,end_reason='creator-left' where id=?").run(now, row.id);
        } else {
          db.prepare("delete from remote_seats where table_id=? and user_id=?").run(row.id, userId);
          const state = readState(row); delete state.deckChecks.registrations[s.seat];
          db.prepare("update remote_tables set state_json=? where id=?").run(JSON.stringify(state), row.id);
          append(row, { type: "seat.left", seat: s.seat, userId }, now, userId, s.seat);
        }
        return projectRemoteTable(table(loadTable(slug, guildId)));
      });
    },
    ready(slug: string, guildId: string, userId: number, ready: boolean, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId); const s = member(row, userId); assertOpen(row, now);
        remoteAssert(row.status === "lobby" && typeof ready === "boolean", "Ready is only available in the lobby", 409);
        if (ready) assertDeckReady(row, s);
        if (s.ready === ready) return room(row, userId);
        db.prepare("update remote_seats set ready=? where table_id=? and user_id=?").run(Number(ready), row.id, userId);
        append(row, { type: "seat.ready", seat: s.seat, ready }, now, userId, s.seat);
        return room(load(slug, guildId), userId);
      });
    },
    start(slug: string, guildId: string, userId: number, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId); member(row, userId); assertOpen(row, now);
        remoteAssert(row.created_by === userId, "Only the creator can start", 403);
        if (row.status === "active") return room(row, userId);
        const all = seats(row);
        remoteAssert(all.length === row.seat_count && all.every(s => s.ready), "All seats must be filled and ready", 409);
        for (const seat of all) assertDeckReady(row, seat);
        const state=readState(row);initializeRemoteHandCounts(state);
        db.prepare("update remote_tables set status='active',started_at=?,state_json=? where id=?").run(now, JSON.stringify(state), row.id);
        append(row, { type: "table.started", handCounts:1 }, now, userId, member(row, userId).seat);
        return room(load(slug, guildId), userId);
      });
    },
    act(slug: string, guildId: string, userId: number, input: { baseSeq: number; action: RemoteAction; onTiming?:(stage:'reducer',ms:number)=>void }, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId); const s = member(row, userId);
        const parsed = remoteActionSchema.safeParse(input.action); remoteAssert(parsed.success, "Invalid remote action");
        const command = parsed.data;
        const delegatedBot = row.solo && row.created_by === userId && seats(row).some(seat => seat.seat === command.actorSeat && seat.bot && seat.userId === null);
        remoteAssert(command.actorSeat === s.seat || delegatedBot, "Actor seat does not match session or an owned solo bot", 403, "ACTOR_SEAT_MISMATCH");
        remoteAssert(!command.idempotencyKey.startsWith("sys:"), "Reserved idempotency key");
        const old = db.prepare("select * from remote_events where table_id=? and idempotency_key=?").get(row.id, command.idempotencyKey) as EventRow | undefined;
        if (old) {
          const { at: _oldTime, ...oldAction } = JSON.parse(old.action_json);
          const { at: _time, ...newAction } = command;
          remoteAssert(old.user_id === userId && JSON.stringify(oldAction) === JSON.stringify(newAction), "Idempotency key was used for a different action", 409, "IDEMPOTENCY_CONFLICT");
          return room(row, userId);
        }
        // A timeout is a server-clock check. Another caller or the sweep may already
        // have handled it; a stale sequence must never turn that race into an error.
        const timeoutState = command.type === "side.timeout" ? readState(row) : undefined;
        if (timeoutState && (row.status !== "active" || !remoteSideTimeoutDue(timeoutState, now))) return room(row, userId, undefined, timeoutState);
        remoteAssert(Number.isSafeInteger(input.baseSeq) && input.baseSeq >= 0, "Invalid base sequence");
        if (command.type !== "side.timeout") remoteAssert(input.baseSeq === row.last_seq, "Stale sequence; fetch state and retry", 409, "STALE_SEQUENCE");
        remoteAssert(now - row.last_event_at < REMOTE_IDLE_CLOSE_MS && (row.status === "active" || (row.end_reason === "game" && command.type === "undo")), "Table is not active", 409, "TABLE_ENDED");
        const action = { ...command, at: now };
        const before = timeoutState ?? readState(row);
        const effects: RemoteReductionContext = {showCardsSetFromDeck:before.showCardsSetFromDeck,undoVersion:1,matchFlowVersion:1,twinPlacementGuard:5,fieldFaceState:1,pileArrivalGuard:2,handKnowledge:1,handReview:1,handCountCorrections:1};
        if(command.type==='hand.add')effects.privateHandIdentity=command.source==='deck'&&before.showCardsSetFromDeck===false||command.source==='field'&&
          !!before.seats[command.actorSeat].twin.find(c=>(c.cardId??c.passcode)===command.cardId&&['monster','extra-monster','spell-trap','field','pendulum'].includes(c.zone)&&!c.faceUp);
        if(command.type==='deck.count')effects.privateHandIdentity=true;
        if(command.type==='twin.move'&&command.zone==='hand')effects.privateHandIdentity=!!before.seats[command.seat].twin.find(c=>c.ref===command.cardRef&&!c.faceUp);
        if (command.type === "side.ready" && row.solo && command.actorSeat === s.seat) effects.soloBotSeats = seats(row).filter(seat => seat.bot).map(seat => seat.seat);
        if(command.type==="card.identified" || command.type==="cards.identified") {
          effects.privateRecognition=(command.type==="card.identified" ? [command] : command.cards).some(card=>{
            const twin=card.cardRef ? before.seats[command.seat].twin.find(c=>c.ref===card.cardRef) : undefined;
            const revealsOrigin=!!twin && !["deck","extra"].includes(twin.zone) && before.effectTracking?.origins.some(o=>o.seat===command.seat && o.ref===twin.ref && (before.showCardsSetFromDeck!==false || (o.destination==="set" && twin.zone!=="hand")));
            return !revealsOrigin && (twin ? !twin.faceUp || ["hand","deck","extra"].includes(twin.zone) : ["hand","deck","extra"].includes(card.zone ?? ""));
          });
        }
        if(command.type==="effect.choose") effects.publicEffectChoice=before.showCardsSetFromDeck!==false;
        if(command.type==="effect.activated") {
          const twin=command.source.cardRef ? before.seats[command.actorSeat].twin.find(c=>c.ref===command.source.cardRef) : undefined;
          remoteAssert(!command.source.cardRef || twin,"Unknown source card",409);
          effects.effect=deckRules.effect({...command.source,...(twin ? {cardId:twin.cardId ?? twin.passcode ?? command.source.cardId,name:twin.name ?? command.source.name} : {})},before.deckChecks.registrations[command.actorSeat]?.deck.main,before.seats[command.actorSeat].twin);
        }
        const recognized: { cardId?: number; passcode?: number }[] = command.type === "card.identified" ? [command] : command.type === "cards.identified" ? command.cards :
          command.type === "twin.flip" && command.faceUp && command.cardId ? [{cardId:command.cardId}] : command.type === "twin.place" ? [command.card] : command.type === "deck.add" ? [command] :
          command.type === "effect.activated" && effects.effect ? [{cardId:effects.effect.source.cardId}] :
          command.type === "effect.choose" || command.type === "hand.add" || command.type === "hand.reveal" ? [{cardId:command.cardId}, ...(command.type === "hand.add" && command.by ? [{cardId:command.by.cardId}] : [])] : [];
        const codes = recognized.flatMap(c => c.cardId ?? c.passcode ? [c.cardId ?? c.passcode!] : []);
        const registrations = before.deckChecks.registrations;
        const deckCodes = Object.values(registrations).flatMap(r => r ? [...r.deck.main, ...r.deck.extra, ...r.deck.side, ...(r.deck.deckMaster ? [r.deck.deckMaster] : [])] : []);
        const twinCodes = before.seats.flatMap(s => s.twin.flatMap(c => c.cardId ?? c.passcode ? [c.cardId ?? c.passcode!] : []));
        effects.facts = deckRules.facts(format(row), [...new Set([...codes, ...deckCodes, ...twinCodes])]);
        if (command.type === "side.swap") {
          const registration = registrations[command.actorSeat];
          remoteAssert(registration, "Select an attached deck before side decking", 409);
          const deck = { ...registration.deck, ...command.deckChanges };
          validateRemoteSideChange(registration.deck, deck);
          const validation = deckRules.inspect(format(row), deck);
          remoteAssert(!validation.issues.length, validation.issues.map(i => i.message).join("\n"), 409, "DECK_INVALID");
          effects.registration = { ...structuredClone(registration), deck, validation };
        }
        if (command.type === "card.identified" || command.type === "cards.identified" || command.type === "deck.add" || command.type === "twin.flip" && command.faceUp && command.cardId) {
          const code = codes.at(-1); const fact = code ? effects.facts[code] : undefined;
          const registration = registrations[command.seat];
          let candidate: RemoteDeckRegistration | undefined;
          if (registration && fact) candidate = proposeRemoteDeckAddition(registration, fact, deck => deckRules.inspect(format(row), deck));
          const registeredCodes = registration ? [...registration.deck.main, ...registration.deck.extra, ...registration.deck.side, registration.deck.deckMaster] : [];
          effects.identified = { notInDecklist: !!registration && (fact ? !isInRemoteDeck(registration.deck, fact, effects.facts) : !registeredCodes.includes(code)),
            addErrors: !registration ? ["Select a saved deck in the lobby first."] : candidate ? candidate.validation.issues.map(i => i.message) : ["Card validation metadata is unavailable."] };
          if (command.type === "deck.add") {
            remoteAssert(command.seat === command.actorSeat, "Only the deck owner can edit their decklist", 403);
            remoteAssert(candidate && !candidate.validation.issues.length, effects.identified.addErrors.join("\n") || "Invalid deck addition", 409, "DECK_INVALID");
            effects.registration = candidate;
          }
        }
        const reduceAt=performance.now();
        const state = getRemoteGame(row.game_id).reduce(before, action, effects);
        input.onTiming?.('reducer',performance.now()-reduceAt);
        if(state===before)return room(row,userId,undefined,before);
        const messages = state.deckChecks.flags.filter(f => !f.private&&!before.deckChecks.flags.some(old => old.id === f.id))
          .map(f => ({ seat: f.seat, text: ": " + f.message }));
        if(command.type==="effect.choose" && effects.publicEffectChoice) {
          const origin=state.effectTracking?.origins.find(o=>o.id===command.originId);
          if(origin?.announcedCard) messages.push({seat:origin.seat,text:origin.destination==="set" ? `: Set from Deck by ${origin.source.name}: ${origin.announcedCard.name}` : `: ${origin.announcedCard.name} added to hand by ${origin.source.name}`});
        }
        if (command.type === "hand.add" || command.type === "hand.reveal") {
          const cardName = effects.privateHandIdentity ? 'a card' : effects.facts[command.cardId]?.name ?? "Card " + command.cardId;
          const by = command.type === "hand.add" && command.by;
          const effectName = by ? effects.facts[by.cardId]?.name ?? 'Card '+by.cardId : undefined;
          messages.push({seat:command.actorSeat, text:command.type === "hand.add" ? command.source==='field'&&effects.privateHandIdentity ? ' a Set card returned to hand' : ` added ${cardName} to hand${effectName ? ` (${effectName}'s effect)` : ''}` : ` revealed ${cardName} in hand`});
        }
        if(command.type==='twin.move'&&command.zone==='hand'&&effects.privateHandIdentity)messages.push({seat:command.actorSeat,text:' a Set card returned to hand'});
        if(command.type==='hand.count')messages.push({seat:command.actorSeat,text:` set hand to ${state.seats[command.actorSeat].handCount}`});
        if(command.type==='hand.forget')messages.push({seat:command.actorSeat,text:' forgot a known card'});
        if(command.type==='hand.draw')messages.push({seat:command.actorSeat,text:` drew ${command.count} card${command.count===1?'':'s'}`});
        if (command.type === "deck.add") messages.unshift({ seat: command.actorSeat, text: " added " + effects.facts[command.cardId]?.name + " to their decklist" });
        if (command.type === "deck.flag.dismiss") messages.push({ seat: command.actorSeat, text: " dismissed flag " + command.flagId + " as wrong: " + command.reason });
        if (command.type === "twin.merge") messages.push({ seat: command.actorSeat, text: " merged instances " + (command.keepInstanceId ?? command.keepRef) + " and " + (command.removeInstanceId ?? command.removeRef) + ": " + command.reason });
        if (command.type === "undo") {
          const target = before.undoHistory?.find(e=>e.actionId===command.targetActionId);
          if (target) messages.push({seat:command.actorSeat,text:": Undone: "+remoteUndoLabel(target.action, target.after)});
        }
        append(row, action, now, userId, command.actorSeat, true, effects, messages);
        syncDecks(row, state);
        const matchDone = state.match.phase === "done";
        db.prepare("update remote_tables set state_json=?,status=?,ended_at=?,end_reason=? where id=?")
          .run(JSON.stringify(state), matchDone ? "ended" : "active", matchDone ? now : null, matchDone ? "game" : null, row.id);
        return room(load(slug, guildId), userId, undefined, state);
      });
    },
    /** Trusted server transport only. Never expose this without the session/member guard. */
    snapshot(slug: string, guildId: string, userId?: number) {
      return db.transaction(() => {
        const row = load(slug, guildId);
        const metadata = table(row);
        if(userId!==undefined) member(row,userId);
        return projectRemoteSnapshot({ table: metadata, state: readState(row),
          events: (db.prepare("select * from remote_events where table_id=? and seq>? order by seq").all(row.id, Math.max(0, row.last_seq - 50)) as EventRow[]).map(e => event(e, metadata.seats)) },userId===undefined ? new Set() : privateSeats(row,userId));
      })();
    },
    /** Trusted server transport only: what the socket pushes to the spectators of a table. */
    spectatorSnapshot(slug: string, guildId: string) {
      return db.transaction(() => spectatorView(load(slug, guildId)))();
    },
    replay(slug: string, guildId: string, userId: number): RemoteState {
      return db.transaction(() => {
        const row = load(slug, guildId); member(row, userId);
        return projectRemoteState(replayState(row),privateSeats(row,userId));
      })();
    },
    /**
     * A seated player is still here (camera on, or recent input). Resets the idle clock and clears a pending warning.
     * It adds no event and does not move last_seq, so no client has to resync for it.
     */
    touch(slug: string, guildId: string, userId: number, now = Date.now()): { lastEventAt: number } {
      return transaction(() => {
        const row = load(slug, guildId); member(row, userId); assertOpen(row, now);
        db.prepare("update remote_tables set last_event_at=?,idle_warning_at=null where id=?").run(now, row.id);
        return { lastEventAt: now };
      });
    },
    /** Warnings append an event but deliberately leave last_event_at unchanged. Presence never calls this service's writes. */
    sweepIdle(now = Date.now()): RemoteTable[] {
      return transaction(() => {
        const changed: RemoteTable[] = [];
        db.prepare("delete from remote_spectators where last_seen_at<=?").run(now - REMOTE_SPECTATOR_SLOT_MS);
        // The existing WS sweep publishes every changed table, including timer transitions.
        const sidingRows = db.prepare("select slug,guild_id,seat_count,json_extract(state_json,'$.match') as match_json from remote_tables where status='active' and json_extract(state_json,'$.match.phase')='siding'")
          .all() as { slug: string; guild_id: string; seat_count: SeatCount; match_json: string }[];
        for (const candidate of sidingRows) {
          if (!remoteSideTimeoutDue({ match: JSON.parse(candidate.match_json) as RemoteMatch, seatCount: candidate.seat_count }, now)) continue;
          const row = load(candidate.slug, candidate.guild_id);
          const before = readState(row);
          const action: RemoteAction = { type: "side.timeout", actorSeat: 0, idempotencyKey: `sys:${randomUUID()}`, at: now };
          const effects: RemoteReductionContext = { matchFlowVersion: 1 };
          const state = getRemoteGame(row.game_id).reduce(before, action, effects);
          append(row, action, now, null, null, true, effects);
          db.prepare("update remote_tables set state_json=? where id=?").run(JSON.stringify(state), row.id);
          changed.push(table(loadTable(row.slug, row.guild_id)));
        }
        const due = db.prepare(`select ${tableColumns} from remote_tables t where t.status!='ended' and t.last_event_at<=?`).all(now - REMOTE_IDLE_WARNING_MS) as TableRow[];
        for (const row of due) {
          // A table that started less than the close time ago is never closed as idle, whatever its last event says.
          const startedRecently = row.started_at !== null && now - row.started_at < REMOTE_IDLE_CLOSE_MS;
          if (now - row.last_event_at >= REMOTE_IDLE_CLOSE_MS && !startedRecently) {
            append(row, { type: "table.ended", reason: "idle" }, now, null, null, false);
            db.prepare("update remote_tables set status='ended',ended_at=?,end_reason='idle' where id=?").run(now, row.id);
          } else if (row.idle_warning_at === null) {
            append(row, { type: "idle.warning", closesAt: row.last_event_at + REMOTE_IDLE_CLOSE_MS }, now, null, null, false);
            db.prepare("update remote_tables set idle_warning_at=? where id=?").run(now, row.id);
          } else continue;
          changed.push(table(loadTable(row.slug, row.guild_id)));
        }
        return changed;
      });
    },
  };
  return api;
}
export type RemoteDuelService = ReturnType<typeof createRemoteDuelService>;
