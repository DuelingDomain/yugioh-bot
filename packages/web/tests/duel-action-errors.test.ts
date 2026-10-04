import { describe, expect, it } from "vitest";
import { DuelRequestError } from "@/components/duel/api";
import {
  ANSWER_REJECTED_NOTICE, CHOICE_CLOSED_NOTICE, SURRENDER_UNSUPPORTED_NOTICE, duelActionErrorText,
} from "@/lib/duel/action-errors";

describe("duelActionErrorText", () => {
  it("maps an unsupported-core surrender 409 to a short notice", () => {
    const err = new DuelRequestError("This engine cannot eliminate a surrendering duelist", 409);
    expect(duelActionErrorText(err)).toBe(SURRENDER_UNSUPPORTED_NOTICE);
    expect(SURRENDER_UNSUPPORTED_NOTICE).toBe("This duel can't accept a surrender right now.");
  });

  it("maps a stale-choice 409 to a short notice", () => {
    const err = new DuelRequestError("That choice is stale. Refresh the current duel state.", 409);
    expect(duelActionErrorText(err)).toBe(CHOICE_CLOSED_NOTICE);
    expect(duelActionErrorText(err, { answer: true })).toBe(CHOICE_CLOSED_NOTICE);
  });

  it("gives a general notice for a 400 on an answer, never a guess about the cause", () => {
    const err = new DuelRequestError("Invalid answer", 400);
    expect(duelActionErrorText(err, { answer: true })).toBe(ANSWER_REJECTED_NOTICE);
    expect(ANSWER_REJECTED_NOTICE).not.toMatch(/left/i);
  });

  it("keeps the text of a 400 that is not an answer", () => {
    expect(duelActionErrorText(new DuelRequestError("Seed must be 4 decimal strings", 400))).toBe("Seed must be 4 decimal strings");
  });

  it("keeps the text of other errors", () => {
    expect(duelActionErrorText(new DuelRequestError("You surrendered this duel", 409), { answer: true })).toBe("You surrendered this duel");
    expect(duelActionErrorText(new DuelRequestError("Worker down", 503))).toBe("Worker down");
    expect(duelActionErrorText(new Error("boom"))).toBe("boom");
    expect(duelActionErrorText("nope")).toBe("Action failed");
  });
});
