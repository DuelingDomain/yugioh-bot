import type { Mock } from "vitest";
import type { ObservabilityAdapter } from "@yugidraft/shared/observability";

export declare function useRecordingObservability(): {
  report: Mock<ObservabilityAdapter["report"]>;
  log: Mock<ObservabilityAdapter["log"]>;
  flush: Mock<ObservabilityAdapter["flush"]>;
  install(): Promise<void>;
};

export declare function useConsoleObservability(): {
  errors: Array<{ name: string; message: string; stack?: string; tags?: Record<string, string>; extra?: Record<string, unknown> }>;
  warnings: Array<{ message: string; fields: Record<string, unknown> }>;
  install(): Promise<void>;
};
