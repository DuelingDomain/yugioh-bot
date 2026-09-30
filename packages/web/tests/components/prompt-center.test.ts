import { describe, expect, it } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";
import { centerKind, declineAnswer } from "@/components/duel/prompt-center";

function prompt(overrides: Partial<DuelPrompt>): DuelPrompt {
  return { id: "p", seat: 0, kind: "choice", title: "t", options: [], ...overrides };
}

const yesNo = [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }];

describe("centerKind", () => {
  it("leaves the action prompt to the field and station track", () => {
    expect(centerKind(prompt({ context: { type: "action", phase: "main" } }))).toBeNull();
  });

  it("centres responses and picks", () => {
    expect(centerKind(prompt({ context: { type: "chain", forced: false } }))).toBe("response");
    expect(centerKind(prompt({ options: yesNo }))).toBe("response");
    expect(centerKind(prompt({ kind: "number" }))).toBe("response");
    expect(centerKind(prompt({ kind: "cards" }))).toBe("select");
    expect(centerKind(prompt({ kind: "tribute" }))).toBe("select");
    expect(centerKind(prompt({ kind: "places" }))).toBe("select");
    expect(centerKind(prompt({ kind: "order" }))).toBe("grid");
    expect(centerKind(prompt({ kind: "counters" }))).toBe("counters");
    expect(centerKind(null)).toBeNull();
  });
});

describe("declineAnswer", () => {
  it("passes an optional chain response", () => {
    expect(declineAnswer(prompt({ cancelable: true, context: { type: "chain", forced: false } }))).toEqual({ cancel: true });
  });

  it("has no decline for a mandatory chain response", () => {
    expect(declineAnswer(prompt({ context: { type: "chain", forced: true } }))).toBeNull();
    expect(declineAnswer(prompt({ cancelable: true, context: { type: "chain", forced: true } }))).toBeNull();
  });

  it("answers No to a yes/no question", () => {
    expect(declineAnswer(prompt({ options: yesNo }))).toEqual({ choice: "no" });
  });

  it("cancels any other cancelable prompt and leaves mandatory ones alone", () => {
    expect(declineAnswer(prompt({ kind: "cards", cancelable: true }))).toEqual({ cancel: true });
    expect(declineAnswer(prompt({ kind: "cards" }))).toBeNull();
    expect(declineAnswer(prompt({ context: { type: "position" } }))).toBeNull();
  });
});
