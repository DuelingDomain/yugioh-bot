// @vitest-environment jsdom
import React from 'react';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {projectRemoteState,remoteActionSchema} from '@yugidraft/shared/remote';
import {ZoneActions} from '../src/components/remote/ui/zone-actions';
import {zoneCardAction} from '../src/components/remote/ui/zone-placement';
import {HoloField} from '../src/components/remote/ui/holo-field';
import {RecognitionTray} from '../src/components/remote/ui/recognition-tray';
import * as catalog from '../src/components/remote/ui/catalog';
import {liveCardSubject, type Subject} from '../src/components/remote/ui/card-view';
import {tapRoom,applyTap} from './tap-room-fixture';

const choices=[{cardId:46986414,name:'Dark Magician',score:.72},{cardId:89631139,name:'Blue-Eyes White Dragon',score:.55}];
function placed(){return applyTap(tapRoom(),{type:'twin.place',actorSeat:0,seat:0,zone:'monster',source:'auto',card:{ref:'paper',cardId:46986414,name:'Dark Magician',slot:1,faceUp:true,position:'attack',nameCandidates:choices}});}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('a sure off-deck correction starts unselected and lists every unique deck card',()=>{
 const onPick=vi.fn();
 const deckIds=[89631139,11,12,13,14,15,16,16];
 const loadCards=vi.spyOn(catalog,'loadCards');
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({cards:[]})));
 const tray=(ids:number[])=><RecognitionTray tray={{seat:0,ownerName:'Player',status:'guesses',guesses:choices,note:'',reader:'vision',at:{anchor:null,feed:null},tier:'sure',correction:true}} deckIds={ids} inDeck={id=>ids.includes(id)} onPick={onPick} onClose={vi.fn()} saying={false} aiAllowed={false}/>;
 const {rerender}=render(tray(deckIds));
 rerender(tray([...deckIds]));
 expect(loadCards.mock.calls.filter(([,options])=>options?.preload)).toEqual([[deckIds,{preload:true}]]);
 const options=screen.getAllByRole('option');
 expect(options).toHaveLength(8);
 expect(options[0].getAttribute('aria-label')).toContain('Blue-Eyes White Dragon');
 expect(options[6].getAttribute('aria-label')).toContain('Card 16');
 expect(options[7].getAttribute('aria-label')).toContain('Dark Magician');
 expect(screen.queryByRole('option',{selected:true})).toBeNull();
 expect((screen.getByRole('button',{name:'This is it'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.keyDown(document,{key:'Enter'});
 expect(onPick).not.toHaveBeenCalled();
 const search=screen.getByRole('textbox',{name:'Search any card'});
 fireEvent.change(search,{target:{value:'whisker'}});
 fireEvent.keyDown(search,{key:'Enter'});
 expect(onPick).not.toHaveBeenCalled();
 fireEvent.keyDown(document,{key:'ArrowDown'});
 expect(options[0].getAttribute('aria-selected')).toBe('true');
 fireEvent.keyDown(document,{key:'Enter'});
 expect(onPick).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({cardId:89631139,via:'click'}));
 fireEvent.mouseEnter(options[7]);
 fireEvent.keyDown(document,{key:'Enter'});
 expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({cardId:46986414,via:'click'}));
 const updatedDeck=[...deckIds,17];
 rerender(tray(updatedDeck));
 expect(loadCards.mock.calls.filter(([,options])=>options?.preload)).toEqual([[deckIds,{preload:true}],[updatedDeck,{preload:true}]]);
});

it('an open card view gets the renamed identity and drops the old read badges',()=>{
 const room=placed();
 const opened:Subject={from:'camera',seat:0,ref:'paper',cardId:46986414,name:'Dark Magician',tier:'not sure',notInDecklist:true,addErrors:['Old warning'],via:'tracked'};
 const updated=applyTap(room,{type:'card.identified',actorSeat:0,seat:0,cardRef:'paper',cardId:89631139,name:'Blue-Eyes White Dragon',source:'typed'});
 expect(liveCardSubject(opened,updated.state.seats[0].twin[0])).toMatchObject({cardId:89631139,name:'Blue-Eyes White Dragon',tier:undefined,notInDecklist:null,addErrors:[]});
 expect(liveCardSubject(opened,undefined)).toBeNull();
});

it('an open camera view keeps its name when its face-down twin has no public code',()=>{
 const opened:Subject={from:'camera',seat:0,ref:'paper',cardId:46986414,name:'Dark Magician',notInDecklist:null,addErrors:[],via:'tracked',revealed:true};
 const card={ref:'paper',zone:'monster',slot:1,faceUp:false,position:'defense' as const};
 expect(liveCardSubject(opened,card)).toEqual({...opened,revealed:false});
});

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
