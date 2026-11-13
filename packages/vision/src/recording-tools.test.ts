import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fieldMatPoint, fieldZoneCells } from './field-zones';
import type { DetectedQuad, RecognitionResult } from './types';
import { compareSummaries, formatComparison, hasFfmpeg, runRecording } from '../../../scripts/vision/recording-lib';
import { decodeBank, resolveRecognizerSpec, searchBank, type LoadedRecognizer } from '../../../scripts/vision/recognizer-switch';
import { harvestLabels } from '../../../scripts/vision/harvest-labels';
import { createFieldCalibration } from './field-zones';

// A 10 s, 5 fps, 320x240 clip made with ffmpeg at test time (nothing binary in git): coloured boxes stand for cards on a whole-frame mat.
//  red   at M1 from 1 s to the end: the watcher read it right ("Red Card") and nobody touched it  -> agreed
//  green at M3 from 1 s: the watcher read "Wrong Name", a player renamed it to "Green Card" at 7 s -> correction
//  blue  at S2 from 2 s to 5 s: the watcher placed it, a player removed it at 5 s                   -> not-a-card
//  every other zone is empty                                                                       -> empty-zone
const calibration = createFieldCalibration([{ x: .04, y: .04 }, { x: .96, y: .04 }, { x: .96, y: .96 }, { x: .04, y: .96 }]);
const W = 320, H = 240, cells = fieldZoneCells('normal');
const centre = (zone: string) => { const c = cells.find(x => x.zone === zone)!; return fieldMatPoint({ x: c.x + c.w / 2, y: c.y + c.h / 2 }, calibration); };
const COLOURS: Record<string, { rgb: number[]; hex: string; zone: string; from: number; to: number }> = {
  red: { rgb: [200, 40, 40], hex: '0xc82828', zone: 'M1', from: 1, to: 10 }, green: { rgb: [40, 200, 40], hex: '0x28c828', zone: 'M3', from: 1, to: 10 }, blue: { rgb: [40, 40, 200], hex: '0x2828c8', zone: 'S2', from: 2, to: 5 },
};
const NAMES: Record<string, [string, string]> = { red: ['1001', 'Red Card'], green: ['1002', 'Green Card'], blue: ['1003', 'Blue Card'] };
const quadAt = (zone: string): DetectedQuad => { const c = centre(zone), hw = 16 / W, hh = 24 / H; return { kind: 'face-up', confidence: .9, partial: false, quad: [{ x: c.x - hw, y: c.y - hh }, { x: c.x + hw, y: c.y - hh }, { x: c.x + hw, y: c.y + hh }, { x: c.x - hw, y: c.y + hh }] }; };
const colourAt = (img: { width: number; data: Uint8ClampedArray | Uint8Array }, x: number, y: number) => {
  let r = 0, g = 0, b = 0; for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { const p = ((Math.round(y) + j) * img.width + Math.round(x) + i) * 4; r += img.data[p]; g += img.data[p + 1]; b += img.data[p + 2]; }
  return r > g && r > b && r > 400 ? 'red' : g > r && g > b && g > 400 ? 'green' : b > r && b > g && b > 400 ? 'blue' : undefined;
};
/** A fake reader that "sees" the coloured boxes. `alias` renames one colour's answer; `delayMs` makes every read slower. */
function fakeReader(name: string, alias: Record<string, [string, string]> = {}, delayMs = 0): LoadedRecognizer {
  const table = { ...NAMES, ...alias }, nameById = new Map(Object.values(table).map(([id, n]) => [id, n]));
  const recognizer = {
    detectCards: async (frame: unknown) => { const img = frame as { width: number; height: number; data: Uint8ClampedArray }; return Object.values(COLOURS).filter(c => colourAt(img, centre(c.zone).x * img.width, centre(c.zone).y * img.height)).map(c => quadAt(c.zone)); },
    recognize: async (frames: unknown[], opts?: { card?: DetectedQuad }) => {
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      const img = frames[0] as { width: number; height: number; data: Uint8ClampedArray }, q = opts!.card!.quad, cx = q.reduce((s, p) => s + p.x, 0) / 4 * img.width, cy = q.reduce((s, p) => s + p.y, 0) / 4 * img.height, key = colourAt(img, cx, cy) ?? 'red';
      const [id] = table[key]; return { candidates: [{ cardId: id, score: .95 }, { cardId: '9', score: .3 }], tier: 'sure', quality: { detected: true, cornersFound: true, framesUsed: 1, selectedFrameIndices: [0], sharpness: 20, fallback: false, searchSource: 'deck' } } as unknown as RecognitionResult;
    },
  };
  return { name, spec: { name, kind: 'ddindex', embedder: '' }, recognizer: recognizer as unknown as LoadedRecognizer['recognizer'], nameOf: id => (id && nameById.get(id)) || id || '(none)', release: async () => {}, threads: 1, settings: { fake: true } };
}
const analyze = () => { const w = 120, h = 176, data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4, u = x / w, v = y / h, edge = u < .06 || u > .94 || v < .04 || v > .96, art = u > .12 && u < .88 && v > .18 && v < .7; data[p] = edge ? 25 : art ? 60 + 140 * u : 200; data[p + 1] = edge ? 25 : art ? 40 + 130 * v : 190; data[p + 2] = edge ? 25 : art ? 90 + 70 * Math.sin(35 * u) * Math.cos(30 * v) : 180; data[p + 3] = 255; } const face = { width: w, height: h, data };
  return { motion: () => 0, sharpness: () => 20, appearance: (c: DetectedQuad) => Array.from({ length: 12 }, (_, i) => .1 + c.quad[0].x * (i + 1) * .3), crop: () => face }; };

