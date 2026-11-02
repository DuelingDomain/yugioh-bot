import {writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {createFieldWatcher} from '../../packages/vision/src/field-watcher';
import {fieldCenter,fieldMatPoint,fieldZoneLocation,createFieldCalibration} from '../../packages/vision/src/field-zones';
import {yugioh} from '../../packages/vision/src/games/yugioh';
import {ygoModule} from '../../packages/shared/src/remote/games/ygo';
import {remoteActionSchema} from '../../packages/shared/src/remote/actions';
import {fieldPlacementProposals,fieldDepartureProposal} from '../../packages/web/src/lib/remote/field-proposals';
const raw=await sharp('data/vision/benchmark/field-watcher/card.png').resize(96,140).ensureAlpha().raw().toBuffer();
const crop={width:96,height:140,data:new Uint8ClampedArray(raw)};
let at=0,reads=0,detects=0,seq=0;let state=ygoModule.initialState({seatCount:2});
const act=(proposal:any)=>{state=ygoModule.reduce(state,remoteActionSchema.parse({...proposal,idempotencyKey:String(++seq),at:Math.ceil(at)}));};
const calibration=createFieldCalibration([{x:0,y:0},{x:1,y:1}],{playerSide:'top',mirrored:false});
const centers:any={M5:{x:.756,y:.38},M4:{x:.628,y:.38},GY:{x:.91,y:.405},BANISHED:{x:.91,y:.125}};
const quad=(zone:string,turned=false)=>{const p=centers[zone],w=turned?.16:.085,h=turned?.12:.22;return {quad:[{x:p.x-w/2,y:p.y-h/2},{x:p.x+w/2,y:p.y-h/2},{x:p.x+w/2,y:p.y+h/2},{x:p.x-w/2,y:p.y+h/2}].map(p=>fieldMatPoint(p,calibration)),kind:'face-up' as const,confidence:.99,partial:false};};
const pixels=Array.from({length:288},(_,i)=>((Math.floor(i/3)*17+(i%3)*31)%251)/255);
let outlines=[quad('M5')], pending:any[]=[];const events:any[]=[];
const watcher=createFieldWatcher({profile:yugioh,calibration,now:()=>at,hidden:()=>false,
 buffer:{sample:async()=>({at,frame:crop as ImageData})},clone:async f=>f,
 getPriors:()=>({decklist:['89631133']}),getKnownCards:()=>state.seats[0].twin.filter(c=>c.cardId).map(c=>({id:c.ref,cardId:String(c.cardId),zone:c.zone==='monster'?`M${c.slot}` as any:c.zone==='graveyard'?'GY':'BANISHED'})),
 recognizer:{detectCards:async()=>{detects++;at+=350;return structuredClone(outlines);},recognize:async()=>{reads++;at+=70;return {candidates:[{cardId:'89631133',score:.84}],tier:'sure',identityEmbedding:{space:'art-box',values:[1,0]},quality:{detected:true,cornersFound:true,fallback:false,sharpness:30,framesUsed:1,selectedFrameIndices:[0]},timingsMs:{total:70},backend:'wasm'};}},
 analyze:()=>({crop:()=>crop,motion:()=>0,motionOutside:()=>outlines.length?.1:0,sharpness:()=>30,halo:()=>Array(192).fill(.2),appearance:c=>outlines.some(o=>Math.hypot(fieldCenter(o).x-fieldCenter(c).x,fieldCenter(o).y-fieldCenter(c).y)<.03)?pixels:Array(288).fill(.2)})});
watcher.subscribe(e=>{events.push({...e,at});pending.push(e);});
const tick=async()=>{at+=100;await watcher.tick();await Promise.resolve();for(const e of pending.splice(0)){
 if(e.type==='reading')for(const p of fieldPlacementProposals({track:{...e.track,cardId:undefined},seat:0}))act(p);
 if(e.type==='placed'){const placeholder=state.seats[0].twin.find(c=>c.ref===e.track.id&&!c.cardId);if(placeholder)act({type:'twin.remove',actorSeat:0,seat:0,cardRef:placeholder.ref});for(const p of fieldPlacementProposals({track:e.track,seat:0,cardId:89631133,name:'Blue-Eyes White Dragon'}))act(p);watcher.confirm(e.track.id,'89631133',e.track.id,false);}
 if(e.type==='moved')act({type:'twin.move',actorSeat:0,seat:0,cardRef:e.track.id,...fieldZoneLocation(e.track.zone),source:'auto',position:e.track.position});
 if(e.type==='removed'){const c=state.seats[0].twin.find(c=>c.ref===e.track.id);if(c){const p=fieldDepartureProposal(c,0);if(p)act(p);}}
 }};
const until=async(pred:()=>boolean)=>{const start=at;while(!pred()&&at-start<5000)await tick();return pred()?at-start:null;};
const placement=await until(()=>events.some(e=>e.type==='placed')),ref=state.seats[0].twin.find(c=>c.cardId)?.ref;
act({type:'twin.place',actorSeat:0,seat:0,zone:'graveyard',card:{ref:'older-gy',cardId:46986414}});
act({type:'twin.place',actorSeat:0,seat:0,zone:'banished',card:{ref:'older-ban',cardId:14558127}});
const move=async(zone:string,turned=false)=>{const begin=events.length;outlines=[quad(zone,turned)];return until(()=>events.slice(begin).some(e=>e.type==='moved'&&e.track.id===ref&&e.track.zone===zone));};
const slide=await move('M4');
outlines=[];await until(()=>events.some(e=>e.type==='removed'));
const graveyard=await move('GY'),gyTop=state.seats[0].twin.filter(c=>c.zone==='graveyard').map(c=>c.ref);
const banished=await move('BANISHED'),banTop=state.seats[0].twin.filter(c=>c.zone==='banished').map(c=>c.ref);
const result={placementMs:placement,placeholderMs:events.find(e=>e.type==='reading')?.at,identifiedAt:events.find(e=>e.type==='placed')?.at,slideMs:slide,gyMs:graveyard,banishMs:banished,gyTop,banTop,ref,prompts:events.filter(e=>e.type==='prompt').length,confirmation:state.twinConfirmation,reads,detects,events:events.map(e=>({type:e.type,at:e.at,id:e.track.id,zone:e.track.zone})),state:state.seats[0].twin};
console.log(JSON.stringify(result,null,2));await writeFile(`/tmp/remote-slide-probe-${process.env.PROBE_LABEL??'result'}.json`,JSON.stringify(result,null,2));watcher.dispose();
