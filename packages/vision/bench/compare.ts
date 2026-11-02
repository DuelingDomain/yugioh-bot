import type {ReplayResult} from './session';
import type {scoreSession} from './score';
interface Run {sessionId:string;deckMode:string;result:ReplayResult;metrics:ReturnType<typeof scoreSession>;labelSha256:string;videoSha256:string}
/** Regression gates compare identical footage/labels, never unrelated samples. */
export function compareRuns(current:Run[],previous:Run[]) {
  const reasons:string[]=[];
  const keyOf=(r:Run)=>`${r.sessionId}/${r.result.variant}/${r.result.requestedBackend}/${r.deckMode}`;
  const currentKeys=new Set(current.map(keyOf)),previousKeys=new Set(previous.map(keyOf));
  if(currentKeys.size!==current.length||previousKeys.size!==previous.length)reasons.push('Duplicate comparison run keys');
  if(currentKeys.size!==previousKeys.size||[...previousKeys].some(k=>!currentKeys.has(k)))reasons.push('Comparison run sets differ; include all original sessions/backends/variants/deck modes');
  for(const run of current){
    const old=previous.find(p=>p.sessionId===run.sessionId&&p.result.variant===run.result.variant&&p.result.requestedBackend===run.result.requestedBackend&&p.deckMode===run.deckMode);
    const key=`${run.sessionId}/${run.result.variant}/${run.result.requestedBackend}/${run.deckMode}`;
    if(!old){reasons.push(`${key}: missing comparison run`);continue;}
    if(old.videoSha256!==run.videoSha256||old.labelSha256!==run.labelSha256){reasons.push(`${key}: footage/label hashes differ`);continue;}
    const a=run.metrics,b=old.metrics;
    for(const metric of ['top1','top5'] as const)if(a.identity[metric]<b.identity[metric])reasons.push(`${key}: identity ${metric} regressed`);
    if(a.wrongSure+a.unsafeSure>b.wrongSure+b.unsafeSure)reasons.push(`${key}: more wrong/unsafe sure events`);
    if(a.promptsPerCard.reduce((s,p)=>s+p.count,0)+a.unassignedPrompts>b.promptsPerCard.reduce((s,p)=>s+p.count,0)+b.unassignedPrompts)reasons.push(`${key}: more prompts`);
    for(const kind of ['placed','moved','removed'] as const){
      const x=a.latencies[kind].p95Ms,y=b.latencies[kind].p95Ms;
      if(y!==null&&(x===null||x>y*1.2))reasons.push(`${key}: ${kind} p95 regressed by >20% or is missing`);
    }
  }
  return {passed:reasons.length===0,reasons};
}
