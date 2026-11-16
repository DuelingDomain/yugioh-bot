import test from 'node:test';
import assert from 'node:assert/strict';
import {unsureNameCandidates} from './unsure-names';
import type {RecognitionResult} from './types';
const read=():RecognitionResult=>({tier:'low match',candidates:[{cardId:'A',score:.72},{cardId:'B',score:.59},{cardId:'C',score:.55}],quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},timingsMs:{sharpness:0,detect:0,warp:0,embed:0,search:0,total:228},backend:'wasm'});
test('only a clean, clear visual lead supplies the public candidate list',()=>{
 const r=read();assert.deepEqual(unsureNameCandidates(r,'back'),r.candidates);
 for(const flag of ['faceDown','fallback','partial','covered'] as const)assert.equal(unsureNameCandidates({...r,quality:{...r.quality,[flag]:true}},'back'),undefined,flag);
 assert.equal(unsureNameCandidates({...r,candidates:[{cardId:'A',score:.599},{cardId:'B',score:.3}]},'back'),undefined);
 assert.equal(unsureNameCandidates({...r,candidates:[{cardId:'A',score:.72},{cardId:'B',score:.609}]},'back'),undefined);
 assert.equal(unsureNameCandidates({...r,candidates:r.candidates.slice(0,1)},'back'),undefined);
 assert.equal(unsureNameCandidates({...r,candidates:[{cardId:'back',score:.72},{cardId:'B',score:.5}]},'back'),undefined);
 // A boosted list must not hide the full-catalog visual winner.
 assert.equal(unsureNameCandidates({...r,raw:{visual:[{cardId:'B',score:.8},{cardId:'A',score:.6}],ranked:r.candidates,winnerId:'A',cardBackId:'back',blocked:[],frames:[],thresholds:{score:.8,margin:.05,floor:.6},modelId:'fixture',modelSha256:'fixture',indexVersion:'fixture',layoutKey:'fixture',learningVersion:'fixture',earlyExit:false}},'back'),undefined);
});
