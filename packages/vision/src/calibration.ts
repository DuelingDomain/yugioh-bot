import { replayTier } from './decision';
import { mergeCandidates } from './search';
import type { Candidate, ConfidenceThresholds, RecognitionEvidence, RecognitionTier } from './types';

export interface RealsetSample {
  id:string; capturedAt:string; label:string|null; condition:string; cardWidthPx:number|null;
  source:'camera'|'photo'; width:number;height:number;clickPoint:{x:number;y:number};
  tier:RecognitionTier; raw:RecognitionEvidence; latencyMs:number; file?:string;
}
export interface RealsetExport {version:1;samples:(RealsetSample & {jpegBase64:string})[]}
const lead=(list:Candidate[]) => (list[0]?.score??-Infinity)-(list[1]?.score??0);
function bound(raw:RecognitionEvidence) {
  const lists=[raw.visual,...raw.frames.map(f=>f.clean)];
  const id=raw.visual[0]?.cardId;
  const eligible=raw.blocked.length===0 && raw.winnerId===id && raw.frames.length>0 && raw.frames.every(f=>f.eligible && f.clean[0]?.cardId===id && f.ranked[0]?.cardId===id);
  return {score:Math.min(...lists.map(l=>l[0]?.score??-Infinity)),margin:Math.min(...lists.map(lead)),eligible};
}
export function realsetMetrics(samples:RealsetSample[],thresholds:ConfidenceThresholds) {
  const positives=samples.filter(s=>s.label!==null),negatives=samples.filter(s=>s.label===null);
  const sure=samples.filter(s=>replayTier(s.raw,thresholds)==='sure');
  const wrong=sure.filter(s=>s.label===null || s.raw.winnerId!==s.label);
  return {samples:samples.length,positives:positives.length,negatives:negatives.length,
    top1:positives.filter(s=>s.raw.winnerId===s.label).length,top5:positives.filter(s=>s.raw.frames.length && (s.raw.ranked??s.raw.visual).slice(0,5).some(c=>c.cardId===s.label)).length,
    sure:sure.length,sureButWrong:wrong.length,negativeSure:wrong.filter(s=>s.label===null).length,wrongIds:wrong.map(s=>s.id)};
}
/** Maximize correct replay coverage over safe single-rule score/margin cutoffs.
 * Also exclude wrong early crop/frame decisions, with a gap in both dimensions.
 * The second broadcast rule is removed, so it cannot bypass the calibrated gate.
 */
export function tuneThresholds(samples:RealsetSample[],safetyGap=.01) {
  if(!samples.length || !samples.some(s=>s.label!==null) || !samples.some(s=>s.label===null))throw new Error('Calibration requires labelled cards AND non-card negatives');
  if(!Number.isFinite(safetyGap) || safetyGap<.001 || safetyGap>.1)throw new Error('Safety gap must be .001–.1');
  const unsafe:{score:number;margin:number}[]=[];
  for(const sample of samples) {
    const lists=[sample.raw.visual,...sample.raw.frames.flatMap(f=>{
      const hypotheses=f.hypotheses??[];
      return [f.clean,...hypotheses,...hypotheses.map((_,i)=>mergeCandidates(hypotheses.slice(0,i+1),10))];
    })];
    for(const list of lists)if(list.length && (sample.label===null || list[0].cardId!==sample.label))unsafe.push({score:list[0].score,margin:lead(list)});
  }
  const scores=[...new Set([.74,1+safetyGap,...unsafe.map(p=>Math.max(.74,p.score+safetyGap+1e-6))])].sort((a,b)=>a-b);
  const bounds=samples.map(s=>({sample:s,...bound(s.raw)}));
  let best:ConfidenceThresholds={score:1+safetyGap,margin:1+safetyGap,floor:.74,cardBackMargin:.1},coverage=-1;
  for(const score of scores) {
    const margin=Math.max(.02,...unsafe.filter(p=>p.score+safetyGap>=score).map(p=>p.margin+safetyGap+1e-6));
    const thresholds:ConfidenceThresholds={score,margin,floor:.74,cardBackMargin:.1};
    const correct=bounds.filter(b=>b.eligible && b.sample.label!==null && b.sample.raw.winnerId===b.sample.label && b.score>=score && b.margin>=Math.max(margin,b.sample.raw.winnerId===b.sample.raw.cardBackId? .1 : 0)).length;
    if(correct>coverage){best=thresholds;coverage=correct;}
  }
  const metrics=realsetMetrics(samples,best);
  if(metrics.sureButWrong!==0)throw new Error('Calibration safety invariant failed');
  return {thresholds:best,safetyGap,metrics};
}
