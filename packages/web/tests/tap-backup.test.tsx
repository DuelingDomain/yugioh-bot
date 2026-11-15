// @vitest-environment jsdom
import React, { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { projectRemoteState, type RemoteActionProposal, type TwinCard } from '@yugidraft/shared/remote';
import { createRoomMutationQueue } from '../src/lib/remote/room-mutations';
import { createManualCorrections, correctionsFor, type CorrectionObservation } from '../src/lib/remote/manual-corrections';
import { zonePlacement, zoneSet, zoneCardAction } from '../src/components/remote/ui/zone-placement';
import { ZoneCardPicker } from '../src/components/remote/ui/zone-card-picker';
import { RecentDepartures } from '../src/components/remote/ui/recent-departures';
import { FieldWatcherUI } from '../src/components/remote/field-watcher-ui';
import { InspectorBody, type CardActions } from '../src/components/remote/ui/card-view';
import { useTokens } from '../src/components/remote/ui/token-ui';
import { useLayers } from '../src/components/remote/ui/use-layers';
import { ZoneActions } from '../src/components/remote/ui/zone-actions';
import { loadCards } from '../src/components/remote/ui/catalog';
import { createChangedZones } from '../src/lib/remote/changed-zones';
import type { FieldTrack } from '@yugidraft/vision';
import { tapRoom, applyTap } from './tap-room-fixture';

afterEach(() => { cleanup(); sessionStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const monster = (ref='paper'): TwinCard => ({ref,cardId:46986414,name:'Dark Magician',zone:'monster',slot:1,faceUp:true,position:'attack'});
const placementCard=(ref='paper')=>{const {zone,...card}=monster(ref);return card;};
const observed = (overrides: Partial<CorrectionObservation> = {}): CorrectionObservation => ({id:'outline',ref:'paper',zone:'monster',slot:1,faceDown:false,position:'attack',removed:false,resting:true,...overrides});

it.each(['place','name','move','flip','position','remove'] as const)('a manual %s survives camera re-observation without a duplicate', async kind => {
  let room=tapRoom();
  if(kind!=='place')room.state.seats[0].twin=[monster()];
  correctionsFor(room,0).observe([observed()],0);
  const edits: Record<typeof kind, RemoteActionProposal> = {
    place:{type:'twin.place',actorSeat:0,seat:0,zone:'monster',card:placementCard()},
    name:{type:'card.identified',actorSeat:0,seat:0,cardRef:'paper',cardId:89631139,name:'Blue-Eyes White Dragon',source:'typed'},
    move:{type:'twin.move',actorSeat:0,seat:0,cardRef:'paper',zone:'monster',slot:3},
    flip:{type:'twin.flip',actorSeat:0,seat:0,cardRef:'paper',faceUp:false},
    position:{type:'twin.flip',actorSeat:0,seat:0,cardRef:'paper',faceUp:true,position:'defense'},
    remove:{type:'twin.remove',actorSeat:0,seat:0,cardRef:'paper'},
  };
  const post=vi.fn(async (a: RemoteActionProposal)=>{try{return room=applyTap(room,a);}catch{return null;}});
  const queue=createRoomMutationQueue(()=>room,post);
  await queue.action(edits[kind]);const chosen=structuredClone(room.state.seats[0].twin);
  await queue.action({type:'twin.place',source:'auto',actorSeat:0,seat:0,zone:'monster',card:{...placementCard('another-outline'),slot:1}});
  await queue.action({type:'twin.move',source:'auto',actorSeat:0,seat:0,cardRef:'paper',zone:'monster',slot:1});
  await queue.action({type:'card.identified',source:'auto',actorSeat:0,seat:0,cardRef:'paper',cardId:46986414,name:'Old read'});
  await queue.action({type:'twin.flip',source:'auto',actorSeat:0,seat:0,cardRef:'paper',faceUp:true});
  expect(room.state.seats[0].twin).toEqual(chosen);expect(post).toHaveBeenCalledTimes(1);
});

it('a later manual click prevents an older queued camera write, even before the click saves', async () => {
  let room=tapRoom();room.state.seats[0].twin=[monster()];
  let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
  const queue=createRoomMutationQueue(()=>room,async a=>room=applyTap(room,a));
  const busy=queue.transaction(async()=>{await gate;});
  const camera=queue.action({type:'twin.remove',source:'auto',actorSeat:0,seat:0,cardRef:'paper'});
  const human=queue.action({type:'twin.move',actorSeat:0,seat:0,cardRef:'paper',zone:'monster',slot:3});
  release();await Promise.all([busy,camera,human]);
  expect(room.state.seats[0].twin).toEqual([expect.objectContaining({ref:'paper',slot:3})]);expect(room.lastSeq).toBe(1);
});

it('holds survive reload, release on a sustained physical change or a proven departure, and keep a separate copy independent', () => {
  const first=createManualCorrections(sessionStorage,'holds');first.observe([observed()],0);first.begin('paper',[{zone:'monster',slot:1}]);
  const reload=createManualCorrections(sessionStorage,'holds');reload.observe([],5000);
  expect(reload.blocks(['new-id'],{zone:'monster',slot:1})).toBe(true);
  expect(reload.blocks(['second-copy'],{zone:'monster',slot:2})).toBe(false);
  const moved=observed({id:'restarted-outline',slot:3});reload.observe([moved],6000);reload.observe([moved],7999);expect(reload.has('paper')).toBe(true);
  reload.observe([moved],8000);expect(reload.has('paper')).toBe(false);
  reload.observe([observed()],9000);reload.begin('paper',[{zone:'monster',slot:1}]);reload.observe([observed({removed:true})],9001);expect(reload.has('paper')).toBe(false);
  reload.begin('untracked',[{zone:'monster',slot:1}]);reload.observe([],20000);expect(reload.has('untracked')).toBe(true);
});

it('a rejected manual correction does not leave an invisible hold', async () => {
  let room=tapRoom();room.state.seats[0].twin=[monster()];let reject=true;
  const queue=createRoomMutationQueue(()=>room,async a=>reject?null:room=applyTap(room,a));
  await queue.action({type:'twin.remove',actorSeat:0,seat:0,cardRef:'paper'});reject=false;
  await queue.action({type:'twin.move',source:'auto',actorSeat:0,seat:0,cardRef:'paper',zone:'monster',slot:2});
  expect(room.state.seats[0].twin[0].slot).toBe(2);
});

it('a later manual placement in a cleared zone replaces its old tombstone',()=>{
  const store=createManualCorrections(sessionStorage,'replace');store.observe([observed()],0);
  store.begin('paper',[{zone:'monster',slot:1}]);
  store.begin('replacement',[{zone:'monster',slot:1}]);
  expect(store.has('paper')).toBe(false);expect(store.has('replacement')).toBe(true);
});

it('two witnessed identical field copies stay separate while the corrected first copy stays held',async()=>{
  let room=tapRoom();const queue=createRoomMutationQueue(()=>room,async a=>room=applyTap(room,a));
  await queue.action({type:'twin.place',actorSeat:0,seat:0,zone:'monster',card:placementCard()});
  await queue.action({type:'twin.place',source:'auto',actorSeat:0,seat:0,zone:'monster',card:{...placementCard('second'),slot:2},copyProof:{simultaneousQuads:2,at:1000}});
  expect(room.state.seats[0].twin.map(c=>[c.ref,c.slot])).toEqual([['paper',1],['second',2]]);
});

it('a manual placement adopts the server hand ref so later camera writes cannot move it',async()=>{
  let room=tapRoom();room.state.seats[0].twin=[{...monster('hand-copy'),zone:'hand',slot:undefined}];
  const queue=createRoomMutationQueue(()=>room,async a=>room=applyTap(room,a));
  for(const a of zonePlacement(room,{seat:0,key:'m3',cardId:46986414,name:'Dark Magician',faceUp:true,anotherCopy:true},'requested'))await queue.action(a);
  await queue.action({type:'twin.move',source:'auto',actorSeat:0,seat:0,cardRef:'hand-copy',zone:'monster',slot:4});
  expect(room.state.seats[0].twin).toEqual([expect.objectContaining({ref:'hand-copy',zone:'monster',slot:3})]);
});

it('exact-zone placement preserves hidden identity, distinguishes copies and reuses a Reading ref', () => {
  let room=tapRoom();const pick={seat:0,key:'m2' as const,cardId:46986414,name:'Dark Magician',faceUp:false};
  for(const a of zonePlacement(room,pick,'first'))room=applyTap(room,a);
  expect(room.state.seats[0].twin[0]).toMatchObject({ref:'first',zone:'monster',slot:2,faceUp:false,position:'defense',cardId:46986414});
  expect(projectRemoteState(room.state,new Set([1])).seats[0].twin[0]).not.toHaveProperty('cardId');
  expect(()=>zonePlacement(room,{...pick,key:'m3'},'second')).toThrow(/physical copy/);
  for(const a of zonePlacement(room,{...pick,key:'m3',anotherCopy:true},'second'))room=applyTap(room,a);
  expect(room.state.seats[0].twin.map(c=>c.ref)).toEqual(['first','second']);
  expect(()=>zonePlacement(room,pick,'occupied')).toThrow(/occupied/);
  expect(()=>zonePlacement({...room,mySeat:1},pick,'foreign')).toThrow(/own active field/);
  room.state.seats[0].twin.push({ref:'fw-reading',zone:'monster',slot:4,faceUp:true,position:'attack'});
  for(const a of zonePlacement(room,{...pick,key:'m4'},'unused'))room=applyTap(room,a);
  expect(room.state.seats[0].twin).toHaveLength(3);expect(room.state.seats[0].twin[2]).toMatchObject({ref:'fw-reading',cardId:46986414,faceUp:false});
});

it('the touch picker offers deck, recent and search, keeps a face-down choice private and asks which copy', async () => {
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({cards:[{id:46986414,name:'Dark Magician',type:'Spellcaster / Normal Monster',frameType:'normal'}]})));
  const pick=vi.fn();render(<ZoneCardPicker seat={0} zone="m2" at={{anchor:null,feed:null}} deck={[46986414,46986414]} recent={[{cardId:46986414,name:'Dark Magician'}]} twin={[monster()]} busy={false} error="" onPick={pick} onClose={()=>{}}/>);
  expect(await screen.findByRole('button',{name:'Dark Magician (2)'})).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox',{name:'Face down (private)'}));
  fireEvent.click(screen.getByRole('tab',{name:'Recent reads'}));fireEvent.click(screen.getByRole('button',{name:'Dark Magician'}));expect(pick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Use monster 1 copy'}));expect(pick).toHaveBeenLastCalledWith(expect.objectContaining({key:'m2',faceUp:false,fromRef:'paper'}));
  fireEvent.click(screen.getByRole('tab',{name:'Search'}));fireEvent.change(screen.getByRole('textbox',{name:'Search cards'}),{target:{value:'Dark'}});
  fireEvent.click(await screen.findByRole('button',{name:'Dark Magician'}));fireEvent.click(screen.getByRole('button',{name:'Another physical copy'}));expect(pick).toHaveBeenLastCalledWith(expect.objectContaining({key:'m2',anotherCopy:true}));
});

it('the card sheet exposes all destinations, battle pose, attach and detach', () => {
  const move=vi.fn(),attach=vi.fn(),detach=vi.fn(),flip=vi.fn(),pose=vi.fn(),remove=vi.fn();
  const actions:CardActions={canAdd:false,adding:false,onAdd:()=>{},canAttack:false,attackHint:'',onAttack:()=>{},edit:{faceUp:true,zone:'monster',slot:1,extraZones:true,onCell:()=>{},onMove:move,onFlip:flip,onRemove:remove,position:{defense:false,onTurn:pose}},materials:[{ref:'material',name:'Material',onDetach:detach}],attach:{label:'Attach Xyz material',options:[{ref:'source',label:'Monster 2'}],onPick:attach}};
  render(<InspectorBody subject={{from:'board',seat:0,ref:'paper',cardId:0,notInDecklist:null,addErrors:[],via:'manual'}} info={undefined} actions={actions} sourceLine=""/>);
  for(const [label,zone] of [['Graveyard','graveyard'],['Banish','banished'],['Hand','hand'],['Deck','deck'],['Extra Deck','extra'],['Field','field']]){fireEvent.click(screen.getByRole('button',{name:label}));expect(move).toHaveBeenLastCalledWith(zone);}
  fireEvent.click(screen.getByRole('button',{name:'Turn face down'}));expect(flip).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'Change to Defense'}));expect(pose).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByRole('combobox',{name:'Attach Xyz material'}),{target:{value:'source'}});expect(attach).toHaveBeenCalledWith('source');fireEvent.click(screen.getByRole('button',{name:'Detach'}));expect(detach).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'Remove'}));expect(remove).toHaveBeenCalledOnce();
});

