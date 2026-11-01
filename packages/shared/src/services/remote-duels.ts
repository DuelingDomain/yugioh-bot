import { projectRemoteSnapshot, projectRemoteState, projectRemoteTable } from "../remote/privacy.js";
import { randomUUID } from "node:crypto";
import { applyRemoteFormat, initialDeckChecks, isInRemoteDeck, normalizeRemoteFormat, proposeRemoteDeckAddition, type RemoteDeckRegistration, type RemoteFormat, type RemoteReductionContext } from "../remote/deck-checks.js";
import { createSavedDeckService } from "./saved-decks.js";
import { createRemoteDeckRules } from "./remote-deck-rules.js";
import type Database from "better-sqlite3";
import { generateWebSlug } from "../util/web-slug.js";
import { getRemoteGame, remoteActionSchema, remoteAssert, type RemoteAction, type RemoteEvent, type RemoteRoom, type RemoteSeat, type RemoteState, type RemoteStatus, type RemoteSystemAction, type RemoteTable, type SeatCount } from "../remote/index.js";

export const REMOTE_IDLE_WARNING_MS = 8 * 60_000;
export const REMOTE_IDLE_CLOSE_MS = 10 * 60_000;
type Row = { id: number; slug: string; guild_id: string; game_id: string; seat_count: SeatCount; status: RemoteStatus; solo: number;
  created_by: number; state_json: string; last_seq: number; created_at: number; started_at: number | null; ended_at: number | null;
  last_event_at: number; idle_warning_at: number | null; end_reason: string | null; format_json: string | null; show_cards_set_from_deck: number };
type EventRow = { seq: number; idempotency_key: string; actor_seat: number | null; user_id: number | null; action_json: string; created_at: number; effects_json: string | null; messages_json: string | null };
type EventMessage = { seat: number; text: string };
const event = (e: EventRow, seats: RemoteSeat[]): RemoteEvent => ({ id: e.idempotency_key, seq: e.seq, actorSeat: e.actor_seat, userId: e.user_id, at: e.created_at, action: JSON.parse(e.action_json),
  ...(e.effects_json ? { effects: JSON.parse(e.effects_json) } : {}),
  ...(e.messages_json ? { messages: (JSON.parse(e.messages_json) as EventMessage[]).map(message =>
    (seats.find(s => s.seat === message.seat)?.displayName ?? "Seat " + (message.seat + 1)) + message.text) } : {}) });

