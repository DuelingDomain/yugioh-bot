import {expect,test,vi} from 'vitest';
import type {FieldTrack,FieldZone} from '@yugidraft/vision';
import type {TwinCard} from '@yugidraft/shared/remote';
import {createQuietCheck,quietCheckEnabled,QUIET_CHECK_STORAGE_KEY,type QuietInput} from '../src/lib/remote/quiet-check';

const track=(id:string,zone:FieldZone,faceDown=false):FieldTrack=>({id,zone,faceDown,state:'identified',removed:false,visible:true,firstSeen:0,lastSeen:9000,position:'attack',cardId:'1',card:{} as FieldTrack['card']});
const twin=(ref:string,slot:number,faceUp=true):TwinCard=>({ref,zone:'monster',slot,faceUp,position:'attack'} as TwinCard);
const zoneOf=(c:TwinCard)=>`M${c.slot}` as FieldZone;
const base=(over:Partial<QuietInput>):QuietInput=>({now:10_000,tracks:[],twins:[],activityAt:{},lastFullAt:9_900,missing:[],refOf:id=>id,zoneOf,held:()=>false,isPile:z=>['GY','BANISHED','DECK','EXTRA'].includes(z),skipTrack:()=>false,skipCard:()=>false,scanAllowed:true,busy:false,...over});

test('quiet check re-reads only zones that moved, yields to reads and motion, skips piles, fixes a sure gap once and hints otherwise',()=>{
  // On by default; localStorage 0 is the kill switch.
  expect(quietCheckEnabled()).toBe(true);
  const store=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null});store.set(QUIET_CHECK_STORAGE_KEY,'0');
  expect(quietCheckEnabled()).toBe(false);vi.unstubAllGlobals();
  const quiet=createQuietCheck();
  const tracks=[track('a','M1'),track('b','M2')];
  const board=[twin('a',1)]; // b: the camera sees a card in M2, the board has none
  const act={M1:1000,M2:1000};
  // Owner read running, or a hand or motion anywhere: nothing happens, no state moves.
  expect(quiet.check(base({tracks,twins:board,activityAt:act,busy:true})).verdict).toBe('wait');
  expect(quiet.check(base({tracks,twins:board,activityAt:act,handZones:['M4']})).verdict).toBe('wait');
  expect(quiet.check(base({tracks,twins:board,activityAt:act,lastMotionAt:8_000})).verdict).toBe('wait');
  expect(quiet.check(base({tracks,twins:board,activityAt:act,fieldActive:true})).verdict).toBe('wait');
  // A pile track (GY) never makes a gap, however long it stays.
  expect(quiet.check(base({tracks:[track('g','GY' as FieldZone)],twins:[],activityAt:{GY:1000}}))).toMatchObject({verdict:'idle',gaps:[],inspected:[]});
  // First look: M1 agrees (confirmed), M2 differs for the first time: only a hint.
  let r=quiet.check(base({now:12_000,lastFullAt:11_900,tracks,twins:board,activityAt:act}));
  expect(r).toMatchObject({verdict:'hint',inspected:['M1','M2']});
  expect(r.gaps).toEqual([{zone:'M2',kind:'extra',ref:'b'}]);
  expect(quiet.confirmedAt().has('M1')).toBe(true);
  // Second look, no new motion: sure, and M1 is skipped by the diff gate. While the 20 s auto scan limit holds, it stays a hint and is not spent.
  expect(quiet.check(base({now:13_900,lastFullAt:13_800,tracks,twins:board,activityAt:act,scanAllowed:false})).verdict).toBe('hint');
  r=quiet.check(base({now:15_800,lastFullAt:15_700,tracks,twins:board,activityAt:act}));
  expect(r).toMatchObject({verdict:'fix',inspected:['M2'],skipped:1});
  // The caller really started the scan; it could not fix it and nothing moved: hint only, never a second scan.
  quiet.scanned();
  expect(quiet.check(base({now:17_700,lastFullAt:17_600,tracks,twins:board,activityAt:act})).verdict).toBe('hint');
  // A face gap is a hint only, even when it stays.
  const faceQuiet=createQuietCheck(),flipped=[twin('a',1),twin('b',2,true)],backs=[track('a','M1'),track('b','M2',true)];
  faceQuiet.check(base({now:12_000,lastFullAt:11_900,tracks:backs,twins:flipped,activityAt:act}));
  expect(faceQuiet.check(base({now:13_900,lastFullAt:13_800,tracks:backs,twins:flipped,activityAt:act})).verdict).toBe('hint');
  // The board now agrees: the zone is confirmed and the next check has nothing to look at.
  const agree=[twin('a',1),twin('b',2)];
  expect(quiet.check(base({now:19_600,lastFullAt:19_500,tracks,twins:agree,activityAt:act}))).toMatchObject({verdict:'idle',inspected:['M2']});
  expect(quiet.check(base({now:21_500,lastFullAt:21_400,tracks,twins:agree,activityAt:act}))).toMatchObject({verdict:'idle',inspected:[],skipped:2});
  // A card still moving is left to the tracker; a stale full pass waits.
  expect(quiet.check(base({now:23_400,lastFullAt:23_300,tracks,twins:board,activityAt:{M2:23_000}})).inspected).toEqual([]);
  expect(quiet.check(base({now:27_000,lastFullAt:23_300,tracks,twins:board,activityAt:{M2:23_000}})).verdict).toBe('wait');
});
