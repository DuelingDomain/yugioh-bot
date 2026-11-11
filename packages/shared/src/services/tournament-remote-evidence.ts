import type Database from "better-sqlite3";
import { getRemoteGame, remoteActionSchema, type RemoteAction, type RemoteSeatState, type RemoteSystemAction, type SeatCount } from "../remote/index.js";
import { applyRemoteFormat } from "../remote/deck-checks.js";
import { initializeRemoteHandCounts } from "../remote/hand.js";
import { applyRemoteOpening, initialRemoteMatch } from "../remote/match.js";
import { readRemoteEffects, readRemoteState } from "../remote/storage.js";

const DAY = 86_400_000;
const modeSeconds = {auto:'autoSeconds',tap:'tapSeconds',manual:'manualSeconds'} as const;
const publicZones = new Set(['monster', 'extra-monster', 'spell-trap', 'field', 'pendulum', 'graveyard', 'banished']);
const manualActions = new Set(['twin.place', 'twin.move', 'twin.flip', 'twin.remove', 'twin.attach', 'twin.detach',
  'twin.equip', 'pile.lift', 'pile.order', 'twin.merge', 'deck.flag.dismiss']);
type EventRow = { seq:number; created_at:number; user_id:number|null; actor_seat:number|null;
  action_json:string; effects_json:string|null; facts_hash:string|null };

function publicCards(seat: RemoteSeatState) {
  return seat.twin.filter(c=>publicZones.has(c.zone) && c.faceUp).map(c=>({
    zone:c.zone,...(c.slot !== undefined ? {slot:c.slot} : {}),
    ...(c.cardId !== undefined ? {cardId:c.cardId} : c.passcode !== undefined ? {passcode:c.passcode} : {}),
    ...(c.name !== undefined ? {name:c.name} : {}),position:c.position,
  }));
}

/** Server-only: copy the section 5.2 allowlist, never a room/undo/effects snapshot.
 * B3 calls this in its proposal transaction. Repeated capture of the same end is a no-op.
 * The optional clock is for retention's fixed cutoff and deterministic callers.
 * Failed copies roll back to their savepoint and are skipped so room writes can commit. */
export function captureRemoteTournamentEvidence(db: Database.Database, tableId: number, now = Date.now()): void {
  try {
    captureEvidence(db, tableId, now);
  } catch (error) {
    if (!db.inTransaction) throw error;
    console.warn(`Skipping tournament evidence for table ${tableId}`, error);
  }
}

