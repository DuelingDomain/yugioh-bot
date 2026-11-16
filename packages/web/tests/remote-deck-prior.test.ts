import Database from 'better-sqlite3';
import {afterEach,expect,it,vi} from 'vitest';
import {migrate} from '@yugidraft/shared/db';
import {createRemoteDuelService,createSavedDeckService} from '@yugidraft/shared/services';
import {seedIdentity} from '../../shared/tests/helpers/identity';
import {recognitionPriorsFor} from '../src/lib/remote/recognition-priors';
import {ownFieldResources} from '../src/components/remote/ui/recognizer';

const model=vi.hoisted(()=>({recognize:vi.fn(async(_frames:unknown,_options:unknown)=>({tier:'sure',candidates:[],quality:{},timingsMs:{}})),prepare:vi.fn(async()=>({backend:'wasm'}))}));
vi.mock('@yugidraft/vision',async original=>({...await original<typeof import('@yugidraft/vision')>(),createRecognizer:()=>model}));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});

it('a real registered table sends only my Main, Extra, Side and Deck Master through the local reader mapping',async()=>{
  const db=new Database(':memory:');migrate(db);
  try{
    for(const userId of [101,102])seedIdentity(db,{guildId:'prior',userId,playerId:userId,name:`Player ${userId}`});
    const service=createRemoteDuelService(db,{openingRoll:false}),saved=createSavedDeckService(db,new Map([[201,{name:'Extra fixture',type:0x2001}]]));
    let room=service.create({guildId:'prior',userId:101,displayName:'A',gameId:'ygo',seatCount:2});
    service.join(room.slug,'prior',102,'B');
    const deck={main:Array.from({length:40},(_,i)=>i+1),extra:[201],side:[301],deckMaster:401};
    const mine=saved.create('prior',101,{name:'Mine',mode:'normal',deck});
    const theirs=saved.create('prior',102,{name:'Theirs',mode:'normal',deck:{main:Array(40).fill(901),extra:[],side:[]}});
    service.selectDeck(room.slug,'prior',102,{savedDeckId:theirs.id});
    room=service.selectDeck(room.slug,'prior',101,{savedDeckId:mine.id});
    expect(room.seats[1].deck).toBeUndefined();
    expect(recognitionPriorsFor(room,1).decklist).toEqual([]);
    const expected=[...deck.main,201,301,401];
    expect(recognitionPriorsFor(room,0).decklist).toEqual(expected);
    // Real server snapshots, also through event history, never expose the other seat's registration.
    expect(JSON.stringify(room)).not.toContain('Theirs');
    const other=service.get(room.slug,'prior',102);
    expect(other.seats[0].deck).toBeUndefined();
    expect(recognitionPriorsFor(other,0).decklist).toEqual([]);
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('related-cards.json')?new Response(null,{status:404}):Response.json({entries:expected.map(passcode=>({cardId:`index-${passcode}`,passcode,name:`Card ${passcode}`}))})));
    const resources=await ownFieldResources(()=>recognitionPriorsFor(room,room.mySeat));
    expect(resources).not.toBeNull();
    const priors=resources!.getPriors();
    const frame:ImageData={width:1,height:1,data:new Uint8ClampedArray(4),colorSpace:'srgb'};
    await resources!.recognizer.recognize([frame],{priors});
    expect(model.recognize.mock.calls[0]?.[1]).toMatchObject({priors:{decklist:expected.map(code=>`index-${code}`)}});
    room=service.selectDeck(room.slug,'prior',101,{savedDeckId:null});
    expect(resources!.getPriors().decklist).toEqual([]);
  }finally{db.close();}
});
