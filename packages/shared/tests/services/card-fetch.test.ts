import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

describe("card fetch transport", () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it.each([400, 401, 403, 404, 429, 503])("retains HTTP %s for callers to distinguish permanent failures", async (status) => {
    const { fetchCardResource } = await import("../../src/services/card-fetch.js");
    await expect(fetchCardResource("https://images.ygoprodeck.com/images/cards/1.jpg",
      async () => new Response("error", { status }), (response) => response.text()))
      .rejects.toMatchObject({ name: "CardFetchError", status });
  });

  it.each([
    [undefined, 5], ["2", 2], ["invalid", 5], ["0", 5],
  ] as const)("limits request starts with CARD_FETCH_REQUESTS_PER_SECOND=%s", async (setting, rate) => {
    vi.stubEnv("CARD_FETCH_REQUESTS_PER_SECOND", setting);
    const { fetchCardResource } = await import("../../src/services/card-fetch.js");
    const starts: number[] = [];
    const fetch = vi.fn(async () => { starts.push(Date.now()); return new Response("ok"); });
    const results = Promise.all(Array.from({ length: rate + 1 }, (_, i) =>
      fetchCardResource(`https://${i % 2 ? "images" : "db"}.ygoprodeck.com/card`, fetch, (r) => r.text())));
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toHaveLength(rate);
    await vi.advanceTimersByTimeAsync(1);
    await results;
    expect(starts).toHaveLength(rate + 1);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1000 / rate);
  });

  it.each([[undefined, 32], ["2", 2]] as const)("rejects a full queue with CARD_FETCH_QUEUE_LIMIT=%s", async (setting, limit) => {
    vi.stubEnv("CARD_FETCH_QUEUE_LIMIT", setting);
    const { fetchCardResource, CardFetchError } = await import("../../src/services/card-fetch.js");
    const fetch = vi.fn(async () => new Response("ok"));
    const call = () => fetchCardResource("https://db.ygoprodeck.com/card", fetch, (r) => r.text());
    const jobs = Promise.all(Array.from({ length: limit + 1 }, call));
    await expect(call()).rejects.toBeInstanceOf(CardFetchError);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await jobs;
    const recovered = call();
    await vi.runAllTimersAsync();
    await expect(recovered).resolves.toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(limit + 2);
  });

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
