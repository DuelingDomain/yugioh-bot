import test from 'node:test';
import assert from 'node:assert/strict';
import {RecognitionPipeline} from './pipeline';
import {fieldGlareChoices} from './field-glare';
import {glareMask,precleanCrop} from './preclean';
import {yugioh} from './games/yugioh';
import type {LoadedIndex,DetectedQuad} from './types';
import type {ModelSession} from './runtime';
import type {TensorCtor} from './embed';
const selected:DetectedQuad={quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'face-up',confidence:1,partial:false};
const frame={width:20,height:30,data:new Uint8ClampedArray(2400).fill(120)};
function fixture(full=true,counter?:{calls:number},scores=[.9,.95]) {
  const profile={...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  const index=(ids:string[])=>({meta:{dim:2,count:2,entries:ids.map(cardId=>({cardId,name:cardId,passcode:1,frameClass:'Effect'}))},vectors:new Float32Array([1,0,0,1])}) as LoadedIndex;
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:unknown){}}
  let step=0;
  const detector={backend:'wasm',run:()=>{throw new Error('selected quad must skip detection');}} as unknown as ModelSession;
  const embedder={backend:'wasm',run:async()=>{if(counter)counter.calls++;const score=scores[Math.min(step++,scores.length-1)];return {[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([score,Math.sqrt(1-score*score)])}};}} as unknown as ModelSession;
  return new RecognitionPipeline(profile,index(['A','B']),detector,embedder,Tensor as unknown as TensorCtor,full?index(['C','D']):undefined);
}
test('clear full-catalog answer survives decklist preference across indexes',async()=>{
  const results=[
    await fixture(true,undefined,[.78,.95]).recognize([frame],{card:selected,k:5,priors:{decklist:['A'],voiceMentioned:['A']}}),
    await fixture(true,undefined,[.9,.7,.95,.95]).recognize([frame],{card:selected,includeRaw:true,preferUpright:true,priors:{decklist:['A']}}),
  ];
  for(const result of results) {
    assert.equal(result.candidates[0].cardId,'C');
    assert.ok(result.candidates.some(c=>c.cardId==='A'));
    assert.equal(result.tier,'sure');
    assert.equal(result.quality.framesUsed,1);
  }
});
test('selected quad skips detector and returns its warp even without full-art references',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected,includeCrop:true});
  assert.equal(result.candidates[0].cardId,'A');
  assert.equal(result.quality.fullArtReferences,0);
  assert.equal(result.warpedCard?.width,10);
  assert.equal(result.warpedCard?.height,15);
  assert.equal(result.quality.fallback,false);
  assert.deepEqual(result.detectedCard,selected);
  const diagnostic=await fixture(false).recognize([frame],{card:selected,includeDiagnosticCrop:true});
  assert.equal(diagnostic.warpedCard?.width,10);assert.equal(diagnostic.warpedCard?.height,15);
  assert.deepEqual(diagnostic.candidates,result.candidates);assert.deepEqual(diagnostic.quality,result.quality);
  for(const key of ['feedback','aiWarpedCard','deferredAICrop','aiCandidateNames'])assert.equal(diagnostic[key as keyof typeof diagnostic],undefined);
});

