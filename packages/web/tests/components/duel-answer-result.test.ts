import { describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { applyAnswerResult } from "@/components/duel/answer-result";

const room = (extra: Record<string, unknown> = {}) => ({ session: {}, engine: { revision: 4 }, ...extra }) as unknown as DuelRoom;

describe("applyAnswerResult", () => {
  it("applies the answered room without asking for the room again, and does not wait for a second read", async () => {
    const mutate = vi.fn(async () => undefined);
    await applyAnswerResult(mutate, room());
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ engine: { revision: 4 } }), { revalidate: false });
  });

  it("is done as soon as the room is applied, even when a read of the room would take a long time", async () => {
    let calls = 0;
    const mutate = vi.fn((_data?: DuelRoom, options?: { revalidate: boolean }) => {
      calls += 1;
      // A revalidating mutate only returns after the GET: model it as never ending.
      return options?.revalidate === false ? Promise.resolve() : new Promise<void>(() => {});
    });
    await applyAnswerResult(mutate, room());
    expect(calls).toBe(1);
  });

  it("reads again in the background when the duel host marked the room stale, without waiting for it", async () => {
    const pending = new Promise<void>(() => {});
    const mutate = vi.fn((_data?: DuelRoom, options?: { revalidate: boolean }) => (options ? Promise.resolve() : pending));
    await applyAnswerResult(mutate, room({ stale: true }));
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenLastCalledWith();
  });

  it("a background read that fails does not reject the answer", async () => {
    const mutate = vi.fn((_data?: DuelRoom, options?: { revalidate: boolean }) => (options ? Promise.resolve() : Promise.reject(new Error("down"))));
    await expect(applyAnswerResult(mutate, room({ stale: true }))).resolves.toBeUndefined();
  });

  it("reads the room when the reply is not a room", async () => {
    const mutate = vi.fn(async () => undefined);
    await applyAnswerResult(mutate, { session: {} });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith();
    await applyAnswerResult(mutate, undefined);
    expect(mutate).toHaveBeenCalledTimes(2);
  });
});