it('several departures remain separately correctable after the toast window, with targeted Undo', () => {
  vi.useFakeTimers();let room=tapRoom();room.state.seats[0].twin=[monster('one'),{...monster('two'),slot:2}];
  for(const ref of ['one','two'])room=applyTap(room,{type:'twin.move',actorSeat:0,seat:0,cardRef:ref,zone:'hand',source:'auto'});
  const action=vi.fn();render(<RecentDepartures room={room} seat={0} onAction={action}/>);act(()=>vi.advanceTimersByTime(6000));
  fireEvent.click(screen.getByText('Recent departures (2)'));const rows=screen.getAllByRole('group',{name:/Departure:/});expect(rows).toHaveLength(2);
  fireEvent.click(within(rows[1]).getByRole('button',{name:'GY'}));expect(action).toHaveBeenLastCalledWith(expect.objectContaining({type:'twin.move',cardRef:'one',zone:'graveyard',confirmed:true,cam:expect.objectContaining({by:'player'})}));
  fireEvent.click(within(rows[0]).getByRole('button',{name:'Undo'}));expect(action).toHaveBeenLastCalledWith(expect.objectContaining({type:'undo',targetActionId:'action-2'}));
});

it('uncertainty stays on its zone when ignored, with explicit choices and no automatic acceptance', () => {
  vi.useFakeTimers();const host=document.createElement('div'),field=document.createElement('div');field.dataset.testid='field-0';field.innerHTML='<div data-zone="m2"></div>';document.body.append(host,field);
  const choose=vi.fn(),wrong=vi.fn(),reject=vi.fn();
  try { render(<FieldWatcherUI keepUnresolved zoneSeat={0} host={host} enabled onEnabledChange={()=>{}} statusLabel="Watching" calibrated calibrationDisabled={false} onCalibrate={()=>{}} prompts={[{id:'outline',zone:'M2',title:'Card here?',candidates:[{id:'46986414',label:'Dark Magician'}]}]} pending={false} onChoose={choose} onDismiss={()=>{}} onWrong={wrong} onNotACard={reject}/>);
    fireEvent.click(screen.getByRole('button',{name:'Later'}));expect(screen.getByTestId('field-unresolved')).toHaveTextContent('Unresolved (1)');
    act(()=>vi.advanceTimersByTime(30000));expect(choose).not.toHaveBeenCalled();const badge=screen.getByTestId('zone-uncertainty');expect(field).toContainElement(badge);expect(badge).toHaveAttribute('aria-expanded','false');
    const open=()=>{fireEvent.click(badge);return within(screen.getByTestId('zone-uncertainty-choices'));};
    fireEvent.click(open().getByRole('button',{name:'Wrong card'}));expect(wrong).toHaveBeenCalledWith('outline');expect(screen.queryByTestId('zone-uncertainty-choices')).toBeNull();
    fireEvent.click(open().getByRole('button',{name:'Confirm'}));expect(choose).toHaveBeenCalledWith('outline','46986414');fireEvent.click(open().getByRole('button',{name:'Not a card'}));expect(reject).toHaveBeenCalledWith('outline');
    fireEvent.click(badge);fireEvent.keyDown(screen.getByTestId('zone-uncertainty-choices'),{key:'Escape'});expect(screen.queryByTestId('zone-uncertainty-choices')).toBeNull();expect(badge).toHaveFocus();
  } finally {host.remove();field.remove();}
});


