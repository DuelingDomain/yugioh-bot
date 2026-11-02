import {test} from 'node:test';import assert from 'node:assert/strict';
import {MotionGate} from './efficient';
test('motion gate skips static pixels and forces periodic full sweeps',()=>{
  const g=new MotionGate(),pixels=new Uint8ClampedArray(16).fill(80);
  assert.equal(g.inspect(pixels,2,2,0).run,true);assert.equal(g.inspect(pixels,2,2,100).run,false);
  const change=new Uint8ClampedArray(pixels);change[0]=255;assert.equal(g.inspect(change,2,2,200).run,true);
  assert.equal(g.inspect(change,2,2,1900).full,true);
});