function captureEvidence(db: Database.Database, tableId: number, now: number): void {
  db.transaction(() => {
    const row = db.prepare(`select t.*,s1.user_id as user_one_id,s2.user_id as user_two_id,
      r.status as result_status,r.proposed_at,r.finalized_at,r.finalization_reason,r.organizer_decided_at
      from remote_tables t join tournament_matches tm on tm.id=t.tournament_match_id
      join tournaments tournament on tournament.id=tm.tournament_id
      join players p1 on p1.id=tm.player_one_id join players p2 on p2.id=tm.player_two_id
      left join remote_seats s1 on s1.table_id=t.id and s1.user_id=p1.user_id
      left join remote_seats s2 on s2.table_id=t.id and s2.user_id=p2.user_id
      join tournament_remote_matches r on r.tournament_match_id=tm.id and r.table_slug=t.slug
      where t.id=? and t.status='ended' and tournament.status!='cancelled'`).get(tableId) as
      { id:number; tournament_match_id:number; slug:string; game_id:string; seat_count:SeatCount; state_json:string;
        started_at:number|null; ended_at:number; end_reason:string; user_one_id:number|null; user_two_id:number|null;
        result_status:string; proposed_at:number|null; finalized_at:number|null; finalization_reason:string|null; organizer_decided_at:number|null } | undefined;
    if (!row) return;
    const cap = row.ended_at + 14 * DAY;
    // A deleted copy must not reappear when the room is finally purged.
    const due = row.organizer_decided_at !== null ? row.organizer_decided_at + 2 * DAY
      : row.result_status === 'disputed' ? cap
      : row.result_status === 'final' && row.finalization_reason === 'both_confirmed' ? row.finalized_at
      : row.result_status === 'final' && row.finalized_at !== null ? row.finalized_at + 2 * DAY
      : row.result_status !== 'proposed' && row.proposed_at === null ? row.ended_at + 2 * DAY : cap;
    if (now >= cap || due !== null && now >= due) return;
    const existing = db.prepare('select table_slug,table_ended_at from tournament_remote_evidence where tournament_match_id=?')
      .get(row.tournament_match_id) as {table_slug:string;table_ended_at:number} | undefined;
    if (existing?.table_slug === row.slug && existing.table_ended_at === row.ended_at) return;

    const current = readRemoteState(db, row.state_json);
    const game = getRemoteGame(row.game_id);
    let state = game.initialState({seatCount:row.seat_count,bestOf:1,tournament:current.tournament});
    const players = db.prepare('select user_id as userId,seat from remote_seats where table_id=? order by seat').all(tableId);
    const summary = current.seats.map(s => ({seat:s.seat,unknownSeconds:0,autoSeconds:0,tapSeconds:0,manualSeconds:0,identifiedByClick:0,identifiedByTyped:0,
      manualCorrections:0,unknownAtGameEnd:[] as {n:number;count:number}[]}));
    // Until a seat announces its mode nobody knows how it identified cards, so that time is "unknown", not Auto-detect.
    const modes = current.seats.map(() => ({mode:null as Extract<RemoteAction, {type:'detection.mode'}>['mode'] | null,since:row.started_at ?? row.ended_at}));
    const perGame = new Map<string, {seats:{seat:number;lp:number}[];unknown:number[]}>();
    const eliminatedBoards = new Map<number, ReturnType<typeof publicCards>>();
    const excerpt: {seq:number;at:number;userId:number|null;seat:number|null;action:object}[] = [];
    const sequences = new Map<string,number>();
    // Stream the full log only to reconstruct facts; no card movements or effects are copied.
    for (const event of db.prepare('select seq,created_at,user_id,actor_seat,action_json,effects_json,facts_hash from remote_events where table_id=? order by seq').iterate(tableId) as Iterable<EventRow>) {
      const before=state, previousGames=state.match.games;
      const action = JSON.parse(event.action_json) as RemoteAction | RemoteSystemAction;
      if ('idempotencyKey' in action) sequences.set(action.idempotencyKey,event.seq);
      let resultAction: object | undefined;
      switch (action.type) {
        case 'lp.change': resultAction={type:action.type,seat:action.seat,delta:action.delta,reason:action.reason}; break;
        case 'player.concede': case 'player.leave': resultAction={type:action.type}; break;
        case 'match.declare': resultAction={type:action.type,winnerSeat:action.winnerSeat}; break;
        case 'match.confirm': resultAction={type:action.type,declarationSeq:sequences.get(action.declarationId) ?? null,accept:action.accept}; break;
        case 'undo': resultAction={type:action.type,targetSeq:sequences.get(action.targetActionId) ?? null}; break;
        case 'detection.mode': {
          resultAction={type:action.type,mode:action.mode,reason:action.reason};
          const seat = event.actor_seat;
          if (seat !== null && modes[seat]) {
            const mode=modes[seat], at=Math.max(mode.since,Math.min(event.created_at,row.ended_at));
            summary[seat][mode.mode ? modeSeconds[mode.mode] : 'unknownSeconds'] += (at-mode.since)/1000;
            mode.mode=action.mode; mode.since=at;
          }
          break;
        }
      }
      if (resultAction) excerpt.push({seq:event.seq,at:event.created_at,userId:event.user_id,seat:event.actor_seat,action:resultAction});
      if (action.type === 'card.identified' || action.type === 'cards.identified') {
        const seat=summary[action.seat], count=action.type === 'cards.identified' ? action.cards.length : 1;
        if (seat && action.source === 'click') seat.identifiedByClick+=count;
        if (seat && action.source === 'typed') seat.identifiedByTyped+=count;
      }
      if (manualActions.has(action.type) && (!('source' in action) || action.source !== 'auto')) {
        const seat='seat' in action ? action.seat : event.actor_seat;
        if (seat !== null && summary[seat]) summary[seat].manualCorrections++;
      }
      if (remoteActionSchema.safeParse(action).success) {
        const effects=readRemoteEffects(db,event.effects_json,event.facts_hash);
        if (effects?.showCardsSetFromDeck !== undefined) state.showCardsSetFromDeck=effects.showCardsSetFromDeck;
        state=game.reduce(state,action as RemoteAction,{...effects,replay:true});
      } else if (action.type === 'table.created') {
        state.match=initialRemoteMatch(row.seat_count,action.bestOf ?? 1);
        if (action.format) state=applyRemoteFormat(state,action.format);
        state.showCardsSetFromDeck=action.showCardsSetFromDeck ?? false;
        state.revealedHand=action.revealedHand ?? 'until-played';
      } else if (action.type === 'table.configured') {
        state=applyRemoteFormat(state,action.format); state.deckChecks.registrations=action.registrations;
        if (action.bestOf !== undefined) state.match=initialRemoteMatch(row.seat_count,action.bestOf);
        state.showCardsSetFromDeck=action.showCardsSetFromDeck ?? state.showCardsSetFromDeck ?? true;
        state.revealedHand=action.revealedHand ?? state.revealedHand ?? 'until-played';
      } else if (action.type === 'table.started' && action.handCounts === 1) { initializeRemoteHandCounts(state); if (action.opening) applyRemoteOpening(state, action.opening); }
      else if (action.type === 'seat.deck') { state.deckChecks.registrations[action.seat]=action.registration; state.undo=null; delete state.undoHistory; }
      else if (action.type === 'seat.left') delete state.deckChecks.registrations[action.seat];
      // Concede/LP clear the eliminated seat's twins. Keep only its last public cards.
      for (const seat of state.seats) {
        if (!seat.eliminated) eliminatedBoards.delete(seat.seat);
        else if (!before.seats[seat.seat].eliminated) eliminatedBoards.set(seat.seat,publicCards(before.seats[seat.seat]));
      }
      const last=state.match.games.at(-1);
      // Timestamps need not be unique: a same-time siding reset is not another game end.
      if (last && !previousGames.some(g=>g.n===last.n && g.endedAt===last.endedAt)) perGame.set(`${last.n}:${last.endedAt}`,{
        seats:state.seats.map(s=>({seat:s.seat,lp:s.resources.lp})),
        unknown:state.seats.map(s=>(eliminatedBoards.get(s.seat) ?? publicCards(s)).filter(c=>!('cardId' in c) && !('passcode' in c) && !('name' in c)).length),
      });
    }
    const games=current.match.games.map(g=>({n:g.n,winnerSeat:g.winnerSeat,reason:g.reason,endedAt:g.endedAt}));
    const finalLp=games.map(g=>{
      const facts=perGame.get(`${g.n}:${g.endedAt}`);
      if (!facts) throw new Error(`Missing tournament game-end facts for table ${tableId}, game ${g.n}`);
      for (const seat of summary) seat.unknownAtGameEnd.push({n:g.n,count:facts.unknown[seat.seat]});
      return {n:g.n,seats:facts.seats};
    });
    for (const seat of summary) {
      const mode=modes[seat.seat];
      seat[mode.mode ? modeSeconds[mode.mode] : 'unknownSeconds'] += Math.max(0,row.ended_at-mode.since)/1000;
    }
    const board=current.seats.map(s=>({seat:s.seat,cards:s.eliminated ? eliminatedBoards.get(s.seat) ?? publicCards(s) : publicCards(s)}));
    db.prepare('delete from tournament_remote_evidence where tournament_match_id=?').run(row.tournament_match_id);
    db.prepare(`insert into tournament_remote_evidence(tournament_match_id,table_id,table_slug,player_one_user_id,player_two_user_id,
      players_json,table_started_at,table_ended_at,end_reason,games_json,result_events_json,final_lp_json,public_board_json,
      reports_json,detection_summary_json,captured_at,purge_after_at,hard_delete_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,?,null,?)`)
      .run(row.tournament_match_id,tableId,row.slug,row.user_one_id,row.user_two_id,JSON.stringify(players),row.started_at,row.ended_at,row.end_reason,
        JSON.stringify(games),JSON.stringify(excerpt),JSON.stringify(finalLp),JSON.stringify(board),JSON.stringify(summary),now,cap);
  }).immediate();
}

/** Hourly worker cleanup, independent of the room retention environment setting. */
export function pruneRemoteTournamentEvidence(db: Database.Database, now = Date.now()): number {
  return db.transaction(() => db.prepare(`delete from tournament_remote_evidence
    where hard_delete_at<=? or purge_after_at<=? or tournament_match_id in
      (select tm.id from tournament_matches tm join tournaments t on t.id=tm.tournament_id where t.status='cancelled')`)
    .run(now,now).changes).immediate();
}