const topCard = { ref:'top', cardId:900001001, name:'Test Xyz', slot:1, faceUp:true, position:'attack' as const };
const summonTop = (): RemoteActionProposal => ({type:'twin.place',actorSeat:0,seat:0,zone:'monster',card:topCard,anotherCopy:true,summon:{kind:'xyz',materialRefs:['paper']}});

it('a shared stack hold survives covered-card removal and a stale reread of the top, including reload', async () => {
  let room=tapRoom();room.state.seats[0].twin=[monster(),{...monster('under'),zone:'material',slot:undefined,materialOf:'paper'}];room.state.seats[0].twin[0].materials=['under'];
  const holds=correctionsFor(room,0);holds.observe([observed()],0);
  let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
  const post=vi.fn(async(a:RemoteActionProposal)=>room=applyTap(room,a));const queue=createRoomMutationQueue(()=>room,post);
  const busy=queue.transaction(async()=>{await gate;});
  const removed=queue.action({type:'twin.remove',source:'auto',actorSeat:0,seat:0,cardRef:'paper'});
  const human=queue.action(summonTop());release();await Promise.all([busy,removed,human]);
  holds.observe([observed({removed:true,resting:false})],100);
  await queue.action({type:'twin.remove',source:'auto',actorSeat:0,seat:0,cardRef:'paper'});
  await queue.action({type:'card.identified',source:'auto',actorSeat:0,seat:0,cardRef:'top',cardId:46986414,name:'Dark Magician'});
  expect(room.state.seats[0].twin.find(c=>c.ref==='top')).toMatchObject({cardId:900001001,materials:['under','paper']});
  expect(room.state.seats[0].twin.filter(c=>c.zone==='material').map(c=>[c.ref,c.materialOf])).toEqual([['paper','top'],['under','top']]);
  expect(post).toHaveBeenCalledTimes(1);
  const stored=Object.keys(sessionStorage).find(key=>key.includes(room.slug))!;
  const reload=createManualCorrections(sessionStorage,stored);
  expect(reload.blocks(['top'])).toBe(true);expect(reload.blocks(['under'])).toBe(true);
});

