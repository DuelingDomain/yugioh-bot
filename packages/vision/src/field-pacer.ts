/**
 * Detector budget for the field watcher on WASM and WebGPU. A still scene costs almost nothing; a change wakes the detector.
 * All numbers come from scripts/vision/benchmark-cpu.ts.
 *
 * Whole-frame passes and zooms have separate allowances in wall milliseconds.
 */
export interface FieldPacerDevice { cores:number; memoryGb?:number }
export interface FieldPacer {
  /** Measured wall time for one zoom, or the startup estimate before sampling. */
  readonly priorityCost:number;
  /** Moving hands wait longer. Urgent first reads use the burst rest and may borrow one pass while backoff is off. */
  check(at:number,moving?:boolean,sceneMoving?:boolean,urgent?:boolean):'ready'|'rest'|'budget';
  /** Record wall time and rest. Urgent passes during backoff spend available tokens only. */
  spend(wallMs:number,at:number,sceneMoving?:boolean,debt?:boolean|'urgent'):void;
  /** Charge the actual cell check, including any overrun beyond the preflight estimate. */
  spendPriority(wallMs:number,at:number):void;
  /** Estimated cost of a cell check must fit the current burst budget. */
  canSpendPriority(at:number):boolean;
  /** The scene changed at `at`: retries after a change come sooner than the slow timer. */
  changed(at:number):void;
  /** Slow timer for a full pass on a still scene. It does not back off: a dark card can fall under the scene check. */
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
const WINDOW_MS=10_000,STILL_CARDS_MS=4000,STILL_EMPTY_MS=15_000,RETRY_MS=2000,RETRY_FOR_MS=6000;
const PRIORITY_BURST=4,PRIORITY_REFILL=.35,INITIAL_PRIORITY_COST=90;
/** CPU bursts rest 1:1; GPU bursts keep the shorter rest for quick placement. */
const BURST_REST=.5,MOVING_REST=2,MOVING_REST_MS=400;
export const fieldPacerDevice=():FieldPacerDevice=>{
  const nav=(globalThis as {navigator?:Navigator&{deviceMemory?:number}}).navigator;
  return {cores:nav?.hardwareConcurrency??2,memoryGb:nav?.deviceMemory};
};
export function createFieldPacer(device:FieldPacerDevice,start:number,backend:()=>string|undefined=()=> 'wasm'):FieldPacer {
  const sustain=()=>backend()==='webgpu'?.25:.2;
  let tokens=2500,prioritySpent=0,priorityCost=0;
  let last=start,passMs=0,lastEnd=-Infinity,changedAt=-Infinity,movingSince=-Infinity,wakeAt=-Infinity,wakePermit=false,lateEma=0,backoff=1;
  const passes:{end:number;wall:number}[]=[];
  const capacity=()=>Math.max(2500,passMs*6);
  const estimatedPriorityCost=()=>priorityCost||INITIAL_PRIORITY_COST;
  const refill=(at:number)=>{
    const elapsed=Math.max(0,at-last)/backoff;
    // Zooms have their own allowance so a burst leaves time for whole-frame scans.
    prioritySpent=Math.max(0,prioritySpent-elapsed*PRIORITY_REFILL);
    tokens=Math.min(capacity(),tokens+elapsed*sustain());last=Math.max(last,at);
  };
  const prune=(at:number)=>{while(passes.length&&at-passes[0].end>WINDOW_MS)passes.shift();};
  const check:FieldPacer['check']=(at,moving=false,sceneMoving=moving,urgent=false)=>{
    refill(at);
    const gpu=backend()==='webgpu',burstRest=passMs*(gpu?BURST_REST:1);
    const rest=urgent?burstRest:(moving?Math.max(MOVING_REST_MS,passMs*MOVING_REST):burstRest)*backoff;
    if(at-lastEnd<rest||!urgent&&moving&&!gpu&&at-movingSince<MOVING_REST_MS)return 'rest';
    // During backoff an urgent pass can spend any positive balance without incurring debt.
    if(urgent)return (backoff>1?tokens>0:tokens>=0)?'ready':'budget';
    return tokens>0||wakePermit&&!sceneMoving?'ready':'budget';
  };
  const record=(wall:number,end:number)=>{passes.push({end,wall});prune(end);};
  return {
    get priorityCost(){return estimatedPriorityCost();},
    check,
    spend(wallMs,at,sceneMoving=false,debt=true){
      refill(at);if(!sceneMoving)wakePermit=false;
      const allowDebt=debt===true||debt==='urgent'&&backoff===1;
      tokens=allowDebt?tokens-wallMs:Math.max(Math.min(tokens,0),tokens-wallMs);
      passMs=passMs?passMs*.7+wallMs*.3:wallMs;lastEnd=at;record(wallMs,at);
    },
    spendPriority(wallMs,at){
      refill(at);
      if(wallMs>0)priorityCost=priorityCost?priorityCost+(wallMs-priorityCost)*.2:wallMs;
      prioritySpent+=wallMs;
      record(wallMs,at);
    },
    canSpendPriority(at){refill(at);return prioritySpent<=(PRIORITY_BURST-1)*estimatedPriorityCost();},
    changed(at){
      if(at-changedAt>1000+passMs){
        movingSince=at;
        // A fresh change can borrow one pass; spend still records its debt for repayment.
        if(at-wakeAt>=8000){wakePermit=true;wakeAt=at;}
      }
      changedAt=at;
    },
    stillEvery(at,hasCards){
      const every=backend()==='webgpu'?1500:hasCards?STILL_CARDS_MS:STILL_EMPTY_MS;
      return at-changedAt<RETRY_FOR_MS?Math.min(every,RETRY_MS*backoff):every;
    },
    tickMs(state){return (state==='still'?250:state==='burst'?66:100)*(state==='still'?backoff:1);},
    late(ms){
      lateEma=lateEma*.9+Math.max(0,ms)*.1;
      if(lateEma>120)backoff=Math.min(4,backoff*1.05);else if(lateEma<40)backoff=Math.max(1,backoff*.98);
    },
    duty(at){prune(at);const busy=passes.reduce((sum,p)=>sum+p.wall,0);return Math.min(100,100*busy/WINDOW_MS);},
    gap(at){prune(at);return passes.length>1?(passes[passes.length-1].end-passes[0].end)/(passes.length-1):WINDOW_MS;},
  };
}
