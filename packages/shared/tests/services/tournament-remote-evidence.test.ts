import Database from 'better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import { migrate } from '../../src/db/index.js';
import { seedIdentity } from '../helpers/identity.js';
import { createRemoteDuelService } from '../../src/services/remote-duels.js';
import { pruneRemoteDuels } from '../../src/services/remote-retention.js';
import { captureRemoteTournamentEvidence, pruneRemoteTournamentEvidence } from '../../src/services/tournament-remote-evidence.js';
import { remoteActionSchema } from '../../src/remote/index.js';

const day = 86_400_000;
const databases: Database.Database[] = [];
afterEach(() => {
  databases.splice(0).forEach(db => db.close());
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function setup(bestOf: 1 | 3 = 1, start = true) {
  const db = new Database(':memory:');
  databases.push(db);
  db.pragma('foreign_keys=ON');
  migrate(db);
  const actors = [seedIdentity(db), seedIdentity(db)];
  const tournamentId = Number(db.prepare(`insert into tournaments(guild_id,name,format,status,created_by_user_id,duel_type)
    values('g','Evidence regression','round_robin','active',?,'remote')`).run(actors[0].userId).lastInsertRowid);
  const matchId = Number(db.prepare(`insert into tournament_matches(tournament_id,player_one_id,player_two_id,round_number,status)
    values(?,?,?,1,'open')`).run(tournamentId, actors[0].playerId, actors[1].playerId).lastInsertRowid);
  const service = createRemoteDuelService(db);
  let room = service.create({guildId:'g',userId:actors[0].userId,displayName:'A',gameId:'ygo',seatCount:2,bestOf}, 1000);
  service.join(room.slug, 'g', actors[1].userId, 'B', 1, 1001);
  if (start) {
    service.ready(room.slug, 'g', actors[0].userId, true, 1002);
    service.ready(room.slug, 'g', actors[1].userId, true, 1002);
    room = service.start(room.slug, 'g', actors[0].userId, 1003);
  }
  const tableId = (db.prepare('select id from remote_tables where slug=?').get(room.slug) as {id:number}).id;
  db.prepare('update remote_tables set tournament_match_id=? where id=?').run(matchId, tableId);
  db.prepare(`insert into tournament_remote_matches(tournament_match_id,table_id,table_slug,player_one_id,player_two_id,created_at,updated_at)
    values(?,?,?,?,?,1000,1000)`).run(matchId, tableId, room.slug, actors[0].playerId, actors[1].playerId);
  const initialSeq = room.lastSeq;
  let serial = 0;
  const act = (input: Record<string, unknown>, actorSeat = 0, at?: number) => {
    room = service.act(room.slug, 'g', actors[actorSeat].userId, {baseSeq:room.lastSeq,
      action:remoteActionSchema.parse({...input,actorSeat,idempotencyKey:`regression-${++serial}`})}, at ?? 2000 + serial);
    return room;
  };
  const evidence = () => db.prepare('select * from tournament_remote_evidence where tournament_match_id=?').get(matchId) as
    {purge_after_at:number|null;hard_delete_at:number} | undefined;
  const removeGameEvents = () => {
    // Simulate a legacy or truncated event log while retaining the current room state.
    db.exec('drop trigger remote_events_no_delete');
    db.prepare('delete from remote_events where table_id=? and seq>?').run(tableId, initialSeq);
    db.prepare('delete from tournament_remote_evidence where tournament_match_id=?').run(matchId);
  };
  return {db,service,actors,room,tableId,matchId,act,evidence,removeGameEvents};
}

it.each(['purge', 'idle', 'act'] as const)('keeps %s successful when a tournament log is missing a game end', operation => {
  const s = setup(operation === 'purge' ? 1 : 3);
  const ended = s.act({type:'player.concede'}, 1);
  if (operation === 'act') {
    s.act({type:'match.continue'});
    s.act({type:'match.first',seatGoesFirst:0}, 1);
    s.act({type:'side.ready',seat:0});
    s.act({type:'side.ready',seat:1}, 1);
    // When both are ready, the next game starts after the 5-second countdown.
    s.act({type:'side.timeout'}, 0, 10_000);
  }
  s.removeGameEvents();
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  if (operation === 'purge') {
    const other = s.service.create({guildId:'g',userId:s.actors[0].userId,displayName:'A',gameId:'ygo',seatCount:2}, 1000);
    s.service.leave(other.slug, 'g', s.actors[0].userId, 2000);
    expect(s.service.purgeEnded(3000, 100, 3000)).toBe(2);
    expect(s.db.prepare('select id from remote_tables').all()).toEqual([]);
  } else if (operation === 'idle') {
    const other = s.service.create({guildId:'g',userId:s.actors[0].userId,displayName:'A',gameId:'ygo',seatCount:2}, 1000);
    const changed = s.service.sweepIdle(day);
    expect(changed).toEqual(expect.arrayContaining([
      expect.objectContaining({slug:ended.slug,status:'ended',endReason:'idle'}),
      expect.objectContaining({slug:other.slug,status:'ended',endReason:'idle'}),
    ]));
  } else {
    expect(s.act({type:'player.concede'}, 1, 10_001)).toMatchObject({status:'ended',endReason:'game'});
  }
  expect(log).toHaveBeenCalledWith(expect.stringContaining(`table ${s.tableId}`),
    expect.objectContaining({message:expect.stringContaining('Missing tournament game-end facts')}));
  expect(s.evidence()).toBeUndefined();
  expect(s.db.pragma('foreign_key_check')).toEqual([]);
});

it('stops the caller when evidence capture rolls back the outer transaction', () => {
  const s = setup();
  s.act({type:'player.concede'}, 1);
  s.db.prepare('delete from tournament_remote_evidence where tournament_match_id=?').run(s.matchId);
  s.db.exec(`create trigger evidence_rollback before insert on tournament_remote_evidence
    begin select raise(rollback, 'evidence rollback'); end;`);
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  expect(() => s.db.transaction(() => {
    s.db.prepare("update tournaments set name='Before capture'").run();
    captureRemoteTournamentEvidence(s.db, s.tableId, 3000);
    s.db.prepare("update tournaments set name='After capture'").run();
  }).immediate()).toThrow('evidence rollback');
  expect(s.db.inTransaction).toBe(false);
  expect(s.db.prepare('select name from tournaments').get()).toEqual({name:'Evidence regression'});
});

it('prunes expired evidence even when room retention configuration is invalid', () => {
  const s = setup();
  const ended = s.act({type:'player.concede'}, 1);
  expect(s.evidence()).toBeDefined();
  vi.stubEnv('REMOTE_DUELS_RETENTION_DAYS', 'bad');
  expect(() => pruneRemoteDuels(s.db, ended.endedAt! + 14 * day)).toThrow('Invalid REMOTE_DUELS_RETENTION_DAYS');
  expect(s.evidence()).toBeUndefined();
  expect(s.db.prepare('select id from remote_tables where id=?').get(s.tableId)).toBeDefined();
});

it.each(['idle', 'creator-left'] as const)('expires %s evidence without a result after 48 hours and never recaptures it', reason => {
  const s = setup(1, false);
  const ended = reason === 'idle' ? s.service.sweepIdle(day).find(t => t.slug === s.room.slug)!
    : s.service.leave(s.room.slug, 'g', s.actors[0].userId, 2000);
  const due = ended.endedAt! + 2 * day;
  expect(s.evidence()?.purge_after_at).toBe(due);
  expect(pruneRemoteTournamentEvidence(s.db, due - 1)).toBe(0);
  expect(pruneRemoteTournamentEvidence(s.db, due)).toBe(1);
  captureRemoteTournamentEvidence(s.db, s.tableId, due);
  expect(s.evidence()).toBeUndefined();
});

it.each(['proposed', 'disputed'] as const)('extends the short deadline when a %s result arrives', status => {
  const s = setup(1, false);
  const ended = s.service.leave(s.room.slug, 'g', s.actors[0].userId, 2000);
  expect(s.evidence()?.purge_after_at).toBe(ended.endedAt! + 2 * day);
  s.db.prepare('update tournament_remote_matches set status=?,proposed_at=? where tournament_match_id=?')
    .run(status, ended.endedAt, s.matchId);
  expect(s.evidence()?.purge_after_at).toBeNull();
  expect(pruneRemoteTournamentEvidence(s.db, ended.endedAt! + 2 * day)).toBe(0);
  s.db.prepare('delete from tournament_remote_evidence where tournament_match_id=?').run(s.matchId);
  captureRemoteTournamentEvidence(s.db, s.tableId, ended.endedAt! + 3 * day);
  expect(s.evidence()).toBeDefined();
  expect(pruneRemoteTournamentEvidence(s.db, ended.endedAt! + 14 * day)).toBe(1);
});

it('upgrades existing evidence triggers and deadlines on migration', () => {
  const s = setup(1, false);
  // Recreate the old deployment's no-result deadline and trigger.
  s.db.exec(`drop trigger tournament_remote_evidence_insert;
    create trigger tournament_remote_evidence_insert after insert on tournament_remote_evidence
    begin update tournament_remote_evidence set purge_after_at=null where tournament_match_id=new.tournament_match_id; end;`);
  const ended = s.service.leave(s.room.slug, 'g', s.actors[0].userId, 2000);
  expect(s.evidence()?.purge_after_at).toBeNull();
  migrate(s.db);
  expect(s.evidence()?.purge_after_at).toBe(ended.endedAt! + 2 * day);
  const once = s.db.serialize();
  const changes = s.db.prepare('select total_changes() as n').get();
  migrate(s.db);
  expect(s.db.serialize().equals(once)).toBe(true);
  expect(s.db.prepare('select total_changes() as n').get()).toEqual(changes);
  s.db.prepare('delete from tournament_remote_evidence where tournament_match_id=?').run(s.matchId);
  captureRemoteTournamentEvidence(s.db, s.tableId, ended.endedAt! + 1);
  expect(s.evidence()?.purge_after_at).toBe(ended.endedAt! + 2 * day);
});
