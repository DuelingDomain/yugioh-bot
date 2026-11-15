import {expect, test} from 'vitest';
import {SIDEWAYS_NAME_MIN, weakSidewaysRead} from '../../vision/src/field-watcher';
import type {RecognitionResult} from '../../vision/src/types';

const read=(score:number,tier:RecognitionResult['tier']='sure',faceDown=false)=>({tier,candidates:[{cardId:'a',score},{cardId:'b',score:score-.15}],quality:{faceDown}}) as unknown as RecognitionResult;

test('a sideways read below the sideways limit is asked, not named',()=>{
  expect(SIDEWAYS_NAME_MIN).toBe(.77);
  // The holo Xyz under glare that matched a wrong card.
  expect(weakSidewaysRead(read(.748),'defense')).toBe(true);
  // The same card one frame later.
  expect(weakSidewaysRead(read(.7503),'defense')).toBe(true);
  expect(weakSidewaysRead(read(.745,'not sure'),'defense')).toBe(true);
});

test('upright reads and sideways reads at the limit or above keep their names',()=>{
  expect(weakSidewaysRead(read(.748),'attack')).toBe(false);
  expect(weakSidewaysRead(read(.719),'attack')).toBe(false);
  expect(weakSidewaysRead(read(.77),'defense')).toBe(false);
  expect(weakSidewaysRead(read(.776),'defense')).toBe(false);
  expect(weakSidewaysRead(read(.793,'not sure'),'defense')).toBe(false);
});

test('a low match, a face-down read and a missing read are left to their own rules',()=>{
  expect(weakSidewaysRead(read(.6,'low match'),'defense')).toBe(false);
  expect(weakSidewaysRead(read(.75,'sure',true),'defense')).toBe(false);
  expect(weakSidewaysRead(undefined,'defense')).toBe(false);
});
