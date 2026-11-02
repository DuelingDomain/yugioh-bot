import type { RemoteActionProposal, RemoteRoom } from '@yugidraft/shared/remote';
export type RoomMutation = (proposal:RemoteActionProposal)=>Promise<RemoteRoom|null>;
export type RoomTransaction = <T>(work:(room:RemoteRoom,act:RoomMutation)=>Promise<T>)=>Promise<T>;
/** Manual reads, prompts and watcher changes share one queue and returned state. */
export function createRoomMutationQueue(read:()=>RemoteRoom|undefined,post:RoomMutation) {
  let chain:Promise<unknown>=Promise.resolve(),latest:RemoteRoom|undefined;
  const current=()=>{const rendered=read();if(rendered&&(!latest||rendered.lastSeq>=latest.lastSeq))latest=rendered;return latest;};
  const act:RoomMutation=async proposal=>{const updated=await post(proposal);if(updated&&(!latest||updated.lastSeq>=latest.lastSeq))latest=updated;return updated;};
  const transaction:RoomTransaction=work=>{
    const result=chain.then(()=>{const room=current();if(!room)throw new Error('Table is not loaded');return work(room,act);});
    chain=result.catch(()=>undefined);return result;
  };
  return {transaction,action:(proposal:RemoteActionProposal)=>transaction((_,apply)=>apply(proposal))};
}
