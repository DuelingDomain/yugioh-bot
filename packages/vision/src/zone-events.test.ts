import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldWatcher, type FieldEvent } from './field-watcher';
import { yugioh } from './games/yugioh';
import { createFieldCalibration } from './field-zones';
import { createZoneWatch, zoneSpecsFromCalibration, type GrayFrame } from './zone-events';
import { classifyZone, estimateMat, zoneCrop } from './zone-state';
import { createPreviewBoard, decodePreview, encodePreview, previewForZone } from './zone-peer';
import type { RGBAImage } from './pixels';

const W = 640, H = 360;
// A card front: dark border, art, text box, frame colour (same look as the face-state test).
const front = (x: number, y: number) => {
  if (x < .06 || x > .94 || y < .04 || y > .96) return [25, 25, 25];
  if (x > .12 && x < .88 && y > .18 && y < .70) return [60 + 140 * x, 40 + 130 * y, 70 + 80 * Math.sin(35 * x) * Math.cos(30 * y)];
  if (x > .10 && x < .90 && y > .76 && y < .92) return y % .035 < .012 ? [65, 55, 45] : [220, 210, 180];
  return [35, 145, 120];
};

test('a card lands in one zone: watch settles, classifier names it, preview is private and server-reconciled', async () => {
  const calibration = createFieldCalibration([{ x: .05, y: .05 }, { x: .95, y: .95 }]);
  const specs = zoneSpecsFromCalibration(calibration);
  const m3 = specs.find(s => s.id === 'M3')!, m1 = specs.find(s => s.id === 'M1')!;
  const box = (q: typeof m3.quad) => ({ x0: Math.min(...q.map(p => p.x)) * W, x1: Math.max(...q.map(p => p.x)) * W, y0: Math.min(...q.map(p => p.y)) * H, y1: Math.max(...q.map(p => p.y)) * H });
  const b3 = box(m3.quad), b1 = box(m1.quad);
  // Draw a frame: dark mat, an optional card in M3 and an optional skin-coloured block over M1 (a passing hand).
  const draw = (card: boolean, hand: boolean, gain = 0): RGBAImage => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let rgb = [30 + gain, 30 + gain, 36 + gain];
      if (card && x > b3.x0 + 8 && x < b3.x1 - 8 && y > b3.y0 + 4 && y < b3.y1 - 4) rgb = front((x - b3.x0 - 8) / (b3.x1 - b3.x0 - 16), (y - b3.y0 - 4) / (b3.y1 - b3.y0 - 8)).map(v => v + gain);
      if (hand && x > b1.x0 - 20 && x < b1.x1 + 20 && y > b1.y0 && y < b1.y1) rgb = [200 + gain, 140 + gain, 110 + gain];
      data.set([...rgb, 255], (y * W + x) * 4);
    }
    return { width: W, height: H, data };
  };
  const gray = (image: RGBAImage): GrayFrame => {
    const data = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) data[i] = (image.data[i * 4] * 77 + image.data[i * 4 + 1] * 150 + image.data[i * 4 + 2] * 29) >> 8;
    return { width: W, height: H, data };
  };

  const watch = createZoneWatch(specs, { width: W, height: H }, { idleIntervalMs: 33 });
  const events: ReturnType<typeof watch.push> = [];
  let t = 0, cardAt = 0, lastRgba = draw(false, false);
  const step = (card: boolean, hand: boolean, gain = 0) => { lastRgba = draw(card, hand, gain); events.push(...watch.push(gray(lastRgba), t)); t += 33; };
  for (let i = 0; i < 6; i++) step(false, false);
  for (let i = 0; i < 3; i++) step(false, true);          // a hand passes over M1 and leaves
  for (let i = 0; i < 6; i++) step(false, false, 3);      // light drifts a little: not a change
  cardAt = t;
  for (let i = 0; i < 12; i++) step(true, false, 3);      // a card is in M3 and stays

  const settled = events.filter(e => e.type === 'settle');
  const m3Settle = settled.find(e => e.zone === 'M3')!;
  assert.ok(m3Settle?.type === 'settle' && m3Settle.changed, 'M3 settles as changed');
  assert.ok(m3Settle.emittedAt - cardAt <= 260, `M3 settle fires within 260 ms of the card (got ${m3Settle.emittedAt - cardAt})`);
  const m1Settle = settled.find(e => e.zone === 'M1');
  assert.ok(!m1Settle || (m1Settle.type === 'settle' && !m1Settle.changed), 'a hand that left is not a change');
  assert.deepEqual([...new Set(settled.filter(e => e.type === 'settle' && e.changed).map(e => e.zone))], ['M3'], 'no other zone reports a change');

  // Classify the settled zone.
  const crops = specs.map(s => zoneCrop(lastRgba, s.quad)!);
  const mat = estimateMat(crops);
  const state = classifyZone(crops[specs.indexOf(m3)], mat);
  assert.equal(state.kind, 'face-up');
  assert.equal(classifyZone(crops[specs.indexOf(m1)], mat).kind, 'empty');

  // The preview: face up carries the name, face down never does, a hand is never sent.
  const up = previewForZone(0, 1, 'M3', state.kind, { cardId: 46986414, name: 'Dark Magician' })!;
  assert.equal(up.name, 'Dark Magician');
  assert.equal(previewForZone(0, 2, 'M3', 'face-down', { cardId: 46986414, name: 'Dark Magician' })!.cardId, undefined);
  assert.equal(previewForZone(0, 3, 'M3', 'hand'), null);
  assert.equal(previewForZone(0, 4, 'HAND', 'face-up'), null);
  // A packet is only taken from its own seat, and a forged identity on a face-down card is dropped.
  assert.equal(decodePreview(encodePreview(up), 1), null);
  const forged = encodePreview({ ...up, kind: 'face-down' });
  assert.equal(decodePreview(forged, 0)!.name, undefined);

  // Reconcile with the server: confirm clears the preview, a silent one rolls back.
  const board = createPreviewBoard({ ttlMs: 3000 });
  assert.ok(board.apply(up, 1000));
  assert.equal(board.view().length, 1);
  assert.equal(board.confirm(0, 'M3', 'face-up'), true);
  assert.equal(board.view().length, 0);
  board.apply({ ...up, seq: 5 }, 2000);
  assert.equal(board.apply({ ...up, seq: 4 }, 2100), false, 'a stale preview is ignored');
  assert.deepEqual(board.expire(2500), []);
  assert.equal(board.expire(5001).length, 1, 'no server event in 3 s rolls the preview back');

  const eventsFromWatcher:FieldEvent[]=[];
  t=0;lastRgba=draw(false,false);
  const watcher=createFieldWatcher({
    profile:yugioh,calibration,now:()=>t,hidden:()=>false,clone:async frame=>frame,
    zoneInstant:{tier:{name:'cpu4',idleIntervalMs:33,settleMs:120,budget:1,preRead:false,maxPreReads:0}},
    buffer:{gray:()=>gray(lastRgba),sample:async()=>({frame:lastRgba as unknown as ImageData,at:t})},
    recognizer:{
      detectCards:async()=>[],
      recognize:async()=>({candidates:[{cardId:'A',score:.98}],tier:'sure',quality:{
        detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false,
      },timingsMs:{sharpness:0,detect:0,warp:0,embed:0,search:0,total:0},backend:'wasm'}),
    },
  });
  watcher.subscribe(event=>eventsFromWatcher.push(event));
  try{
    for(let i=0;i<18;i++){
      t+=33;lastRgba=draw(i>=5,false);
      watcher.pushZoneFrame(gray(lastRgba),t);
      await new Promise<void>(resolve=>setImmediate(resolve));
    }
    assert.equal(watcher.zoneInstantStats()?.delivered,1);
    assert.equal(watcher.getSnapshot().instantPreviews?.[0]?.cardId,'A','shows the name before a detector pass');
    assert.deepEqual(eventsFromWatcher,[]);
    t+=100;
    await watcher.tick();
    assert.equal(watcher.getSnapshot().instantPreviews?.length??0,0,'a detector miss rolls it back');
    assert.deepEqual(eventsFromWatcher,[],'rollback never posts a board event');
  }finally{watcher.dispose();}

});
