import type { RemoteRoom, RemoteState } from '@yugidraft/shared/remote';

/** Card detection in a tournament table. Auto-detect is the default and the opponent sees each player's mode. */
/** What a player can pick. Manual is set by the app when no camera feed reads the board. */
export type PlayerMode='auto'|'tap';
export type TournamentMode=PlayerMode|'manual';
export type TournamentModeReason='start'|'player'|'slow-offer';

/** A tournament table has a match link. A normal Remote table has none and keeps the device preference. */
export const isTournamentTable=(room:Pick<RemoteRoom,'tournamentMatchId'>)=>room.tournamentMatchId!==undefined;

const modeKey=(slug:string,seat:number)=>`dd-remote-tournament-mode:v1:${slug}:${seat}`;
/** The player's own choice for this table only. It never touches the device preference, and a reload keeps it. */
export function readTournamentMode(slug:string,seat:number):PlayerMode|null {
  try{const value=sessionStorage.getItem(modeKey(slug,seat));return value==='auto'||value==='tap'?value:null;}catch{return null;}
}
export function saveTournamentMode(slug:string,seat:number,mode:PlayerMode) {
  try{sessionStorage.setItem(modeKey(slug,seat),mode);}catch{/* Memory-only fallback. */}
}

/**
 * The mode a seat last announced. The table state keeps it (`state.detection[seat]`), so a reload shows the same answer.
 * Undefined when the seat never announced one: show "Unknown", never a default.
 */
export function stateMode(state:Pick<RemoteState,'detection'>|null|undefined,seat:number):TournamentMode|undefined {
  return state?.detection?.[seat]?.mode;
}

/**
 * The mode this player announces. No camera feed on the board (camera off, no camera, or a phone in scan mode) is "manual",
 * whatever the Auto-detect switch says. Otherwise the switch decides between Auto-detect and Tap.
 */
export const ownDetectionMode=(input:{ownsSource:boolean;cameraOn:boolean;enabled:boolean}):TournamentMode=>
  !input.ownsSource||!input.cameraOn?'manual':input.enabled?'auto':'tap';

export const modeLabel=(mode:TournamentMode|undefined)=>mode==='tap'?'Tap to identify':mode==='auto'?'Auto-detect':mode==='manual'?'Manual':'Unknown';
/** The nameplate badge: a short word so a long player name stays readable on a phone. The full label is the tooltip and the screen reader text. */
export const modeShort=(mode:TournamentMode|undefined)=>mode==='tap'?'Tap':mode==='auto'?'Auto':mode==='manual'?'Manual':'Unknown';
