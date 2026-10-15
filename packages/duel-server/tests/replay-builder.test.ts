import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReplayData, buildReplayFrames, replayBuildLimits, REPLAY_MAX_BUILD_BYTES, ReplayBuildCache } from "../src/replay-builder.js";
import { createReplayCursorCodec, replaySourceVersion } from "../src/replay-cursor.js";
import { multiScriptsFolderHash, pinnedEngineVersion } from "../src/multi-scripts.js";
import { ReplayWorker, replaySource } from "./support/replay-fixtures.js";
import { replayForkTimeoutMs } from "../src/replay-fork.js";
import type { EngineViewHistory } from "../src/engine.js";
import type { DuelEngineView } from "@yugidraft/shared/duels";

const codec = createReplayCursorCodec("builder-test-secret");
const dirs: string[] = [];
const sizeOf = (value: string | string[]) => typeof value === "string" ? Buffer.byteLength(value) + 2 : 5;
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
function input(format: "1v1" | "tag" | "ffa3" | "ffa4" = "1v1") {
  const source = replaySource(format);
  const resources = { dataDirectory: "/trusted/engine", bundleVersion: "test-bundle", multiScriptsDirectory: undefined as string | undefined };
  if (format !== "1v1") {
    const dir = mkdtempSync(join(tmpdir(), "replay-overlay-")); dirs.push(dir);
    writeFileSync(join(dir, "mp-utility.lua"), "-- fixture");
    resources.multiScriptsDirectory = dir;
    source.bundleVersion = pinnedEngineVersion(resources.bundleVersion, source.decks.length, multiScriptsFolderHash(dir));
  }
  return { source, resources, sourceVersion: replaySourceVersion(source), codec, finalView: null };
}

