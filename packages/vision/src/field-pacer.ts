/**
 * CPU budget for the field watcher on WASM. A still scene costs almost nothing; a change wakes the detector.
 * All numbers come from scripts/vision/benchmark-cpu.ts.
 *
 * Detector passes spend from a bucket of wall milliseconds. The bucket allows a short burst for one placement and
 * then refills at `sustain`, so a hand that moves for a long time never holds the detector at 100%.
 */
export interface FieldPacerDevice { cores:number; memoryGb?:number }
export interface FieldPacer {
  /** A pass may start now. `moving`: a hand or card still moves and nothing waits for an outline; a pass now sees little, so it waits longer and saves the bucket for when the card lands. */
  allow(at:number,moving?:boolean):boolean;
  /** A detector pass of this wall time ended at `at`. */
  spend(wallMs:number,at:number):void;
  /** The scene changed at `at`: retries after a change come sooner than the slow timer. */
  changed(at:number):void;
  /** Slow timer for a full pass on a still scene. */
  stillEvery(at:number,hasCards:boolean):number;
  /** Delay between camera samples. */
  tickMs(state:'still'|'active'|'burst'):number;
  /** A timer fired this late: the main thread is short of time, so back off. */
  late(ms:number):void;
  /** Real share of the last window that a detector pass ran (0..100), not an estimate. */
  duty(at:number):number;
  /** Mean gap between passes in the last window, for the debug line. */
  gap(at:number):number;
}
const WINDOW_MS=10_000,STILL_CARDS_MS=8000,STILL_EMPTY_MS=15_000,RETRY_MS=2000,RETRY_FOR_MS=6000;
/** Rest between passes in a burst, as a share of the pass: at most 2 parts work to 1 part rest. */
const BURST_REST=.5,MOVING_REST=2,MOVING_REST_MS=400;
export const fieldPacerDevice=():FieldPacerDevice=>{
  const nav=(globalThis as {navigator?:Navigator&{deviceMemory?:number}}).navigator;
  return {cores:nav?.hardwareConcurrency??2,memoryGb:nav?.deviceMemory};
};
export function createFieldPacer(device:FieldPacerDevice,start:number):FieldPacer {
  const weak=device.cores<=2||(device.memoryGb!==undefined&&device.memoryGb<4);
  const sustain=weak?.25:.35;
  let tokens=2500,last=start,passMs=0,lastEnd=-Infinity,changedAt=-Infinity,lateEma=0,backoff=1;
  const passes:{end:number;wall:number}[]=[];
  const capacity=()=>Math.max(2500,passMs*6);
  const refill=(at:number)=>{tokens=Math.min(capacity(),tokens+Math.max(0,at-last)*sustain/backoff);last=Math.max(last,at);};
  const prune=(at:number)=>{while(passes.length&&at-passes[0].end>WINDOW_MS)passes.shift();};
  return {
    allow(at,moving=false){
      refill(at);
      const rest=moving?Math.max(MOVING_REST_MS,passMs*MOVING_REST):passMs*BURST_REST;
      return tokens>0&&at-lastEnd>=rest*backoff;
    },
    spend(wallMs,at){
      refill(at);tokens-=wallMs;passMs=passMs?passMs*.7+wallMs*.3:wallMs;lastEnd=at;passes.push({end:at,wall:wallMs});prune(at);
    },
    changed(at){changedAt=at;},
    stillEvery(at,hasCards){
      if(at-changedAt<RETRY_FOR_MS)return RETRY_MS*backoff;
      return (hasCards?STILL_CARDS_MS:STILL_EMPTY_MS)*backoff;
    },
    tickMs(state){return (state==='still'?250:state==='burst'?66:100)*(state==='still'?backoff:1);},
    late(ms){
      lateEma=lateEma*.9+Math.max(0,ms)*.1;
      if(lateEma>120)backoff=Math.min(4,backoff*1.05);else if(lateEma<40)backoff=Math.max(1,backoff*.98);
    },
    duty(at){prune(at);const busy=passes.reduce((sum,p)=>sum+p.wall,0);return Math.min(100,100*busy/WINDOW_MS);},
    gap(at){prune(at);return passes.length?WINDOW_MS/passes.length:WINDOW_MS;},
  };
}