it.each(['graveyard','banished'] as const)('detaches a material to %s, Undo restores the stack, and the camera cannot redo the detach',async zone=>{
  let room=tapRoom();room.state.seats[0].twin=[monster()];room=applyTap(room,summonTop());
  const queue=createRoomMutationQueue(()=>room,async a=>room=applyTap(room,a));
  await queue.action({type:'twin.detach',actorSeat:0,seat:0,cardRef:'top',materialRef:'paper',zone});
  expect(room.state.seats[0].twin.find(c=>c.ref==='paper')).toMatchObject({zone});
  await queue.action({type:'undo',actorSeat:0,targetActionId:room.state.undo!.actionId});
  await queue.action({type:'twin.detach',actorSeat:0,seat:0,cardRef:'top',materialRef:'paper',zone,cam:{by:'camera',sentAt:1000}});
  expect(room.state.seats[0].twin.find(c=>c.ref==='top')?.materials).toEqual(['paper']);
  expect(room.state.seats[0].twin.find(c=>c.ref==='paper')).toMatchObject({zone:'material',materialOf:'top'});
});

it('a token marker low match cannot name or replace a manual token, and Undo keeps the marker off the board',async()=>{
  let room=tapRoom();const queue=createRoomMutationQueue(()=>room,async a=>room=applyTap(room,a));
  const token:RemoteActionProposal={type:'twin.place',actorSeat:0,seat:0,zone:'monster',card:{ref:'token',name:'Token',slot:3,faceUp:true,position:'defense',token:{atk:0,def:0}}};
  correctionsFor(room,0).observe([observed({id:'marker',ref:'low-match',slot:3,faceDown:true})],0);
  await queue.action(token);
  const low:RemoteActionProposal={type:'twin.place',source:'auto',actorSeat:0,seat:0,zone:'monster',card:{ref:'marker-read',slot:3,faceUp:false,position:'defense'}};
  await queue.action(low);
  expect(room.state.seats[0].twin).toEqual([expect.objectContaining({ref:'token',token:{atk:0,def:0},position:'defense'})]);
  await queue.action({type:'undo',actorSeat:0,targetActionId:room.state.undo!.actionId});await queue.action(low);
  expect(room.state.seats[0].twin).toEqual([]);
});