describe("replay frame builder", () => {
  it("projects and transfers only new history during a 1,500-command FFA4 rebuild", async () => {
    const options = input("ffa4");
    options.source.commands = Array.from({ length: 1500 }, (_, index) => ({ storedSeq: index + 1, seat: 0,
      command: { revision: index + 1, promptId: `p${index + 1}`, answer: { choice: "next" } },
    }));
    options.sourceVersion = replaySourceVersion(options.source);
    const encodeView = async (view: DuelEngineView) => {
      const json = JSON.stringify(view); return { json, bytes: Buffer.byteLength(json) };
    };
    const legacy = new ReplayWorker(), legacyView = legacy.view.bind(legacy);
    let legacyTransferredLogs = 0;
    // Model the existing 400-entry engine rings and a worker that projects the whole ring every time.
    legacy.view = async (seat) => {
      const view = await legacyView(seat);
      view.log = view.log.slice(-400);
      legacyTransferredLogs += view.log.length;
      return view;
    };
    const expected = await buildReplayData({ ...options, dataSeat: null, createWorker: () => legacy, encodeView });
    const worker = new ReplayWorker(), originalView = worker.view.bind(worker);
    const historyRequests: Array<EngineViewHistory | undefined> = [];
    let transferredLogs = 0;
    worker.view = async (seat, history?: EngineViewHistory) => {
      historyRequests.push(history);
      const view = await originalView(seat);
      view.log = view.log.slice(-400);
      if (history?.logAfter != null) view.log = view.log.filter((entry) => entry.id > history.logAfter!);
      if (history?.eventsAfter != null) view.events = view.events.filter((entry) => entry.id > history.eventsAfter!);
      transferredLogs += view.log.length;
      return view;
    };
    const data = await buildReplayData({ ...options, dataSeat: null, createWorker: () => worker, encodeView });
    expect(data).toEqual(expected);
    expect(data.frames).toHaveLength(1502);
    expect(data.frames.flatMap((frame) => frame.view.log.map((entry) => entry.id)))
      .toEqual(Array.from({ length: 1501 }, (_, index) => index + 1));
    expect(historyRequests.filter((history) => history?.logAfter === Number.MAX_SAFE_INTEGER)).toHaveLength(1500);
    expect(historyRequests.filter((history) => history === undefined)).toHaveLength(5);
    // Each log once for checkpoints, plus the five full final rings used for verification.
    expect(legacyTransferredLogs).toBe(1_042_800);
    expect(transferredLogs).toBe(1501 + 400 * 5);
    expect(worker.closed).toBe(1);
  });

  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("uses stable %s frame IDs, exact prefixes and independent projection deltas", async format => {
    const options = input(format);
    const workers: ReplayWorker[] = [];
    const build = (dataSeat: number | null) => buildReplayFrames({ ...options, dataSeat,
      createWorker: () => { const worker = new ReplayWorker(); workers.push(worker); return worker; } });
    const mine = await build(0); const other = await build(1); const publicFrames = await build(null);
    expect(mine.map(f => f.frameId)).toEqual(other.map(f => f.frameId));
    expect(mine.map(f => f.frameId)).toEqual(publicFrames.map(f => f.frameId));
    expect(mine.map(f => f.kind)).toEqual(["opening", "engine", "engine", "result"]);
    expect(mine.map(f => f.cursor && codec.open(f.cursor).prefixCount)).toEqual([0, 1, 3, null]);
    expect(mine[1]!.view.log.map(e => e.id)).toEqual([2]);
    expect(other[1]!.view.log[0]!.text).toBe("Private 1 1");
    expect(publicFrames[1]!.view.log[0]!.text).toBe("Public 1");
    expect(publicFrames[0]!.view.seats.every(s => s.hand[0]!.code === undefined)).toBe(true);
    expect(mine[0]!.view.seats[1]!.hand[0]!.code).toBeUndefined();
    for (const frames of [mine, other, publicFrames]) for (const f of frames) {
      expect(f.view.prompt).toBeNull(); expect(f.view.prioritySeat).toBeNull(); expect(f.view).not.toHaveProperty("chainMode");
    }
    expect(workers.every(w => w.closed === 1)).toBe(true);
  });
  it("reveals only hands and Extra Decks on an explicit owner projection", async () => {
    const frames = await buildReplayFrames({ ...input(), dataSeat: null, reveal: true, createWorker: () => new ReplayWorker() });
    expect(frames[0]!.view.seats.map(s => s.hand[0]!.code)).toEqual([900, 901]);
    expect(frames[0]!.view.seats.map(s => s.extra[0]!.code)).toEqual([900, 901]);
    expect(frames[0]!.view.seats.every(s => s.monsters[0]!.code === undefined)).toBe(true);
    expect(frames[0]!.view.log[0]!.text).toBe("Public 0");
  });
  it("makes genuine engine results unplayable without adding a second result", async () => {
    const options = input(); options.source.commands = options.source.commands.slice(0, 1);
    const worker = new ReplayWorker();
    worker.answer = async () => { worker.revision++; worker.result = { winnerSeat: 0, reason: "Life points" }; };
    const frames = await buildReplayFrames({ ...options, dataSeat: 0, createWorker: () => worker });
    expect(frames).toHaveLength(2); expect(frames[1]).toMatchObject({ kind: "result", cursor: null });
    expect(frames[0]!.cursor).toBeTypeOf("string");
  });
  it("refuses cursors for unsequenced old host losses without copying them into early frames", async () => {
    const options = input("ffa3"); options.source.setup!.surrenderedSeats = [1];
    const frames = await buildReplayFrames({ ...options, dataSeat: null, createWorker: () => new ReplayWorker() });
    expect(frames.every(f => f.cursor === null)).toBe(true);
    expect(frames[0]!.view.seats[1]!.eliminated).toBeUndefined();
  });
  it("counts each view once against the wire limit and accounts cache memory separately", async () => {
    const options = input();
    const worker = () => {
      const value = new ReplayWorker(), view = value.view.bind(value);
      value.view = async seat => { const board = await view(seat); return { ...board, log: [{ id: board.revision + 1, text: "x".repeat(30_000) }] }; };
      return value;
    };
    const measured = await buildReplayData({ ...options, dataSeat: null, createWorker: worker });
    const viewBytes = measured.viewJson.reduce((sum, json) => sum + Buffer.byteLength(json), 0);
    const bounded = await buildReplayData({ ...options, dataSeat: null, createWorker: worker, maxBytes: 64 * 1024 + viewBytes + 10_000 });
    expect(bounded.frames).toHaveLength(4);
    expect(bounded.bytes).toBeLessThan(64 * 1024 + viewBytes + 10_000);
    expect(bounded.cacheBytes).toBeGreaterThanOrEqual(viewBytes * 2);
  });
  it("retains every exact checkpoint without move views when an owner replay exceeds the cap", async () => {
    const options = input();
    const worker = new ReplayWorker(), view = worker.view.bind(worker);
    worker.view = async seat => { const board = await view(seat); return board.revision === 1
      ? { ...board, log: [{ id: 1, text: "x".repeat(100_000) }] } : board; };
    const data = await buildReplayData({ ...options, dataSeat: null, createWorker: () => worker,
      maxBytes: 80_000, retainStepsOnOverflow: true });
    expect(data.oversized).toBe(true);
    expect(data.frames).toHaveLength(1); expect(data.frames[0]).toMatchObject({ kind: "result", cursor: null });
    expect(data.steps.map(step => step.cursor?.prefixCount ?? null)).toEqual([0, 1, 3, null]);
    expect(data.steps.every(step => !("view" in step))).toBe(true);
    expect(data.bytes).toBeLessThanOrEqual(80_000);
    expect(worker.closed).toBe(1);
  });
  it("closes on mismatch, byte limit and bounded timeout", async () => {
    for (const failure of ["mismatch", "bytes", "timeout"]) {
      const worker = new ReplayWorker(); const options = input();
      if (failure === "mismatch") options.source.commands[0]!.command.revision = 9;
      if (failure === "timeout") worker.create = () => new Promise(() => {});
      await expect(buildReplayFrames({ ...options, dataSeat: null, createWorker: () => worker,
        maxBytes: failure === "bytes" ? 20 : undefined, timeoutMs: failure === "timeout" ? 20 : undefined })).rejects.toMatchObject({
          code: failure === "mismatch" ? "REPLAY_MISMATCH" : failure === "bytes" ? "REPLAY_TOO_LARGE" : "ENGINE_BUSY" });
      expect(worker.closed).toBe(1);
    }
  });
});

