import type { Mock } from "vitest";
import type { ObservabilityAdapter } from "@yugidraft/shared/observability";

export declare function useRecordingObservability(): {
  report: Mock<ObservabilityAdapter["report"]>;
  log: Mock<ObservabilityAdapter["log"]>;
  flush: Mock<ObservabilityAdapter["flush"]>;
  install(): Promise<void>;
};
