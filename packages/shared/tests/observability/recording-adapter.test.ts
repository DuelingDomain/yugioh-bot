import { expect, it, vi } from "vitest";
import * as source from "../../src/observability/index.js";
import * as built from "@yugidraft/shared/observability";
import { useRecordingObservability } from "../helpers/recording-observability.mjs";

it("records source and workspace consumers through their adapters", () => {
  const error = new Error("failed");
  source.report(error, { tags: { operation: "source" } });
  built.log("warn", "Workspace warning", { count: 2 });
  expect(recording.report).toHaveBeenCalledExactlyOnceWith(error, { tags: { operation: "source" } });
  expect(recording.log).toHaveBeenCalledExactlyOnceWith("warn", "Workspace warning", { count: 2 });
});
it("installs the adapter again after a consumer resets modules", async () => {
  vi.resetModules();
  await recording.install();
  const consumer = await import("@yugidraft/shared/observability");
  consumer.log("warn", "Reloaded warning");
  source.log("info", "Original warning");
  expect(recording.log.mock.calls).toEqual([["warn", "Reloaded warning", {}], ["info", "Original warning", {}]]);
});
const recording = useRecordingObservability();
