import { ygoModule, type RemoteActionProposal, type RemoteRoom } from '@yugidraft/shared/remote';

let counter = 0;
export function tapRoom(): RemoteRoom {
  return { guildId:'tap-test',slug:`tap-${++counter}`,gameId:'ygo',seatCount:2,mySeat:0,status:'active',solo:false,
    createdBy:1,createdAt:0,startedAt:0,endedAt:null,lastEventAt:0,lastSeq:0,endReason:null,idleWarningAt:null,
    seats:[0,1].map(seat=>({seat,userId:seat+1,displayName:`Player ${seat+1}`,bot:false,ready:true})),
    state:ygoModule.initialState({seatCount:2}),events:[] };
}
export function applyTap(room: RemoteRoom, action: RemoteActionProposal): RemoteRoom {
  const id=`action-${room.lastSeq+1}`,full={...action,idempotencyKey:id,at:1000+room.lastSeq};
  return {...room,lastSeq:room.lastSeq+1,state:ygoModule.reduce(room.state,full),events:[...room.events,{id,seq:room.lastSeq+1,at:full.at,actorSeat:action.actorSeat,userId:1,action:full}]};
}