it('a nameless sleeved Set flips through the picker and shares the normal manual hold',async()=>{
  let room=tapRoom();const queue=createRoomMutationQueue(()=>room,async a=>room=applyTap(room,a));
  await queue.action(zoneSet(room,0,'m3','sleeve'));
  expect(room.state.seats[0].twin).toEqual([{ref:'sleeve',zone:'monster',slot:3,faceUp:false,position:'defense'}]);
  expect(projectRemoteState(room.state,new Set([1])).seats[0].twin[0]).not.toHaveProperty('cardId');
  for(const a of zonePlacement(room,{seat:0,key:'m3',cardId:46986414,name:'Dark Magician',faceUp:true,targetRef:'sleeve'},'unused'))await queue.action(a);
  await queue.action({type:'twin.flip',source:'auto',actorSeat:0,seat:0,cardRef:'sleeve',faceUp:false});
  expect(room.state.seats[0].twin).toEqual([expect.objectContaining({ref:'sleeve',cardId:46986414,faceUp:true,slot:3})]);
  expect(()=>zoneSet(room,1,'m1','foreign')).toThrow(/own active field/);
  expect(()=>zoneSet(room,0,'m3','occupied')).toThrow(/occupied/);
});

it('top placement uses the existing summon model and rejects a zone changed since the tap',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({cards:[{id:900001001,name:'Test Xyz',type:'Warrior / Xyz Monster',frameType:'xyz'}]})));
  await loadCards([900001001]);let room=tapRoom();room.state.seats[0].twin=[monster(),{...monster('second'),slot:2}];
  const pick={seat:0,key:'m1' as const,cardId:900001001,name:'Test Xyz',faceUp:true,top:{ref:'paper',kind:'summon' as const,materialRefs:['paper','second']}};
  for(const a of zonePlacement(room,pick,'top'))room=applyTap(room,a);
  expect(room.state.seats[0].twin.find(c=>c.ref==='top')).toMatchObject({materials:['paper','second'],zone:'monster',slot:1});
  expect(()=>zonePlacement(room,pick,'stale')).toThrow(/zone changed/);
  expect(()=>zoneCardAction(room,'m2',{type:'twin.flip',actorSeat:0,seat:0,cardRef:'top',faceUp:false})).toThrow(/zone changed/);
  expect(()=>zonePlacement(room,{...pick,anotherCopy:true,top:{...pick.top,ref:'top',materialRefs:['paper']}},'wrong')).toThrow(/material/);
  const replace={...pick,top:{ref:'top',kind:'replace' as const},anotherCopy:true};
  for(const a of zonePlacement(room,replace,'replacement'))room=applyTap(room,a);
  expect(room.state.seats[0].twin.find(c=>c.ref==='top')?.zone).toBe('graveyard');
  expect(room.state.seats[0].twin.filter(c=>c.zone==='material')).toEqual([]);
  expect(room.state.seats[0].twin.find(c=>c.ref==='replacement')).toMatchObject({slot:1,zone:'monster'});
});

