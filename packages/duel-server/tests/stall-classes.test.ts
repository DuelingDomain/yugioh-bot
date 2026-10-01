import { describe, expect, it } from "vitest";
import { classifyStall, isBotPolicy, isDebugTrace, type DebugTrace } from "../scripts/lib/stall-classes.js";

const worker = { busy: false, lastOp: "answer", lastOpAt: 1000, callsSinceLastPrompt: 0, messagesSinceLastPrompt: 0 };
const prompt = { id: "p1-2", kind: "choice" };
const trace = (over: Partial<DebugTrace> = {}): DebugTrace => ({
  revision: 10,
  wasmSha: "abc",
  seats: [{ seat: 0 }, { seat: 1 }, { seat: 2 }],
  worker,
  bot: { seats: [{ seat: 0, policy: "human" }, { seat: 1, policy: "scripted" }, { seat: 2, policy: "practice" }] },
  ...over,
});

describe("classifyStall", () => {
  it("core: an answer was given and no prompt followed", () => {
    const v = classifyStall(trace({ worker: { ...worker, busy: true, callsSinceLastPrompt: 3, messagesSinceLastPrompt: 12 } }));
    expect(v.class).toBe("core");
    expect(v.reason).toContain("12 message");
  });

  it("core: also when the worker is idle but produced output after the last prompt", () => {
    expect(classifyStall(trace({ worker: { ...worker, messagesSinceLastPrompt: 2 } })).class).toBe("core");
  });

  it("bot: a bot seat holds the open prompt", () => {
    const v = classifyStall(trace({ seats: [{ seat: 0 }, { seat: 1, prompt }, { seat: 2 }] }), { revision: 10, promptVisible: false });
    expect(v).toMatchObject({ class: "bot", seat: 1 });
    expect(classifyStall(trace({ seats: [{ seat: 2, prompt }] })).class).toBe("bot");
  });

  it("ui: the view has the prompt for a person, the page does not show it", () => {
    const v = classifyStall(trace({ seats: [{ seat: 0, prompt }] }), { revision: 10, promptVisible: false });
    expect(v).toMatchObject({ class: "ui", seat: 0 });
  });

  it("none: the page shows the prompt of a person", () => {
    expect(classifyStall(trace({ seats: [{ seat: 0, prompt }] }), { revision: 10, promptVisible: true }).class).toBe("none");
  });

  it("transport: the server revision is higher than the page revision (wins over the other classes)", () => {
    const t = trace({ seats: [{ seat: 0, prompt }] });
    expect(classifyStall(t, { revision: 9, promptVisible: false }).class).toBe("transport");
    expect(classifyStall(trace({ seats: [{ seat: 1, prompt }] }), { revision: 8, promptVisible: true }).class).toBe("transport");
  });

  it("unknown: a person holds the prompt and there is no page state; or no activity at all", () => {
    expect(classifyStall(trace({ seats: [{ seat: 0, prompt }] })).class).toBe("unknown");
    expect(classifyStall(trace()).class).toBe("unknown");
    expect(classifyStall({ revision: 1 } as DebugTrace).class).toBe("unknown");
    expect(classifyStall({} as DebugTrace).class).toBe("unknown");
  });

  it("knows bot policies and the debug-trace shape", () => {
    expect(isBotPolicy("scripted")).toBe(true);
    expect(isBotPolicy("human")).toBe(false);
    expect(isBotPolicy(null)).toBe(false);
    expect(isDebugTrace(trace())).toBe(true);
    expect(isDebugTrace({ revision: 1 })).toBe(false);
    expect(isDebugTrace(null)).toBe(false);
  });
});
