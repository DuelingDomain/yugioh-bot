import { afterEach, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { createFieldWatcher, type FieldEvent } from '../../vision/src/field-watcher';
import { yugioh } from '../../vision/src/games/yugioh';
import type { FieldEdgeGrip } from '../../vision/src/field-motion';
import type { DetectedQuad, RecognitionResult } from '../../vision/src/types';
import phone from '../../vision/src/fixtures/phantom-phone.json';
import calculator from '../../vision/src/fixtures/phantom-calculator.json';

const watchers: ReturnType<typeof createFieldWatcher>[] = [];
afterEach(() => { for (const watcher of watchers.splice(0)) watcher.dispose(); });

function rig() {
  let grip:FieldEdgeGrip='clear';
  const image: ImageData = { width: 96, height: 140, colorSpace: 'srgb', data: new Uint8ClampedArray(96 * 140 * 4).fill(15) };
  const state = {
    at: 0, contact: .6, motion: 0, hidden: false, crop: true, visible: true,
    look: [.2, .6, .2, .6, .2, .6], pixels: image,
    card: { kind: 'face-down', confidence: .95, partial: false, quad: [{ x: .3, y: .3 }, { x: .47, y: .3 }, { x: .47, y: .55 }, { x: .3, y: .55 }] } satisfies DetectedQuad,
  };
  const events: FieldEvent[] = [];
  const result: RecognitionResult = { candidates: [{ cardId: 'A', score: .95 }], tier: 'sure', quality: { detected: true, cornersFound: true, framesUsed: 1, selectedFrameIndices: [0], sharpness: 20, fallback: false }, timingsMs: { sharpness: 0, detect: 0, warp: 0, embed: 0, search: 0, total: 0 }, backend: 'wasm' };
  const watcher = createFieldWatcher({
    profile: yugioh, now: () => state.at, hidden: () => state.hidden, setGuards: { startup: false },
    recognizer: { detectCards: async () => state.visible ? [structuredClone(state.card)] : [], recognize: async () => result },
    buffer: { sample: async () => ({ frame: image, at: state.at }) }, clone: async frame => frame,
    analyze: () => ({ motion: () => state.motion, sharpness: () => 20, touched: () => state.contact, occluded: () => false, edgeGrip: () => grip,
      appearance: () => state.look, halo: () => Array(192).fill(.6), crop: () => state.crop ? state.pixels : undefined }),
  });
  watchers.push(watcher); watcher.subscribe(event => events.push(event));
  return { state, events, watcher, setGrip(value:FieldEdgeGrip) { grip=value; }, async tick(count = 1, ms = 100) { for (let i = 0; i < count; i++) { state.at += ms; await watcher.tick(); } } };
}

it('release keeps two clean back samples across the CPU detector cadence', async () => {
  const r = rig();r.state.crop = false;
  await r.tick(10);
  r.state.contact = 0;r.state.crop = true;
  await r.tick(2, 800);
  expect(r.events.filter(event => event.type === 'placed')).toHaveLength(1);
  expect(r.events.filter(event => event.type === 'prompt')).toEqual([]);
});

it('a released card places after 200 ms without an expired contact question', async () => {
  const r = rig();
  await r.tick(19);
  expect(r.events).toEqual([]);
  r.state.contact = 0;
  await r.tick(5);
  expect(r.events.filter(event => event.type === 'prompt')).toEqual([]);
  expect(r.events.filter(event => event.type === 'placed')).toHaveLength(1);
});

it('fingers outside opposite edges cannot time out into a placement', async () => {
  const r = rig();r.state.contact = 0;r.setGrip('grip');
  await r.tick(40);
  expect(r.events.some(event => ['placed','reading','prompt'].includes(event.type))).toBe(false);
  r.setGrip('near');await r.tick(10);
  expect(r.events.some(event => ['placed','reading','prompt'].includes(event.type))).toBe(false);
  r.setGrip('clear');
  await r.tick(5);
  expect(r.events.filter(event => event.type === 'placed')).toHaveLength(1);
  expect(r.events.filter(event => event.type === 'prompt')).toEqual([]);
});

it('a drifting held outline never earns a stationary-contact question', async () => {
  const r = rig();
  for (let i = 0; i < 140; i++) {
    const dx = i % 20 < 10 ? .004 : -.004;
    r.state.card.quad = r.state.card.quad.map(point => ({ ...point, x: point.x + dx }));
    await r.tick();
  }
  expect(r.events.filter(event => ['prompt', 'reading', 'placed'].includes(event.type))).toEqual([]);
});

it('only ten seconds of continuous still contact asks once and never places automatically', async () => {
  const r = rig();
  await r.tick(100);
  expect(r.events).toEqual([]);
  await r.tick(30);
  expect(r.events.filter(event => event.type === 'prompt')).toHaveLength(1);
  expect(r.events.some(event => event.type === 'reading' || event.type === 'placed')).toBe(false);
  const prompt = r.events.find(event => event.type === 'prompt')!;
  expect(r.watcher.acceptSet(prompt.track.id)).toBe(true);
});

it('edge contact on an already resting outline does not delay its first positive back', async () => {
  const r = rig();
  r.state.contact = 0; r.state.crop = false;
  await r.tick(3);
  expect(r.events).toEqual([]);
  expect(r.watcher.getSnapshot().tracks[0].restSince).toBeDefined();
  r.state.contact = .1; r.state.crop = true;
  await r.tick(10);
  expect(r.events.filter(event => event.type === 'placed')).toHaveLength(1);
  expect(r.events.filter(event => event.type === 'prompt')).toEqual([]);
});

it.each(['motion', 'pause', 'box movement', 'changed art', 'missing outline'] as const)('prior resting evidence does not survive %s', async interruption => {
  const r = rig();
  r.state.contact = 0; r.state.crop = false;
  await r.tick(3);
  if (interruption === 'motion') r.state.motion = .1;
  if (interruption === 'pause') r.state.hidden = true;
  if (interruption === 'box movement') r.state.card.quad = r.state.card.quad.map(point => ({ ...point, x: point.x + .03 }));
  if (interruption === 'changed art') r.state.look = [.8, .1, .8, .1, .8, .1];
  if (interruption === 'missing outline') { r.state.visible = false; r.watcher.scanNow(); }
  r.state.contact = .6;
  await r.tick();
  r.state.motion = 0; r.state.hidden = false; r.state.crop = true; r.state.visible = true;
  await r.tick(30);
  expect(r.events.some(event => event.type === 'reading' || event.type === 'placed')).toBe(false);
});

it.each([['phone', phone], ['calculator', calculator]] as const)('pre-contact rest cannot turn the retained %s phantom into a Set', async (_name, trace) => {
  const r = rig();
  r.state.contact = 0;
  r.state.pixels = { width: trace.crop.width, height: trace.crop.height, colorSpace: 'srgb', data: new Uint8ClampedArray(inflateSync(Buffer.from(trace.crop.rgbaDeflate, 'base64'))) };
  await r.tick(3);
  expect(r.watcher.getSnapshot().tracks[0].restSince).toBeDefined();
  r.state.contact = .1;
  await r.tick(130);
  expect(r.events.some(event => event.type === 'reading' || event.type === 'placed')).toBe(false);
});
