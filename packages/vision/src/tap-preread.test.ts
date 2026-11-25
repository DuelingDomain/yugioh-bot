import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createRecognizer } from './client';
import { createTapPreread } from './tap-preread';
import { createFieldCalibration, DEFAULT_FIELD_ORIENTATION, fieldMatPoint, fieldZoneCells } from './field-zones';
import type { DetectedQuad } from './types';

test('Tap prereads only settled public fronts and drops a cached name when the card changes', () => {
  const corners = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const calibration = createFieldCalibration(corners, DEFAULT_FIELD_ORIENTATION);
  const cells = fieldZoneCells();
  const outline = (zone: string): DetectedQuad => {
    const {x,y,w,h} = cells.find(cell => cell.zone === zone)!;
    const quad = [{x:x+.125*w,y:y+.125*h},{x:x+.875*w,y:y+.125*h},{x:x+.875*w,y:y+.875*h},{x:x+.125*w,y:y+.875*h}];
    return {quad:quad.map(point => fieldMatPoint(point, calibration)), kind:'face-up', confidence:.95, partial:false};
  };
  const card = outline('M3'), deck = outline('DECK');
  const look = Array.from({length:288}, (_, i) => i % 2 ? .7 : .2);
  const clean = {appearance:() => look, motion:() => 0, sharpness:() => 50};
  const coveredPixels = {...clean, appearance:() => look.map(() => .4)};
  const covered = {...coveredPixels, touched:() => .1};
  const tracker = createTapPreread(calibration, 'normal');
  const point = {x:(card.quad[0].x+card.quad[2].x)/2,y:(card.quad[0].y+card.quad[2].y)/2};

  tracker.sample(covered, 0, [card, deck]);
  tracker.sample(covered, 180);
  assert.equal(tracker.next(), undefined);
  tracker.sample(coveredPixels, 260, [card, deck]);
  assert.equal(tracker.next(), undefined);
  tracker.sample(clean, 300, [card, deck]);
  assert.equal(tracker.next(), undefined);
  tracker.sample(clean, 480);
  const front = tracker.next()!;
  assert.deepEqual(front.card, card);
  tracker.finish(front, {cardId:42,name:'Card'});
  tracker.sample(clean, 500, [{...card}, deck]);
  assert.equal(tracker.next(), undefined);
  assert.equal(tracker.hit(point, clean)?.identity?.cardId, 42);
  assert.equal(tracker.hit(point, covered), undefined);
  assert.equal(tracker.hit(point, coveredPixels), undefined);

  tracker.sample(clean, 600, [{...card,kind:'face-down'}, deck]);
  assert.equal(tracker.hit(point, clean), undefined);
  assert.equal(tracker.next(), undefined);
  tracker.sample(clean, 720, [card, deck]);
  tracker.sample(clean, 900);
  assert.equal(tracker.next()?.identity, undefined);
  assert.notEqual(tracker.next(), front);

  const discovery = createTapPreread(calibration, 'normal');
  const scene = (moving: number, sinceMark: number) => ({ ...clean, scene: { moving, sinceMark, mark() {} } });
  assert.equal(discovery.sample(scene(20, 20), 0), false);
  assert.equal(discovery.sample(scene(1, 20), 350), false);
  assert.equal(discovery.sample(scene(0, 20), 700), true);
  assert.equal(discovery.sample(scene(0, 0), 3000), false);
  assert.equal(discovery.sample(scene(15, 15), 3350), false);
  assert.equal(discovery.sample(scene(10, 16), 3700), false);
  assert.equal(discovery.sample(scene(0, 16), 4050), false);
  assert.equal(discovery.sample(scene(0, 16), 4400), true);
});

function mockReader(t: TestContext) {
  const original = globalThis.Worker;
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: {data: unknown}) => void;
    messages: {id: number; type: string}[] = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(message: {id: number; type: string}) { this.messages.push(message); }
    reply(type: string, result: unknown) {
      const message = this.messages.at(-1);
      assert.ok(message?.type === type, `Expected a ${type} request`);
      this.onmessage?.({data: {id: message.id, result}});
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const reader = createRecognizer({workers: 'single', backend: 'wasm'});
  t.mock.timers.enable({apis: ['setTimeout']});
  t.after(() => { reader.dispose(); globalThis.Worker = original; });
  return {reader, workers};
}

const frame = {width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4)} as ImageData;
const card: DetectedQuad = {
  quad: [{x: .1, y: .1}, {x: .4, y: .1}, {x: .4, y: .5}, {x: .1, y: .5}],
  kind: 'face-up', confidence: .95, partial: false,
};
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('Cancelling a background scan during startup preserves the worker for a foreground scan', async t => {
  const {reader, workers} = mockReader(t);
  const stop = new AbortController();
  const scan = reader.detectCards(frame, {background: true}, stop.signal);
  const cancelled = assert.rejects(scan, {name: 'AbortError'});
  await flush();
  const [worker] = workers;
  stop.abort();
  assert.equal(worker.terminated, false);
  worker.reply('init', null);
  await cancelled;
  assert.deepEqual(worker.messages.map(message => message.type), ['init']);

  const foreground = reader.detectCards(frame);
  await flush();
  worker.reply('detect', [card]);
  assert.deepEqual(await foreground, [card]);
  assert.equal(workers.length, 1);
});

test('Cancelling background inference drops its result at the worker boundary', async t => {
  const {reader, workers} = mockReader(t);
  const stop = new AbortController();
  const scan = reader.detectCards(frame, {background: true}, stop.signal);
  const cancelled = assert.rejects(scan, {name: 'AbortError'});
  await flush();
  const [worker] = workers;
  worker.reply('init', null);
  await flush();
  assert.equal(worker.messages.at(-1)?.type, 'detect');
  stop.abort();
  worker.reply('detect', [card]);
  await cancelled;
  assert.equal(worker.terminated, false);
});

test('A cold background peek has a full inference budget after detector and reader startup', async t => {
  const {reader, workers} = mockReader(t);
  const peek = reader.peek(frame, {card, background: true});
  await flush();
  const [worker] = workers;
  t.mock.timers.tick(4_000);
  worker.reply('init', null);
  await flush();
  assert.equal(worker.messages.at(-1)?.type, 'prepare');
  t.mock.timers.tick(4_000);
  worker.reply('prepare', {backend: 'wasm'});
  await flush();
  t.mock.timers.tick(2_999);
  worker.reply('peek', {name: 'Card'});
  assert.equal((await peek).name, 'Card');

  const late = reader.peek(frame, {card, background: true});
  const timedOut = assert.rejects(late, {name: 'TimeoutError'});
  await flush();
  t.mock.timers.tick(3_000);
  worker.reply('peek', {name: 'Late card'});
  await timedOut;
  assert.equal(worker.terminated, false);
  assert.deepEqual(worker.messages.map(message => message.type), ['init', 'prepare', 'peek', 'peek']);
});

test('A hung background scan releases its lane after the watchdog expires', async t => {
  const {reader, workers} = mockReader(t);
  const scan = reader.detectCards(frame, {background: true});
  const timedOut = assert.rejects(scan, {name: 'TimeoutError'});
  await flush();
  const [worker] = workers;
  worker.reply('init', null);
  await flush();
  t.mock.timers.tick(59_999);
  assert.equal(worker.terminated, false);
  t.mock.timers.tick(1);
  await timedOut;
  assert.equal(worker.terminated, true);

  const foreground = reader.detectCards(frame);
  await flush();
  const [, replacement] = workers;
  replacement.reply('init', null);
  await flush();
  replacement.reply('detect', [card]);
  assert.deepEqual(await foreground, [card]);
});
