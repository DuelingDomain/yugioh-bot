/**
 * A test that fails today because a core patch is not merged yet.
 *
 * Do not use it.skip or a bare it.fails for this. A skip hides the test. A bare it.fails passes on any failure,
 * also on a crash that has nothing to do with the gap. expectKnownFailure runs the test body and accepts only the
 * one failure that the gap causes. Any other failure stays red. A body that passes also fails, with the message
 * "known gap fixed: remove the expected-failure mark", so the mark goes away when the core patch lands.
 */
export interface KnownGap {
  /** The core patch that is missing. */
  patch: string;
  /** Where the spec names the gap, for example "docs/adr/0002-multiplayer-duel-rules.md:153". */
  spec: string;
  /** Text that must all be in the failure message. Name the step and the assertion, for example `step 15 expectNotOffered(`. */
  failsWith: string[];
}

export function knownGapLabel(gap: KnownGap): string {
  return `expected failure: ${gap.patch}`;
}

export async function expectKnownFailure(gap: KnownGap, body: () => unknown): Promise<void> {
  try {
    await body();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missing = gap.failsWith.filter((text) => !message.includes(text));
    if (missing.length === 0) return;
    // A different failure. Keep it red and keep the original error as the cause.
    throw new Error(
      `A failure that is not the known gap (${gap.patch}, ${gap.spec}).\n` +
      `The failure message does not contain: ${missing.map((text) => JSON.stringify(text)).join(", ")}\n` +
      `Failure:\n${error instanceof Error ? error.stack ?? message : message}`,
      { cause: error },
    );
  }
  throw new Error(`known gap fixed: remove the expected-failure mark (${gap.patch}, ${gap.spec}).`);
}