test('a glare blob is masked for embedding and counted in read diagnostics',async()=>{
  const image={width:20,height:30,data:frame.data.slice()};
  for(let y=5;y<15;y++)for(let x=5;x<15;x++)image.data.set([249,247,246,255],(y*20+x)*4);
  image.data.set([255,255,255,255],(20*20+5)*4);
  const measured=glareMask(image);
  assert.equal(measured.blobs,1);
  assert.equal(measured.share,100/600);
  const {image:clean}=precleanCrop(image);
  assert.deepEqual(clean.data.slice((9*20+9)*4,(9*20+9)*4+3),new Uint8ClampedArray([120,120,120]));
  assert.deepEqual(clean.data.slice(0,4),image.data.slice(0,4));
  const result=await fixture(false).recognize([image],{card:selected});
  assert.equal(result.timingsMs.precleanGlareBlobs,1);
  assert.ok(result.timingsMs.precleanGlare!>2);
  // Some cameras clip to a lower white level. A broad patch counts, a bright spec does not.
  for(let y=5;y<15;y++)for(let x=5;x<15;x++)image.data.set([236,234,232,255],(y*20+x)*4);
  assert.equal(glareMask(image).share,100/600);
});
test('upright preference skips a clear reverse view with replay evidence and preserves uncertain reverse rescue',async()=>{
  const baseline={calls:0},fast={calls:0},rescue={calls:0};
  const plain=await fixture(false,baseline).recognize([frame],{card:selected,includeRaw:true});
  const result=await fixture(false,fast).recognize([frame],{card:selected,includeRaw:true,includeFeedback:true,preferUpright:true});
  assert.equal(baseline.calls,2);assert.equal(fast.calls,1);assert.equal(result.candidates[0].cardId,plain.candidates[0].cardId);
  assert.equal(result.tier,'sure');assert.equal(result.raw?.winnerId,result.candidates[0].cardId);assert.equal(result.raw?.frames[0].hypotheses?.length,1);
  assert.ok(Math.abs(result.feedback!.embedding[0]-.9)<1e-6);
  const reversed=await fixture(false,rescue,[.76,.95]).recognize([frame],{card:selected,includeRaw:true,preferUpright:true});
  assert.equal(rescue.calls,2);assert.equal(reversed.candidates[0].cardId,'A');assert.equal(reversed.tier,'sure');
});
test('live reads use only the sharpest buffered frame and return that frame outline',async()=>{
  const noisy={...frame,data:frame.data.slice()};
  for(let i=0;i<noisy.data.length;i+=4){noisy.data[i]=noisy.data[i+1]=noisy.data[i+2]=Math.floor(i/4)%2?255:0;noisy.data[i+3]=255;}
  const result=await fixture(false).recognize([noisy],{card:selected,maxFrames:1});
  assert.equal(result.quality.framesUsed,1);
  assert.deepEqual(result.quality.selectedFrameIndices,[0]);
  assert.deepEqual(result.detectedCard,selected);
  await assert.rejects(()=>fixture(false).recognize([frame],{maxFrames:2 as 1}),/maxFrames/);
});
test('clipped selected quad preserves whole-card shape and cannot be sure',async()=>{
  const result=await fixture(false).recognize([frame],{card:{...selected,quad:selected.quad.map(p=>({x:p.x-.2,y:p.y})),partial:true},includeCrop:true});
  assert.equal(result.quality.partial,true);
  assert.notEqual(result.tier,'sure');
  assert.equal(result.warpedCard?.width,10);
});
test('feedback evidence is opt-in, bound to a detected warp and carries its vector and versions',async()=>{
  const plain=await fixture(false).recognize([frame],{card:selected});
  assert.equal(plain.feedback,undefined);
  const result=await fixture(false).recognize([frame],{card:selected,includeFeedback:true});
  assert.ok(result.feedback);assert.equal(result.feedback.embedding.length,2);
  assert.equal(result.feedback.space,'art-box');assert.ok(result.warpedCard);
  const clipped=await fixture(false).recognize([frame],{card:{...selected,quad:selected.quad.map(p=>({x:p.x-.2,y:p.y})),partial:true},includeFeedback:true});
  assert.equal(clipped.feedback,undefined);
});
test('identity embedding is opt-in and reuses the clean art vector without feedback or crop capture',async()=>{
  const plainCount={calls:0},identityCount={calls:0};
  const plain=await fixture(false,plainCount).recognize([frame],{card:selected});
  const result=await fixture(false,identityCount).recognize([frame],{card:selected,includeIdentityEmbedding:true});
  const feedback=await fixture(false).recognize([frame],{card:selected,includeFeedback:true});
  assert.equal('identityEmbedding' in plain,false);
  assert.deepEqual(result.identityEmbedding,{values:feedback.feedback!.embedding,space:'art-box'});
  assert.ok(result.identityEmbedding!.values.every(Number.isFinite));assert.equal(identityCount.calls,plainCount.calls);
  assert.deepEqual(result.candidates,plain.candidates);assert.deepEqual(result.quality,plain.quality);
  for(const key of ['feedback','warpedCard','aiWarpedCard','deferredAICrop','cropJpeg','aiCropJpeg','aiCropToken'] as const) assert.equal(result[key as keyof typeof result],undefined);
  // No deck list: cards already confirmed in this duel form the first closed set, and the set never forces a card the catalog beats.
  const dynamic=await fixture(false,undefined,[.95]).recognize([frame],{card:selected,preclean:false,priors:{decklist:[],seen:['A']}});
  assert.equal(dynamic.quality.searchSource,'dynamic');assert.equal(dynamic.tier,'sure');
  assert.equal((await fixture(false,undefined,[.95]).recognize([frame],{card:selected,preclean:false,priors:{decklist:[],seen:['B']}})).quality.searchSource,'catalog');
  // A card the table's banlist forbids never enters the related-cards set.
  const related=[{cardId:'A',reason:'x'}];
  assert.equal((await fixture(false,undefined,[.95]).recognize([frame],{card:selected,preclean:false,priors:{decklist:[],seen:[],related}})).quality.searchSource,'likely');
  assert.equal((await fixture(false,undefined,[.95]).recognize([frame],{card:selected,preclean:false,priors:{decklist:[],seen:[],related,forbidden:['A']}})).quality.searchSource,'catalog');
  const disabled=await fixture(false).recognize([frame],{card:selected,includeIdentityEmbedding:false});
  assert.equal('identityEmbedding' in disabled,false);assert.equal('identityEmbedding' in feedback,false);
});
test('identity embedding copies the winning whole-card feedback hypothesis with its matching space',async()=>{
  const baseline={calls:0},requested={calls:0};
  await fixture(true,baseline).recognize([frame],{card:selected,includeFeedback:true});
  const result=await fixture(true,requested).recognize([frame],{card:selected,includeFeedback:true,includeIdentityEmbedding:true});
  assert.equal(result.candidates[0].cardId,'C');assert.equal(result.identityEmbedding?.space,'whole-card');
  assert.deepEqual(result.identityEmbedding?.values,result.feedback!.embedding);assert.equal(requested.calls,baseline.calls);
  assert.notEqual(result.identityEmbedding!.values,result.feedback!.embedding);
  const cleanValue=result.feedback!.embedding[0];result.identityEmbedding!.values[0]=-123;
  assert.equal(result.feedback!.embedding[0],cleanValue);
});
test('identity embeddings exclude covered, clipped, explicitly partial, face-down and fallback evidence',async()=>{
  for(const card of [
    {...selected,covered:true}, {...selected,quad:selected.quad.map(p=>({x:p.x-.2,y:p.y})),partial:true},
    {...selected,partial:true}, {...selected,kind:'face-down' as const},
  ]) {
    const result=await fixture(false).recognize([frame],{card,includeIdentityEmbedding:true});
    assert.equal('identityEmbedding' in result,false);
  }
  const f=clickFixture(()=>[]),result=await f.pipeline.recognize([f.image],{clickPoint:{x:.5,y:.5},includeIdentityEmbedding:true});
  assert.equal(result.quality.fallback,true);assert.equal('identityEmbedding' in result,false);
});
test('learned references compete with the main index without manufacturing sure',async()=>{
  const p=fixture(false);
  p.setLearning({version:'v',references:[{cardId:'B',embedding:[.9,Math.sqrt(1-.9*.9)],space:'art-box'}],confusions:[]});
  const result=await p.recognize([frame],{card:selected});
  assert.equal(result.candidates[0].cardId,'B');assert.notEqual(result.tier,'sure');
  p.setLearning({version:'empty',references:[],confusions:[]});
  assert.equal((await p.recognize([frame],{card:selected})).candidates[0].cardId,'A');
});
test('confusion pairs trigger another hypothesis and suppress a narrow sure winner',async()=>{
  const p=fixture(false);
  p.setLearning({version:'v',references:[],confusions:[{a:'A',b:'B'}]});
  const result=await p.recognize([frame],{card:selected});
  assert.ok(result.quality.confusionChecked);
});
test('whole-card learning cannot introduce labels absent from its clean index',async()=>{
  const p=fixture(true);p.setLearning({version:'v',references:[{cardId:'B',embedding:[.95,Math.sqrt(1-.95*.95)],space:'whole-card'}],confusions:[]});
  assert.equal((await p.recognize([frame],{card:selected})).candidates[0].cardId,'C');
});
test('a late whole-card confusion winner is checked in both whole-card rotations',async()=>{
  const counter={calls:0};const p=fixture(true,counter);p.setLearning({version:'v',references:[],confusions:[{a:'C',b:'D'}]});
  const result=await p.recognize([frame],{card:selected,preclean:false});assert.equal(result.candidates[0].cardId,'C');assert.equal(result.quality.confusionChecked,true);
  // One art view and both whole-card rotations ran. The final .05 lead
  // over the main-index competitor stays below the stricter .06 margin.
  assert.equal(counter.calls,3);assert.equal(result.tier,'not sure');
});

