import {boxIou,distribution,type LabelledSession,type ReplayResult,type PredictedEvent,type EventKind} from './session';
const windows:Record<EventKind,number>={placed:5000,moved:3000,removed:7000,flipped:3000,defense:3000};
const ratio=(a:number,b:number)=>b?a/b:0;
export function scoreSession(session:LabelledSession,run:ReplayResult) {
  const used=new Set<number>(),bindings=new Map<string,string>();
  const labels=[...session.events].sort((a,b)=>a.atMs-b.atMs);
  const perEvent=labels.map(label=>{
    const choices=run.events.map((p,i)=>({p,i})).filter(({p,i})=>{
      const kind=p.kind==='prompt'?'placed':p.kind;
      if(used.has(i)||kind!==label.kind||p.atMs<label.atMs-100||p.atMs>label.atMs+windows[label.kind])return false;
      const bound=bindings.get(label.instanceId);
      // Spatial evidence is independent of zone and identity; neither can hide errors.
      return label.box?boxIou(label.box,p.box)>=.2:bound?bound===p.trackId:true;
    }).sort((a,b)=>a.p.atMs-b.p.atMs);
    const found=choices[0];if(found){used.add(found.i);bindings.set(label.instanceId,found.p.trackId);}
    const prediction=found?.p;
    const identified=!!prediction&&prediction.kind!=='prompt'&&prediction.cardId===label.cardId;
    const identityEligible=!!label.cardId&&!label.faceDown;
    return {labelId:label.id,instanceId:label.instanceId,kind:label.kind,atMs:label.atMs,matched:!!prediction,predictionIndex:found?.i??null,
      latencyMs:prediction?Math.max(0,prediction.atMs-label.atMs):null,identityEligible,
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
  const falseEventsFromHands=falsePredictions.filter(p=>session.negatives.some(n=>n.kind==='hands'&&p.atMs>=n.startMs&&p.atMs<=n.endMs)).length;
  const latencies=Object.fromEntries((Object.keys(windows) as EventKind[]).map(kind=>[kind,distribution(perEvent.filter(e=>e.kind===kind&&e.latencyMs!==null).map(e=>e.latencyMs!))]));
  const spatialLabels=labels.filter(e=>e.box&&e.kind!=='removed');
  const detectionHits=spatialLabels.filter(e=>run.detections.some(s=>s.atMs>=e.atMs&&s.atMs<=e.atMs+1500&&s.cards.some(c=>boxIou(e.box!,c.box)>=.5))).length;
  const events={recall:ratio(matched,labels.length),precision:ratio(matched,run.events.length),matched,expected:labels.length,predicted:run.events.length,automaticRecall:ratio(perEvent.filter(e=>e.automatic).length,labels.filter(e=>e.cardId).length)};
  const identity={top1:ratio(eligible.filter(e=>e.top1).length,eligible.length),top5:ratio(eligible.filter(e=>e.top5).length,eligible.length),denominator:eligible.length};
  const zoneAccuracy=ratio(perEvent.filter(e=>e.zoneCorrect).length,labels.length),wrongSure=perEvent.filter(e=>e.wrongSure).length;
  const reasons:string[]=[];
  if(session.source!=='real'||!session.reviewed||labels.some(e=>!e.reviewed))reasons.push('Requires real, exhaustively reviewed labels');
  if(labels.length<50)reasons.push('Requires at least 50 events');
  if(labels.some(e=>!e.box&&e.kind!=='removed'))reasons.push('Requires spatial boxes on visible events');
  if(!session.decklist.length)reasons.push('Requires a declared decklist for paired comparison');
  const coverage=['placed','moved','removed','flipped','defense'].every(kind=>labels.some(e=>e.kind===kind))&&labels.some(e=>e.zone==='FIELD')&&labels.some(e=>e.fromZone==='EXTRA'&&e.zone.startsWith('EMZ'))&&['GY','DECK','HAND'].every(zone=>labels.some(e=>e.kind==='removed'&&e.zone===zone));
  if(!coverage||!session.negatives.some(n=>n.kind==='hands'&&n.endMs-n.startMs>=5000))reasons.push('Missing lifecycle/field/Extra→EMZ/destination/hand-negative coverage');
  if(events.recall<=.9||events.precision<=.9||identity.top1<=.9||zoneAccuracy<=.9||events.automaticRecall<=.9)reasons.push('Recall, precision, automatic recall, top-1 and zones must each exceed 90%');
  if(wrongSure||falseEventsFromHands||promptsPerCard.some(p=>p.count>1))reasons.push('Wrong sure, hand false events or repeated physical-card prompts');
  for(const [kind,limit] of [['placed',2000],['moved',1000],['removed',4500]] as const)if(latencies[kind].p95Ms===null||latencies[kind].p95Ms!>limit)reasons.push(`${kind} p95 must be ≤${limit} ms`);
  if(run.errors.length)reasons.push('Replay contains runtime errors');
  return {events,identity,zoneAccuracy,wrongSure,latencies,promptsPerCard,unassignedPrompts:prompts.filter(p=>!promptsPerCard.some(c=>bindings.get(c.instanceId)===p.trackId)).length,falseEventsFromHands,falseEvents:falsePredictions,
    detector:{recall:ratio(detectionHits,spatialLabels.length),hits:detectionHits,expected:spatialLabels.length,definition:'Visible-event boxes IoU≥.5 within 1.5 s; not all-frame detector AP'},
    destinationAccuracy:ratio(perEvent.filter(e=>e.destinationCorrect).length,labels.filter(e=>e.kind==='removed').length),perEvent,gate:{passed:reasons.length===0,reasons}};
}
export function markdownReport(report:{runs:{sessionId:string;deckMode:string;result:ReplayResult;metrics:ReturnType<typeof scoreSession>;cpuSecondsPerVideoSecond:number}[];[key:string]:unknown}) {
  const rows=report.runs.map(r=>`| ${r.sessionId} | ${r.result.variant} | ${r.deckMode} | ${r.result.backends.join(',')||'unknown'} | ${(r.metrics.events.recall*100).toFixed(1)}% | ${(r.metrics.events.precision*100).toFixed(1)}% | ${(r.metrics.identity.top1*100).toFixed(1)} / ${(r.metrics.identity.top5*100).toFixed(1)}% | ${(r.metrics.zoneAccuracy*100).toFixed(1)}% | ${r.cpuSecondsPerVideoSecond.toFixed(3)} | ${r.metrics.gate.passed?'PASS':'FAIL'} |`);
  return `# Vision session benchmark\n\nAccuracy is measured on these labelled files only. Missing observations stay in denominators. CPU is aggregate Chromium process CPU seconds per second of video (includes decoding; excludes warm-up). Cold start is separate.\n\n| Session | Variant | Deck | Actual backend | Event recall | Event precision | ID top1 / top5 | Zone | CPU s/s | Gate |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n`+report.runs.map(r=>`## ${r.sessionId}: ${r.result.variant}, ${r.deckMode}, ${r.result.requestedBackend}\n\nGate: ${r.metrics.gate.reasons.join('; ')||'PASS'}.\n\nPlacement / move / removal p95: ${['placed','moved','removed'].map(k=>r.metrics.latencies[k].p95Ms??'unmeasured').join(' / ')} ms. Warm start ${r.result.warmMs.toFixed(0)} ms. Detector visible-event recall ${(r.metrics.detector.recall*100).toFixed(1)}%. Hand false events ${r.metrics.falseEventsFromHands}; wrong sure ${r.metrics.wrongSure}. Prompts per card: ${JSON.stringify(r.metrics.promptsPerCard)}. Removal destination accuracy ${(r.metrics.destinationAccuracy*100).toFixed(1)}% (off-camera destinations require human/voice intent).\n`).join('\n');
}