const outline = (change: Partial<FieldTrack>={}):FieldTrack => ({id:'outline',zone:'M1',state:'candidate',faceDown:false,position:'attack',firstSeen:0,lastSeen:0,visible:true,removed:false,restSince:0,
  card:{quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'face-up',confidence:.9,partial:false},...change});
it('Changed here waits for resting evidence, survives track churn, and clears on recovery or a manual action',()=>{
  const cues=createChangedZones(),held=vi.fn(()=>false),twins=[monster()];
  const see=(tracks:FieldTrack[],now:number)=>cues.observe(tracks,twins,now,id=>id==='known'?'paper':id,held);
  expect(see([outline({restSince:undefined})],0)).toEqual([]);
  expect(see([outline()],100)).toEqual([]);expect(see([outline({id:'next'})],1299)).toEqual([]);
  expect(see([outline({id:'another'})],1300)).toEqual(['M1']);expect(see([],2000)).toEqual(['M1']);
  expect(see([outline({id:'known',state:'identified',cardId:'46986414'})],2100)).toEqual([]);
  const weak=outline({id:'known',state:'identified',cardId:'46986414',setEvidence:{detector:.7,pixel:'unknown',pixelConfidence:.2,sd:10,backDistance:null,positive:false,basis:'none',decision:'waiting'}});
  expect(see([weak],2200)).toEqual([]);expect(see([weak],3400)).toEqual(['M1']);
  held.mockReturnValue(true);expect(see([outline()],3500)).toEqual([]);
  expect(cues.observe([outline()],[],5000,id=>id,held)).toEqual([]);
});