// Review regressions share this single small, API-free test file.
import {topK,preferDeck} from './search';
import {learnedTopK} from './learning';
const searchIndex=(ids:string[],vectors:number[])=>({meta:{dim:2,count:ids.length,entries:ids.map(cardId=>({cardId,passcode:Number(cardId)||1,name:cardId,frameClass:'Effect'}))},vectors:new Float32Array(vectors)}) as LoadedIndex;
test('deck restriction searches only its artwork rows before catalog fallback',async()=>{
  const index=searchIndex(['1','2'],[1,0,.8,.6]);
  assert.deepEqual(topK(new Float32Array([1,0]),index,5,undefined,undefined,new Set(['2'])).map(c=>c.cardId),['2']);
  const fast=await fixture(false,undefined,[.95]).recognize([frame],{card:selected,preclean:false,includeRaw:true,priors:{decklist:['A']}});
  assert.equal(fast.quality.searchSource,'deck');
  assert.equal(fast.tier,'sure');assert.equal(fast.candidates[0].cardId,'A');
  assert.equal(fast.raw?.visual[0].score,fast.candidates[0].score);
  for(const decklist of [[],['missing'],['B']]) {
    const miss=await fixture(false).recognize([frame],{card:selected,preclean:false,priors:{decklist}});
    assert.equal(miss.quality.searchSource,'catalog');assert.equal(miss.candidates[0].cardId,'A');
  }
  const weak=await fixture(false,undefined,[.7]).recognize([frame],{card:selected,preclean:false,priors:{decklist:['A']}});
  assert.equal(weak.quality.searchSource,'catalog');
  const disabled=await fixture(false).recognize([frame],{card:selected,preclean:false,deckFirst:false,priors:{decklist:['A']}});
  assert.equal(disabled.quality.searchSource,'catalog');
  const alts=searchIndex(['A','B','A'],[0,1,.8,.6,1,0]);
  assert.equal(topK(new Float32Array([1,0]),alts,5,undefined,undefined,new Set(['A']))[0].score,1);
  const {rankWithPriors}=await import('./search');
  const limits={score:.8,margin:.05,floor:.74};
  const close=[{cardId:'A',score:.82},{cardId:'B',score:.81}];
  const priors={related:[{cardId:'B',reason:'mentioned by Treasures of the Kings'}]};
  const boosted=rankWithPriors(close,close,priors,limits);
  assert.equal(boosted[0].cardId,'B');assert.equal(boosted[0].score,.81);
  assert.equal(boosted[0].prior,'mentioned by Treasures of the Kings');
  const raw:any={visual:close,winnerId:'B',cardBackId:'back',blocked:[],frames:[{eligible:true,clean:close,ranked:boosted}],priors};
  assert.equal(replayTier(raw,limits),'not sure');
  const profile={...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2,thresholds:limits}};
  class PriorTensor {constructor(public type:unknown,public data:unknown,public dims:unknown){}}
  const model={backend:'wasm',run:async()=>({[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([1,0])}})} as unknown as ModelSession;
  const pipeline=new RecognitionPipeline(profile,searchIndex(['A','B'],[.82,Math.sqrt(1-.82**2),.81,Math.sqrt(1-.81**2)]),model,model,PriorTensor as unknown as TensorCtor);
  const contextual=await pipeline.recognize([frame],{card:selected,priors,preclean:false,includeRaw:true});
  assert.equal(contextual.candidates[0].cardId,'B');assert.equal(contextual.tier,'not sure');
  assert.equal(contextual.prior,'mentioned by Treasures of the Kings');assert.equal(contextual.raw?.visual[0].cardId,'A');
  assert.equal(rankWithPriors(close,close,{voiceMentioned:['B'],voiceExpiresAt:0},limits)[0].cardId,'A');
  for(const scores of [[.9,.7],[.72,.71],[.83,.75]]) {
    const list=close.map((c,i)=>({...c,score:scores[i]}));
    assert.equal(rankWithPriors(list,list,priors,limits)[0].cardId,'A');
  }
  const {VoicePrior,relatedPriors}=await import('./context-prior');
  const voice=new VoicePrior();voice.mention('room:0',2,1000);
  assert.deepEqual(voice.current('room:0',10999),[2]);assert.deepEqual(voice.current('room:1',1001),[]);
  assert.equal(voice.expiresAt('room:0'),11000);
  assert.deepEqual(voice.current('room:0',11000),[]);
  const delayed=new VoicePrior();delayed.mention('room:0',2,5000,5000);
  delayed.mention('room:0',1,1000,6000);assert.deepEqual(delayed.current('room:0',6000),[2]);
  delayed.mention('expired',3,1000,11001);assert.equal(delayed.expiresAt('expired'),undefined);
  const {buildRelatedCards}=await import('../../../scripts/vision/build-related');
  const relations=buildRelatedCards([
    {id:1,name:'Treasures of the Kings',text:'Add 1 "Apophis" card, or "Temple of the Kings".',setcodes:[],script:'s.listed_series={SET_APOPHIS}\ns.listed_names={3}\nCard.IsCode(c,3)'},
    {id:2,name:'Apophis the Swamp Deity',text:'',setcodes:[0x1c2],script:''},
    {id:3,name:'Temple of the Kings',text:'',setcodes:[],script:''},
    {id:4,name:'Kashtira Fenrir',text:'',setcodes:[0x18a],script:''},
    {id:5,name:'Kashtira Unicorn',text:'',setcodes:[0x18a],script:''},
    {id:6,name:'Script source',text:'',setcodes:[],script:'s.listed_names={CARD_TARGET}\naux.FilterBoolFunction(Card.IsCode,2)\nc:IsSetCard(SET_APOPHIS,fc,SUMMON_TYPE_SPECIAL+1,tp)'},
    {id:7,name:'Unrelated card',text:'',setcodes:[1],script:''},
  ],new Map([[0x1c2,'Apophis'],[0x18a,'Kashtira'],[1,'Ally of Justice']]),'SET_APOPHIS = 0x1c2\nCARD_TARGET = 5');
  const related=relatedPriors(relations,[1]);
  assert.equal(related.find(c=>c.cardId==='3')?.reason,'mentioned by Treasures of the Kings');
  assert.ok(related.some(c=>c.cardId==='2'));assert.ok(!related.some(c=>c.cardId==='5'));
  assert.ok(relatedPriors(relations,[4]).some(c=>c.cardId==='5'&&c.reason.includes('Kashtira')));
  assert.ok(relatedPriors(relations,[6]).some(c=>c.cardId==='5'&&c.reason==='script link from Script source'));
  assert.ok(relatedPriors(relations,[6]).some(c=>c.cardId==='2'));
  assert.ok(!relatedPriors(relations,[6]).some(c=>c.cardId==='7'));
  const {recognitionPriorsFor}=await import('../../web/src/lib/remote/recognition-priors');
  const room:any={slug:'test',seats:[{seat:0,deck:{deck:{main:[1],extra:[2],side:[3]}}}],state:{match:{game:1},seats:[
    {seat:0,twin:[{ref:'a',cardId:1,zone:'field',faceUp:true},{ref:'hidden',cardId:2,zone:'hand',faceUp:true}]},
    {seat:1,twin:[{ref:'b',cardId:4,zone:'graveyard',faceUp:true}]},
  ]},events:[{actorSeat:0,action:{type:'card.identified',seat:0,cardId:3}}]};
  assert.deepEqual(recognitionPriorsFor(room,0).decklist,[1,2,3]);
  assert.deepEqual(recognitionPriorsFor(room,0).context,[1,3,4]);
  assert.ok(recognitionPriorsFor(room,0).seen.includes(4));
  assert.ok(!recognitionPriorsFor(room,0).seen.includes(2));
  assert.deepEqual(recognitionPriorsFor(room,1).context,[4,1]);
  room.events.push({action:{type:'match.first'},seq:2});
  assert.deepEqual(recognitionPriorsFor(room,0).context,[1,4]);
  // A draw or siding timeout can start game 2 without a match.first action.
  room.state.match.games=[{endedAt:200}];
  room.events=[{at:100,actorSeat:0,action:{type:'card.identified',seat:0,cardId:3}},
    {at:210,actorSeat:0,action:{type:'side.ready',seat:0}},
    {at:220,actorSeat:0,action:{type:'card.identified',seat:0,cardId:6}}];
  assert.deepEqual(recognitionPriorsFor(room,0).context,[1,6,4]);
  assert.ok(!recognitionPriorsFor(room,0).seen.includes(3));
  room.state.seats[0].twin.push({ref:'scale',cardId:8,zone:'pendulum',faceUp:true},{ref:'private-set',cardId:9,zone:'monster',faceUp:false});
  room.events.push({at:230,actorSeat:0,action:{type:'card.identified',seat:0,cardRef:'private-set',cardId:9,zone:'monster'}});
  assert.ok(recognitionPriorsFor(room,0).context?.includes(8));assert.ok(!recognitionPriorsFor(room,0).context?.includes(9));
});
test('poisoned learned label cannot introduce a card outside the clean top ten',()=>{
  const ids=Array.from({length:11},(_,i)=>String(i+1));
  const index=searchIndex(ids,ids.flatMap((_,i)=>[Math.cos(i*.1),Math.sin(i*.1)]));
  const list=learnedTopK(new Float32Array([1,0]),index,{version:'poison',references:[{cardId:'11',embedding:[1,0],space:'art-box'}],confusions:[]},'art-box',5);
  assert.equal(list[0].cardId,'1');assert.ok(!list.some(c=>c.cardId==='11'));
});
test('face-down art sleeve cannot become sure as a face-up identity or feedback',async()=>{
  const result=await fixture(false).recognize([frame],{card:{...selected,kind:'face-down'},includeFeedback:true});
  assert.notEqual(result.tier,'sure');assert.equal(result.feedback,undefined);
});

