import { expect, it } from "vitest";
import { GameWorker } from "../src/worker-client.js";
import type { ReportContext } from "@yugidraft/shared/observability";
import { useRecordingObservability } from "../../shared/tests/helpers/recording-observability.mjs";

const recording = useRecordingObservability();
it("preserves the original stack and resolves table context when a real worker fails", async () => {
  const reports: Array<{ error: unknown; context: ReportContext }> = [];
  recording.report.mockImplementation((error, context) => { reports.push({ error, context }); });
  let table = "source-table";
  const worker = new GameWorker(undefined, undefined, () => table);
  try {
    const result = worker.create({ mode: "normal", decks: [], seed: [], dataDirectory: "/tmp/observability-missing-engine" }).catch(error => error as Error);
    // Fork persistence assigns the destination slug while the thread is still running.
    table = "fork-table";
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("stack", expect.stringContaining("worker.ts"));
    expect(reports).toHaveLength(1);
    expect(reports[0].error).toBeInstanceOf(Error);
    expect(reports[0].context).toEqual({ tags: { table: "fork-table" } });
  } finally { await worker.close(); }
}, 15_000);
