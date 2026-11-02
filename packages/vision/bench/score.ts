import {boxIou,distribution,validBox,type LabelledSession,type ReplayResult,type PredictedEvent,type EventKind} from './session';
const windows:Record<EventKind,number>={placed:5000,moved:3000,removed:7000,flipped:3000,defense:3000};
const ratio=(a:number,b:number)=>b?a/b:0;
export function scoreSession(session:LabelledSession,run:ReplayResult) {
  const used=new Set<number>(),bindings=new Map<string,string>();
  const labels=[...session.events].sort((a,b)=>a.atMs-b.atMs);
  const perEvent=labels.map(label=>{
    const choices=run.events.map((p,i)=>({p,i})).filter(({p,i})=>{
      const kind=p.kind==='prompt'?'placed':p.kind;
      if(!Number.isFinite(p.atMs)||!validBox(p.box)||used.has(i)||kind!==label.kind||p.atMs<label.atMs-100||p.atMs>label.atMs+windows[label.kind])return false;
      const bound=bindings.get(label.instanceId);
      // Spatial evidence is independent of zone and identity; neither can hide errors.
      return label.box?boxIou(label.box,p.box)>=.2:bound?bound===p.trackId:true;
    }).sort((a,b)=>a.p.atMs-b.p.atMs);
    const found=choices[0];if(found){used.add(found.i);bindings.set(label.instanceId,found.p.trackId);}
    const prediction=found?.p;
    const identified=!!prediction&&prediction.kind!=='prompt'&&(label.faceDown?prediction.faceDown===true:!!label.cardId&&prediction.cardId===label.cardId)&&prediction.zone===label.zone&&(label.position===undefined||prediction.position===label.position);
    const identifiedLatencyMs=identified?Math.max(0,prediction!.atMs-label.atMs):null;
    const identityEligible=!!label.cardId&&!label.faceDown;
    return {labelId:label.id,instanceId:label.instanceId,kind:label.kind,atMs:label.atMs,matched:!!prediction,predictionIndex:found?.i??null,
      latencyMs:prediction?Math.max(0,prediction.atMs-label.atMs):null,identifiedLatencyMs,identityEligible,
      top1:identityEligible&&prediction?.candidates?.[0]===label.cardId,top5:identityEligible&&!!prediction?.candidates?.slice(0,5).includes(label.cardId!),
      automatic:identified,zoneCorrect:prediction?.zone===label.zone,destinationCorrect:label.kind==='removed'?prediction?.zone===label.zone:null,
      wrongSure:!!prediction&&prediction.tier==='sure'&&identityEligible&&prediction.candidates?.[0]!==label.cardId,
      orientationCorrect:label.position===undefined?null:prediction?.position===label.position};
  });
  const matched=perEvent.filter(e=>e.matched).length,eligible=perEvent.filter(e=>e.identityEligible);
  const prompts=run.events.filter(p=>p.kind==='prompt');
  const promptsPerCard=Array.from(new Set(labels.map(e=>e.instanceId))).map(instanceId=>{
    const cardLabels=labels.filter(e=>e.instanceId===instanceId),trackId=bindings.get(instanceId);
    const count=prompts.filter(p=>p.trackId===trackId||cardLabels.some(e=>e.box&&Math.abs(p.atMs-e.atMs)<windows[e.kind]&&boxIou(p.box,e.box)>.2)).length;
    return {instanceId,count};
  });
  const falsePredictions=run.events.filter((_,i)=>!used.has(i));
  const unsafeSure=falsePredictions.filter(p=>p.tier==='sure').length;
  const falseEventsFromHands=falsePredictions.filter(p=>session.negatives.some(n=>n.kind==='hands'&&p.atMs>=n.startMs&&p.atMs<=n.endMs)).length;
  const latencies=Object.fromEntries((Object.keys(windows) as EventKind[]).map(kind=>[kind,distribution(perEvent.filter(e=>e.kind===kind&&(kind==='placed'?e.identifiedLatencyMs!==null:e.latencyMs!==null)).map(e=>kind==='placed'?e.identifiedLatencyMs!:e.latencyMs!))]));
  let detectionHits=0,detectionExpected=0,detectionPredicted=0,checkpointsObserved=0;
  for(const frame of session.detectorFrames??[]){
    const sample=run.detections.filter(s=>Math.abs(s.atMs-frame.atMs)<=750).sort((a,b)=>Math.abs(a.atMs-frame.atMs)-Math.abs(b.atMs-frame.atMs))[0];
    detectionExpected+=frame.cards.length;detectionPredicted+=sample?.cards.length??0;if(sample)checkpointsObserved++;
    // Greedy highest-IoU, one prediction per ground-truth card; class agnostic.
    const pairs=frame.cards.flatMap((truth,i)=>(sample?.cards??[]).map((c,j)=>({i,j,iou:boxIou(truth.box,c.box)}))).filter(p=>p.iou>=.5).sort((a,b)=>b.iou-a.iou);
    const truths=new Set<number>(),predictions=new Set<number>();
    for(const p of pairs)if(!truths.has(p.i)&&!predictions.has(p.j)){truths.add(p.i);predictions.add(p.j);detectionHits++;}
  }
  const detector={recall:ratio(detectionHits,detectionExpected),precision:ratio(detectionHits,detectionPredicted),hits:detectionHits,expected:detectionExpected,predicted:detectionPredicted,checkpoints:session.detectorFrames?.length??0,checkpointsObserved,definition:'Human-reviewed complete-frame checkpoints; nearest detector sample within 750 ms, IoU≥.5, one-to-one. Missing samples count as misses. Mark checkpoints during steady holds.'};
  const events={recall:ratio(matched,labels.length),precision:ratio(matched,run.events.length),matched,expected:labels.length,predicted:run.events.length,automaticRecall:ratio(perEvent.filter(e=>e.automatic).length,labels.length)};
  const identity={top1:ratio(eligible.filter(e=>e.top1).length,eligible.length),top5:ratio(eligible.filter(e=>e.top5).length,eligible.length),denominator:eligible.length};
  const zoneAccuracy=ratio(perEvent.filter(e=>e.zoneCorrect).length,labels.length),wrongSure=perEvent.filter(e=>e.wrongSure).length;
  const reasons:string[]=[];
  if(run.events.some(p=>!Number.isFinite(p.atMs)||!validBox(p.box))||![run.wallMs,run.warmMs,run.inferenceMs].every(n=>Number.isFinite(n)&&n>=0))reasons.push('Nonfinite/invalid replay evidence');
  if(run.backends.length!==1||!run.backends.includes(run.requestedBackend)||!run.runtime.length)reasons.push('Missing actual requested backend/runtime evidence');
  if(labels.some(e=>!e.faceDown&&!e.cardId))reasons.push('Face-up events require a verified catalog identity');
  if(session.source!=='real'||!session.reviewed||labels.some(e=>!e.reviewed))reasons.push('Requires real, exhaustively reviewed labels');
  if(run.wallMs<session.durationMs*.9)reasons.push('Replay did not cover the declared video duration');
  if(detector.checkpoints<10||session.detectorFrames?.some(f=>!f.reviewed)||!detector.expected||detector.checkpointsObserved!==detector.checkpoints)reasons.push('Requires at least 10 reviewed complete detector checkpoints and samples');
  if(detector.recall<=.9||detector.precision<=.9)reasons.push('Detector checkpoint recall and precision must exceed 90%');
  if(labels.length<50)reasons.push('Requires at least 50 events');
  if(labels.some(e=>!e.box&&e.kind!=='removed'))reasons.push('Requires spatial boxes on visible events');
  if(!session.decklist.length)reasons.push('Requires a declared decklist for paired comparison');
  const coverage=['placed','moved','removed','flipped','defense'].every(kind=>labels.some(e=>e.kind===kind))&&labels.some(e=>e.zone==='FIELD')&&labels.some(e=>e.fromZone==='EXTRA'&&e.zone.startsWith('EMZ'))&&['GY','DECK','HAND'].every(zone=>labels.some(e=>e.kind==='removed'&&e.zone===zone));
  if(!coverage||!session.negatives.some(n=>n.kind==='hands'&&n.endMs-n.startMs>=5000))reasons.push('Missing lifecycle/field/Extra→EMZ/destination/hand-negative coverage');
  if(events.recall<=.9||events.precision<=.9||identity.top1<=.9||zoneAccuracy<=.9||events.automaticRecall<=.9)reasons.push('Recall, precision, automatic recall, top-1 and zones must each exceed 90%');
  if(wrongSure||unsafeSure||falseEventsFromHands||promptsPerCard.some(p=>p.count>1))reasons.push('Wrong sure, hand false events or repeated physical-card prompts');
  for(const [kind,limit] of [['placed',2000],['moved',1000],['removed',4500]] as const)if(latencies[kind].p95Ms===null||!Number.isFinite(latencies[kind].p95Ms)||latencies[kind].p95Ms!>limit)reasons.push(`${kind} p95 must be ≤${limit} ms`);
  if(run.errors.length)reasons.push('Replay contains runtime errors');
  return {events,identity,zoneAccuracy,wrongSure,unsafeSure,latencies,promptsPerCard,unassignedPrompts:prompts.filter(p=>!promptsPerCard.some(c=>bindings.get(c.instanceId)===p.trackId)).length,falseEventsFromHands,falseEvents:falsePredictions,
    detector,
    destinationAccuracy:ratio(perEvent.filter(e=>e.destinationCorrect).length,labels.filter(e=>e.kind==='removed').length),perEvent,gate:{passed:reasons.length===0,reasons}};
}
export function markdownReport(report:{runs:{sessionId:string;deckMode:string;result:ReplayResult;metrics:ReturnType<typeof scoreSession>;cpuSecondsPerVideoSecond:number}[];[key:string]:unknown}) {
  const rows=report.runs.map(r=>`| ${r.sessionId} | ${r.result.variant} | ${r.deckMode} | ${r.result.backends.join(',')||'unknown'} | ${(r.metrics.events.recall*100).toFixed(1)}% | ${(r.metrics.events.precision*100).toFixed(1)}% | ${(r.metrics.identity.top1*100).toFixed(1)} / ${(r.metrics.identity.top5*100).toFixed(1)}% | ${(r.metrics.zoneAccuracy*100).toFixed(1)}% | ${r.cpuSecondsPerVideoSecond.toFixed(3)} | ${r.metrics.gate.passed?'PASS':'FAIL'} |`);
  return `# Vision session benchmark\n\nAccuracy is measured on these labelled files only. Missing observations stay in denominators. CPU is aggregate Chromium process CPU seconds per second of video (includes decoding; excludes warm-up). Cold start is separate.\n\n| Session | Variant | Deck | Actual backend | Event recall | Event precision | ID top1 / top5 | Zone | CPU s/s | Gate |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n`+report.runs.map(r=>`## ${r.sessionId}: ${r.result.variant}, ${r.deckMode}, ${r.result.requestedBackend}\n\nGate: ${r.metrics.gate.reasons.join('; ')||'PASS'}.\n\nPlacement / move / removal p95: ${['placed','moved','removed'].map(k=>r.metrics.latencies[k].p95Ms??'unmeasured').join(' / ')} ms. Warm start ${r.result.warmMs.toFixed(0)} ms. Detector checkpoint recall / precision ${(r.metrics.detector.recall*100).toFixed(1)} / ${(r.metrics.detector.precision*100).toFixed(1)}% (${r.metrics.detector.checkpointsObserved}/${r.metrics.detector.checkpoints} checkpoints). Hand false events ${r.metrics.falseEventsFromHands}; wrong sure ${r.metrics.wrongSure}. Prompts per card: ${JSON.stringify(r.metrics.promptsPerCard)}. Removal destination accuracy ${(r.metrics.destinationAccuracy*100).toFixed(1)}% (off-camera destinations require human/voice intent).\n`).join('\n');
}
