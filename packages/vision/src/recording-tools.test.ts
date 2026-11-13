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
import { remoteActionSchema } from '../../shared/src/remote/actions';

// A 26 s, 5 fps, 320x240 clip made with ffmpeg at test time (nothing binary in git): coloured boxes stand for cards on a whole-frame mat. One row per case; the events are in makeFixture.
//  A red    M1 all clip     watcher read it right, nobody touched it                       -> agreed (only after its last name event)
//  B green  M3              watcher read "Wrong Name", a player renamed it at 9 s          -> correction (second source: this reader reads green)
//  C teal   M2 -> M4        watcher "Wrong Two", moved at 5 s, player renamed it at 11 s   -> correction on BOTH spans (a rename after a move)
//  D blue   S2              no name, a person removed it, but the reader here reads it sure -> NO not-a-card (a hard crop with no label)
//  E orange S4              no name, a person undid the place, the reader is not sure       -> not-a-card
//  F violet S1              a click named it, then the click was undone                    -> dropped (an undone identify leaves a trace)
//  G orange S5              no name, removed by a source-less action (watcher or UI)       -> no label (not shown to be a person)
//  H lime   M5              an Xyz attach names it                                         -> dropped (an event not followed)
//  J pink / K cyan  S3      K put in S3 while J was still open                             -> both dropped (overlap)
//  L brown  EMZ2            a card on the mat that no event mentions                      -> never an empty-zone crop
//  N blue   M2 (15 s on)    watcher "Blue Card", swapped for another card, a player named it "Cyan Card" at 21.5 s, the watcher named it so too at 22.5 s
//                                                                                          -> hard crop, NO label (the later watcher name is not a second source)
//  P red    S5 -> S2        named "Red Card" (right), moved at 24 s, the watcher renamed it "Blue Card" at 25.5 s -> no agreed label (a later different name)
//  Q red    S4 (16 s on)    placed, then an action type this tool does not know names it     -> dropped, counted in summary.unknownActions
const calibration = createFieldCalibration([{ x: .04, y: .04 }, { x: .96, y: .04 }, { x: .96, y: .96 }, { x: .04, y: .96 }]);
const W = 320, H = 240, cells = fieldZoneCells('normal');
const centre = (zone: string) => { const c = cells.find(x => x.zone === zone)!; return fieldMatPoint({ x: c.x + c.w / 2, y: c.y + c.h / 2 }, calibration); };
const PALETTE: Record<string, { rgb: number[]; hex: string; id: string; name: string }> = {
  red: { rgb: [200, 40, 40], hex: '0xc82828', id: '1001', name: 'Red Card' }, green: { rgb: [40, 200, 40], hex: '0x28c828', id: '1002', name: 'Green Card' }, blue: { rgb: [40, 40, 200], hex: '0x2828c8', id: '1003', name: 'Blue Card' },
  teal: { rgb: [40, 160, 170], hex: '0x28a0aa', id: '1004', name: 'Teal Card' }, orange: { rgb: [230, 140, 30], hex: '0xe68c1e', id: '9', name: 'Unreadable' }, violet: { rgb: [150, 40, 190], hex: '0x9628be', id: '1005', name: 'Violet Card' },
  lime: { rgb: [170, 220, 40], hex: '0xaadc28', id: '1006', name: 'Lime Card' }, pink: { rgb: [240, 140, 200], hex: '0xf08cc8', id: '1007', name: 'Pink Card' }, cyan: { rgb: [40, 220, 230], hex: '0x28dce6', id: '1008', name: 'Cyan Card' },
  brown: { rgb: [130, 80, 30], hex: '0x82501e', id: '1009', name: 'Brown Card' },
};
const END = 26; // seconds
const BOXES: { colour: string; zone: string; from: number; to: number }[] = [
  { colour: 'red', zone: 'M1', from: .5, to: END }, { colour: 'green', zone: 'M3', from: .5, to: END }, { colour: 'teal', zone: 'M2', from: .5, to: 5 }, { colour: 'teal', zone: 'M4', from: 5, to: END },
  { colour: 'blue', zone: 'S2', from: 2, to: 9 }, { colour: 'orange', zone: 'S4', from: 2, to: 9 }, { colour: 'violet', zone: 'S1', from: 2, to: END }, { colour: 'orange', zone: 'S5', from: 2, to: 9 },
  { colour: 'lime', zone: 'M5', from: .5, to: END }, { colour: 'pink', zone: 'S3', from: .5, to: 7 }, { colour: 'cyan', zone: 'S3', from: 7, to: END }, { colour: 'brown', zone: 'EMZ2', from: .5, to: END },
  { colour: 'blue', zone: 'M2', from: 15.4, to: END }, { colour: 'red', zone: 'S5', from: 14.8, to: 24 }, { colour: 'red', zone: 'S2', from: 24, to: END }, { colour: 'red', zone: 'S4', from: 15.9, to: END },
];
const ZONES = [...new Set(BOXES.map(b => b.zone))];
const quadAt = (zone: string): DetectedQuad => { const c = centre(zone), hw = 16 / W, hh = 24 / H; return { kind: 'face-up', confidence: .9, partial: false, quad: [{ x: c.x - hw, y: c.y - hh }, { x: c.x + hw, y: c.y - hh }, { x: c.x + hw, y: c.y + hh }, { x: c.x - hw, y: c.y + hh }] }; };
/** The palette colour nearest to the 7x7 patch around a point, if close enough. */
const colourAt = (img: { width: number; data: Uint8ClampedArray | Uint8Array }, x: number, y: number) => {
  const avg = [0, 0, 0]; for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) { const p = ((Math.round(y) + j) * img.width + Math.round(x) + i) * 4; for (let k = 0; k < 3; k++) avg[k] += img.data[p + k] / 49; }
  const best = Object.entries(PALETTE).map(([k, v]) => [k, Math.hypot(...v.rgb.map((c, i) => c - avg[i]))] as const).sort((p, q) => p[1] - q[1])[0];
  return best[1] < 70 ? best[0] : undefined;
};
/** A fake reader that "sees" the coloured boxes (orange: not sure). `alias` renames one colour's answer; `delayMs` makes every read slower. */
function fakeReader(name: string, alias: Record<string, [string, string]> = {}, delayMs = 0): LoadedRecognizer {
  const table = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, alias[k] ?? [v.id, v.name]])), nameById = new Map(Object.values(table).map(([id, n]) => [id, n]));
  const recognizer = {
    detectCards: async (frame: unknown) => { const img = frame as { width: number; height: number; data: Uint8ClampedArray }; return ZONES.filter(z => colourAt(img, centre(z).x * img.width, centre(z).y * img.height)).map(quadAt); },
    recognize: async (frames: unknown[], opts?: { card?: DetectedQuad }) => {
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      const img = frames[0] as { width: number; height: number; data: Uint8ClampedArray }, q = opts!.card!.quad, cx = q.reduce((s, p) => s + p.x, 0) / 4 * img.width, cy = q.reduce((s, p) => s + p.y, 0) / 4 * img.height, key = colourAt(img, cx, cy) ?? 'red';
      const [id] = table[key], sure = key !== 'orange';
      return { candidates: sure ? [{ cardId: id, score: .95 }, { cardId: '8', score: .3 }] : [{ cardId: '9', score: .2 }, { cardId: '8', score: .15 }], tier: sure ? 'sure' : 'unsure', quality: { detected: true, cornersFound: true, framesUsed: 1, selectedFrameIndices: [0], sharpness: 20, fallback: false, searchSource: 'deck' } } as unknown as RecognitionResult;
    },
  };
  return { name, spec: { name, kind: 'ddindex', embedder: '' }, recognizer: recognizer as unknown as LoadedRecognizer['recognizer'], nameOf: id => (id && nameById.get(id)) || id || '(none)', release: async () => {}, threads: 1, settings: { fake: true } };
}
const analyze = () => { const w = 120, h = 176, data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 4, u = x / w, v = y / h, edge = u < .06 || u > .94 || v < .04 || v > .96, art = u > .12 && u < .88 && v > .18 && v < .7; data[p] = edge ? 25 : art ? 60 + 140 * u : 200; data[p + 1] = edge ? 25 : art ? 40 + 130 * v : 190; data[p + 2] = edge ? 25 : art ? 90 + 70 * Math.sin(35 * u) * Math.cos(30 * v) : 180; data[p + 3] = 255; } const face = { width: w, height: h, data };
  return { motion: () => 0, sharpness: () => 20, appearance: (c: DetectedQuad) => Array.from({ length: 12 }, (_, i) => .1 + c.quad[0].x * (i + 1) * .3), crop: () => face }; };

