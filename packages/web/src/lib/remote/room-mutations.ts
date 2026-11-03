import type { RemoteActionProposal, RemoteRoom } from '@yugidraft/shared/remote';
export type RoomMutation = (proposal:RemoteActionProposal,idempotencyKey?:string)=>Promise<RemoteRoom|null>;
export type RoomTransaction = <T>(work:(room:RemoteRoom,act:RoomMutation)=>Promise<T>)=>Promise<T>;
/** Manual reads, prompts and watcher changes share one queue and returned state. */
export function createRoomMutationQueue(read:()=>RemoteRoom|undefined,post:RoomMutation) {
  let chain:Promise<unknown>=Promise.resolve(),writes:Promise<unknown>=Promise.resolve(),latest:RemoteRoom|undefined;
  const current=()=>{const rendered=read();if(rendered&&(!latest||rendered.lastSeq>=latest.lastSeq))latest=rendered;return latest;};
  // A transaction can start more than one write before awaiting either. Choose
  // baseSeq in post only after the preceding response has updated the room ref.
  const act:RoomMutation=(proposal,idempotencyKey)=>{
    const result=writes.then(async()=>{const updated=await post(proposal,idempotencyKey);if(updated&&(!latest||updated.lastSeq>=latest.lastSeq))latest=updated;return updated;});
    writes=result.catch(()=>undefined);return result;
  };
  const transaction:RoomTransaction=work=>{
    const result=chain.then(()=>{const room=current();if(!room)throw new Error('Table is not loaded');return work(room,act);});
    chain=result.catch(()=>undefined);return result;
  };
  return {transaction,action:(proposal:RemoteActionProposal,idempotencyKey?:string)=>transaction((_,apply)=>apply(proposal,idempotencyKey))};
}
