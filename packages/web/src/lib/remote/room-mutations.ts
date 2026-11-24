import { applyPatch, type RemoteActionProposal, type RemoteRoom, type RoomPatch } from '@yugidraft/shared/remote';
import { markFieldAction } from './field-timing';
import { adoptManualCorrection, beginManualCorrection, cameraCorrectionBlocked } from './manual-corrections';
import { rememberRecentRead } from './recent-reads';
import { OutageGaveUpError, writeWaiting, retryThroughOutage, SKIPPED } from './outage';
/** A player's own action waits this long for the connection, then gives up and the table is refreshed (a stale click must not land minutes later). */
export const MANUAL_OUTAGE_CAP_MS=20_000;
export type RoomMutation = (proposal:RemoteActionProposal,idempotencyKey?:string)=>Promise<RemoteRoom|null>;
/** The server's last refusal text for a table action, for notices and the Debug view. */
let lastActionError:{message:string;at:number;code?:string}|undefined;
export function noteRemoteActionError(error:unknown){lastActionError={message:error instanceof Error?error.message:String(error),at:Date.now(),code:(error as {code?:string}|null)?.code};}
export const remoteActionError=()=>lastActionError;
/**
 * `remote:changed` only says that a table moved. The GET it used to start returns the same room that `remote:private` already carried
 * (or that this browser's own action reply carried), so it is needed only when the announced sequence is newer than the newest one held.
 * A lost private message leaves the held sequence behind, so the GET still runs; the slow poll repairs anything else.
 */
export const remoteChangeNeedsFetch=(heldSeq:number,announcedSeq:number)=>announcedSeq>heldSeq;
/** `lanes`: the cards and cells the work touches. Works with a common lane run in order; others do not wait for each other. */
/** Lane keys for a queued work (see createRoomMutationQueue): one `zone:` key per cell and one `ref:` key per card, no duplicates. */
export const laneOf=(refs:readonly (string|undefined)[],zones:readonly (string|undefined)[]=[])=>[...new Set([...zones.filter((z):z is string=>!!z).map(z=>`zone:${z}`),...refs.filter((r):r is string=>!!r).map(r=>`ref:${r}`)])];
/** A card that leaves a field cell can end in a pile, and its pile order write follows its move: every pile write waits for it. */
export const PILE_LANES=['GY','BANISHED'] as const;
export type RoomTransaction = <T>(work:(room:RemoteRoom,act:RoomMutation)=>Promise<T>,lanes?:readonly string[])=>Promise<T>;

export const hasPendingTwinConfirmation = (room: RemoteRoom) =>
  !!(room.state.twinConfirmation || room.state.twinConfirmationQueue?.length);

/**
 * Serialize board transactions. Notes can use the manual chain independently.
 * `onPost` runs once per write, the moment it passes the local checks (valid, camera correction), before it waits for the post gate or an
 * older write. A retry never runs it again.
 */
