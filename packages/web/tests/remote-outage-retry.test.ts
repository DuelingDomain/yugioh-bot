import { afterEach, expect, it, vi } from 'vitest';
import { retryFieldMutation } from '../src/lib/remote/field-proposals';
import { noteOutage, noteReachable, noteWriteLost, reconnecting } from '../src/lib/remote/outage';

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
