import { afterEach, beforeEach, vi } from "vitest";
import * as source from "../../src/observability/index.js";
import * as built from "@yugidraft/shared/observability";
import { consoleAdapter } from "../../src/observability/console-adapter.js";

export function useConsoleObservability() {
  const errors = [];
  const warnings = [];
  const consumers = new Set([source, built]);
  const install = async () => {
    consumers.add(await import("../../src/observability/index.js"));
    consumers.add(await import("@yugidraft/shared/observability"));
    for (const consumer of consumers) consumer.setObservabilityAdapter(consoleAdapter);
  };
  let errorOutput;
  let warnOutput;
  beforeEach(async () => {
    errors.length = 0;
    warnings.length = 0;
    await install();
    errorOutput = vi.spyOn(console, "error").mockImplementation(event => { errors.push(event); });
    warnOutput = vi.spyOn(console, "warn").mockImplementation((message, fields) => { warnings.push({ message, fields }); });
  });
  afterEach(() => {
    errorOutput.mockRestore();
    warnOutput.mockRestore();
  });
  return { errors, warnings, install };
}

export function useRecordingObservability() {
  const adapter = {
    report: vi.fn(),
    log: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
  const consumers = new Set([source, built]);
  const install = async () => {
    // Source tests and workspace consumers have separate module instances.
    consumers.add(await import("../../src/observability/index.js"));
    consumers.add(await import("@yugidraft/shared/observability"));
    for (const consumer of consumers) consumer.setObservabilityAdapter(adapter);
  };
  beforeEach(async () => {
    adapter.report.mockClear();
    adapter.log.mockClear();
    adapter.flush.mockClear();
    await install();
  });
  afterEach(() => {
    for (const consumer of consumers) consumer.setObservabilityAdapter(consoleAdapter);
  });
  return { ...adapter, install };
}