async function makeFixture(dir: string) {
  const boxes = Object.values(COLOURS).map(c => { const p = centre(c.zone); return `drawbox=x=${Math.round(p.x * W - 16)}:y=${Math.round(p.y * H - 24)}:w=32:h=48:color=${c.hex}:t=fill:enable='between(t,${c.from},${c.to})'`; });
  const out = join(dir, 'clip.webm'), r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=0x1e1e1e:s=${W}x${H}:r=5:d=10`, '-vf', [...boxes, 'drawgrid=w=8:h=8:t=1:c=white@0.35'].join(','), '-c:v', 'libvpx', '-b:v', '600k', '-an', out], { stdio: 'inherit' });
  assert.equal(r.status, 0, 'ffmpeg made the fixture clip');
  const origin = 1_700_000_000_000, at = (s: number) => origin + s * 1000, cam = (seen: number, sent: number) => ({ seenAt: at(seen), namedAt: at(sent - .1), sentAt: at(sent), v: 1 });
  await writeFile(join(dir, 'clip.json'), JSON.stringify({ tableSlug: 'testroom', seat: 0, userId: 7, video: { width: W, height: H }, client: { timeOrigin: origin, videoStartPerfNow: 0, clockOffsetMs: 0, rttMs: 20 } }));
  const ev = (seq: number, s: number, action: Record<string, unknown>) => ({ id: `e${seq}`, seq, actorSeat: 0, userId: 7, at: at(s), action: { seat: 0, ...action } });
  const place = (seq: number, ref: string, zone: string, slot: number, seen: number, sent: number, card: Record<string, unknown>) => ev(seq, sent + .05, { type: 'twin.place', idempotencyKey: `k${seq}`, source: 'auto', zone, slot, card: { ref, slot, ...card }, cam: cam(seen, sent) });
  const events = [
    place(1, 'r1', 'monster', 1, 1, 1.5, { cardId: 1001, name: 'Red Card' }), place(2, 'r2', 'monster', 3, 1, 1.6, { cardId: 9999, name: 'Wrong Name' }), place(3, 'r3', 'spell-trap', 2, 2, 2.4, {}),
    ev(4, 5, { type: 'twin.remove', idempotencyKey: 'k4', cardRef: 'r3' }),
    ev(5, 7, { type: 'card.identified', idempotencyKey: 'k5', source: 'click', cardRef: 'r2', card: { ref: 'r2', cardId: 1002, name: 'Green Card' } }),
  ];
  await writeFile(join(dir, 'room.json'), JSON.stringify({ events }));
  return { video: out, events: JSON.parse(await readFile(join(dir, 'room.json'), 'utf8')) as unknown };
}
const skipNoFfmpeg = hasFfmpeg() ? {} : { skip: 'ffmpeg is not on PATH' };

test('recognizer switch resolves a spec and two readers compare on one clip', skipNoFfmpeg, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dd-rt-'));
  try {
    // a spec file: paths are relative to the file, input settings are kept, a missing field is a plain error
    await writeFile(join(dir, 'other.json'), JSON.stringify({ name: 'other', kind: 'whole-card-bank', embedder: 'm/e.onnx', bank: 'bank.json', catalog: 'cat.json', input: { size: 8, inputName: 'x', outputName: 'y', mean: [.5, .5, .5], std: [.5, .5, .5] } }));
    const spec = await resolveRecognizerSpec(join(dir, 'other.json'), dir);
    assert.equal(spec.name, 'other'); assert.equal(spec.embedder, join(dir, 'm/e.onnx')); assert.equal(spec.input?.size, 8);
    await writeFile(join(dir, 'bad.json'), JSON.stringify({ kind: 'ddindex' })); await assert.rejects(resolveRecognizerSpec(join(dir, 'bad.json'), dir), /"embedder" is required/);
    // a two-card bank: the best row per name wins
    const half = (v: number[]) => Buffer.concat(v.map(n => { const b = Buffer.alloc(2); b.writeUInt16LE(n === 1 ? 0x3c00 : 0, 0); return b; })).toString('base64');
    const bank = decodeBank({ dim: 2, entries: [{ cardId: 'a', vec: half([1, 0]) }, { cardId: 'b', vec: half([0, 1]) }] }, id => id.toUpperCase());
    assert.deepEqual(searchBank(bank, new Float32Array([.2, .9]), 2).map(c => c.cardId), ['b', 'a']);

    const { video, events } = await makeFixture(dir);
    const common = { video, events, fps: 5, calibration, analyze: analyze as never };
    const a = await runRecording({ ...common, recognizer: fakeReader('current') });
    const b = await runRecording({ ...common, recognizer: fakeReader('other', { red: ['2001', 'Crimson Card'] }, 12) });
    assert.equal(a.schema, 'recording-run/1'); assert.equal(a.errors, 0);
    const red = a.reads.filter(r => r.zone === 'M1'); assert.ok(red.length >= 1 && red.every(r => r.name === 'Red Card' && r.sure && r.score === .95 && r.margin === .65), 'reads carry zone, name, score, margin, sure');
    assert.ok(a.reads.every(r => r.ms >= 0) && a.readMs.n === a.reads.length, 'time per read');
    assert.ok(a.tracks.some(t => t.zone === 'M3' && t.name === 'Green Card') || a.tracks.length >= 2, 'tracks are named');
    assert.equal(a.phantom.checked, true); assert.equal(a.phantom.reads.length, 0, 'no read on a zone the events say is empty');
    assert.ok(a.seenToNamed.live.length >= 2 && a.seenToNamed.live.every(g => g.gapS > 0), 'live seen-to-named from the cam stamps');
    const cmp = compareSummaries([a, b]), pair = cmp.pairs[0];
    assert.ok(pair.aligned >= 1 && pair.agreePct < 100 && pair.differences.some(d => d.zone === 'M1' && d.names.join() === 'Red Card,Crimson Card'), 'agreement is below 100 % and the difference is listed');
    assert.ok(cmp.runs[1].readMsP50 > cmp.runs[0].readMsP50, 'the slower reader shows slower');
    assert.match(formatComparison(cmp), /current vs other/);
    assert.throws(() => compareSummaries([a, { ...b, recording: { ...b.recording, file: 'x.webm' } }]), /not of the same clip/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('harvest writes a correction, an agreed read, a not-a-card negative and an empty-zone crop', skipNoFfmpeg, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dd-rt-'));
  try {
    const { video, events } = await makeFixture(dir), out = join(dir, 'out');
    const { records, summary } = await harvestLabels({ video, events, recognizer: fakeReader('current'), calibration, room: 'testroom', out, fps: 2, agreeSeconds: 4, minSharpness: 2, holdout: true });
    const kinds = (k: string) => records.filter(r => r.labelKind === k);
    const corr = kinds('correction').filter(r => r.label === 'Green Card'); assert.ok(corr.length >= 1, 'correction crops carry the corrected name');
    assert.ok(corr.every(r => r.zone === 'M3' && r.previous === 'Wrong Name' && r.clipTimeS < 7 && r.hard && r.source === 'player-rename'), 'before the rename, previous name kept');
    const agreed = kinds('agreed'); assert.ok(agreed.length >= 1 && agreed.length <= 8 && agreed.every(r => r.zone === 'M1' && r.label === 'Red Card' && r.cardId === 1001 && !r.hard), 'agreed red card, at most 8 crops');
    assert.ok(!agreed.some(r => r.zone === 'M3'), 'the corrected card is never an agreed label');
    const neg = records.filter(r => r.label === 'not-a-card'); assert.ok(neg.length >= 1 && neg.every(r => r.zone === 'S2' && r.cardId === null), 'phantom removal gives a not-a-card negative');
    const empty = kinds('empty-zone'); assert.ok(empty.length >= 1 && empty.length <= 12 && empty.every(r => r.label === 'empty' && !['M1', 'M3'].includes(r.zone)), 'empty zones, never an occupied one');
    assert.ok(summary.counts.byKind.correction >= 2 && summary.counts.notACard === neg.length && summary.counts.byCard['Red Card'] === agreed.length, 'summary counts');
    const lines = (await readFile(join(out, 'labels.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l) as { crop: string }); assert.equal(lines.length, records.length);
    assert.ok((await readFile(join(out, lines[0].crop))).length > 100, 'crop image written');
    assert.match(await readFile(join(out, 'HOLDOUT'), 'utf8'), /never use/);
    assert.equal(JSON.parse(await readFile(join(out, 'summary.json'), 'utf8')).holdout, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