import {filterPhysicalIndex} from './physical-index';
test('physical filter removes skills/nonphysical rows, preserves tokens and collapses duplicate art',()=>{
  const index=searchIndex(['1','300302001','999','8','9'],[1,0,1,0,1,0,1,0,1,0]);
  index.meta.entries[1]={cardId:'300302001',passcode:0,name:'A Skill'};
  index.meta.entries[2]={cardId:'999',passcode:0,name:'Token'};
  index.meta.entries[3]={cardId:'8',passcode:8,name:'Duplicate',imageId:1,frameClass:'Effect'};
  index.meta.entries[4]={...index.meta.entries[3],cardId:'9'};
  index.meta.entries[0].name='Skill Drain';
  assert.deepEqual(filterPhysicalIndex(index).meta.entries.map(e=>e.cardId),['1','999','8']);
});

import {replayTier} from './decision';
import type {RecognitionEvidence} from './types';
test('every evaluated frame must independently agree before sure',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected,includeRaw:true});
  const raw=result.raw!;assert.equal(replayTier(raw,raw.thresholds),'sure');
  raw.frames.push({...raw.frames[0],frameIndex:1,clean:[{cardId:'B',score:.99},{cardId:'A',score:.4}]});
  assert.equal(replayTier(raw,raw.thresholds),'not sure');
});
test('AI crop is warped from source at text-readable resolution; feedback stays small',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected,includeCrop:true,includeFeedback:true});
  assert.equal(result.aiWarpedCard?.width,640);assert.equal(result.warpedCard?.width,10);
});
test('deferred AI warping preserves exact source pixels while returning identification first',async()=>{
  const source={...frame,data:frame.data.map((_,i)=>(i*17)%256)};
  const card={...selected,quad:selected.quad.map(p=>({x:p.x-.1,y:p.y}))};
  const eager=await fixture(false).recognize([source],{card,includeCrop:true});
  const deferred=await fixture(false).recognize([source],{card,includeCrop:true,deferAICrop:true});
  assert.equal(Boolean(deferred.aiWarpedCard),false);
  assert.equal(deferred.deferredAICrop?.bytes,source.data.byteLength);
  assert.deepEqual(deferred.deferredAICrop?.create(),eager.aiWarpedCard);
  assert.deepEqual(deferred.candidates,eager.candidates);
  assert.deepEqual(deferred.warpedCard,eager.warpedCard);
});
import {LearningCache} from './learning-cache';
import {toRemoteRecognitionResult} from './remote-result';
test('cached learning never fetches during reads, deduplicates refresh and expires failures',async()=>{
  let calls=0,now=0,fail=false;
  const cache=new LearningCache(async()=>{calls++;if(fail)throw Error('offline');return {version:'v1',references:[],confusions:[]};},()=>now);
  await Promise.all([cache.refresh(),cache.refresh()]);
  for(let i=0;i<10;i++)assert.equal(cache.current().version,'v1');assert.equal(calls,1);
  fail=true;await cache.refresh();assert.equal(cache.current().version,'v1');now=120001;assert.equal(cache.current().version,'empty');
});
test('remote message retains tier and guards and maps zero-passcode Tokens to catalog IDs',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected});
  result.candidates=[{cardId:'999',score:.9},{cardId:'bad',score:.8}];
  const message=toRemoteRecognitionResult(result,new Map([['999',{cardId:'999',passcode:0,name:'Token'}]]),'request');
  assert.equal(message.tier,result.tier);assert.equal(message.candidates[0].cardId,999);assert.equal(message.candidates.length,1);
  result.quality.faceDown=true;assert.deepEqual(toRemoteRecognitionResult(result,new Map(),'request').candidates,[]);
});
function temporalFixture(counter:{detect:number},switchIdentity=false,vectors?:number[][]) {
  const profile={...yugioh,id:'fixture',detector:{...yugioh.detector,longSide:32},card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:number[]) {}}
  const detector={backend:'wasm',run:async()=>{
    const heat=new Float32Array(128),box=new Float32Array(384),cell=26;
    heat[cell]=.99;box[2*64+cell]=Math.log(14/4);box[3*64+cell]=Math.log(22/4);box[5*64+cell]=1;
    box[cell]=counter.detect++*.1; // The outline moves on each frame.
    return {heat:{dims:[1,2,8,8],data:heat},box:{dims:[1,6,8,8],data:box}};
  }} as unknown as ModelSession;
  let calls=0;
  const embedder={backend:'wasm',run:async()=>({[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array(vectors?vectors[Math.min(calls++,vectors.length-1)]:switchIdentity&&calls++>0?[.3,.95]:[.95,.3])}})} as unknown as ModelSession;
  return new RecognitionPipeline(profile,searchIndex(['1','2'],[1,0,0,1]),detector,embedder,Tensor as unknown as TensorCtor);
}
test('temporal frames redetect moved outlines instead of reusing a selected quad',async()=>{
  const counter={detect:0};const p=temporalFixture(counter,true);
  const result=await p.recognize([frame,frame],{card:selected,earlyExit:false,includeRaw:true,preclean:false});
  assert.equal(counter.detect,2);assert.equal(result.quality.framesAgree,false);assert.notEqual(result.tier,'sure');
});
test('a first clean sure frame stops before subsequent detector/embed runs',async()=>{
  const counter={detect:0};const result=await temporalFixture(counter).recognize([frame,frame,frame],{includeRaw:true});
  assert.equal(result.tier,'sure');assert.equal(counter.detect,1);assert.equal(result.quality.framesUsed,1);assert.equal(result.raw?.earlyExit,true);
});
type ClickOutline={x:number;y?:number;w?:number;h?:number;confidence?:number};
function clickFixture(scene:(width:number)=>ClickOutline[]) {
  const image={width:1280,height:720,data:new Uint8ClampedArray(1280*720*4).fill(120)};
  const profile={...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:number[]) {}}
  const calls:number[][]=[];
  const detector={backend:'wasm',run:async(feeds:Record<string,Tensor>)=>{
    const dims=feeds.image.dims;calls.push(dims.slice());
    const [, ,height,width]=dims,gh=height/4,gw=width/4,plane=gh*gw;
    const heat=new Float32Array(plane*2),box=new Float32Array(plane*6);
    const contentHeight=Math.round(image.height*width/image.width);
    for(const outline of scene(width)) {
      const cx=outline.x*width,cy=(outline.y??.5)*contentHeight,col=Math.floor(cx/4),row=Math.floor(cy/4),cell=row*gw+col;
      heat[cell]=outline.confidence??.99;
      box[cell]=cx/4-col-.5;box[plane+cell]=cy/4-row-.5;
      box[2*plane+cell]=Math.log((outline.w??.14)*width/4);box[3*plane+cell]=Math.log((outline.h??.36)*contentHeight/4);box[5*plane+cell]=1;
    }
    return {heat:{dims:[1,2,gh,gw],data:heat},box:{dims:[1,6,gh,gw],data:box}};
  }} as unknown as ModelSession;
  const embedder={backend:'wasm',run:async()=>({[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([.95,.3])}})} as unknown as ModelSession;
  const pipeline=new RecognitionPipeline(profile,searchIndex(['1','2'],[1,0,0,1]),detector,embedder,Tensor as unknown as TensorCtor);
  return {pipeline,image,calls};
}
test('an explicit one-frame click first detects the full scene at 640 and picks the clicked card',async()=>{
  const f=clickFixture(()=>[{x:.2,confidence:1},{x:.7,confidence:.98}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.7,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640]]);
  assert.ok(Math.abs(result.detectedCard!.quad.reduce((sum,p)=>sum+p.x,0)/4-.7)<.001);
  assert.equal(result.quality.covered,false);assert.equal(result.quality.fallback,false);assert.equal(result.tier,'sure');
});
for(const scenario of ['missing','weak'] as const) test(`a ${scenario} clicked outline at 640 retries the original 960 detector`,async()=>{
  const f=clickFixture(width=>width===640?(scenario==='missing'?[{x:.2}]:[{x:.7,confidence:.89}]):[{x:.7}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.7,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960]]);
  assert.ok(Math.abs(result.detectedCard!.quad.reduce((sum,p)=>sum+p.x,0)/4-.7)<.001);
  assert.equal(result.detectedCard!.confidence,.99);
});
for(const outline of [{x:.04},{x:.07},{x:.96},{x:.5,y:.1},{x:.5,y:.9}]) test(`a clipped or edge-touching click at ${JSON.stringify(outline)} retries 960`,async()=>{
  const f=clickFixture(()=>[outline]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:outline.x,y:outline.y??.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960]]);
  if(outline.x!==.07){assert.equal(result.quality.partial,true);assert.notEqual(result.tier,'sure');}
});
test('weak overlapping outlines trigger 960 and remain in the covered-card scene',async()=>{
  const f=clickFixture(()=>[{x:.55},{x:.64,confidence:.25}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.53,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960]]);
  assert.equal(result.quality.covered,true);assert.notEqual(result.tier,'sure');
});
test('multiple outlines under a click trigger 960 before choosing the smaller card',async()=>{
  const f=clickFixture(()=>[{x:.48,w:.22,h:.4},{x:.54,w:.1,h:.2,confidence:.95}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.5,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960]]);
  assert.ok(Math.abs(result.detectedCard!.quad.reduce((sum,p)=>sum+p.x,0)/4-.54)<.001);
  assert.equal(result.quality.covered,true);assert.notEqual(result.tier,'sure');
});
test('a click on two touching card edges retries 960 even without overlap area',async()=>{
  const f=clickFixture(()=>[{x:.43},{x:.57,confidence:.95}]);
  await f.pipeline.recognize([f.image],{clickPoint:{x:.5,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960]]);
});
test('a missed click keeps the existing 448 close-up rescue after both scene passes',async()=>{
  const f=clickFixture(width=>width===448?[{x:.7}]:[{x:.2}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.7,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960],[1,3,256,448]]);
  assert.equal(result.quality.fallback,false);
});
test('unrelated outlines never turn a missed explicit click into a different detected target',async()=>{
  const f=clickFixture(()=>[{x:.2}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.7,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960],[1,3,256,448]]);
  assert.equal(result.detectedCard,undefined);assert.equal(result.quality.fallback,true);assert.notEqual(result.tier,'sure');
});
test('explicit quads, temporal reads and reads without a click retain their detector paths',async()=>{
  const f=clickFixture(()=>[{x:.5}]);
  await f.pipeline.recognize([f.image],{card:selected,clickPoint:{x:.5,y:.5}});assert.deepEqual(f.calls,[]);
  await f.pipeline.recognize([f.image,f.image],{clickPoint:{x:.5,y:.5},earlyExit:false});assert.deepEqual(f.calls,[[1,3,544,960],[1,3,544,960]]);
  f.calls.length=0;await f.pipeline.recognize([f.image]);assert.deepEqual(f.calls,[[1,3,544,960]]);
});
import {tuneThresholds,realsetMetrics,type RealsetSample} from './calibration';
test('threshold tuner keeps zero wrong sure on cards and negatives with a safety gap',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected,includeRaw:true});
  const sample=(id:string,label:string|null,score:number,runner:number):RealsetSample=>{
    const raw=structuredClone(result.raw!);const list=[{cardId:'A',score},{cardId:'B',score:runner}];raw.visual=list;raw.ranked=list;raw.winnerId='A';raw.frames=[{...raw.frames[0],clean:list,ranked:list,hypotheses:[list]}];
    return {id,capturedAt:'now',label,condition:'mocked',cardWidthPx:100,source:'photo',width:20,height:30,clickPoint:{x:.5,y:.5},tier:'sure',raw,latencyMs:1};
  };
  const samples=[sample('right','A',.98,.4),sample('wrong','B',.9,.6),sample('object',null,.93,.4)];
  const tuned=tuneThresholds(samples,.01);assert.equal(tuned.metrics.sureButWrong,0);assert.equal(tuned.metrics.sure,1);assert.ok(tuned.thresholds.score>.94 || tuned.thresholds.margin>.54);
  assert.equal(realsetMetrics(samples,tuned.thresholds).negativeSure,0);assert.throws(()=>tuneThresholds(samples.slice(0,1)),/negatives/);
});
test('calibration guards wrong individual whole-card views even when later art rescues capture',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected,includeRaw:true});
  const raw=structuredClone(result.raw!),list=(id:string,score:number)=>[{cardId:id,score},{cardId:id==='A'?'B':'A',score:.1}];
  raw.visual=list('A',.95);raw.ranked=raw.visual;raw.frames[0].clean=raw.visual;raw.frames[0].ranked=raw.visual;
  raw.frames[0].hypotheses=[list('A',.85),list('A',.95),list('B',.90)];
  const base:RealsetSample={id:'card',capturedAt:'now',label:'A',condition:'mock',cardWidthPx:100,source:'photo',width:20,height:30,clickPoint:{x:.5,y:.5},tier:'sure',raw,latencyMs:1};
  const negative={...base,id:'negative',label:null,raw:{...raw,visual:list('B',.2),frames:[]}};
  const tuned=tuneThresholds([base,negative]);
  assert.ok(tuned.thresholds.score>.91 || tuned.thresholds.margin>.81);
});
test('AI abstains when mocked provider returns a name outside its closed candidate list',async()=>{
  const {identifyRemoteVisionCard}=await import('../../web/src/lib/remote-vision-ai');
  const {MODEL}=await import('@yugidraft/shared/cards/effects/budget-ledger');
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>Response.json({model:MODEL,stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({name:'Wrong card'})}]});
    const result=await identifyRemoteVisionCard({prepare:()=>{throw Error('Out-of-list name reached catalog');}} as never,'mock-jpeg','mock-key',['Right card']);
    assert.equal(result.match,null);
  } finally {globalThis.fetch=original;}
});
import {calibratedThresholds} from './threshold-config';
import {indexVersion} from './learning';
test('runtime refuses thresholds calibrated for a different index or model',()=>{
  const index=searchIndex(['1','2'],[1,0,0,1]);index.meta.layoutKey='layout';
  const config={version:1,modelId:yugioh.embedding.id,modelSha256:yugioh.embedding.sha256,indexVersion:indexVersion(index.meta),layoutKey:'layout',thresholds:{score:.9,margin:.04,floor:.74},sampleCount:2,negativeCount:1,sureButWrong:0,safetyGap:.01};
  assert.equal(calibratedThresholds(config,yugioh,index).score,.9);
  assert.throws(()=>calibratedThresholds({...config,indexVersion:'stale'},yugioh,index),/Incompatible/);
  assert.throws(()=>calibratedThresholds({...config,modelSha256:'wrong'},yugioh,index),/Incompatible/);
});

