
/** The player's answer to "Auto-detect or Tap to identify", kept per browser. No answer means Auto-detect. */
export type TapChoice='switch'|'keep';
const KEY='dd-remote-tap-offer:v1';
/** Blocked storage still holds the answer for this page. */
let answer:TapChoice|null=null;
export function readTapChoice():TapChoice|null {
  if(answer)return answer;
  try{const value=localStorage.getItem(KEY);return value==='switch'||value==='keep'?value:null;}catch{return null;}
}
export function saveTapChoice(choice:TapChoice) {
  answer=choice;
  // Only a switch has a reason; the slow-computer offer names it first (noteTapReason), any other switch is the player's own.
  reason=choice==='switch'?pending??'player':null;pending=null;
  try{localStorage.setItem(KEY,choice);if(reason)localStorage.setItem(REASON_KEY,reason);else localStorage.removeItem(REASON_KEY);}catch{/* Memory-only fallback. */}
}
/** Why Auto-detect is off on this browser: the slow-computer offer, or the player's own switch. */
export type TapReason='slow'|'player';
const REASON_KEY='dd-remote-tap-reason:v1';
let reason:TapReason|null=null,pending:TapReason|null=null;
/** Names the reason for the next switch to Tap. */
export const noteTapReason=(value:TapReason)=>{pending=value;};
/** The reason for the saved Tap choice, or null when it is not known (a choice saved before reasons were kept). */
export function readTapReason():TapReason|null {
  if(readTapChoice()!=='switch')return null;
  if(reason)return reason;
  try{const value=localStorage.getItem(REASON_KEY);return value==='slow'||value==='player'?value:null;}catch{return null;}
}
/** The offer shows once per page. With no answer it can show again on a later visit. */
let offered=false;
export const tapOfferShown=()=>offered;
export const markTapOfferShown=()=>{offered=true;};
export const TAP_OFFER_MS=20_000;
/** The same rule as the field pacer's weak device. */
export const isWeakDevice=(device:{cores:number;memoryGb?:number})=>device.cores<=2||(device.memoryGb!==undefined&&device.memoryGb<4);

const SLOW_PASS_MS=1500,SUSTAINED_MS=20_000,KEEP_MS=40_000,MIN_PASSES=3;
/**
 * The median detector pass stays over 1500 ms for 20 s.
 * A still scene runs a pass only every 8 to 15 s, so the passes kept reach back further than the 20 s.
 */
export function createSlowWatch() {
  let passes:{at:number;ms:number}[]=[],lastSample=-1;
  return {
    see(at:number,metrics:{detectorMs:number;samples:number}) {
      if(metrics.samples!==lastSample&&metrics.detectorMs>0){lastSample=metrics.samples;passes.push({at,ms:metrics.detectorMs});}
      passes=passes.filter(pass=>at-pass.at<=KEEP_MS);
    },
    slow(at:number) {
      if(passes.length<MIN_PASSES||at-passes[0].at<SUSTAINED_MS)return false;
      const sorted=passes.map(pass=>pass.ms).sort((a,b)=>a-b);
      return sorted[Math.floor(sorted.length/2)]>SLOW_PASS_MS;
    },
  };
}
