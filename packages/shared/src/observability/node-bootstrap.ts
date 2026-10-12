import { consoleAdapter } from "./console-adapter.js";
import { flushObservability, report, setObservabilityAdapter, type ObservabilityAdapter } from "./index.js";

type Runtime = {
  env: NodeJS.ProcessEnv;
  on(event: "uncaughtException" | "unhandledRejection" | "SIGTERM", listener: (error: unknown) => void): unknown;
  listenerCount(event: string): number;
  exit(code: number): unknown;
};
let shutdownFlush: Promise<void> | undefined;

export function awaitObservabilityShutdown(): Promise<void> {
  return shutdownFlush ?? flushObservability(2000);
}

export function bootstrapObservability(factory: () => ObservabilityAdapter, runtime: Runtime = process): void {
  shutdownFlush = undefined;
  setObservabilityAdapter(consoleAdapter);
  if (runtime.env.SENTRY_DSN) {
    try { setObservabilityAdapter(factory()); } catch (error) { report(error); }
  }
  let crashing = false;
  const crash = (error: unknown) => {
    if (crashing) return;
    crashing = true;
    report(error);
    void flushObservability(2000).then(() => runtime.exit(1));
  };
  runtime.on("uncaughtException", crash);
  runtime.on("unhandledRejection", crash);
  runtime.on("SIGTERM", () => {
    const hasDrain = runtime.listenerCount("SIGTERM") > 1;
    shutdownFlush ??= flushObservability(2000);
    if (!hasDrain) void shutdownFlush.then(() => runtime.exit(0));
  });
}
