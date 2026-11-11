import type Database from "better-sqlite3";
import { readRemoteState, writeRemoteState } from "../remote/storage.js";
import type { RemoteState } from "../remote/types.js";

const REMOVED = "[removed]";

type PrivacyContext = {ownedDecks:Set<number>;canonicalNames:Set<string>};

/** One catalog read and one append-only guard suspension for the whole deletion. */
export function anonymizeRemoteData(db: Database.Database, userId: number, deletedName: string, tableIds: number[]): void {
  if (!db.inTransaction) throw new Error("Remote anonymization requires a transaction");
  const context: PrivacyContext = {
    ownedDecks:new Set((db.prepare("select id from saved_decks where owner_user_id=?").all(userId) as {id:number}[]).map(d=>d.id)),
    canonicalNames:new Set((db.prepare("select name from card_catalog").all() as {name:string}[]).map(c=>c.name)),
  };
  anonymizeRemoteEvidence(db,userId,context);
  if (!tableIds.length) return;
  // The writer transaction excludes other writers; rollback restores data and schema.
  const guard = db.prepare("select sql from sqlite_master where name='remote_events_no_update'").get() as {sql:string};
  db.exec("drop trigger remote_events_no_update");
  try {
    for (const tableId of tableIds) anonymizeRemoteRoom(db,tableId,userId,deletedName,context);
  } finally { db.exec(guard.sql); }
}

function textScrubber(db: Database.Database, userId: number, ownedSeats: Set<number>, context: PrivacyContext, tableId?: number) {
  const {ownedDecks} = context;
  const canonicalNames = new Set(context.canonicalNames);
  if (tableId !== undefined) {
    // Server-resolved catalog facts are authoritative; user-entered board names are not.
    const collectNames = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if ("name" in value && typeof value.name === "string") canonicalNames.add(value.name);
      for (const child of Object.values(value)) collectNames(child);
    };
    for (const {effects_json} of db.prepare("select effects_json from remote_events where table_id=? and effects_json is not null").all(tableId) as {effects_json:string}[]) {
      const effects = JSON.parse(effects_json);
      collectNames(effects.facts); collectNames(effects.effect);
    }
    for (const {json} of db.prepare(`select distinct v.json from remote_events e join remote_values v on v.hash=e.facts_hash
      where e.table_id=?`).all(tableId) as {json:string}[]) {
      for (const fact of Object.values(JSON.parse(json)) as {name:string}[]) canonicalNames.add(fact.name);
    }
  }
  function scrub(value: unknown, owned = false): unknown {
    if (Array.isArray(value)) return value.map(item=>scrub(item,owned));
    if (!value || typeof value !== "object") return value;
    const obj = value as Record<string,unknown>;
    const author = typeof obj.actorSeat === "number" ? owned || ownedSeats.has(obj.actorSeat)
      : typeof obj.seat === "number" ? ownedSeats.has(obj.seat) : owned;
    const next: Record<string,unknown> = {};
    for (const [key,child] of Object.entries(obj)) {
      if (key === "registrations" && child && typeof child === "object") {
        next[key] = Object.fromEntries(Object.entries(child).map(([seat,registration])=>[seat,scrub(registration,ownedSeats.has(Number(seat)))]));
      } else next[key] = scrub(child,author);
    }
    // Deck contents/validation are game inputs; the library link and user-written deck label are personal.
    if ("savedDeckId" in obj && (author || ownedDecks.has(obj.savedDeckId as number))) {
      next.savedDeckId = null; next.name = "Deleted player's deck";
    }
    if ((obj.type === "seat.joined" || obj.type === "seat.left" || obj.type === "admin.watching") && obj.userId === userId) {
      next.userId = null;
      if (obj.type === "admin.watching") next.name = "Deleted player";
    }
    if (author) {
      if (obj.type === "log.note") next.text = REMOVED;
      if (["lp.change","deck.flag.dismiss","twin.merge"].includes(String(obj.type)) || ("dismissed" in obj && "reason" in obj)) next.reason = REMOVED;
      if ("zoneRule" in obj) delete next.zoneRule;
      if ("race" in obj) delete next.race;
    }
    // Card IDs, positions, counters and canonical game names stay. Custom annotations
    // (including token names) can contain personal text and have no rules authority.
    if (author && typeof obj.name === "string" && !("savedDeckId" in obj) && obj.type !== "admin.watching"
      && !canonicalNames.has(obj.name)) next.name = "token" in obj ? "Token" : "Card";
    if (author && typeof obj.message === "string") next.message = REMOVED;
    return next;
  }
  return scrub;
}

