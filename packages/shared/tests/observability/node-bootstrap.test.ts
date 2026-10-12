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
it("awaits SIGTERM flush before the existing shutdown finishes", async () => {
  const runtime = new Runtime(); runtime.env.SENTRY_DSN = "configured";
  let finish!: () => void; const order: string[] = [];
  bootstrapObservability(() => ({ report() {}, log() {}, flush: () => new Promise<void>(resolve => { finish = () => { order.push("flush"); resolve(); }; }) }), runtime);
  runtime.once("SIGTERM", async () => { order.push("drain"); await awaitObservabilityShutdown(); order.push("done"); });
  runtime.emit("SIGTERM");
  expect(order).toEqual(["drain"]);
  finish();
  await vi.waitFor(() => expect(order).toEqual(["drain", "flush", "done"]));
  expect(runtime.exit).not.toHaveBeenCalled();
});
it("exits on SIGTERM after flushing when no service drain is registered", async () => {
  const runtime = new Runtime();
  bootstrapObservability(() => { throw new Error("unused"); }, runtime);
  runtime.emit("SIGTERM");
  await vi.waitFor(() => expect(runtime.exit).toHaveBeenCalledWith(0));
});