export function createRoomMutationQueue(read:()=>RemoteRoom|undefined,post:RoomMutation,giveUp?:(error:Error)=>void,valid?:()=>boolean,onPost?:(proposal:RemoteActionProposal,key:string,room:RemoteRoom|undefined)=>void) {
  const idle = Promise.resolve();
  let manual: Promise<unknown> = idle;
  let latest: RemoteRoom | undefined;
  const current = () => {
    const rendered = read();
    if (rendered && (!latest || rendered.lastSeq >= latest.lastSeq)) latest = rendered;
    return latest;
  };
  // A retry (camera retry, outage retry, Retry button) calls `act` again with the same key: it previews once.
  const announced = new Set<string>();
  const announce = (proposal:RemoteActionProposal, key:string|undefined) => {
    if (!onPost || !key || announced.has(key)) return;
    const now = current();
    if (valid?.() === false || (now && cameraCorrectionBlocked(now, proposal))) return;
    announced.add(key);
    if (announced.size > 64) announced.delete(announced.values().next().value!);
    try { onPost(proposal, key, now); } catch { /* A preview never blocks a write. */ }
  };
  const write = async (proposal:RemoteActionProposal, key?:string, prepared?:()=>void, patient=false) => {
    const now = current();
    const rollback = prepared ?? (now ? beginManualCorrection(now, proposal) : undefined);
    try {
      if (valid?.() === false || (now && cameraCorrectionBlocked(now, proposal))) {
        rollback?.();
        return null;
      }
      if (key) markFieldAction(key, 'writeDequeued');
      const result = patient
        ? await retryThroughOutage(() => post(proposal, key), {valid, capMs: MANUAL_OUTAGE_CAP_MS})
        : await post(proposal, key);
      if (result === SKIPPED || !result) {
        rollback?.();
        return null;
      }
      adoptManualCorrection(result, proposal);
      rememberRecentRead(result, proposal);
      if (!latest || result.lastSeq >= latest.lastSeq) latest = result;
      return result;
    } catch (error) {
      rollback?.();
      if (!(error instanceof OutageGaveUpError) || !patient) throw error;
      giveUp?.(new Error('Could not reach the table. Check the connection and try again.'));
      return null;
    }
  };
  // Board works run one after the other only when they touch the same card or cell (the same "lane"). A work that waits (card facts,
  // a slow read) holds back the works of its own lanes, never the works for other cards. Works without a lane (a player's action, a
  // board re-sync) wait for every earlier work and hold back every later one, as the single chain did.
  const lanes = new Map<string, Promise<unknown>>(), live = new Set<Promise<unknown>>();
  let barrier: Promise<unknown> = idle;
  // The server accepts one write per sequence number, so the posts themselves still go out one at a time, in the order they are ready.
  let gate: Promise<unknown> = idle;
  const post1 = <T,>(run:()=>Promise<T>):Promise<T> => { const sent = gate.then(run); gate = sent.catch(() => undefined); return sent; };
  const transaction: RoomTransaction = (work, laneKeys) => {
    const keys = laneKeys?.length ? [...new Set(laneKeys)] : undefined;
    const before = Promise.all([barrier, ...(keys ? keys.map(key => lanes.get(key) ?? idle) : live)]);
    const result = before.then(async () => {
      const room = current();
      if (!room) throw new Error('Table is not loaded');
      let writes: Promise<unknown> = idle;
      // A callback can start more than one write before awaiting either.
      const act: RoomMutation = (proposal, given) => {
        const key = given ?? (onPost ? crypto.randomUUID() : undefined);
        if (key) markFieldAction(key, 'writeQueued');
        announce(proposal, key);
        const sent = writes.then(() => post1(() => write(proposal, key)));
        writes = sent.catch(() => undefined);
        return sent;
      };
      try { return await work(room, act); }
      finally { await writes; }
    });
    const tail = result.catch(() => undefined);
    if (keys) {
      live.add(tail);
      for (const key of keys) lanes.set(key, tail);
      void tail.then(() => { live.delete(tail); for (const key of keys) if (lanes.get(key) === tail) lanes.delete(key); });
    } else barrier = tail;
    return result;
  };
  return {
    transaction,
    action: (proposal:RemoteActionProposal, idempotencyKey?:string) => {
      if (writeWaiting()) {
        giveUp?.(new Error('Reconnecting… try again in a moment.'));
        return Promise.resolve(null);
      }
      const room = current();
      const rollback = room && beginManualCorrection(room, proposal);
      const key = idempotencyKey ?? crypto.randomUUID();
      if (idempotencyKey) markFieldAction(key, 'writeQueued');
      announce(proposal, key);
      const prior = manual;
      const run = () => prior.then(() => write(proposal, key, rollback, true));
      // A log note can clear a pending placement confirmation in the reducer. A response never touches the board, so it skips the queue.
      const independent = (proposal.type === 'log.note' || proposal.type === 'chain.respond' || proposal.type === 'chain.thinking' || proposal.type === 'chain.ok') && room && !hasPendingTwinConfirmation(room);
      const result = independent ? run() : transaction(run);
      manual = result.catch(() => undefined);
      return result;
    },
  };
}

/** What a browser holding sequence `held` does with a patch: apply it, drop it as old, or repair because it cannot be applied in order. */
export const classifyPatch=(held:number,patch:RoomPatch):'apply'|'stale'|'repair'=>
  patch.seq<=held?'stale':patch.base===held&&patch.seq>patch.base?'apply':'repair';
/** The view after a patch. The old view is untouched; parts the patch does not reach keep their identity. A throw means a bad patch: repair. */
export const applyRoomPatch=(room:RemoteRoom,patch:RoomPatch):RemoteRoom=>({...applyPatch(room,patch.ops),lastSeq:patch.seq});

/**
 * One repair GET at a time, never a storm. Every trigger (gap, bad patch, reconnect, tab shown, a notice with no data) asks here.
 * Asks that come while one is waiting join it. The GET starts after a random delay, and it is skipped when the sequence it was
 * asked for has arrived meanwhile (`wantedSeq` 0 means always run). An ask during the GET adds nothing for a wanted sequence the GET may already cover; only a wanted sequence still missing afterwards starts one more.
 * An ask with `wantedSeq` 0 during the GET (join ack, tab shown) always starts one more afterwards, because the GET may have been read before the socket joined.
 */
export function createRepairScheduler(run:()=>Promise<unknown>,held:()=>number,options:{random?:()=>number;timers?:{set:(fn:()=>void,ms:number)=>unknown;clear:(id:unknown)=>void}}={}){
  const random=options.random??Math.random,timers=options.timers??{set:(fn:()=>void,ms:number)=>setTimeout(fn,ms),clear:(id:unknown)=>clearTimeout(id as ReturnType<typeof setTimeout>)};
  let timer:unknown,need:number|undefined,running=false,laterNeed=0,rerun=false;
  const start=()=>{
    timer=undefined;const wanted=need;need=undefined;
    if(wanted!==undefined&&wanted>0&&held()>=wanted)return;
    running=true;
    void run().catch(()=>undefined).finally(()=>{running=false;const later=laterNeed,again=rerun;laterNeed=0;rerun=false;if(again)ask(0,300);else if(later>held())ask(later,300);});
  };
  /** `wantedSeq`: the sequence that makes the GET useless once held. `jitterMs`: the longest random delay. */
  function ask(wantedSeq:number,jitterMs:number){
    if(running){if(wantedSeq===0)rerun=true;else laterNeed=Math.max(laterNeed,wantedSeq);return;}
    need=need===undefined?wantedSeq:need===0||wantedSeq===0?0:Math.max(need,wantedSeq);
    if(timer!==undefined)return;
    timer=timers.set(start,Math.floor(random()*jitterMs));
  }
  return {ask,cancel(){if(timer!==undefined)timers.clear(timer);timer=undefined;need=undefined;laterNeed=0;rerun=false;}};
}