test('deck suggestions preserve the visual winner and remain available for manual choice',async()=>{
  const t=yugioh.embedding.thresholds,deck=[{cardId:'2',score:.81}],catalog=[{cardId:'1',score:.82},deck[0]];
  assert.equal(preferDeck(deck,catalog,t)[0].cardId,'1');
  assert.equal(preferDeck(deck,[{cardId:'1',score:.96},deck[0]],t)[0].cardId,'1');
  const search=await import('./search');
  const weakDeck=[{cardId:'nibiru',score:.66},{cardId:'deck-2',score:.56},{cardId:'too-low',score:.54}];
  const visual=[.79,.78,.77,.76,.75].map((score,i)=>({cardId:`catalog-${i}`,score}));
  const shown=search.withDeckSuggestions(weakDeck,visual,5);
  assert.equal(shown[0],visual[0]);assert.equal(shown.length,5);assert.deepEqual(shown.slice(-2),weakDeck.slice(0,2));
  assert.ok(!shown.some(c=>c.cardId==='too-low'));
  const {replayTier}=await import('./decision');
  const raw:any={visual:[{cardId:'nibiru',score:.79},{cardId:'other',score:.70}],ranked:[{cardId:'nibiru',score:.79},{cardId:'other',score:.70}],winnerId:'nibiru',cardBackId:'back',blocked:[],priors:{decklist:['nibiru']}};
  raw.frames=[{eligible:true,clean:raw.visual,ranked:raw.ranked,deck:weakDeck}];
  assert.equal(replayTier(raw,t),'sure');assert.notEqual(replayTier({...raw,priors:undefined},t),'sure');
  assert.notEqual(replayTier({...raw,visual:[{cardId:'nibiru',score:.66},{cardId:'other',score:.5}]},t),'sure');
  assert.notEqual(replayTier(raw,{score:.9,margin:.04,floor:.74}),'sure');
  const profile={...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  const rows=[{cardId:'clear',score:.95},...visual,...weakDeck];
  const index:LoadedIndex={meta:{dim:2,count:rows.length,entries:rows.map(c=>({cardId:c.cardId,name:c.cardId,passcode:1}))} as LoadedIndex['meta'],vectors:Float32Array.from(rows.flatMap(c=>[c.score,Math.sqrt(1-c.score*c.score)]))};
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:unknown){}}
  const detector={backend:'wasm',run:()=>{throw Error('selected quad');}} as unknown as ModelSession;
  const embedder={backend:'wasm',run:async()=>({[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([1,0])}})} as unknown as ModelSession;
  const pipeline=new RecognitionPipeline(profile,index,detector,embedder,Tensor as unknown as TensorCtor);
  const plain=await pipeline.recognize([frame],{card:selected,includeRaw:true,includeFeedback:true});
  const result=await pipeline.recognize([frame],{card:selected,includeRaw:true,includeFeedback:true,priors:{decklist:weakDeck.map(c=>c.cardId)}});
  assert.equal(result.candidates[0].cardId,'clear');assert.equal(result.tier,plain.tier);
  assert.deepEqual(result.candidates.slice(-2).map(c=>c.cardId),['nibiru','deck-2']);
  assert.deepEqual(result.raw?.ranked,plain.raw?.ranked);assert.deepEqual(result.feedback,plain.feedback);
});

