import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { generateWebSlug } from "../util/web-slug.js";
import { getRemoteGame, remoteActionSchema, remoteAssert, type RemoteAction, type RemoteEvent, type RemoteRoom, type RemoteSeat, type RemoteState, type RemoteStatus, type RemoteSystemAction, type RemoteTable, type SeatCount } from "../remote/index.js";

export const REMOTE_IDLE_WARNING_MS = 8 * 60_000;
export const REMOTE_IDLE_CLOSE_MS = 10 * 60_000;
type Row = { id: number; slug: string; guild_id: string; game_id: string; seat_count: SeatCount; status: RemoteStatus;
  created_by: number; state_json: string; last_seq: number; created_at: number; started_at: number | null; ended_at: number | null;
  last_event_at: number; idle_warning_at: number | null; end_reason: string | null };
type EventRow = { seq: number; idempotency_key: string; actor_seat: number | null; user_id: number | null; action_json: string; created_at: number };
const event = (e: EventRow): RemoteEvent => ({ id: e.idempotency_key, seq: e.seq, actorSeat: e.actor_seat, userId: e.user_id, at: e.created_at, action: JSON.parse(e.action_json) });

/** All writes serialize through BEGIN IMMEDIATE; a successful return is already committed. */
export function createRemoteDuelService(db: Database.Database) {
  const transaction = <T>(work: () => T): T => db.transaction(work).immediate();
  function load(slug: string, guildId: string): Row {
    const row = db.prepare("select * from remote_tables where slug=? and guild_id=?").get(slug, guildId) as Row | undefined;
    remoteAssert(row, "Remote table not found", 404, "REMOTE_NOT_FOUND"); return row;
  }
  function seats(row: Row): RemoteSeat[] {
    return (db.prepare("select seat,user_id,display_name,ready from remote_seats where table_id=? order by seat").all(row.id) as
      { seat: number; user_id: number; display_name: string; ready: number }[])
      .map(s => ({ seat: s.seat, userId: s.user_id, displayName: s.display_name, ready: !!s.ready }));
  }
  function member(row: Row, userId: number): RemoteSeat {
    const seat = seats(row).find(s => s.userId === userId);
    remoteAssert(seat, "Remote table not found", 404, "REMOTE_NOT_FOUND"); return seat;
  }
  function table(row: Row): RemoteTable {
    return { slug: row.slug, guildId: row.guild_id, gameId: row.game_id, seatCount: row.seat_count, status: row.status, createdBy: row.created_by,
      createdAt: row.created_at, startedAt: row.started_at, endedAt: row.ended_at, lastEventAt: row.last_event_at,
      lastSeq: row.last_seq, endReason: row.end_reason, idleWarningAt: row.idle_warning_at, seats: seats(row) };
  }
  function room(row: Row, userId: number, afterSeq?: number): RemoteRoom {
    const viewer = member(row, userId);
    remoteAssert(afterSeq === undefined || (Number.isSafeInteger(afterSeq) && afterSeq >= 0), "Invalid event cursor");
    const events = db.prepare(`select * from remote_events where table_id=? and seq>? order by seq limit 200`)
      .all(row.id, afterSeq ?? Math.max(0, row.last_seq - 50)) as EventRow[];
    return { ...table(row), mySeat: viewer.seat, state: JSON.parse(row.state_json), events: events.map(event) };
  }
  function append(row: Row, action: RemoteAction | RemoteSystemAction, at: number, userId: number | null = null, actorSeat: number | null = null, activity = true) {
    const id = "idempotencyKey" in action ? action.idempotencyKey : `sys:${randomUUID()}`;
    db.prepare("insert into remote_events(table_id,seq,idempotency_key,actor_seat,user_id,action_json,created_at) values(?,?,?,?,?,?,?)")
      .run(row.id, row.last_seq + 1, id, actorSeat, userId, JSON.stringify(action), at);
    db.prepare(`update remote_tables set last_seq=last_seq+1${activity ? ",last_event_at=?,idle_warning_at=null" : ""} where id=?`)
      .run(...(activity ? [at, row.id] : [row.id]));
  }
  function assertOpen(row: Row, now: number) {
    remoteAssert(row.status !== "ended", "Remote table has ended", 409, "TABLE_ENDED");
    remoteAssert(now - row.last_event_at < REMOTE_IDLE_CLOSE_MS, "Remote table expired from inactivity", 409, "TABLE_IDLE");
  }
  function name(value: string) { remoteAssert(typeof value === "string" && value.trim().length > 0 && value.length <= 100, "Invalid display name"); return value.trim(); }
  const api = {
    create(input: { guildId: string; userId: number; displayName: string; gameId: string; seatCount: SeatCount }, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const game = getRemoteGame(input.gameId);
        remoteAssert(game.seatsAllowed.includes(input.seatCount) && input.guildId, "Invalid table settings");
        const displayName = name(input.displayName);
        remoteAssert(db.prepare("select 1 from users where id=?").get(input.userId), "User not found", 404);
        const slug = generateWebSlug();
        const initial = game.initialState({ seatCount: input.seatCount });
        db.prepare("insert into remote_tables(slug,guild_id,game_id,seat_count,status,created_by,state_json,created_at,last_event_at) values(?,?,?,?,'lobby',?,?,?,?)")
          .run(slug, input.guildId, input.gameId, input.seatCount, input.userId, JSON.stringify(initial), now, now);
        const row = load(slug, input.guildId);
        db.prepare("insert into remote_seats(table_id,seat,user_id,display_name) values(?,0,?,?)").run(row.id, input.userId, displayName);
        append(row, { type: "table.created", gameId: input.gameId, seatCount: input.seatCount }, now, input.userId, 0);
        append(load(slug, input.guildId), { type: "seat.joined", seat: 0, userId: input.userId, displayName }, now, input.userId, 0);
        return room(load(slug, input.guildId), input.userId);
      });
    },
    get(slug: string, guildId: string, userId: number, afterSeq?: number): RemoteRoom {
      return db.transaction(() => room(load(slug, guildId), userId, afterSeq))();
    },
    list(guildId: string, userId: number, scope: "mine" | "open" = "mine"): RemoteTable[] {
      const rows = db.prepare(`select t.* from remote_tables t where t.guild_id=? and ${scope === "open"
        ? "t.status='lobby' and (select count(*) from remote_seats s where s.table_id=t.id)<t.seat_count"
        : "exists(select 1 from remote_seats s where s.table_id=t.id and s.user_id=?)"} order by t.created_at desc,t.id desc limit 100`)
        .all(...(scope === "open" ? [guildId] : [guildId, userId])) as Row[];
      return rows.map(table);
    },
    join(slug: string, guildId: string, userId: number, displayName: string, requestedSeat?: number, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId); assertOpen(row, now);
        if (seats(row).some(s => s.userId === userId)) return room(row, userId);
        remoteAssert(row.status === "lobby", "Table is no longer in its lobby", 409);
        const occupied = seats(row).map(s => s.seat);
        const seat = requestedSeat ?? Array.from({ length: row.seat_count }, (_, n) => n).find(n => !occupied.includes(n));
        remoteAssert(seat !== undefined && Number.isInteger(seat) && seat >= 0 && seat < row.seat_count && !occupied.includes(seat), "Seat is unavailable", 409, "SEAT_UNAVAILABLE");
        const display = name(displayName);
        db.prepare("insert into remote_seats(table_id,seat,user_id,display_name) values(?,?,?,?)").run(row.id, seat, userId, display);
        append(row, { type: "seat.joined", seat, userId, displayName: display }, now, userId, seat);
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
          append(row, { type: "seat.left", seat: s.seat, userId }, now, userId, s.seat);
        }
        return table(load(slug, guildId));
      });
    },
    ready(slug: string, guildId: string, userId: number, ready: boolean, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId); const s = member(row, userId); assertOpen(row, now);
        remoteAssert(row.status === "lobby" && typeof ready === "boolean", "Ready is only available in the lobby", 409);
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
        db.prepare("update remote_tables set status='active',started_at=? where id=?").run(now, row.id);
        append(row, { type: "table.started" }, now, userId, member(row, userId).seat);
        return room(load(slug, guildId), userId);
      });
    },
    act(slug: string, guildId: string, userId: number, input: { baseSeq: number; action: RemoteAction }, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId); const s = member(row, userId);
        const parsed = remoteActionSchema.safeParse(input.action); remoteAssert(parsed.success, "Invalid remote action");
        const command = parsed.data;
        remoteAssert(command.actorSeat === s.seat, "Actor seat does not match session", 403, "ACTOR_SEAT_MISMATCH");
        remoteAssert(!command.idempotencyKey.startsWith("sys:"), "Reserved idempotency key");
        const old = db.prepare("select * from remote_events where table_id=? and idempotency_key=?").get(row.id, command.idempotencyKey) as EventRow | undefined;
        if (old) {
          const { at: _oldTime, ...oldAction } = JSON.parse(old.action_json);
          const { at: _time, ...newAction } = command;
          remoteAssert(old.user_id === userId && JSON.stringify(oldAction) === JSON.stringify(newAction), "Idempotency key was used for a different action", 409, "IDEMPOTENCY_CONFLICT");
          return room(row, userId);
        }
        remoteAssert(Number.isSafeInteger(input.baseSeq) && input.baseSeq >= 0, "Invalid base sequence");
        remoteAssert(input.baseSeq === row.last_seq, "Stale sequence; fetch state and retry", 409, "STALE_SEQUENCE");
        remoteAssert(now - row.last_event_at < REMOTE_IDLE_CLOSE_MS && (row.status === "active" || (row.end_reason === "game" && command.type === "undo")), "Table is not active", 409, "TABLE_ENDED");
        const action = { ...command, at: now };
        const state = getRemoteGame(row.game_id).reduce(JSON.parse(row.state_json), action);
        append(row, action, now, userId, s.seat);
        db.prepare("update remote_tables set state_json=?,status=?,ended_at=?,end_reason=? where id=?")
          .run(JSON.stringify(state), state.ended ? "ended" : "active", state.ended ? now : null, state.ended ? "game" : null, row.id);
        return room(load(slug, guildId), userId);
      });
    },
    replay(slug: string, guildId: string, userId: number): RemoteState {
      return db.transaction(() => {
        const row = load(slug, guildId); member(row, userId);
        const game = getRemoteGame(row.game_id); let state = game.initialState({ seatCount: row.seat_count });
        for (const e of db.prepare("select * from remote_events where table_id=? order by seq").all(row.id) as EventRow[]) {
          const action: unknown = JSON.parse(e.action_json);
          if (remoteActionSchema.safeParse(action).success) state = game.reduce(state, action as RemoteAction);
        }
        return state;
      })();
    },
    /** Warnings append an event but deliberately leave last_event_at unchanged. Presence never calls this service's writes. */
    sweepIdle(now = Date.now()): RemoteTable[] {
      return transaction(() => {
        const due = db.prepare("select * from remote_tables where status!='ended' and last_event_at<=?").all(now - REMOTE_IDLE_WARNING_MS) as Row[];
        const changed: RemoteTable[] = [];
        for (const row of due) {
          if (now - row.last_event_at >= REMOTE_IDLE_CLOSE_MS) {
            append(row, { type: "table.ended", reason: "idle" }, now, null, null, false);
            db.prepare("update remote_tables set status='ended',ended_at=?,end_reason='idle' where id=?").run(now, row.id);
          } else if (row.idle_warning_at === null) {
            append(row, { type: "idle.warning", closesAt: row.last_event_at + REMOTE_IDLE_CLOSE_MS }, now, null, null, false);
            db.prepare("update remote_tables set idle_warning_at=? where id=?").run(now, row.id);
          } else continue;
          changed.push(table(load(row.slug, row.guild_id)));
        }
        return changed;
      });
    },
  };
  return api;
}
export type RemoteDuelService = ReturnType<typeof createRemoteDuelService>;
