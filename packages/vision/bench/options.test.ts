import {test} from 'node:test';import assert from 'node:assert/strict';
import {SessionTracker} from './tracker';import {MotionGate} from './efficient';
test('two-stage tracker keeps appearance across a move and abstains on identical-copy re-ID',()=>{
  const t=new SessionTracker(),a={box:{x:.1,y:.2,w:.1,h:.2},confidence:.9,appearance:[1,0,0],embedding:[1,0]};
  const first=t.update([a],0)[0];t.identify(first.id,'one',[1,0]);
  assert.equal(t.update([{...a,box:{...a.box,x:.55}}],500)[0].id,first.id);
  assert.equal(t.update([{...a,confidence:.5,box:{...a.box,x:.56}}],700)[0].id,first.id);
  const copies=new SessionTracker();const both=copies.update([a,{...a,box:{...a.box,x:.7}}],0);both.forEach(c=>copies.identify(c.id,'same',[1,0]));
  const uncertain=copies.update([{...a,box:{...a.box,x:.4}}],1000)[0];assert.equal(uncertain.cardId,undefined);
});
test('motion gate skips static pixels and forces periodic full sweeps',()=>{
  const g=new MotionGate(),pixels=new Uint8ClampedArray(16).fill(80);
  assert.equal(g.inspect(pixels,2,2,0).run,true);assert.equal(g.inspect(pixels,2,2,100).run,false);
  const change=new Uint8ClampedArray(pixels);change[0]=255;assert.equal(g.inspect(change,2,2,200).run,true);
  assert.equal(g.inspect(change,2,2,1900).full,true);
});