async function makeFixture(dir: string) {
  const boxes = BOXES.map(c => { const p = centre(c.zone); return `drawbox=x=${Math.round(p.x * W - 16)}:y=${Math.round(p.y * H - 24)}:w=32:h=48:color=${PALETTE[c.colour].hex}:t=fill:enable='between(t,${c.from},${c.to})'`; });
  const out = join(dir, 'clip.webm'), r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=0x1e1e1e:s=${W}x${H}:r=5:d=${END}`, '-vf', [...boxes, 'drawgrid=w=8:h=8:t=1:c=white@0.35'].join(','), '-c:v', 'libvpx', '-b:v', '600k', '-an', out], { stdio: 'inherit' });
  assert.equal(r.status, 0, 'ffmpeg made the fixture clip');
  const origin = 1_700_000_000_000, at = (s: number) => origin + s * 1000, cam = (seen: number, sent: number, extra: Record<string, unknown> = {}) => ({ seenAt: at(seen), namedAt: at(sent - .1), sentAt: at(sent), v: '1', ...extra });
  await writeFile(join(dir, 'clip.json'), JSON.stringify({ tableSlug: 'testroom', seat: 0, userId: 7, video: { width: W, height: H }, client: { timeOrigin: origin, videoStartPerfNow: 0, clockOffsetMs: 0, rttMs: 20, clockSamples: [{ n: 1, serverMs: at(0), offsetMs: 0, rttMs: 20 }, { n: 2, serverMs: at(7), offsetMs: 0, rttMs: 30 }] },
    // the shape the recording sidecar has (PR #605): a list of live calibrations; this one = the whole frame, placed by the player
    calibrations: [{ at: origin, serverMs: at(0), format: 'normal', placed: true, needed: false, calibration: { version: 1, layout: null, corners: [{ x: .04, y: .04 }, { x: .96, y: .04 }, { x: .96, y: .96 }, { x: .04, y: .96 }], orientation: null, zoneSpacing: null, zones: {} } }] }));
  const where = (z: string) => ({ zone: z.startsWith('EMZ') ? 'extra-monster' : z[0] === 'M' ? 'monster' : 'spell-trap', slot: Number(z.replace(/\D/g, '')) });
  const PLAYER = { by: 'player', ui: 'popup-remove' };
  // [video seconds, action]: seqs are given in time order below
  const list: [number, Record<string, unknown>][] = [
    [1.05, { type: 'twin.place', idempotencyKey: 'pA', source: 'auto', ...where('M1'), card: { ref: 'rA', slot: 1, cardId: 1001, name: 'Red Card' }, cam: cam(.5, 1) }],
    [1.15, { type: 'twin.place', idempotencyKey: 'pB', source: 'auto', ...where('M3'), card: { ref: 'rB', slot: 3, cardId: 9999, name: 'Wrong Name' }, cam: cam(.5, 1.1) }],
    [1.25, { type: 'twin.place', idempotencyKey: 'pC', source: 'auto', ...where('M2'), card: { ref: 'rC', slot: 2, cardId: 9998, name: 'Wrong Two' }, cam: cam(.5, 1.2) }],
    [1.35, { type: 'twin.place', idempotencyKey: 'pH', source: 'auto', ...where('M5'), card: { ref: 'rH', slot: 5, cardId: 1006, name: 'Lime Card' }, cam: cam(.5, 1.3) }],
    [1.45, { type: 'twin.place', idempotencyKey: 'pJ', source: 'auto', ...where('S3'), card: { ref: 'rJ', slot: 3, cardId: 1007, name: 'Pink Card' }, cam: cam(.5, 1.4) }],
    [2.45, { type: 'twin.place', idempotencyKey: 'pD', source: 'auto', ...where('S2'), card: { ref: 'rD', slot: 2 }, cam: cam(2, 2.4) }],
    [2.55, { type: 'twin.place', idempotencyKey: 'pE', source: 'auto', ...where('S4'), card: { ref: 'rE', slot: 4 }, cam: cam(2, 2.5) }],
    [2.65, { type: 'twin.place', idempotencyKey: 'pF', source: 'auto', ...where('S1'), card: { ref: 'rF', slot: 1 }, cam: cam(2, 2.6) }],
    [2.75, { type: 'twin.place', idempotencyKey: 'pG', source: 'auto', ...where('S5'), card: { ref: 'rG', slot: 5 }, cam: cam(2, 2.7) }],
    [4, { type: 'card.identified', idempotencyKey: 'iF', source: 'click', cardRef: 'rF', cardId: 1005, name: 'Violet Card' }],
    [5, { type: 'twin.move', idempotencyKey: 'mC', source: 'auto', cardRef: 'rC', ...where('M4'), cam: cam(4.7, 5) }],
    [5.2, { type: 'undo', idempotencyKey: 'uF', targetActionId: 'iF' }],
    [6, { type: 'twin.attach', idempotencyKey: 'aH', cardRef: 'rH', kind: 'xyz', materialRefs: ['rM1'] }],
    [7.4, { type: 'twin.place', idempotencyKey: 'pK', source: 'auto', ...where('S3'), card: { ref: 'rK', slot: 3, cardId: 1008, name: 'Cyan Card' }, cam: cam(7, 7.4) }],
    [8.9, { type: 'undo', idempotencyKey: 'uE', targetActionId: 'pE', cam: { sentAt: at(8.9), ...PLAYER, ui: 'undo' } }],
    [9, { type: 'twin.remove', idempotencyKey: 'xD', cardRef: 'rD', cam: { sentAt: at(9), ...PLAYER } }],
    [9.02, { type: 'twin.remove', idempotencyKey: 'xG', cardRef: 'rG' }],
    [9.05, { type: 'card.identified', idempotencyKey: 'iB', source: 'click', cardRef: 'rB', cardId: 1002, name: 'Green Card' }],
    [11, { type: 'card.identified', idempotencyKey: 'iC', source: 'click', cardRef: 'rC', cardId: 1004, name: 'Teal Card' }],
    [15.6, { type: 'twin.place', idempotencyKey: 'pN', source: 'auto', ...where('M2'), card: { ref: 'rN', slot: 2, cardId: 1003, name: 'Blue Card' }, cam: cam(15.4, 15.55) }],
    [21.5, { type: 'card.identified', idempotencyKey: 'iN', source: 'click', cardRef: 'rN', cardId: 1008, name: 'Cyan Card' }],
    [22.5, { type: 'card.identified', idempotencyKey: 'iN2', source: 'auto', cardRef: 'rN', cardId: 1008, name: 'Cyan Card' }],
    [15.1, { type: 'twin.place', idempotencyKey: 'pP', source: 'auto', ...where('S5'), card: { ref: 'rP', slot: 5, cardId: 1001, name: 'Red Card' }, cam: cam(14.8, 15.05) }],
    [24, { type: 'twin.move', idempotencyKey: 'mP', source: 'auto', cardRef: 'rP', ...where('S2'), cam: cam(23.7, 24) }],
    [25.5, { type: 'card.identified', idempotencyKey: 'iP', source: 'auto', cardRef: 'rP', cardId: 1003, name: 'Blue Card' }],
    [16.1, { type: 'twin.place', idempotencyKey: 'pQ', source: 'auto', ...where('S4'), card: { ref: 'rQ', slot: 4, cardId: 1001, name: 'Red Card' }, cam: cam(15.9, 16.05) }],
    [18, { type: 'board.future-thing', idempotencyKey: 'fQ', cardRef: 'rQ' }],
  ];
  const events = list.sort((x, y) => x[0] - y[0]).map(([s, action], i) => ({ id: `e${i + 1}`, seq: i + 1, actorSeat: 0, userId: 7, at: at(s), action: { ...(action.type === 'undo' ? {} : { seat: 0 }), actorSeat: 0, ...(action.type === 'twin.place' ? (({ slot: _slot, ...rest }) => rest)(action) : action) } }));
  // every fixture action is checked against the real schema (the one made-up type is skipped on purpose)
  for (const e of events) {
    const a = e.action as unknown as { type: string; idempotencyKey: string; cam?: Record<string, unknown> }; if (a.type === 'board.future-thing') continue;
    const r = remoteActionSchema.safeParse(a);
    assert.ok(r.success, `fixture action ${a.idempotencyKey} fits the schema: ${r.success ? '' : JSON.stringify(r.error.issues[0])}`);
  }
  const room = { slug: 'testroom', lastSeq: events.length, events };
  await writeFile(join(dir, 'room.json'), JSON.stringify(room));
  return { video: out, events: JSON.parse(await readFile(join(dir, 'room.json'), 'utf8')) as { lastSeq: number; events: { seq: number }[] } };
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
    assert.equal(a.phantom.checked, true); assert.ok(a.phantom.reads.length >= 1 && a.phantom.reads.every(r => r.zone === 'EMZ2'), 'the only read on a zone the events say is empty is the card no event mentions (brown, EMZ2)');
    assert.ok(a.seenToNamed.live.length >= 2 && a.seenToNamed.live.every(g => g.gapS > 0), 'live seen-to-named from the cam stamps');
    const cmp = compareSummaries([a, b]), pair = cmp.pairs[0];
    assert.ok(pair.aligned >= 1 && pair.agreePct < 100 && pair.differences.some(d => d.zone === 'M1' && d.names.join() === 'Red Card,Crimson Card'), 'agreement is below 100 % and the difference is listed');
    assert.ok(cmp.runs[1].readMsP50 > cmp.runs[0].readMsP50, 'the slower reader shows slower');
    assert.match(formatComparison(cmp), /current vs other/);
    assert.throws(() => compareSummaries([a, { ...b, recording: { ...b.recording, file: 'x.webm' } }]), /not of the same clip/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('harvest labels only what the events and the reader both support', skipNoFfmpeg, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dd-rt-'));
  try {
    const { video, events } = await makeFixture(dir), out = join(dir, 'out');
    const { records, summary } = await harvestLabels({ video, events, recognizer: fakeReader('current'), room: 'testroom', out, fps: 2, agreeSeconds: 4, minSharpness: 2, holdout: true });
    const inZone = (...z: string[]) => records.filter(r => z.includes(r.zone)), kinds = (k: string) => records.filter(r => r.labelKind === k);
    // agreed: red only, only after its name event (1 s) plus the margins, at most 8 crops
    const agreed = kinds('agreed'); assert.ok(agreed.length >= 1 && agreed.length <= 8 && agreed.every(r => r.zone === 'M1' && r.label === 'Red Card' && r.cardId === 1001 && !r.hard && r.clipTimeS >= 3.5), 'agreed: red card, late enough');
    // corrections: green; teal on BOTH of its spans (the rename came after the move)
    const green = records.filter(r => r.label === 'Green Card'); assert.ok(green.length >= 1 && green.every(r => r.zone === 'M3' && r.previous === 'Wrong Name' && r.clipTimeS < 7 && r.hard && r.source === 'player-rename'), 'green correction, before the rename');
    const teal = records.filter(r => r.label === 'Teal Card'); assert.ok(teal.some(r => r.zone === 'M2') && teal.some(r => r.zone === 'M4') && teal.every(r => r.previous === 'Wrong Two' && r.labelKind === 'correction'), 'rename after a move reaches the crops of the first span');
    assert.ok(!records.some(r => r.labelKind === 'agreed' && ['M2', 'M3', 'M4'].includes(r.zone)), 'a corrected card is never an agreed label');
    // not-a-card: orange at S4 (undo marked as a person, reader not sure) only; blue (reader sure), orange at S5 (source-less remove) never
    const neg = records.filter(r => r.label === 'not-a-card'); assert.ok(neg.length >= 1 && neg.every(r => r.zone === 'S4' && r.source === 'player-undo-of-auto-place'), 'phantom only where every sign agrees');
    const s2 = inZone('S2').filter(r => r.clipTimeS < 14); assert.ok(s2.length >= 1 && s2.every(r => r.label === null && r.hard), 'a card the reader reads sure is never not-a-card');
    assert.equal(inZone('S5').filter(r => r.clipTimeS < 14).length, 0, 'a source-less remove is not a person');
    // the sidecar (PR #605 shape) gave the clock samples and the live calibration; no --calibration file was passed
    assert.deepEqual([summary.params.calibration, summary.clock.source, summary.clock.samples, summary.clock.rttMs, summary.calibrations.entries], ['sidecar', 'samples', 2, 30, 1]);
    // N: the card was swapped, a player named the new one, a later watcher name agrees: the old card's crops get NO label (the later watcher name is not a second source)
    const swapped = records.filter(r => r.zone === 'M2' && r.clipTimeS > 14 && r.label !== 'empty'); assert.ok(swapped.length >= 1 && swapped.every(r => r.label === null && r.hard && r.source === 'player-rename-unconfirmed'), 'swap then rename: hard crops, no label');
    // P: a later automatic rename to another name means no agreed label on the earlier span; Q: an action type this tool does not know taints the card it names
    assert.ok(!records.some(r => r.zone === 'S5' && r.clipTimeS > 14) && summary.skipped.renamedLater >= 1, 'a later different name blocks agreed');
    assert.deepEqual(summary.unknownActions, { 'board.future-thing': 1 }); assert.ok(!records.some(r => r.zone === 'S4' && r.clipTimeS > 14 && r.label !== 'empty'), 'an unknown action type taints its card');
    // dropped: undone identify, Xyz attach, overlap
    assert.equal(inZone('S1', 'M5', 'S3').length, 0, 'undone identify, attach and zone overlap leave no label');
    assert.ok(summary.skipped.refUnclear >= 2 && summary.skipped.zoneOverlap >= 2 && summary.gaps.some(g => /undo of card\.identified/.test(g)) && summary.gaps.some(g => /twin\.attach/.test(g)), 'the summary says why');
    // empty zones: never an occupied one, never the zone with an unexplained card
    const empty = kinds('empty-zone'); assert.ok(empty.length >= 1 && empty.length <= 12 && empty.every(r => r.label === 'empty' && ['EMZ1', 'FIELD', 'M2', 'S2'].includes(r.zone)), 'empty zones only where nothing is');
    assert.ok(!inZone('EMZ2').length && summary.skipped.emptyZoneHasOutline >= 1, 'an unexplained card on the mat drops the crop');
    assert.deepEqual([summary.eventList.complete, summary.eventList.holes, summary.eventList.allowPartial], [true, 0, false]);
    const lines = (await readFile(join(out, 'labels.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l) as { crop: string }); assert.equal(lines.length, records.length);
    assert.ok((await readFile(join(out, lines[0].crop))).length > 100, 'crop image written');
    assert.match(await readFile(join(out, 'HOLDOUT'), 'utf8'), /never use/);
    assert.equal(JSON.parse(await readFile(join(out, 'summary.json'), 'utf8')).holdout, true);
    // a player mark with another ui (not undo / popup-remove) gives no not-a-card
    const otherUi = { ...events, events: events.events.map(e => (e as unknown as { action: { idempotencyKey?: string } }).action.idempotencyKey === 'uE' ? { ...e, action: { ...(e as unknown as { action: object }).action, cam: { sentAt: 1_700_000_008_900, by: 'player', ui: 'tap' } } } : e) };
    const tapped = await harvestLabels({ video, events: otherUi, recognizer: fakeReader('current'), room: 'testroom', out: join(dir, 'tapped'), fps: 2, agreeSeconds: 4, minSharpness: 2 });
    assert.ok(tapped.summary.skipped.playerRemovedOtherUi >= 1 && !tapped.records.some(r => r.label === 'not-a-card'), 'another ui gives no not-a-card');
    // an unknown action type with no card ref may have moved any card: nothing is labelled
    const blind = { ...events, events: [...events.events, { id: 'e99', seq: events.lastSeq + 1, actorSeat: 0, userId: 7, at: 1_700_000_025_000, action: { type: 'board.future-thing', idempotencyKey: 'fZ', actorSeat: 0 } }], lastSeq: events.lastSeq + 1 };
    const blinded = await harvestLabels({ video, events: blind, recognizer: fakeReader('current'), room: 'testroom', out: join(dir, 'blind'), fps: 2, agreeSeconds: 4, minSharpness: 2 });
    assert.ok(!blinded.records.some(r => r.label && r.label !== 'empty') && blinded.summary.unknownActions['board.future-thing'] === 2, 'an unknown action without a ref labels nothing');
    // a calibration entry this tool cannot read (the app's writer takes 4-8 corners, this reader needs 4) is never skipped silently: no crop in its period, a WARNING gap, a count in summary.json
    const sidecarFile = join(dir, 'clip.json'), good = JSON.parse(await readFile(sidecarFile, 'utf8')) as { calibrations: { at: number; serverMs: number; calibration: { corners: unknown[] } }[] };
    const five = { ...good.calibrations[0], at: good.calibrations[0].at + 12_000, serverMs: good.calibrations[0].serverMs + 12_000, calibration: { ...good.calibrations[0].calibration, corners: [...good.calibrations[0].calibration.corners, { x: .5, y: .97 }] } };
    await writeFile(sidecarFile, JSON.stringify({ ...good, calibrations: [good.calibrations[0], five] }));
    const later = await harvestLabels({ video, events, recognizer: fakeReader('current'), room: 'testroom', out: join(dir, 'later'), fps: 2, agreeSeconds: 4, minSharpness: 2 });
    assert.ok(later.records.length >= 1 && later.records.every(r => r.clipTimeS < 12) && later.summary.calibrations.unreadable === 1 && later.summary.skipped.calibrationUnreadable >= 1 && later.summary.gaps.some(g => /^WARNING: 1 sidecar calibration entry is unreadable/.test(g)), 'an unreadable later entry: no crop from then on');
    await writeFile(sidecarFile, JSON.stringify({ ...good, calibrations: [five] }));
    const none = await harvestLabels({ video, events, recognizer: fakeReader('current'), room: 'testroom', out: join(dir, 'none'), fps: 2, agreeSeconds: 4, minSharpness: 2 });
    assert.ok(none.records.length === 0 && none.summary.calibrations.unreadable === 1 && none.summary.gaps.some(g => /whole recording/.test(g)), 'all entries unreadable: no crop at all, never the whole-frame guess');
    // a list cut to the last events (what GET /api/remote/<slug> returns) is refused; --allow-partial says so in the summary
    const cut = { ...events, events: events.events.filter(e => e.seq > 5) };
    await assert.rejects(harvestLabels({ video, events: cut, recognizer: fakeReader('current'), calibration, room: 'testroom', out: join(dir, 'cut') }), /not complete: it starts at seq 6/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