import {catalogCards,physicalCatalogCards} from '../../../scripts/vision/catalog';
test('builder selects physical catalog entries while source parsing retains all records',()=>{
  const rows=['Trap Card','Token','Skill Card'].map((type,i)=>({id:i+1,type,name:type==='Trap Card'?'Skill Drain':type,card_images:[{id:i+1,image_url:'https://example.test/card.jpg'}]}));
  const all=catalogCards(rows);assert.equal(all.length,3);assert.deepEqual(physicalCatalogCards(all).map(c=>c.name),['Skill Drain','Token']);
});

test('deck prior lowers the in-list floor without ever renaming a better off-list match',async()=>{
  const profile={...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  class DeckTensor {constructor(public type:unknown,public data:unknown,public dims:unknown){}}
  const model={backend:'wasm',run:async()=>({[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([1,0])}})} as unknown as ModelSession;
  const run=(scores:number[],decklist:string[])=>new RecognitionPipeline(profile,searchIndex(['off-list','deck'],scores.flatMap(s=>[s,Math.sqrt(1-s*s)])),model,model,DeckTensor as unknown as TensorCtor).recognize([frame],{card:selected,priors:{decklist},preclean:false,includeRaw:true});
  const off=await run([.82,.81],['deck']);
  assert.equal(off.candidates[0].cardId,'off-list');assert.equal(off.quality.searchSource,'catalog');assert.equal(off.quality.notInDecklist,true);
  const noList=await run([.72,.79],[]);
  assert.equal(noList.tier,'not sure');
  const on=await run([.72,.79],['deck']);
  assert.equal(on.candidates[0].cardId,'deck');assert.equal(on.quality.searchSource,'deck');assert.equal(on.tier,'sure');
  const absent=await run([.9,.65],['missing']);
  assert.equal(absent.candidates[0].cardId,'off-list');assert.equal(absent.tier,'sure');assert.equal(absent.quality.searchSource,'catalog');
});

test('a weak deck view cannot hide a stronger off-list card in the reverse view',async()=>{
  const result=await fixture(false,undefined,[.79,.3]).recognize([frame],{
    card:selected,preclean:false,includeRaw:true,preferUpright:true,priors:{decklist:['A']},
  });
  assert.equal(result.candidates[0].cardId,'B');
  assert.equal(result.quality.searchSource,'catalog');
  assert.equal(result.tier,'sure');
});

test('a field deck rescue needs a clear in-deck lead and preserves a sure catalog name',async()=>{
  const profile={...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:unknown){}}
  const model={backend:'wasm',run:async()=>({[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([1,0])}})} as unknown as ModelSession;
  const run=(scores:number[],covered=false)=>new RecognitionPipeline(profile,searchIndex(['off-list','deck','deck-2'],scores.flatMap(s=>[s,Math.sqrt(1-s*s)])),model,model,Tensor as unknown as TensorCtor).recognize([frame],{
    card:{...selected,covered},priors:{decklist:['deck','deck-2']},deckRescue:true,includeRaw:true,preclean:false,
  });
  const rescued=await run([.802,.789,.65]);
  assert.equal(rescued.candidates[0].cardId,'deck');
  assert.equal(rescued.quality.searchSource,'deck');
  assert.equal(rescued.tier,'sure');
  assert.equal(rescued.raw?.visual[0].cardId,'off-list');
  assert.deepEqual(fieldGlareChoices(rescued).map(c=>c.cardId),['deck','deck-2']);
  const low=await run([.719,.71,.56]);
  assert.equal(low.tier,'sure');assert.equal(low.candidates[0].cardId,'deck');
  assert.notEqual((await run([.802,.789,.75])).tier,'sure');
  assert.notEqual((await run([.802,.789,.65],true)).tier,'sure');
  const catalog=await run([.92,.789,.65]);
  assert.equal(catalog.tier,'sure');assert.equal(catalog.candidates[0].cardId,'off-list');

  const angle=.2, cosine=Math.cos(angle), sine=Math.sin(angle);
  const rawScores=[.802,.789,.65], maskedScores=[.787,.799,.74];
  const rows=rawScores.flatMap((raw,i)=>{
    const second=(maskedScores[i]-raw*cosine)/sine;
    return [raw,second,Math.sqrt(1-raw*raw-second*second)];
  });
  const threeDim={...profile,embedding:{...profile.embedding,dim:3}};
  const index={meta:{...searchIndex(['off-list','deck','deck-2'],[]).meta,dim:3},vectors:Float32Array.from(rows)};
  let embeddings=0;
  const alternating={backend:'wasm',run:async()=>({[profile.embedding.outputName]:{dims:[1,3],data:new Float32Array(embeddings++<2?[1,0,0]:[cosine,sine,0])}})} as unknown as ModelSession;
  const cleanMiss=await new RecognitionPipeline(threeDim,index,model,alternating,Tensor as unknown as TensorCtor).recognize([frame],{
    card:selected,priors:{decklist:['deck','deck-2']},deckRescue:true,includeRaw:true,
  });
  assert.equal(cleanMiss.candidates[0].cardId,'deck');assert.equal(cleanMiss.tier,'sure');
  assert.equal(cleanMiss.preclean?.used,'raw');
});

