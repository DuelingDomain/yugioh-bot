import { afterEach, expect, it, vi } from 'vitest';
import type { RemoteActionProposal } from '@yugidraft/shared/remote';
import { retryFieldMutation } from '../src/lib/remote/field-proposals';
import { noteOutage, noteReachable, noteWriteLost, reconnecting } from '../src/lib/remote/outage';
import { tapRoom } from './tap-room-fixture';

afterEach(() => { vi.useRealTimers(); noteReachable(); });

it('a field write that fails while the server restarts is retried with one key, shows one notice, and is applied once', async () => {
  vi.useFakeTimers();
  const keys: string[] = [], applied = new Map<string, number>(), notices: unknown[] = [];
  let down = 3;
  // Like postAction: a lost connection notes the outage and resolves to null; a reachable server saves the key once.
  const act = vi.fn(async (_proposal: unknown, key?: string) => {
    keys.push(key!);
    if (down-- > 0) { noteOutage(new TypeError('Failed to fetch')); noteWriteLost(); return null; }
    noteReachable(); applied.set(key!, (applied.get(key!) ?? 0) + 1);
    return { lastSeq: 7 } as never;
  });
  const proposal = { type: 'twin.move', source: 'auto', actorSeat: 0, seat: 0, cardRef: 'c1', zone: 'monster', slot: 1 } as never;
  const run = retryFieldMutation(act, proposal, 'key-1', () => true, error => notices.push(error));
  await vi.advanceTimersByTimeAsync(0);
  expect(reconnecting()).toBe(true);
  await vi.advanceTimersByTimeAsync(0.5e3 + 1e3 + 2e3);
  expect((await run)?.lastSeq).toBe(7);
  expect(keys).toEqual(['key-1', 'key-1', 'key-1', 'key-1']);
  expect(applied.get('key-1')).toBe(1);
  expect(notices).toEqual([]); // no raw error text for a lost connection
  expect(reconnecting()).toBe(false); // the single shared notice clears on the first success
});

it('two clicks while reconnecting apply once, and a manual action gives up after about 20 s', async () => {
  vi.useFakeTimers();
  const { createRoomMutationQueue } = await import('../src/lib/remote/room-mutations');
  const applied = new Map<string, number>(), keys: string[] = [], told: string[] = [];
  let down = 1;
  const post = vi.fn(async (_proposal: unknown, key?: string) => {
    keys.push(key!);
    if (down-- > 0) { noteOutage(new TypeError('Failed to fetch')); noteWriteLost(); return null; }
    noteReachable(); applied.set(key!, (applied.get(key!) ?? 0) + 1);
    return { lastSeq: 3 } as never;
  });
  const room = { lastSeq: 2, slug: 't', state: { seats: [] } } as never;
  const queue = createRoomMutationQueue(() => room, post as never, e => told.push(e.message));
  const lp = { type: 'lp.change', actorSeat: 0, seat: 0, delta: -1000, reason: 'Manual adjustment' } as never;
  const first = queue.action(lp);
  await vi.advanceTimersByTimeAsync(0);
  expect(reconnecting()).toBe(true);
  expect(await queue.action(lp)).toBeNull(); // the second click is refused, not queued
  expect(told).toEqual(['Reconnecting… try again in a moment.']);
  await vi.advanceTimersByTimeAsync(600);
  expect((await first)?.lastSeq).toBe(3);
  expect(keys).toHaveLength(2); expect(new Set(keys).size).toBe(1);
  expect([...applied.values()]).toEqual([1]);
  // The server stays away: the manual action ends with one calm message after the cap.
  down = 1e9; told.length = 0;
  const lost = queue.action(lp);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await lost).toBeNull();
  expect(told).toEqual(['Could not reach the table. Check the connection and try again.']);
});

it('saves a placeholder and its name in order while a log write is still in flight', async () => {
  const { createRoomMutationQueue } = await import('../src/lib/remote/room-mutations');
  let room = tapRoom();
  const slow = Promise.withResolvers<void>();
  const placement = Promise.withResolvers<void>();
  const post = vi.fn(async (proposal: RemoteActionProposal, _key?: string) => {
    if (proposal.type === 'log.note') await slow.promise;
    if (proposal.type === 'twin.place' && proposal.card.ref === 'c1') await placement.promise;
    room = { ...room, lastSeq: room.lastSeq + 1 };
    return room;
  });
  const queue = createRoomMutationQueue(() => room, post);
  const note = queue.action({ type: 'log.note', actorSeat: 0, text: 'A note' }, 'note');
  const scope = { seat: 0, cardRef: 'c1', cell: { zone: 'monster', slot: 1 } };
  const place = queue.transaction((_room, act) => act({
    type: 'twin.place', source: 'auto', actorSeat: 0, seat: 0, zone: 'monster',
    card: { ref: 'c1', slot: 1, faceUp: true, position: 'attack' },
  }, 'place'), scope);
  const identify = queue.transaction((_room, act) => act({
    type: 'card.identified', actorSeat: 0, seat: 0, source: 'auto', cardRef: 'c1', cardId: 123,
  }, 'name'), scope);
  const other = queue.transaction((_room, act) => act({
    type: 'twin.place', source: 'auto', actorSeat: 0, seat: 0, zone: 'monster',
    card: { ref: 'c2', slot: 2, faceUp: true, position: 'attack' },
  }, 'other'), { seat: 0, cardRef: 'c2', cell: { zone: 'monster', slot: 2 } });
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(post.mock.calls.map(([, key]) => key)).toEqual(['note', 'place', 'other']);
    placement.resolve();
    await identify;
    expect(post.mock.calls.map(([, key]) => key)).toEqual(['note', 'place', 'other', 'name']);
  } finally {
    slow.resolve();
    placement.resolve();
    await Promise.allSettled([note, place, identify, other]);
  }
});