it('own-zone actions offer top placement, both detach destinations, tokens and a nameless Set without changing the board on open',async()=>{
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  const room=tapRoom();room.state.seats[0].twin=[{...monster(),materials:['under']},{...monster('under'),zone:'material',materialOf:'paper',slot:undefined}];
  const action=vi.fn(),token=vi.fn(),set=vi.fn(),pick=vi.fn();
  const props={room,seat:0,zone:'m1' as const,at:{anchor:null,feed:null},deck:[900001001],busy:false,error:'',onPick:pick,onAction:action,onSet:set,onToken:token,onDetails:()=>{},onClose:()=>{}};
  const view=render(<ZoneActions {...props}/>);
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Detach material to banished'}));expect(action).toHaveBeenLastCalledWith(expect.objectContaining({type:'twin.detach',materialRef:'under',zone:'banished',cam:expect.objectContaining({by:'player',ui:'zone-actions'})}));
  fireEvent.click(screen.getByRole('button',{name:'Add token'}));expect(token).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:'Put a card on top'}));
  fireEvent.click(await screen.findByRole('button',{name:'Test Xyz (1)'}));
  fireEvent.click(screen.getByRole('button',{name:'Summon using the card(s) here as material'}));
  expect(pick).toHaveBeenLastCalledWith(expect.objectContaining({top:{ref:'paper',kind:'summon',materialRefs:['paper']}}));
  view.unmount();render(<ZoneActions {...props} zone="m3"/>);
  fireEvent.click(screen.getByRole('button',{name:'Set a card here'}));expect(set).toHaveBeenCalledOnce();
});


it.each(['generic','named'] as const)('the existing token dialog creates a %s token in the chosen Main Monster Zone and position',async kind=>{
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({cards:[{id:900001002,name:'Fixture Token',type:'Token',frameType:'token',atk:100,def:200}]})));
  function Tokens() {
    const [room,setRoom]=useState(tapRoom),current=useRef(room);current.current=room;
    const [queue]=useState(()=>createRoomMutationQueue(()=>current.current,async a=>{const next=applyTap(current.current,a);current.current=next;setRoom(next);return next;}));
    const layers=useLayers();
    const tokens=useTokens({room,act:queue.action,live:true,extraZones:false,layers,info:()=>undefined});
    return <>{tokens.trigger(0)}{tokens.node}<output data-testid="token-board">{JSON.stringify(room.state.seats[0].twin)}</output></>;
  }
  render(<Tokens/>);fireEvent.click(screen.getByRole('button',{name:'Token'}));
  if(kind==='generic'){
    fireEvent.click(screen.getByRole('button',{name:'Generic token'}));fireEvent.click(screen.getByRole('button',{name:'Defense'}));
  }else{
    fireEvent.change(screen.getByTestId('token-search'),{target:{value:'Fixture'}});
    fireEvent.click(await screen.findByRole('button',{name:'Fixture Token · ATK 100 / DEF 200'}));
  }
  fireEvent.change(screen.getByTestId('token-zone'),{target:{value:'m5'}});fireEvent.click(screen.getByRole('button',{name:'Create token'}));
  await act(async()=>{await Promise.resolve();});
  expect(JSON.parse(screen.getByTestId('token-board').textContent!)).toEqual([expect.objectContaining({zone:'monster',slot:5,faceUp:true,position:kind==='generic'?'defense':'attack',token:kind==='generic'?{atk:0,def:0}:{atk:100,def:200,artId:900001002}})]);
});
