import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("member card fetch budget", () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("refuses the twenty-first pending fetch and accepts another member", async () => {
    const { fetchCardResource } = await import("../../src/services/card-fetch.js");
    const call = (memberId: number) => fetchCardResource("https://db.ygoprodeck.com/card", async () => new Response("ok"), r => r.text(), [], memberId);
    const jobs = Promise.all(Array.from({ length: 20 }, () => call(1)));
    const refused = expect(call(1)).rejects.toMatchObject({ status: 429, message: expect.stringContaining("pending") });
    const other = call(2);
    await Promise.all([vi.runAllTimersAsync(), refused]);
    expect(await jobs).toHaveLength(20);
    expect(await other).toBe("ok");
    const again = call(1);
    await vi.runAllTimersAsync();
    expect(await again).toBe("ok");
  });

  it.each(["failure", "timeout"])("releases a member's pending slots after a %s", async failure => {
    vi.stubEnv("CARD_FETCH_MEMBER_QUEUE_LIMIT", "1");
    const { fetchCardResource } = await import("../../src/services/card-fetch.js");
    const pending = fetchCardResource("https://db.ygoprodeck.com/card", async () => {
      if (failure === "failure") throw new Error("offline");
      return new Promise<Response>(() => {});
    }, r => r.text(), [], 1);
    const failed = expect(pending).rejects.toMatchObject({ name: "CardFetchError" });
    const refused = expect(fetchCardResource("https://db.ygoprodeck.com/card", async () => new Response("ok"), r => r.text(), [], 1))
      .rejects.toMatchObject({ status: 429 });
    await Promise.all([vi.runAllTimersAsync(), failed, refused]);
    const retry = fetchCardResource("https://db.ygoprodeck.com/card", async () => new Response("ok"), r => r.text(), [], 1);
    await vi.runAllTimersAsync();
    expect(await retry).toBe("ok");
  });
});
