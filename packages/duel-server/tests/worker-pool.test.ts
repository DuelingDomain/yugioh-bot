import { describe, expect, it } from "vitest";
import { WorkerPool } from "../src/worker-pool.js";

describe("worker reservations", () => {
  it("queues rebuilds in order and reserves capacity before waking them", async () => {
    const pool = new WorkerPool(1, 3);
    const release = await pool.acquire([1]);
    const order: number[] = [];
    const first = pool.acquire([], true).then((done) => { order.push(1); return done; });
    const second = pool.acquire([], true).then((done) => { order.push(2); return done; });
    expect(order).toEqual([]);
    release();
    const doneFirst = await first;
    expect(order).toEqual([1]);
    await expect(pool.acquire([2])).rejects.toMatchObject({ status: 429 });
    doneFirst();
    (await second)();
    expect(order).toEqual([1, 2]);
    (await pool.acquire([2]))();
  });

  it("bounds the waiting queue to 32 and cancels it on shutdown", async () => {
    const pool = new WorkerPool(1, 3);
    const release = await pool.acquire([1]);
    const waiting = Array.from({ length: 32 }, () => expect(pool.acquire([], true)).rejects.toMatchObject({ status: 503 }));
    await expect(pool.acquire([], true)).rejects.toMatchObject({ status: 429 });
    pool.close();
    await Promise.all(waiting);
    release();
    await expect(pool.acquire([2])).rejects.toMatchObject({ status: 503 });
  });

  it("releases reservations once and counts overlapping players independently", async () => {
    const pool = new WorkerPool(3, 1);
    const release = await pool.acquire([1, 2]);
    await expect(pool.acquire([2, 3])).rejects.toMatchObject({ status: 429 });
    const other = await pool.acquire([3, 4]);
    release(); release();
    const next = await pool.acquire([1, 2]);
    await expect(pool.acquire([3, 5])).rejects.toMatchObject({ status: 429 });
    other(); next();
  });
});


it("releases players once at Table end while retaining the worker slot", async () => {
  const pool = new WorkerPool(2, 1);
  const first = await pool.acquire([1]);
  first.releasePlayers();
  const second = await pool.acquire([1]);
  await expect(pool.acquire([2])).rejects.toMatchObject({ status: 429, message: "The duel server is busy. Try again in a minute." });
  first.releasePlayers(); first.releasePlayers();
  first(); first();
  await expect(pool.acquire([1])).rejects.toMatchObject({ status: 429, message: "You already have 1 live duels. Finish one first." });
  const third = await pool.acquire([2]);
  second(); third();
});
