import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoreSession} from './score';
import {validateSession,type LabelledSession,type ReplayResult} from './session';
test('session scoring keeps misses, wrong identity, duplicate events and hand negatives in the gate',()=>{
  const session:LabelledSession={version:1,id:'test',source:'real',video:'test.webm',durationMs:15000,width:640,height:480,decklist:['1'],format:'normal',reviewed:true,events:[
    {id:'a',instanceId:'copy-1',atMs:1000,kind:'placed',cardId:'1',zone:'M1',box:{x:.2,y:.2,w:.1,h:.2},reviewed:true},
    {id:'b',instanceId:'copy-1',atMs:6000,kind:'moved',cardId:'1',zone:'M2',box:{x:.4,y:.2,w:.1,h:.2},reviewed:true},
  ],negatives:[{startMs:10000,endMs:14000,kind:'hands'}],log:[]};
  const run:ReplayResult={variant:'baseline',requestedBackend:'wasm',events:[
    {atMs:1200,kind:'placed',trackId:'t',cardId:'wrong',zone:'M5',box:{x:.2,y:.2,w:.1,h:.2},candidates:['wrong','1'],tier:'sure'},
    {atMs:1300,kind:'placed',trackId:'duplicate',cardId:'1',zone:'M1',box:{x:.2,y:.2,w:.1,h:.2},candidates:['1']},
    {atMs:11000,kind:'prompt',trackId:'hand',zone:'M3',box:{x:.7,y:.7,w:.1,h:.1}},
  ],detections:[],wallMs:15000,warmMs:0,inferenceMs:20,errors:[],backends:['wasm'],runtime:[],stats:{}};
  assert.equal(validateSession(session).events.length,2);
  const score=scoreSession(session,run);
  assert.equal(score.events.recall,.5);assert.equal(score.events.precision,1/3);
  assert.equal(score.identity.top1,0);assert.equal(score.identity.top5,.5);
  assert.equal(score.zoneAccuracy,0);assert.equal(score.wrongSure,1);assert.equal(score.unsafeSure,0);
  assert.equal(score.falseEventsFromHands,1);assert.equal(score.perEvent[0].latencyMs,200);
  assert.equal(score.gate.passed,false);
  assert.ok(scoreSession({...session,events:session.events.map(e=>({...e,cardId:undefined}))},run).events.automaticRecall<=1);
  assert.equal(scoreSession(session,{...run,events:run.events.map(e=>({...e,atMs:NaN}))}).events.matched,0);
  assert.equal(scoreSession(session,{...run,events:[...run.events,{...run.events[0],atMs:14500,tier:'sure'}]}).unsafeSure,1);
  const detector=scoreSession({...session,detectorFrames:[{atMs:1000,reviewed:true,cards:[{instanceId:'copy-1',box:session.events[0].box!}]}]},
    {...run,detections:[{atMs:1100,cards:[{box:session.events[0].box!,confidence:.9},{box:{x:.7,y:.7,w:.1,h:.1},confidence:.8}]}]});
  assert.equal(detector.detector.recall,1);assert.equal(detector.detector.precision,.5);
  assert.equal(score.perEvent[0].identifiedLatencyMs,null);
  assert.equal(scoreSession(session,{...run,wallMs:1000}).gate.passed,false);
  assert.throws(()=>validateSession({...session,events:[{...session.events[0],atMs:-2}]}));
});
