import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RemotePosition, RemoteState } from './types.js';
import type { RemoteReductionContext } from './deck-checks.js';
import { freezeRemoteValue } from './position.js';

// Module scope is intentional: the web constructs a new service for each request.
// Both limits apply across all services/databases in this process. Budget charged at
// 4x UTF-8 JSON bytes to allow for decoded objects/strings (not an exact heap size).
const MAX_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 512;
const cache = new Map<string, {value: unknown; bytes: number}>();
const hashes = new WeakMap<object, {hash:string; json:string}>();
let bytes = 0, hits = 0;
export const remoteValueCacheStats = () => ({entries:cache.size, bytes, hits, maxBytes:MAX_BYTES, maxEntries:MAX_ENTRIES});
function cached(hash: string, value: unknown, json: string) {
  const cost = Buffer.byteLength(json) * 4;
  if (cost > MAX_BYTES) return;
  if (cache.has(hash)) { bytes -= cache.get(hash)!.bytes; cache.delete(hash); }
  cache.set(hash,{value,bytes:cost}); bytes += cost;
  while (cache.size > MAX_ENTRIES || bytes > MAX_BYTES) {
    const oldest=cache.keys().next().value!; bytes-=cache.get(oldest)!.bytes; cache.delete(oldest);
  }
}
function intern(db: Database.Database, value: object): string {
  freezeRemoteValue(value);
  let encoded = hashes.get(value);
  if (!encoded) {
    const json=JSON.stringify(value);
    encoded={hash:createHash('sha256').update(json).digest('hex'),json};
    hashes.set(value,encoded);
  }
  db.prepare('insert or ignore into remote_values(hash,json) values(?,?)').run(encoded.hash, encoded.json);
  return encoded.hash;
}
function resolve<T>(db: Database.Database, hash: string): T {
  // Check existence even on a cache hit: never mask a missing value or a rollback.
  const saved=cache.get(hash);
  if (saved) {
    if (!db.prepare('select 1 from remote_values where hash=?').get(hash)) throw new Error(`Missing Remote Duel value ${hash}`);
    hits++; cache.delete(hash); cache.set(hash,saved); return saved.value as T;
  }
  const row=db.prepare('select json from remote_values where hash=?').get(hash) as {json:string} | undefined;
  if (!row) throw new Error(`Missing Remote Duel value ${hash}`);
  if (createHash('sha256').update(row.json).digest('hex') !== hash) throw new Error(`Corrupt Remote Duel value ${hash}`);
  const value=freezeRemoteValue(JSON.parse(row.json));
  if (value && typeof value==='object') hashes.set(value,{hash,json:row.json});
  cached(hash,value,row.json); return value as T;
}
type Reference = {valueHash:string};
export function readRemoteState(db: Database.Database, json: string): RemoteState {
  const stored=JSON.parse(json);
  if (stored.storageVersion !== undefined && stored.storageVersion !== 1) throw new Error('Unsupported Remote Duel storage version');
  if (stored.storageVersion === 1) {
    delete stored.storageVersion;
    const position=(ref:Reference) => resolve<RemotePosition>(db,ref.valueHash);
    if (stored.undo) stored.undo.before=position(stored.undo.before);
    for (const entry of stored.undoHistory ?? []) {
      if (entry.before) entry.before=position(entry.before);
      if (entry.after) entry.after=position(entry.after);
    }
  } else {
    if (stored.undo) freezeRemoteValue(stored.undo.before);
    for (const entry of stored.undoHistory ?? []) {
      freezeRemoteValue(entry.before); freezeRemoteValue(entry.after);
    }
  }
  return stored;
}
/** Must run inside the same immediate transaction as the state update/event. */
export function writeRemoteState(db: Database.Database, tableId: number, state: RemoteState): string {
  if (!db.inTransaction) throw new Error('Remote values require a transaction');
  const wanted=new Set<string>();
  const position=(value:RemotePosition):Reference => { const hash=intern(db,value); wanted.add(hash); return {valueHash:hash}; };
  const stored={...state, storageVersion:1,
    undo:state.undo && {...state.undo,before:position(state.undo.before)},
    ...(state.undoHistory ? {undoHistory:state.undoHistory.map(entry=>({...entry,
      ...(entry.before ? {before:position(entry.before)} : {}), ...(entry.after ? {after:position(entry.after)} : {})}))} : {})};
  const previous=db.prepare('select value_hash from remote_state_values where table_id=?').all(tableId) as {value_hash:string}[];
  const existing=new Set(previous.map(row=>row.value_hash));
  for (const hash of wanted) if (!existing.has(hash)) db.prepare('insert into remote_state_values(table_id,value_hash) values(?,?)').run(tableId,hash);
  for (const hash of existing) if (!wanted.has(hash)) db.prepare('delete from remote_state_values where table_id=? and value_hash=?').run(tableId,hash);
  return JSON.stringify(stored);
}
export function writeRemoteEffects(db: Database.Database, effects?: RemoteReductionContext): {json:string|null; factsHash:string|null} {
  if (!effects) return {json:null,factsHash:null};
  if (!db.inTransaction) throw new Error('Remote values require a transaction');
  const {facts,...rest}=effects;
  return {json:JSON.stringify(rest),factsHash:facts ? intern(db,facts) : null};
}
export function readRemoteEffects(db: Database.Database, json: string|null, factsHash: string|null): RemoteReductionContext | undefined {
  const effects=json ? JSON.parse(json) : undefined;
  return factsHash ? {...effects,facts:resolve<RemoteReductionContext['facts']>(db,factsHash)} : effects;
}