test('a clear off-list upright card stays fast even when a reverse deck view could score higher',async()=>{
  const calls={calls:0};
  const result=await fixture(false,calls,[.5,1]).recognize([frame],{
    card:selected,preclean:false,includeRaw:true,preferUpright:true,priors:{decklist:['A']},
    gallery:[{cardId:'A',embedding:{values:[-1,0],space:'art-box'}}],
  });
  assert.equal(result.candidates[0].cardId,'B');assert.equal(result.tier,'sure');
  assert.equal(calls.calls,1);
});

test('a deck confidence boost cannot skip the clean view that identifies an off-list card',async()=>{
  const profile={...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:96,warpHeight:140},embedding:{...yugioh.embedding,dim:3,inputSize:2}};
  const image={width:20,height:30,data:new Uint8ClampedArray(2400)};
  for(let i=0;i<image.data.length;i+=4)image.data.set([40,80,120,255],i);
  const index:LoadedIndex={meta:{dim:3,count:2,entries:['deck','off-list'].map(cardId=>({cardId,name:cardId,passcode:1}))} as LoadedIndex['meta'],vectors:new Float32Array([.79,Math.sqrt(1-.79**2),0,.72,0,Math.sqrt(1-.72**2)])};
  class CleanTensor {constructor(public type:unknown,public data:Float32Array,public dims:number[]){}}
  const detector={backend:'wasm',run:()=>{throw Error('provided quad');}} as unknown as ModelSession;
  const model={backend:'wasm',run:async(feeds:Record<string,CleanTensor>)=>({[profile.embedding.outputName]:{
    dims:[1,3],data:new Float32Array(feeds[profile.embedding.inputName].data[0]<-1.6?[.72,0,Math.sqrt(1-.72**2)]:[1,0,0]),
  }})} as unknown as ModelSession;
  const run=(decklist:string[])=>new RecognitionPipeline(profile,index,detector,model,CleanTensor as unknown as TensorCtor).recognize([image],{card:selected,includeRaw:true,preferUpright:true,priors:{decklist}});
  const plain=await run([]),listed=await run(['deck']);
  assert.equal(plain.candidates[0].cardId,'off-list');assert.equal(plain.preclean?.used,'clean');
  assert.equal(listed.candidates[0].cardId,'off-list');assert.equal(listed.preclean?.used,'clean');
});

test('temporal mean follows majority image evidence without manufacturing certainty on disagreement',async()=>{
  const views=[[0,1],[1,0],[1,0]],make=()=>temporalFixture({detect:0},false,views);
  const first=await make().recognize([frame],{card:selected,preclean:false});
  const mean=await make().recognize([frame,frame,frame],{card:selected,maxFrames:3,earlyExit:false,preclean:false});
  assert.equal(first.candidates[0].cardId,'2');assert.equal(mean.candidates[0].cardId,'1');
  assert.equal(mean.quality.framesUsed,3);assert.equal(mean.quality.framesAgree,false);assert.equal(mean.tier,'not sure');
});
test('three agreeing complete card views retain a sure identity',async()=>{
  const mean=await temporalFixture({detect:0},false,[[1,0],[1,0],[1,0]]).recognize([frame,frame,frame],{card:selected,maxFrames:3,earlyExit:false,preclean:false});
  assert.equal(mean.candidates[0].cardId,'1');assert.equal(mean.quality.framesAgree,true);assert.equal(mean.tier,'sure');
});
