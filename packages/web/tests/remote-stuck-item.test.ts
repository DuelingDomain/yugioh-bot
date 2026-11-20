// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createRoomMutationQueue, laneOf, PILE_LANES } from '../src/lib/remote/room-mutations';
import { holdFieldLatencyLog } from '../src/lib/remote/field-profile';
import type { FieldTiming } from '@yugidraft/vision';
import { tapRoom } from './tap-room-fixture';

it('a stuck item does not delay the next one, and works for one card or cell keep their order', async () => {
  const room = tapRoom(), posts: string[] = [];
  // Like the server: one write at a time, each answered after one round trip.
  const queue = createRoomMutationQueue(() => room, async proposal => { await Promise.resolve(); posts.push((proposal as unknown as { tag: string }).tag); return { lastSeq: posts.length } as never; });
  const write = (tag: string) => ({ type: 'phase.advance', actorSeat: 0, tag }) as never;
  let release!: () => void;
  const stuck = queue.transaction(async (_room, act) => { await new Promise<void>(done => { release = done; }); await act(write('stuck')); }, ['ref:stuck', 'zone:M1']);
  const sameCell = queue.transaction(async (_room, act) => { await act(write('same-cell')); }, ['ref:other', 'zone:M1']);
  const other = queue.transaction(async (_room, act) => { await act(write('other')); }, ['ref:b', 'zone:M2']);
  const unlaned = queue.transaction(async (_room, act) => { await act(write('unlaned')); });
  await other;
  // The next card was saved while the first still waits; the same cell and the work without lanes still wait for it.
  expect(posts).toEqual(['other']);
  release();
  await Promise.all([stuck, sameCell, unlaned]);
  expect(posts).toEqual(['other', 'stuck', 'same-cell', 'unlaned']);
});

it('the per-action latency log is off by default and flags an action over 1 s and over 2 s when on', async () => {
  let release: () => void = () => undefined;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const send = (id: string, type: string, marks: Record<string, number>) => {
    const timing = { id, originAt: 1_000_000, stagesMs: { capture: 0, commit: 100 }, durationsMs: {} } as FieldTiming;
    for (const [stage, elapsedMs] of Object.entries({ watcher: 110, ...marks })) window.dispatchEvent(new CustomEvent('remote-field-latency', { detail: { ...timing, stage, elapsedMs, type } }));
  };
  try {
    send('off:removed', 'removed', { queued: 120, httpState: 3500 });
    expect(warn).not.toHaveBeenCalled();
    release = holdFieldLatencyLog();
    send('on:removed', 'removed', { queued: 120, dequeued: 130, mutation: 2900, httpState: 3500 }); // 3.4 s after emit, the wait inside the work
    send('on:flipped', 'flipped', { queued: 120, dequeued: 130, mutation: 140, httpState: 1400 }); // 1.3 s
    send('on:moved', 'moved', { queued: 120, dequeued: 130, mutation: 140, httpState: 500 }); // 0.4 s, no flag
    const lines = warn.mock.calls.map(call => String(call[0]));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('removed 3400 ms (>2 s) longest step: dequeued→mutation');
    expect(lines[1]).toContain('flipped 1300 ms (>1 s)');
  } finally { release(); warn.mockRestore(); }
});

it('a card leaving a field cell and the new pile top keep their order, so the pile order is saved', async () => {
  const room = tapRoom(), posts: string[] = [];
  const queue = createRoomMutationQueue(() => room, async proposal => { await Promise.resolve(); posts.push((proposal as unknown as { tag: string }).tag); return { lastSeq: posts.length } as never; });
  const write = (tag: string) => ({ type: 'phase.advance', actorSeat: 0, tag }) as never;
  // X leaves M1 for the graveyard (move, then the pile order); the new graveyard top T is placed at the same time.
  const departure = queue.transaction(async (_room, act) => { await act(write('x.move')); await Promise.resolve(); await act(write('x.pile.order')); }, laneOf(['x'], ['M1', ...PILE_LANES]));
  const newTop = queue.transaction(async (_room, act) => { await act(write('t.move')); }, laneOf(['t'], ['GY']));
  const elsewhere = queue.transaction(async (_room, act) => { await act(write('other')); }, laneOf(['o'], ['M4']));
  await Promise.all([departure, newTop, elsewhere]);
  expect(posts.filter(tag => tag !== 'other')).toEqual(['x.move', 'x.pile.order', 't.move']);
});
