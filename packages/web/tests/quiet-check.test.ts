import {expect,test} from 'vitest';
import type {FieldTrack,FieldZone} from '@yugidraft/vision';
import type {TwinCard} from '@yugidraft/shared/remote';
import {createQuietCheck,type QuietInput} from '../src/lib/remote/quiet-check';

const track=(id:string,zone:FieldZone,faceDown=false):FieldTrack=>({id,zone,faceDown,state:'identified',removed:false,visible:true,firstSeen:0,lastSeen:9000,position:'attack',cardId:'1',card:{} as FieldTrack['card']});
const twin=(ref:string,slot:number,faceUp=true):TwinCard=>({ref,zone:'monster',slot,faceUp,position:'attack'} as TwinCard);
const zoneOf=(c:TwinCard)=>`M${c.slot}` as FieldZone;
const base=(over:Partial<QuietInput>):QuietInput=>({now:10_000,tracks:[],twins:[],activityAt:{},lastFullAt:9_900,missing:[],refOf:id=>id,zoneOf,held:()=>false,busy:false,...over});

test('quiet check re-reads only zones that moved, yields to owner reads, fixes a sure gap once and hints otherwise',()=>{
  const quiet=createQuietCheck();
  const tracks=[track('a','M1'),track('b','M2',true)];
  const board=[twin('a',1),twin('b',2,true)]; // b: camera sees a back, board says face up
  // Owner read running: nothing happens, no state moves.
  expect(quiet.check(base({tracks,twins:board,activityAt:{M1:1000,M2:1000},busy:true})).verdict).toBe('wait');
  // First look: M1 agrees (confirmed), M2 differs for the first time: only a hint.
  let r=quiet.check(base({tracks,twins:board,activityAt:{M1:1000,M2:1000}}));
  expect(r).toMatchObject({verdict:'hint',inspected:['M1','M2']});
  expect(r.gaps).toEqual([{zone:'M2',kind:'face',ref:'b'}]);
  expect(quiet.confirmedAt().has('M1')).toBe(true);
  // Second look, no new motion: the gap is sure and M1 is skipped by the diff gate (no pixel change since it was confirmed).
  r=quiet.check(base({now:12_100,lastFullAt:12_000,tracks,twins:board,activityAt:{M1:1000,M2:1000}}));
  expect(r).toMatchObject({verdict:'fix',inspected:['M2'],skipped:1});
  // The scan could not fix it and nothing moved: hint only, never a second scan.
  r=quiet.check(base({now:14_200,lastFullAt:14_100,tracks,twins:board,activityAt:{M1:1000,M2:1000}}));
  expect(r.verdict).toBe('hint');
  // The board now agrees: the zone is confirmed and the next check has nothing to look at.
  r=quiet.check(base({now:16_300,lastFullAt:16_200,tracks,twins:[twin('a',1),twin('b',2,false)],activityAt:{M1:1000,M2:1000}}));
  expect(r).toMatchObject({verdict:'idle',inspected:['M2']});
  expect(quiet.check(base({now:18_400,lastFullAt:18_300,tracks,twins:[twin('a',1),twin('b',2,false)],activityAt:{M1:1000,M2:1000}}))).toMatchObject({verdict:'idle',inspected:[],skipped:2});
  // A card still moving is left to the tracker; a stale full pass waits.
  expect(quiet.check(base({now:20_500,lastFullAt:20_400,tracks,twins:board,activityAt:{M2:20_000}})).inspected).toEqual([]);
  expect(quiet.check(base({now:24_000,lastFullAt:20_400,tracks,twins:board,activityAt:{M2:20_000}})).verdict).toBe('wait');
});
