import { useMemo, useRef } from 'react';
import type { RemoteEvent, RemoteRoom } from '@yugidraft/shared/remote';

/** Card detection in a tournament table. Auto-detect is the default and the opponent sees each player's mode. */
export type TournamentMode='auto'|'tap';
export type TournamentModeReason='start'|'player'|'slow-offer';

/** A tournament table has a match link. A normal Remote table has none and keeps the device preference. */
export const isTournamentTable=(room:Pick<RemoteRoom,'tournamentMatchId'>)=>room.tournamentMatchId!==undefined;

const modeKey=(slug:string,seat:number)=>`dd-remote-tournament-mode:v1:${slug}:${seat}`;
/** The player's own choice for this table only. It never touches the device preference, and a reload keeps it. */
export function readTournamentMode(slug:string,seat:number):TournamentMode|null {
  try{const value=sessionStorage.getItem(modeKey(slug,seat));return value==='auto'||value==='tap'?value:null;}catch{return null;}
}
export function saveTournamentMode(slug:string,seat:number,mode:TournamentMode) {
  try{sessionStorage.setItem(modeKey(slug,seat),mode);}catch{/* Memory-only fallback. */}
}

/** The newest announced mode of each seat. The reducer keeps no mode, so it is read from the public events. */
export function announcedModes(events:readonly Pick<RemoteEvent,'seq'|'actorSeat'|'action'>[],into=new Map<number,TournamentMode>()) {
  for(const event of [...events].sort((a,b)=>a.seq-b.seq)){
    const action=event.action;
    if(action.type==='detection.mode'&&event.actorSeat!==null)into.set(event.actorSeat,action.mode);
  }
  return into;
}

/**
 * Mode of each seat for this table. The events window is short, so an announcement seen once stays in memory.
 * A seat with no announcement yet shows the tournament default, Auto-detect.
 */
export function useAnnouncedModes(room:Pick<RemoteRoom,'slug'|'events'>):ReadonlyMap<number,TournamentMode> {
  const memory=useRef({slug:room.slug,modes:new Map<number,TournamentMode>(),seq:-1});
  if(memory.current.slug!==room.slug)memory.current={slug:room.slug,modes:new Map(),seq:-1};
  const known=memory.current;
  return useMemo(()=>{
    const fresh=room.events.filter(event=>event.seq>known.seq);
    if(fresh.length){announcedModes(fresh,known.modes);known.seq=Math.max(known.seq,...fresh.map(event=>event.seq));}
    return new Map(known.modes);
  },[room.events,known]);
}

export const modeLabel=(mode:TournamentMode|undefined)=>mode==='tap'?'Tap to identify':'Auto-detect';
