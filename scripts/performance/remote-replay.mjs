import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { migrate } from '../../packages/shared/dist/db/index.js';
import { createRemoteDuelService } from '../../packages/shared/dist/services/remote-duels.js';
import { remoteActionSchema, ygoModule, applyPatch, projectRemoteState } from '../../packages/shared/dist/remote/index.js';

// Node 22; build packages/shared first. Run with --sync to compare the synchronous path.
// All fixtures live in disposable in-memory databases. No application data is read or changed.
const synchronous = process.argv.includes('--sync');
const runs = [];
for (let run = 0; run < 5; run++) {
  const db = new Database(':memory:'); migrate(db);
  db.prepare("insert into users(id,username,display_name) values(101,'benchmark','Bench')").run();
  const service = createRemoteDuelService(db);
  const room = service.create({ guildId: 'g', userId: 101, displayName: 'Bench', gameId: 'ygo', seatCount: 2, bestOf: 1, visibility: 'public' }, 1000);
  let seq = room.lastSeq;
  let state = room.state;
  const insert = db.prepare('insert into remote_events(table_id,seq,idempotency_key,actor_seat,user_id,action_json,created_at) values(?,?,?,?,?,?,?)');
  const { id } = db.prepare('select id from remote_tables where slug=?').get(room.slug);
  db.transaction(() => {
    for (let i = 0; i < 2200; i++) {
      // Public board changes rather than only chat: alternating LP changes and phases, with log notes.
      const action = remoteActionSchema.parse({ actorSeat: i < 40 ? i % 2 : 0, idempotencyKey: `bench-${i}`, at: 2000 + i,
        ...(i < 40 ? { type: 'twin.place', seat: i % 2, zone: i < 10 ? 'monster' : 'graveyard', card: { ref: `card-${i}`, name: `Synthetic monster ${i}`, cardId: 1000+i, slot: Math.floor(i/2)+1 <= 5 ? Math.floor(i/2)+1 : undefined } } : i % 5 === 0 ? { type: 'log.note', text: 'Synthetic remote duel note: checking a long replay.' }
          : i % 5 === 1 ? { type: 'phase.set', phase: 'main1' }
          : i % 5 === 2 ? { type: 'phase.set', phase: 'standby' }
          : { type: 'lp.change', seat: 0, delta: i % 5 === 3 ? -1 : 1, reason: 'Synthetic damage / recovery' }) });
      state = ygoModule.reduce(state, action, { replay: true });
      insert.run(id, ++seq, action.idempotencyKey, action.actorSeat, 101, JSON.stringify(action), action.at);
    }
    const action = remoteActionSchema.parse({ type: 'player.concede', actorSeat: 0, idempotencyKey: 'bench-end', at: 5000 });
    state = ygoModule.reduce(state, action, { replay: true });
    insert.run(id, ++seq, action.idempotencyKey, action.actorSeat, 101, JSON.stringify(action), action.at);
    db.prepare("update remote_tables set status='ended', started_at=1001, ended_at=5000,last_seq=?,state_json=? where id=?").run(seq, JSON.stringify(state), id);
  })();
  let lastTick = performance.now(), maxGapMs = 0, ticks = 0;
  const timer = setInterval(() => { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now-lastTick); lastTick=now; ticks++; }, 1);
  const start = performance.now();
  const replay = await createRemoteDuelService(db)[synchronous ? 'replayFrames' : 'replayFramesAsync'](room.slug, 'g', 101);
  const rebuilt = performance.now();
  const json = JSON.stringify(replay);
  const serialized = performance.now();
  const warm = performance.now();
  const cached = await createRemoteDuelService(db)[synchronous ? 'replayFrames' : 'replayFramesAsync'](room.slug, 'g', 101);
  const warmEnd = performance.now();
  await new Promise(resolve => setTimeout(resolve, 1));
  clearInterval(timer);
  const final = replay.steps.reduce((board, step) => applyPatch(board, step.ops), replay.initial);
  assert.deepEqual(final, projectRemoteState({ ...state, undo: null, undoHistory: [] }, new Set([0])));
  assert.equal(cached, replay);
  runs.push({ events: replay.steps.length, coldMs: rebuilt-start, maxGapMs, ticks, stringifyMs: serialized-rebuilt, coldTotalMs: serialized-start, cachedMs: warmEnd-warm, jsonBytes: Buffer.byteLength(json), gzipBytes: gzipSync(json).length });
  db.close();
}
console.log(JSON.stringify({ node: process.version, mode: synchronous ? "sync" : "incremental", cards: 40, runs }, null, 2));
