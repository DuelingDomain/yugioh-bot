import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { bootstrapObservability, awaitObservabilityShutdown } from "../../src/observability/node-bootstrap.js";
import { report, setObservabilityAdapter } from "../../src/observability/index.js";
import { consoleAdapter } from "../../src/observability/console-adapter.js";

class Runtime extends EventEmitter {
  env: NodeJS.ProcessEnv = {};
  exit = vi.fn();
}
afterEach(() => { setObservabilityAdapter(consoleAdapter); vi.restoreAllMocks(); });
it("flushes errors reported during service drain before exiting", async () => {
  const runtime = new Runtime(); runtime.env.SENTRY_DSN = "configured";
  const pending: unknown[] = []; const sent: unknown[] = []; const order: string[] = [];
  const error = new Error("drain failed");
  bootstrapObservability(() => ({
    report(error) { pending.push(error); }, log() {},
    async flush(timeout) { expect(timeout).toBe(2000); sent.push(...pending.splice(0)); order.push("flush"); },
  }), runtime);
  runtime.exit.mockImplementation(() => { order.push("exit"); });
  runtime.once("SIGTERM", async () => {
    await Promise.resolve();
    report(error);
    order.push("drained");
    await awaitObservabilityShutdown();
    runtime.exit(0);
  });
  runtime.emit("SIGTERM");
  await vi.waitFor(() => expect(runtime.exit).toHaveBeenCalledWith(0));
  expect(sent).toEqual([error]);
  expect(order).toEqual(["flush", "drained", "flush", "exit"]);
});

it("caps the final flush after draining at two seconds", async () => {
  vi.useFakeTimers();
  const runtime = new Runtime(); runtime.env.SENTRY_DSN = "configured";
  let draining = false;
  bootstrapObservability(() => ({ report() {}, log() {}, flush: () => draining ? new Promise(() => {}) : Promise.resolve() }), runtime);
  runtime.once("SIGTERM", async () => {
    await Promise.resolve();
    draining = true;
    await awaitObservabilityShutdown();
    runtime.exit(0);
  });
  try {
    runtime.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(1999);
    expect(runtime.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.exit).toHaveBeenCalledWith(0);
  } finally { vi.useRealTimers(); }
});
it.each(["uncaughtException", "unhandledRejection"])("reports %s and flushes before exiting", async signal => {
  const runtime = new Runtime(); runtime.env.SENTRY_DSN = "configured";
  const order: string[] = [];
  runtime.exit.mockImplementation(() => { order.push("exit"); });
  bootstrapObservability(() => ({ report() { order.push("report"); }, log() {}, async flush(timeout) { expect(timeout).toBe(2000); order.push("flush"); } }), runtime);
  runtime.emit(signal, new Error("worker failed"));
  await vi.waitFor(() => expect(runtime.exit).toHaveBeenCalledWith(1));
  expect(order).toEqual(["report", "flush", "exit"]);
});
it("keeps the console adapter with an empty DSN", () => {
  const factory = vi.fn(); const output = vi.spyOn(console, "error").mockImplementation(() => {});
  bootstrapObservability(factory, new Runtime());
  report(new Error("local"));
  expect(factory).not.toHaveBeenCalled(); expect(output).toHaveBeenCalled();
});
it("continues with console when the adapter factory throws", () => {
  const runtime = new Runtime(); runtime.env.SENTRY_DSN = "configured";
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => bootstrapObservability(() => { throw new Error("configuration failed"); }, runtime)).not.toThrow();
});
it("awaits the final SIGTERM flush before the existing shutdown finishes", async () => {
  const runtime = new Runtime(); runtime.env.SENTRY_DSN = "configured";
  const finishes: (() => void)[] = []; const order: string[] = [];
  bootstrapObservability(() => ({ report() {}, log() {}, flush: () => new Promise<void>(resolve => { finishes.push(() => { order.push("flush"); resolve(); }); }) }), runtime);
  runtime.once("SIGTERM", async () => { order.push("drain"); await awaitObservabilityShutdown(); order.push("done"); });
  runtime.emit("SIGTERM");
  expect(order).toEqual(["drain"]);
  expect(finishes).toHaveLength(2);
  finishes[0]();
  await Promise.resolve();
  expect(order).toEqual(["drain", "flush"]);
  finishes[1]();
  await vi.waitFor(() => expect(order).toEqual(["drain", "flush", "flush", "done"]));
  expect(runtime.exit).not.toHaveBeenCalled();
});
it("exits on SIGTERM after flushing when no service drain is registered", async () => {
  const runtime = new Runtime();
  bootstrapObservability(() => { throw new Error("unused"); }, runtime);
  runtime.emit("SIGTERM");
  await vi.waitFor(() => expect(runtime.exit).toHaveBeenCalledWith(0));
});