/** All writes serialize through BEGIN IMMEDIATE; a successful return is already committed. */
export function createRemoteDuelService(db: Database.Database, options: { dataDirectory?: string } = {}) {
  const deckRules = createRemoteDeckRules(db, options.dataDirectory);
  const transaction = <T>(work: () => T): T => db.transaction(work).immediate();
  function load(slug: string, guildId: string): Row {
    const row = db.prepare("select * from remote_tables where slug=? and guild_id=?").get(slug, guildId) as Row | undefined;
    remoteAssert(row, "Remote table not found", 404, "REMOTE_NOT_FOUND"); return row;
  }
  function seats(row: Row): RemoteSeat[] {
    return (db.prepare(`select seat,user_id,display_name,ready,0 as bot,deck_json from remote_seats where table_id=?
      union all select seat,null,display_name,1,1,deck_json from remote_bot_seats where table_id=? order by seat`).all(row.id, row.id) as
      { seat: number; user_id: number | null; display_name: string; ready: number; bot: number; deck_json: string | null }[])
      .map(s => ({ seat: s.seat, userId: s.user_id, bot: !!s.bot, displayName: s.display_name, ready: !!s.ready, deck: s.deck_json ? JSON.parse(s.deck_json) : null }));
  }
  function member(row: Row, userId: number): RemoteSeat {
    const seat = seats(row).find(s => s.userId === userId);
    remoteAssert(seat, "Remote table not found", 404, "REMOTE_NOT_FOUND"); return seat;
  }
  function table(row: Row): RemoteTable {
    return { slug: row.slug, guildId: row.guild_id, gameId: row.game_id, seatCount: row.seat_count, status: row.status, solo: !!row.solo, createdBy: row.created_by,
      createdAt: row.created_at, startedAt: row.started_at, endedAt: row.ended_at, lastEventAt: row.last_event_at,
      lastSeq: row.last_seq, endReason: row.end_reason, idleWarningAt: row.idle_warning_at, seats: seats(row), format: format(row), showCardsSetFromDeck: !!row.show_cards_set_from_deck };
  }
  const format = (row: Row): RemoteFormat => row.format_json ? JSON.parse(row.format_json) : normalizeRemoteFormat();
  function applyTableRule(state:RemoteState,row:Row):RemoteState {
    state.showCardsSetFromDeck=!!row.show_cards_set_from_deck;
    if(state.undo) state.undo.before.showCardsSetFromDeck=state.showCardsSetFromDeck;
    return state;
  }
  function readState(row: Row): RemoteState {
    const state: RemoteState = JSON.parse(row.state_json);
    state.deckChecks ??= initialDeckChecks(format(row));
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
    remoteAssert(seat.deck || row.solo, "Select a saved deck before readying up", 409, "DECK_REQUIRED");
    if (seat.deck) {
      const report = deckRules.inspect(format(row), seat.deck.deck);
      remoteAssert(!report.issues.length, report.issues.map(i => i.message).join("\n"), 409, "DECK_INVALID");
    }
  }
  function room(row: Row, userId: number, afterSeq?: number): RemoteRoom {
    const viewer = member(row, userId);
    remoteAssert(afterSeq === undefined || (Number.isSafeInteger(afterSeq) && afterSeq >= 0), "Invalid event cursor");
    const events = db.prepare(`select * from remote_events where table_id=? and seq>? order by seq limit 200`)
      .all(row.id, afterSeq ?? Math.max(0, row.last_seq - 50)) as EventRow[];
    const metadata = table(row);
    const projected=projectRemoteSnapshot({table:metadata,state:readState(row),events:events.map(e=>event(e,metadata.seats))}, privateSeats(row,userId));
    return {...projected.table,mySeat:viewer.seat,state:projected.state,events:projected.events};
  }
  function privateSeats(row:Row,userId:number):Set<number> {
    return new Set(seats(row).filter(s=>s.userId===userId || (!!row.solo && row.created_by===userId && s.bot)).map(s=>s.seat));
  }
  function append(row: Row, action: RemoteAction | RemoteSystemAction, at: number, userId: number | null = null, actorSeat: number | null = null, activity = true, effects?: RemoteReductionContext, messages?: EventMessage[]) {
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
    create(input: { guildId: string; userId: number; displayName: string; gameId: string; seatCount: SeatCount; solo?: boolean; format?: unknown; rules?: unknown; showCardsSetFromDeck?: boolean }, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const game = getRemoteGame(input.gameId);
        remoteAssert(game.seatsAllowed.includes(input.seatCount) && input.guildId, "Invalid table settings");
        remoteAssert(input.solo === undefined || typeof input.solo === "boolean", "Invalid solo setting");
        remoteAssert(input.showCardsSetFromDeck === undefined || typeof input.showCardsSetFromDeck === "boolean", "Invalid Deck publicity setting");
        const displayName = name(input.displayName);
        remoteAssert(db.prepare("select 1 from users where id=?").get(input.userId), "User not found", 404);
        const slug = generateWebSlug();
        const chosenFormat = normalizeRemoteFormat(input.format, input.rules);
        const initial = applyRemoteFormat(game.initialState({ seatCount: input.seatCount }), chosenFormat);
        initial.showCardsSetFromDeck = input.showCardsSetFromDeck ?? true;
        db.prepare("insert into remote_tables(slug,guild_id,game_id,seat_count,status,created_by,state_json,created_at,last_event_at,solo,format_json,show_cards_set_from_deck) values(?,?,?,?,'lobby',?,?,?,?,?,?,?)")
          .run(slug, input.guildId, input.gameId, input.seatCount, input.userId, JSON.stringify(initial), now, now, Number(input.solo ?? false), JSON.stringify(chosenFormat), Number(initial.showCardsSetFromDeck));
        const row = load(slug, input.guildId);
        db.prepare("insert into remote_seats(table_id,seat,user_id,display_name) values(?,0,?,?)").run(row.id, input.userId, displayName);
        append(row, { type: "table.created", gameId: input.gameId, seatCount: input.seatCount, solo: input.solo ?? false, format: chosenFormat, showCardsSetFromDeck: initial.showCardsSetFromDeck }, now, input.userId, 0);
        append(load(slug, input.guildId), { type: "seat.joined", seat: 0, userId: input.userId }, now, input.userId, 0);
        if (input.solo) for (let seat = 1; seat < input.seatCount; seat++) {
          db.prepare("insert into remote_bot_seats(table_id,seat,display_name) values(?,?,?)").run(row.id, seat, `Test Bot ${seat}`);
          append(load(slug, input.guildId), { type: "seat.joined", seat, userId: null, bot: true }, now, input.userId, 0);
        }
        return room(load(slug, input.guildId), input.userId);
      });
    },
    configure(slug: string, guildId: string, userId: number, input: { format: unknown; rules?: unknown; showCardsSetFromDeck?: boolean }, now = Date.now()): RemoteRoom {
      return transaction(() => {
        const row = load(slug, guildId); const viewer = member(row, userId); assertOpen(row, now);
        remoteAssert(row.created_by === userId, "Only the host can choose rules", 403);
        remoteAssert(row.status === "lobby", "Rules can only change in the lobby", 409);
        remoteAssert(input.showCardsSetFromDeck === undefined || typeof input.showCardsSetFromDeck === "boolean", "Invalid Deck publicity setting");
        const chosenFormat = normalizeRemoteFormat(input.format, input.rules);
        const state = applyRemoteFormat(readState(row), chosenFormat);
        state.showCardsSetFromDeck = input.showCardsSetFromDeck ?? !!row.show_cards_set_from_deck;
        for (const registration of Object.values(state.deckChecks.registrations))
          if (registration) registration.validation = deckRules.inspect(chosenFormat, registration.deck);
        db.prepare("update remote_tables set format_json=?,state_json=?,show_cards_set_from_deck=? where id=?").run(JSON.stringify(chosenFormat), JSON.stringify(state), Number(state.showCardsSetFromDeck), row.id);
        db.prepare("update remote_seats set ready=0 where table_id=?").run(row.id);
        syncDecks(row, state);
        append(row, { type: "table.configured", format: chosenFormat, registrations: state.deckChecks.registrations, showCardsSetFromDeck: state.showCardsSetFromDeck }, now, userId, viewer.seat);
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
        const state = readState(row); state.deckChecks.registrations[target.seat] = registration; state.undo = null;
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
    list(guildId: string, userId: number, scope: "mine" | "open" | "live" = "mine"): RemoteTable[] {
      const rows = db.prepare(`select t.* from remote_tables t where t.guild_id=? and ${scope === "open"
        ? "t.solo=0 and t.status='lobby' and (select count(*) from remote_seats s where s.table_id=t.id)<t.seat_count"
        : `exists(select 1 from remote_seats s where s.table_id=t.id and s.user_id=?)${scope === "live" ? " and t.status!='ended'" : ""}`} order by t.created_at desc,t.id desc limit 100`)
        .all(...(scope === "open" ? [guildId] : [guildId, userId])) as Row[];
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
        return projectRemoteTable(table(load(slug, guildId)));
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
        remoteAssert(Number.isSafeInteger(input.baseSeq) && input.baseSeq >= 0, "Invalid base sequence");
        remoteAssert(input.baseSeq === row.last_seq, "Stale sequence; fetch state and retry", 409, "STALE_SEQUENCE");
        remoteAssert(now - row.last_event_at < REMOTE_IDLE_CLOSE_MS && (row.status === "active" || (row.end_reason === "game" && command.type === "undo")), "Table is not active", 409, "TABLE_ENDED");
        const action = { ...command, at: now };
        const before = readState(row);
        const effects: RemoteReductionContext = {showCardsSetFromDeck:before.showCardsSetFromDeck};
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
          effects.effect=deckRules.effect({...command.source,...(twin ? {cardId:twin.cardId ?? twin.passcode ?? command.source.cardId,name:twin.name ?? command.source.name} : {})},before.deckChecks.registrations[command.actorSeat]?.deck.main ?? []);
        }
        const recognized: { cardId?: number; passcode?: number }[] = command.type === "card.identified" ? [command] : command.type === "cards.identified" ? command.cards :
          command.type === "twin.place" ? [command.card] : command.type === "deck.add" ? [command] :
          command.type === "effect.activated" && effects.effect ? [{cardId:effects.effect.source.cardId}] :
          command.type === "effect.choose" ? [{cardId:command.cardId}] : [];
        const codes = recognized.flatMap(c => c.cardId ?? c.passcode ? [c.cardId ?? c.passcode!] : []);
        const registrations = before.deckChecks.registrations;
        const deckCodes = Object.values(registrations).flatMap(r => r ? [...r.deck.main, ...r.deck.extra, ...r.deck.side, ...(r.deck.deckMaster ? [r.deck.deckMaster] : [])] : []);
        effects.facts = deckRules.facts(format(row), [...new Set([...codes, ...deckCodes])]);
        if (command.type === "card.identified" || command.type === "cards.identified" || command.type === "deck.add") {
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
        const state = getRemoteGame(row.game_id).reduce(before, action, effects);
        const messages = state.deckChecks.flags.filter(f => !before.deckChecks.flags.some(old => old.id === f.id))
          .map(f => ({ seat: f.seat, text: ": " + f.message }));
        if(command.type==="effect.choose" && effects.publicEffectChoice) {
          const origin=state.effectTracking?.origins.find(o=>o.id===command.originId);
          if(origin?.announcedCard) messages.push({seat:origin.seat,text:origin.destination==="set" ? `: Set from Deck by ${origin.source.name}: ${origin.announcedCard.name}` : `: ${origin.announcedCard.name} added to hand by ${origin.source.name}`});
        }
        if (command.type === "deck.add") messages.unshift({ seat: command.actorSeat, text: " added " + effects.facts[command.cardId]?.name + " to their decklist" });
        if (command.type === "deck.flag.dismiss") messages.push({ seat: command.actorSeat, text: " dismissed flag " + command.flagId + " as wrong: " + command.reason });
        if (command.type === "twin.merge") messages.push({ seat: command.actorSeat, text: " merged instances " + command.keepInstanceId + " and " + command.removeInstanceId + ": " + command.reason });
        append(row, action, now, userId, command.actorSeat, true, effects, messages);
        syncDecks(row, state);
        db.prepare("update remote_tables set state_json=?,status=?,ended_at=?,end_reason=? where id=?")
          .run(JSON.stringify(state), state.ended ? "ended" : "active", state.ended ? now : null, state.ended ? "game" : null, row.id);
        return room(load(slug, guildId), userId);
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
    replay(slug: string, guildId: string, userId: number): RemoteState {
      return db.transaction(() => {
        const row = load(slug, guildId); member(row, userId);
        const game = getRemoteGame(row.game_id); let state = game.initialState({ seatCount: row.seat_count });
        for (const e of db.prepare("select * from remote_events where table_id=? order by seq").all(row.id) as EventRow[]) {
          const action: RemoteEvent["action"] = JSON.parse(e.action_json);
          if (remoteActionSchema.safeParse(action).success) {
            const effects:RemoteReductionContext|undefined=e.effects_json ? JSON.parse(e.effects_json) : undefined;
            if(effects?.showCardsSetFromDeck!==undefined) state.showCardsSetFromDeck=effects.showCardsSetFromDeck;
            state = game.reduce(state, action as RemoteAction, effects);
          }
          else if (action.type === "table.created") {
            if(action.format) state = applyRemoteFormat(state, action.format);
            state.showCardsSetFromDeck = action.showCardsSetFromDeck ?? false;
          }
          else if (action.type === "table.configured") {
            state = applyRemoteFormat(state, action.format); state.deckChecks.registrations = action.registrations;
            state.showCardsSetFromDeck = action.showCardsSetFromDeck ?? state.showCardsSetFromDeck ?? true;
          }
          else if (action.type === "seat.deck") { state.deckChecks.registrations[action.seat] = action.registration; state.undo = null; }
          else if (action.type === "seat.left") delete state.deckChecks.registrations[action.seat];
        }
        return projectRemoteState(applyTableRule(state,row),privateSeats(row,userId));
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
