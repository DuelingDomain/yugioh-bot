import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

describe("card fetch transport", () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(["network", "timeout", "json", "429", "503"])("contains a %s failure", async (failure) => {
    const { fetchCardResource, CardFetchError } = await import("../../src/services/card-fetch.js");
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (failure === "network") throw new Error("private network detail");
      if (failure === "timeout") return new Promise<Response>(() => {});
      if (failure === "json") return new Response("bad json");
      return new Response("", { status: Number(failure), headers: { "Retry-After": "2" } });
    });
    const result = expect(fetchCardResource("https://db.ygoprodeck.com/api/v7/cardinfo.php", fetch,
      (response) => response.json())).rejects.toBeInstanceOf(CardFetchError);
    await vi.runAllTimersAsync();
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["2", new Date(Date.now() + 2000).toUTCString()])("respects Retry-After %s across callers", async (retryAfter) => {
    const { fetchCardResource } = await import("../../src/services/card-fetch.js");
    const fetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": retryAfter } }))
      .mockResolvedValue(new Response('{"data":[]}'));
    const call = () => fetchCardResource("https://db.ygoprodeck.com/api/v7/cardinfo.php", fetch, (r) => r.json());
    await expect(call()).rejects.toThrow(/Try again/);
    await expect(call()).rejects.toThrow(/Try again/);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(call()).resolves.toEqual({ data: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the timeout active while reading a response body", async () => {
    const { fetchCardResource } = await import("../../src/services/card-fetch.js");
    const result = expect(fetchCardResource("https://images.ygoprodeck.com/images/cards/1.jpg",
      async () => ({ ok: true }), () => new Promise(() => {}))).rejects.toThrow(/Try again/);
    await vi.advanceTimersByTimeAsync(8000);
    await result;
  });

  it("closes streaming error bodies before more requests start", async () => {
    vi.useRealTimers();
    const { fetchCardResource } = await import("../../src/services/card-fetch.js");
    let live = 0, maxLive = 0;
    const server = createServer((_request, response) => {
      live++; maxLive = Math.max(maxLive, live);
      response.on("close", () => { live--; });
      response.writeHead(503); response.write("unavailable");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/card`;
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => fetchCardResource(url, fetch, (r) => r.text())));
      expect(results.every((result) => result.status === "rejected")).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(live).toBe(0);
      expect(maxLive).toBeLessThanOrEqual(4);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