/** A privacy write, inside account deletion's immediate transaction. Board facts and seat numbers survive. */
function anonymizeRemoteRoom(db: Database.Database, tableId: number, userId: number, deletedName: string, context: PrivacyContext): void {
  const currentSeats = (db.prepare("select seat from remote_seats where table_id=? and user_id=?").all(tableId,userId) as {seat:number}[]).map(s=>s.seat);
  const ownedSeats = new Set<number>();
  const events = db.prepare("select id,user_id,actor_seat,action_json,effects_json,messages_json from remote_events where table_id=? order by seq").all(tableId) as
    {id:number;user_id:number|null;actor_seat:number|null;action_json:string;effects_json:string|null;messages_json:string|null}[];
  const scrub = textScrubber(db,userId,ownedSeats,context,tableId);
  const update = db.prepare("update remote_events set user_id=?,action_json=?,effects_json=?,messages_json=? where id=?");
  for (const event of events) {
    const owned = event.user_id === userId;
    const original = JSON.parse(event.action_json);
    // Follow occupancy through the log: a later player may reuse a departed player's lobby seat.
    if (original.type === "seat.joined") {
      if (original.userId === userId) ownedSeats.add(original.seat); else ownedSeats.delete(original.seat);
    }
    const action = scrub(original,owned);
    const effects = event.effects_json ? JSON.stringify(scrub(JSON.parse(event.effects_json),owned)) : null;
    const messages = owned || !event.messages_json ? null : JSON.stringify(
      (JSON.parse(event.messages_json) as {seat:number;text:string}[]).filter(message=>!ownedSeats.has(message.seat)));
    update.run(owned ? null : event.user_id,JSON.stringify(action),effects,messages,event.id);
    if (original.type === "seat.left") ownedSeats.delete(original.seat);
  }
  const {state_json} = db.prepare("select state_json from remote_tables where id=?").get(tableId) as {state_json:string};
  ownedSeats.clear();
  for (const seat of currentSeats) ownedSeats.add(seat);
  const state = scrub(readRemoteState(db,state_json)) as RemoteState;
  // Re-intern changed undo positions instead of mutating immutable, content-addressed board values.
  db.prepare("update remote_tables set state_json=?,created_by=case when created_by=? then null else created_by end,privacy_revision=privacy_revision+1 where id=?")
    .run(writeRemoteState(db,tableId,state),userId,tableId);
  const seats = db.prepare("select seat,deck_json from remote_seats where table_id=? and user_id=?").all(tableId,userId) as {seat:number;deck_json:string|null}[];
  for (const seat of seats) db.prepare("update remote_seats set user_id=null,ready=0,display_name=?,saved_deck_id=null,deck_json=? where table_id=? and seat=?")
    .run(deletedName,seat.deck_json ? JSON.stringify(scrub(JSON.parse(seat.deck_json),true)) : null,tableId,seat.seat);
}

/** Keep structured tournament facts on their existing deadline; remove personal links and authored reports. */
function anonymizeRemoteEvidence(db: Database.Database, userId: number, context: PrivacyContext): void {
  for (const side of ["one","two"]) db.prepare(`update tournament_remote_matches set player_${side}_note=null
    where player_${side}_id in (select id from players where user_id=?) and player_${side}_note is not null`).run(userId);
  db.prepare("update tournament_remote_matches set organizer_user_id=null,organizer_note=null where organizer_user_id=?").run(userId);
  const rows = db.prepare(`select tournament_match_id,table_id,players_json,result_events_json,reports_json,public_board_json from tournament_remote_evidence
    where player_one_user_id=? or player_two_user_id=?`).all(userId,userId) as
    {tournament_match_id:number;table_id:number|null;players_json:string;result_events_json:string;reports_json:string;public_board_json:string}[];
  const redact = (json:string, reports = false) => JSON.stringify((JSON.parse(json) as Record<string,unknown>[]).map(row=>row.userId === userId
    ? {...row,userId:null,...(reports ? {note:null} : {}),...(row.action && typeof row.action === "object" && (row.action as {type:string}).type === "lp.change"
      ? {action:{...row.action,reason:REMOVED}} : {})} : row));
  for (const row of rows) {
    const ownedSeats = new Set((JSON.parse(row.players_json) as {userId:number|null;seat:number}[])
      .filter(player=>player.userId === userId).map(player=>player.seat));
    const scrub = textScrubber(db,userId,ownedSeats,context,row.table_id ?? undefined);
    db.prepare(`update tournament_remote_evidence set
    player_one_user_id=case when player_one_user_id=? then null else player_one_user_id end,
    player_two_user_id=case when player_two_user_id=? then null else player_two_user_id end,
    players_json=?,result_events_json=?,reports_json=?,public_board_json=? where tournament_match_id=?`)
    .run(userId,userId,redact(row.players_json),redact(row.result_events_json),redact(row.reports_json,true),JSON.stringify(scrub(JSON.parse(row.public_board_json))),row.tournament_match_id);
  }
}
