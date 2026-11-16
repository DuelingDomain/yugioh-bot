// @vitest-environment jsdom
import React from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {projectRemoteState,remoteActionSchema} from '@yugidraft/shared/remote';
import {ZoneActions} from '../src/components/remote/ui/zone-actions';
import {zoneCardAction} from '../src/components/remote/ui/zone-placement';
import {HoloField} from '../src/components/remote/ui/holo-field';
import {tapRoom,applyTap} from './tap-room-fixture';

const choices=[{cardId:46986414,name:'Dark Magician',score:.72},{cardId:89631139,name:'Blue-Eyes White Dragon',score:.55}];
function placed(){return applyTap(tapRoom(),{type:'twin.place',actorSeat:0,seat:0,zone:'monster',source:'auto',card:{ref:'paper',cardId:46986414,name:'Dark Magician',slot:1,faceUp:true,position:'attack',nameCandidates:choices}});}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

it('an unsure name and choices reach both seats; a sure correction is one undoable identification on the same ref',()=>{
 let room=placed();
 const other=projectRemoteState(room.state,new Set([1]));
 expect(other.seats[0].twin[0].nameCandidates).toEqual(choices);
 const proposal=remoteActionSchema.parse({type:'card.identified',idempotencyKey:'sure',actorSeat:0,seat:0,cardRef:'paper',cardId:89631139,name:'Blue-Eyes White Dragon',source:'auto',nameCandidates:null});
 room=applyTap(room,proposal);
 expect(room.state.seats[0].twin).toHaveLength(1);
 expect(room.state.seats[0].twin[0]).toMatchObject({ref:'paper',cardId:89631139});
 expect(room.state.seats[0].twin[0].nameCandidates).toBeUndefined();
 expect(room.state.undoHistory?.filter(h=>!h.undone).map(h=>h.action.type)).toEqual(['twin.place','card.identified']);
 room=applyTap(room,{type:'undo',actorSeat:0,targetActionId:room.state.undo!.actionId});
 expect(room.state.seats[0].twin[0]).toMatchObject({ref:'paper',cardId:46986414,nameCandidates:choices});
});

it('the existing tap popup offers one-tap candidate names and refuses a stale choice',()=>{
 const room=placed(),onAction=vi.fn();
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({cards:[]})));
 render(<ZoneActions room={room} seat={0} zone="m1" at={{anchor:null,feed:null}} deck={[]} busy={false} error="" onPick={vi.fn()} onAction={onAction} onSet={vi.fn()} onToken={vi.fn()} onDetails={vi.fn()} onClose={vi.fn()}/>);
 fireEvent.click(within(screen.getByRole('region',{name:'Unsure name'})).getByRole('button',{name:'Blue-Eyes White Dragon'}));
 const proposal=onAction.mock.calls[0][0];
 expect(zoneCardAction(room,'m1',proposal)).toMatchObject({type:'card.identified',cardRef:'paper',cardId:89631139,source:'click',cam:{by:'player'}});
 const corrected=applyTap(room,proposal);
 expect(corrected.state.seats[0].twin[0].nameCandidates).toBeUndefined();
 expect(()=>zoneCardAction(corrected,'m1',proposal)).toThrow('name changed');
});

it('both field views show the same small unsure mark and accessible status',()=>{
 const room=placed(),card=room.state.seats[0].twin;
 for(const seat of [0,1])render(<HoloField seat={seat} name={`Player ${seat}`} twin={card} info={()=>undefined} rv="m1" onRv={vi.fn()} picking={false} warnRefs={new Set()} onActivate={vi.fn()} onAttack={vi.fn()} onInspect={vi.fn()}/>);
 expect(screen.getAllByTestId('unsure-name')).toHaveLength(2);
 expect(screen.getAllByRole('button',{name:/Unsure card name/})).toHaveLength(2);
});

it('setting an unsure card clears the old front candidates before another reveal',()=>{
 const room=applyTap(placed(),{type:'twin.flip',actorSeat:0,seat:0,cardRef:'paper',faceUp:false,source:'auto'});
 expect(room.state.seats[0].twin[0].nameCandidates).toBeUndefined();
 expect(projectRemoteState(room.state,new Set([1])).seats[0].twin[0].nameCandidates).toBeUndefined();
});
