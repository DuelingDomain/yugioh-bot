import { expect, it } from 'vitest';
import { ygoModule, remoteActionSchema } from '@yugidraft/shared/remote';
import { fieldStackCovers, fieldStackUnder } from '../../vision/src/field-stack-memory';
import type { FieldTrack, DetectedQuad } from '@yugidraft/vision';
import { fieldKeepsMonsterStack, fieldStackXyzCandidates, fieldSummonKind, fieldSummonMaterials } from '../src/lib/remote/field-summons';
import { fieldPlacementProposals } from '../src/lib/remote/field-proposals';

const box = (x: number): DetectedQuad => ({quad:[{x,y:.35},{x:x+.1,y:.35},{x:x+.1,y:.5},{x,y:.5}],kind:'face-up',confidence:.95,partial:false});
const track = (id: string, zone: FieldTrack['zone'], x: number, cardId?: string): FieldTrack => ({
  id,zone,card:box(x),cardId,position:'attack',faceDown:false,state:cardId?'identified':'candidate',firstSeen:0,lastSeen:1000,removed:false,
});

it.each([false,true])('one atomic Xyz placement keeps ordered known materials, including a returning preview (%s)', preview => {
  let state=ygoModule.initialState({seatCount:2}),serial=0;
  const act=(proposal:unknown)=>{state=ygoModule.reduce(state,remoteActionSchema.parse({...Object(proposal),at:10000,idempotencyKey:`stack-${++serial}`}));};
  const p=track('p','M3',.4,'1'),q=track('q','M4',.54,'2'),x=track('x','M3',.4);
  for(const t of [p,q])for(const proposal of fieldPlacementProposals({track:t,seat:0,cardId:Number(t.cardId)}))act(proposal);
  if(preview)act({type:'twin.place',actorSeat:0,seat:0,zone:'hand',card:{ref:'x',cardId:3,faceUp:true}});
  x.firstSeen=1100;
  const tracks=[p,q,x],evidence={tracks,outlines:new Map([['x',x.card]]),confirmed:new Set(['p','q']),settled:()=>true,held:()=>false,empty:(t:FieldTrack)=>t.id==='q',at:1500};
  const applyCovers=()=>{for(const [id,top]of fieldStackCovers(evidence).covers){const t=tracks.find(t=>t.id===id);if(t)t.under=top;}};
  applyCovers();
  const twins=state.seats[0].twin;
  expect(fieldKeepsMonsterStack(twins[1],twins[0])).toBe(true);
  // The top read arrives well after the summon window. A still-observed physical stack keeps its refs.
  evidence.at=18000;applyCovers();x.cardId='3';x.state='identified';
  const type=fieldSummonKind({type:'Xyz Effect Monster',level:4});expect(type?.kind).toBe('xyz');
  const materialRefs=fieldSummonMaterials({kind:'xyz',covered:fieldStackUnder('x',tracks),vanished:[],firstSeen:x.firstSeen,twins,removed:()=>false,now:18000});
  expect(materialRefs).toEqual(['p','q']);
  for(const proposal of fieldPlacementProposals({track:x,seat:0,cardId:3,fromRef:preview?'x':undefined,summon:{kind:'xyz',materialRefs:materialRefs??[]}}))act(proposal);
  expect(state.seats[0].twin.map(c=>[c.ref,c.zone,c.materialOf,c.materials])).toEqual([
    ['p','material','x',undefined],['q','material','x',undefined],['x','monster',undefined,['p','q']],
  ]);
});

it('an unread stack asks with only the known Extra Deck Xyz of matching rank first; missing facts abstain',()=>{
  const materials=[
    {ref:'p',cardId:1,zone:'monster',slot:3,faceUp:true,position:'attack' as const},
    {ref:'q',cardId:2,zone:'monster',slot:4,faceUp:true,position:'attack' as const},
  ];
  const catalog=new Map([
    [1,{type:'Effect Monster',level:4}],[2,{type:'Effect Monster',level:4}],
    [3,{type:'Xyz Effect Monster',level:4}],[4,{type:'Xyz Effect Monster',level:7}],
    [5,{type:'Synchro Effect Monster',level:4}],[6,{type:'Xyz Effect Monster',level:4}],
  ]);
  const facts=(id:number|undefined)=>id===undefined?undefined:catalog.get(id);
  expect(fieldStackXyzCandidates({materials,extra:[3,4,5],facts})).toEqual([3]);
  expect(fieldStackXyzCandidates({materials,extra:[],facts})).toEqual([]);
  expect(fieldStackXyzCandidates({materials,extra:[3],facts:()=>undefined})).toEqual([]);
  expect(fieldStackXyzCandidates({materials:[materials[0]],extra:[3],facts})).toEqual([]);
  catalog.set(2,{type:'Effect Monster',level:7});
  expect(fieldStackXyzCandidates({materials,extra:[3,4],facts})).toEqual([]);
});

