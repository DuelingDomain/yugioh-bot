import { describe, expect, it } from "vitest";
import { firstDiff } from "./harness.js";
import { splitMessages, toHex } from "./raw-messages.js";
import type { Trace, TraceStep } from "./trace.js";

const step = (over: Partial<TraceStep> = {}): TraceStep => ({ status: 0, messages: ['{"type":2}'], raw: ["0201"], parseWarnings: [], field: "f", ...over });
const trace = (...steps: TraceStep[]): Trace => ({ steps });

describe("differential firstDiff", () => {
  it("finds no difference in equal traces", () => {
    expect(firstDiff(1, trace(step(), step()), trace(step(), step()))).toBeNull();
  });

  it("finds a raw byte difference that the parsed messages do not show", () => {
    const diff = firstDiff(7, trace(step(), step({ raw: ["0201", "a00005"] })), trace(step(), step({ raw: ["0201", "a00007"] })));
    expect(diff).toMatchObject({ seed: 7, step: 1, kind: "raw", expected: "a00005", actual: "a00007" });
    expect(diff?.message).toContain("message 1 of 2 differ at byte 2");
  });

  it("finds a raw message that only one core wrote", () => {
    const diff = firstDiff(7, trace(step()), trace(step({ raw: ["0201", "05"] })));
    expect(diff).toMatchObject({ kind: "raw", expected: "(none)", actual: "05" });
  });

  it("reports a parsed message difference before a raw difference", () => {
    const diff = firstDiff(7, trace(step()), trace(step({ messages: ['{"type":3}'], raw: ["0301"] })));
    expect(diff?.kind).toBe("messages");
  });
});

describe("splitMessages", () => {
  it("splits a getMessage buffer at the u32 length of each message", () => {
    const buffer = Uint8Array.from([2, 0, 0, 0, 0x5a, 0x01, 1, 0, 0, 0, 0x28, 0, 0, 0, 0]);
    expect(splitMessages(buffer).map(toHex)).toEqual(["5a01", "28", ""]);
  });

  it("keeps a truncated tail so a bad length still shows as a difference", () => {
    expect(splitMessages(Uint8Array.from([9, 0, 0, 0, 1, 2])).map(toHex)).toEqual(["0102"]);
    expect(splitMessages(Uint8Array.from([1, 0])).map(toHex)).toEqual(["0100"]);
  });
});
