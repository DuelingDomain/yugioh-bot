import { describe, expect, it, vi } from "vitest";
import { limitWorkerOperations, type DuelGameWorker, type GameOptions } from "../src/worker-client.js";

import { WorkerPool } from "../src/worker-pool.js";

const methods = ["create", "view", "answer", "search", "eliminate", "setChainMode", "diagnostics"] as const;

describe("worker operation deadlines", () => {
  it.each(methods)("bounds a stuck %s operation and closes the worker", async (method) => {
    vi.useFakeTimers();
    let closed = 0;
    let released = 0;
    const worker = { running: true, close: async () => { closed++; },
      [method]: () => new Promise(() => {}),
    } as unknown as DuelGameWorker;
    const limited = limitWorkerOperations(worker, 20, () => { released++; }, 20);
    try {
      const result = (limited[method] as () => Promise<unknown>)();
      const check = expect(result).rejects.toMatchObject({ status: 503, message: "The duel engine did not answer in time." });
      await vi.advanceTimersByTimeAsync(20);
      await check;
      expect(limited.running).toBe(false);
      await limited.close();
      expect(closed).toBe(1);
      expect(released).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it("bounds close but retains capacity until it completes", async () => {
    vi.useFakeTimers();
    let released = 0;
    let finish: () => void;
    const worker = { running: true, close: () => new Promise<void>((resolve) => { finish = resolve; }) } as unknown as DuelGameWorker;
    const limited = limitWorkerOperations(worker, 20, () => { released++; });
    try {
      const check = expect(limited.close()).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(20);
      await check;
      expect(released).toBe(0);
      finish!();
      await vi.advanceTimersByTimeAsync(0);
      expect(released).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it("closing cancels pending reads immediately", async () => {
    const worker = { running: true, view: () => new Promise(() => {}), close: async () => {} } as unknown as DuelGameWorker;
    const limited = limitWorkerOperations(worker, 10000, () => {});
    const read = expect(limited.view(0)).rejects.toMatchObject({ status: 503 });
    await limited.close();
    await read;
  });
});


it("lets create run past the live operation deadline", async () => {
  vi.useFakeTimers();
  let finish: () => void;
  const worker = { running: true, create: () => new Promise<void>((resolve) => { finish = resolve; }), close: async () => {} } as unknown as DuelGameWorker;
  const limited = limitWorkerOperations(worker, 15000, () => {});
  try {
    const created = limited.create({} as GameOptions);
    const check = expect(created).resolves.toBeUndefined();
    void check.catch(() => {});
    await vi.advanceTimersByTimeAsync(119999);
    expect(limited.running).toBe(true);
    finish!();
    await check;
    await limited.close();
  } finally { vi.useRealTimers(); }
});

it("bounds create at the separate creation deadline", async () => {
  vi.useFakeTimers();
  const worker = { running: true, create: () => new Promise(() => {}), close: async () => {} } as unknown as DuelGameWorker;
  const limited = limitWorkerOperations(worker, 20, () => {}, 80);
  try {
    const check = expect(limited.create({} as GameOptions)).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(79);
    expect(limited.running).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await check;
    await limited.close();
  } finally { vi.useRealTimers(); }
});

it("retains global and player capacity until close completes and releases it once", async () => {
  vi.useFakeTimers();
  const pool = new WorkerPool(1, 1);
  const release = await pool.acquire([1]);
  let finish: () => void;
  let releases = 0;
  const worker = { running: true, close: () => new Promise<void>((resolve) => { finish = resolve; }) } as unknown as DuelGameWorker;
  const limited = limitWorkerOperations(worker, 20, () => { releases++; release(); });
  try {
    const check = expect(limited.close()).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(20);
    await check;
    await expect(pool.acquire([2])).rejects.toMatchObject({ status: 429 });
    expect(releases).toBe(0);
    finish!();
    await vi.advanceTimersByTimeAsync(0);
    const next = await pool.acquire([1]);
    await expect(limited.close()).rejects.toMatchObject({ status: 503 });
    expect(releases).toBe(1);
    await expect(pool.acquire([2])).rejects.toMatchObject({ status: 429 });
    await expect(pool.acquire([1])).rejects.toMatchObject({ status: 429 });
    next();
  } finally { vi.useRealTimers(); }
});


it("bounds initialization as a whole while letting its journal calls exceed the live deadline", async () => {
  vi.useFakeTimers();
  const worker = { running: true, create: async () => {},
    view: () => new Promise((resolve) => { setTimeout(resolve, 60); }), close: async () => {},
  } as unknown as DuelGameWorker;
  const limited = limitWorkerOperations(worker, 20, () => {}, 100);
  try {
    const check = expect(limited.initialize(async () => {
      await limited.create({} as GameOptions);
      await limited.view(0);
      await limited.view(0);
    })).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(99);
    expect(limited.running).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await check;
    await limited.close();
  } finally { vi.useRealTimers(); }
});

it("does not free a worker slot when close fails without completing", async () => {
  let released = 0;
  const worker = { running: false, close: async () => { throw new Error("Close failed"); } } as unknown as DuelGameWorker;
  const limited = limitWorkerOperations(worker, 20, () => { released++; });
  await expect(limited.close()).rejects.toThrow("Close failed");
  expect(released).toBe(0);
});