describe("bounded replay cache", () => {
  it("accounts measured bytes without serializing the cache value", async () => {
    const serialize = vi.fn(() => { throw new Error("Host stringify must not run"); });
    const value = { toJSON: serialize };
    const cache = new ReplayBuildCache<typeof value>(() => 7);
    expect(await cache.getOrBuild("measured", async () => value)).toBe(value);
    expect(cache.bytes).toBe(7); expect(serialize).not.toHaveBeenCalled();
  });
  it("deduplicates concurrent builds, retries failures and keeps auth/perspective keys apart", async () => {
    const cache = new ReplayBuildCache(sizeOf, { maxBytes: 100, maxEntries: 2, maxConcurrent: 2 });
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const build = vi.fn(async () => { await wait; return ["a"]; });
    const a = cache.getOrBuild("owner:seat0", build); const b = cache.getOrBuild("owner:seat0", build);
    await Promise.resolve(); expect(build).toHaveBeenCalledTimes(1);
    release(); expect(await a).toEqual(await b);
    await cache.getOrBuild("alpha:public", async () => ["b"]);
    expect(cache.size).toBe(2);
    await expect(cache.getOrBuild("failure", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    expect(await cache.getOrBuild("failure", async () => ["ok"])).toEqual(["ok"]);
  });
  it("queues four builds with at most two workers and shares waiting keys", async () => {
    const cache = new ReplayBuildCache<string>(sizeOf);
    let active = 0, peak = 0;
    const releases: Array<() => void> = [];
    const build = (value: string) => async () => {
      active++; peak = Math.max(peak, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--; return value;
    };
    const jobs = ["a", "b", "c", "d"].map(key => cache.getOrBuild(key, build(key)));
    const same = cache.getOrBuild("c", build("wrong"));
    await Promise.resolve(); expect(active).toBe(2);
    releases.splice(0).forEach(release => release());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(active).toBe(2); releases.splice(0).forEach(release => release());
    expect(await Promise.all(jobs)).toEqual(["a", "b", "c", "d"]);
    expect(await same).toBe("c"); expect(peak).toBe(2);
    await cache.settle();
  });
  it("bounds the wait queue and releases a slot after a build failure", async () => {
    const cache = new ReplayBuildCache<string>(sizeOf, { maxBytes: 100, maxEntries: 2, maxConcurrent: 1, maxWaiting: 1 });
    let release!: () => void;
    const first = cache.getOrBuild("a", async () => { await new Promise<void>(resolve => { release = resolve; }); throw new Error("failed"); });
    const failure = expect(first).rejects.toThrow("failed");
    const waiting = cache.getOrBuild("b", async () => "ok");
    await expect(cache.getOrBuild("c", async () => "overflow")).rejects.toMatchObject({ code: "ENGINE_BUSY" });
    await Promise.resolve(); release(); await failure; expect(await waiting).toBe("ok");
  });
  it("caps long replay budgets and remembers deterministic size failures", async () => {
    const limits = replayBuildLimits(1500, 4);
    expect(limits.timeoutMs).toBeLessThanOrEqual(25_000);
    expect(replayForkTimeoutMs(1500)).toBeLessThanOrEqual(25_000);
    expect(limits.maxBytes).toBe(REPLAY_MAX_BUILD_BYTES);
    const cache = new ReplayBuildCache<string>(sizeOf, { maxBytes: 20, maxEntries: 2, maxConcurrent: 1 });
    const build = vi.fn(async () => "x".repeat(21));
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(cache.getOrBuild("large", build)).rejects.toMatchObject({ code: "REPLAY_TOO_LARGE", status: 413 });
    }
    expect(build).toHaveBeenCalledTimes(1);
  });
  it("evicts by bytes and entries, refuses oversized values and caps detached jobs", async () => {
    const cache = new ReplayBuildCache(sizeOf, { maxBytes: 20, maxEntries: 2, maxConcurrent: 1, maxWaiting: 0 });
    await cache.getOrBuild("a", async () => "12345678"); await cache.getOrBuild("b", async () => "123456789");
    expect(cache.size).toBe(1); expect(cache.bytes).toBeLessThanOrEqual(20);
    await expect(cache.getOrBuild("huge", async () => "x".repeat(21))).rejects.toMatchObject({ code: "REPLAY_TOO_LARGE" });
    let release!: () => void;
    const pending = cache.getOrBuild("slow", () => new Promise<string>(resolve => { release = () => resolve("ok"); }));
    await Promise.resolve();
    await expect(cache.getOrBuild("other", async () => "ok")).rejects.toMatchObject({ code: "ENGINE_BUSY" });
    release(); await pending; cache.clear(); expect(cache.size).toBe(0); expect(cache.bytes).toBe(0);
  });
});
