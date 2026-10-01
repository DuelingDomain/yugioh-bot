import type { FuzzFailure } from "./driver.js";

/**
 * Real defects the fuzzer found that are reported but not fixed yet. The smoke test lists them and
 * does not fail on them, so that it can still catch new problems. Set FUZZ_STRICT=1 to make them fail.
 * Remove an entry when the defect is fixed.
 */
export interface KnownIssue {
  id: string;
  summary: string;
  matches(failure: FuzzFailure): boolean;
}

export const KNOWN_ISSUES: KnownIssue[] = [];

export function knownIssueFor(failure: FuzzFailure): KnownIssue | null {
  return KNOWN_ISSUES.find((issue) => issue.matches(failure)) ?? null;
}
