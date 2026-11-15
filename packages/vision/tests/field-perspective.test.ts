import { expect, it } from 'vitest';
import { createFieldWatcher } from '../src/field-watcher';
import { createFieldCalibration, FIELD_ROW, FIELD_ZONE_PITCH } from '../src/field-zones';
import { yugioh } from '../src/games/yugioh';
import type { FieldCalibration } from '../src/field-zones';

// An equal-slot grid for 59:86 cards, in a square camera image.
function grid(compression: number): FieldCalibration {
  const height = .8 * FIELD_ZONE_PITCH / FIELD_ROW * 86 / 59 * compression;
  return createFieldCalibration([
    { x: .1, y: .2 }, { x: .9, y: .2 },
    { x: .9, y: .2 + height }, { x: .1, y: .2 + height },
  ], { playerSide: 'bottom', mirrored: false });
}

function camera(calibration?: FieldCalibration) {
  let at = 0;
  let frame: ImageData = { width: 1000, height: 1000, colorSpace: 'srgb', data: new Uint8ClampedArray(4_000_000) };
  const watcher = createFieldWatcher({
    profile: yugioh, calibration, now: () => at, hidden: () => false, clone: async f => f,
    buffer: { sample: async () => ({ frame, at }) },
    recognizer: {
      detectCards: async () => [],
      recognize: async () => { throw new Error('An empty field must not read'); },
    },
    analyze: () => ({ motion: () => 0, sharpness: () => 20 }),
  });
  return {
    watcher,
    resize(width: number, height: number) {
      frame = { width, height, colorSpace: 'srgb', data: new Uint8ClampedArray(width * height * 4) };
    },
    async tick() { at += 1000; await watcher.tick(); },
  };
}

it('reports a flat calibrated view at more than fourfold directional compression', async () => {
  const c = camera(grid(.2));
  try {
    expect(c.watcher.getSnapshot().cameraView).toBeUndefined();
    await c.tick();
    expect(c.watcher.getSnapshot().cameraView?.tooFlat).toBe(true);
    expect(c.watcher.getSnapshot().cameraView?.compression).toBeCloseTo(.2, 6);
    expect(c.watcher.getSnapshot().metrics.placements).toBe(0);
  } finally { c.watcher.dispose(); }
});

it('updates the advisory after calibration and capture-size changes', async () => {
  const c = camera(grid(.2));
  try {
    await c.tick();
    c.watcher.setCalibration(grid(1));
    expect(c.watcher.getSnapshot().cameraView?.tooFlat).toBe(false);
    expect(c.watcher.getSnapshot().cameraView?.compression).toBeCloseTo(1, 6);
    c.resize(1000, 200);
    await c.tick();
    expect(c.watcher.getSnapshot().cameraView?.tooFlat).toBe(true);
    c.watcher.setCalibration();
    expect(c.watcher.getSnapshot().cameraView).toBeUndefined();
  } finally { c.watcher.dispose(); }
});

it('keeps camera rotation and mirroring out of the compression measurement', async () => {
  const upright = grid(.2);
  const rotated = createFieldCalibration(
    upright.corners.map(p => ({ x: 1 - p.y, y: p.x })),
    { playerSide: 'bottom', mirrored: true },
  );
  const c = camera(rotated);
  try {
    await c.tick();
    expect(c.watcher.getSnapshot().cameraView?.tooFlat).toBe(true);
    expect(c.watcher.getSnapshot().cameraView?.compression).toBeCloseTo(.2, 6);
  } finally { c.watcher.dispose(); }
});

it.each([.25, .251, 1])('does not flag a view at compression %s', async compression => {
  const c = camera(grid(compression));
  try {
    await c.tick();
    expect(c.watcher.getSnapshot().cameraView?.tooFlat).toBe(false);
  } finally { c.watcher.dispose(); }
});

it('leaves an unconfirmed grid unassessed', async () => {
  const { orientation: _orientation, ...unconfirmed } = grid(.2);
  const c = camera(unconfirmed);
  try {
    await c.tick();
    expect(c.watcher.getSnapshot().cameraView).toBeUndefined();
  } finally { c.watcher.dispose(); }
});

it('checks the compressed far cells of a trapezoid as well as the near row', async () => {
  const c = camera(createFieldCalibration([
    { x: .3, y: .2 }, { x: .7, y: .2 },
    { x: .9, y: .3 }, { x: .1, y: .3 },
  ], { playerSide: 'bottom', mirrored: false }));
  try {
    await c.tick();
    expect(c.watcher.getSnapshot().cameraView?.tooFlat).toBe(true);
    expect(c.watcher.getSnapshot().cameraView?.compression).toBeLessThan(.25);
    expect(c.watcher.getSnapshot().metrics.errors).toBe(0);
  } finally { c.watcher.dispose(); }
});
