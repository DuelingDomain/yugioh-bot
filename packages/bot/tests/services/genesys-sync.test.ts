import cron from "node-cron";
import { afterEach, expect, it, vi } from "vitest";
import { createGenesysPointsSync } from "@yugidraft/shared/services";

afterEach(() => vi.useRealTimers());

it("syncs at startup and on the weekly UTC cron, then stops", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T05:59:58Z"));
  const syncGenesysPoints = vi.fn(async () => undefined);
  const job = createGenesysPointsSync({ cards: { syncGenesysPoints }, schedule: cron.schedule });
  try {
    await job.start();
    await job.start();
    expect(syncGenesysPoints).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(syncGenesysPoints).toHaveBeenCalledTimes(2);
    await job.stop();
    await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000);
    expect(syncGenesysPoints).toHaveBeenCalledTimes(2);
  } finally { await job.stop(); }
});

it("accepts cron/timezone and official effective date overrides", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T10:59:58Z"));
  const syncGenesysPoints = vi.fn(async () => undefined);
  const job = createGenesysPointsSync({ cards: { syncGenesysPoints }, schedule: cron.schedule,
    expression: "0 7 * * 1", timezone: "America/Toronto", effectiveDate: "2026-10-05", expectedRevision: "tcg-sha256-verified" });
  try {
    await job.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(syncGenesysPoints.mock.calls).toEqual([
      [{ effectiveDate: "2026-10-05", expectedRevision: "tcg-sha256-verified" }],
      [{ effectiveDate: "2026-10-05", expectedRevision: "tcg-sha256-verified" }],
    ]);
  } finally { await job.stop(); }
});

it("coalesces overlapping ticks and drains the in-flight startup sync", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T05:59:58Z"));
  let release!: () => void;
  const syncGenesysPoints = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const job = createGenesysPointsSync({ cards: { syncGenesysPoints }, schedule: cron.schedule });
  const started = job.start();
  await vi.advanceTimersByTimeAsync(3000);
  expect(syncGenesysPoints).toHaveBeenCalledTimes(1);
  let stopped = false;
  const stop = job.stop().then(() => { stopped = true; });
  await Promise.resolve();
  expect(stopped).toBe(false);
  release();
  await Promise.all([started, stop]);
  await job.tick();
  await job.start();
  expect(syncGenesysPoints).toHaveBeenCalledTimes(1);
});

it("reports an upstream failure and retries on the next cron", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T05:59:58Z"));
  const failure = new Error("offline");
  const syncGenesysPoints = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
  const onError = vi.fn();
  const job = createGenesysPointsSync({ cards: { syncGenesysPoints }, schedule: cron.schedule, onError });
  try {
    await job.start();
    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(3000);
    expect(syncGenesysPoints).toHaveBeenCalledTimes(2);
  } finally { await job.stop(); }
});
