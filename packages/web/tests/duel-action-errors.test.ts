import { describe, expect, it } from "vitest";
import { DuelRequestError } from "@/components/duel/api";
import {
  ANSWER_REJECTED_NOTICE, CHOICE_CLOSED_NOTICE, SURRENDER_UNSUPPORTED_NOTICE, duelActionErrorText,
} from "@/lib/duel/action-errors";

describe("duelActionErrorText", () => {
  it.each([true, false])("explains a restarting 503 (seatPick: %s)", seatPick => {
    const err = new DuelRequestError("restarting", 503);
    expect(duelActionErrorText(err, { seatPick })).toBe("The duel server is restarting. Try again in a moment.");
  });

  it("keeps restart-like text for other statuses and error types", () => {
    expect(duelActionErrorText(new DuelRequestError("restarting", 409))).toBe("restarting");
    expect(duelActionErrorText(new DuelRequestError("restarting soon", 503))).toBe("restarting soon");
    expect(duelActionErrorText(new Error("restarting"))).toBe("restarting");
  });

  it("maps an unsupported-core surrender 409 to a short notice", () => {
    const err = new DuelRequestError("This engine cannot eliminate a surrendering duelist", 409);
    expect(duelActionErrorText(err)).toBe(SURRENDER_UNSUPPORTED_NOTICE);
    expect(SURRENDER_UNSUPPORTED_NOTICE).toBe("This server's duel engine is out of date and can't accept a surrender. The creator can cancel the duel.");
  });

  it("maps a stale-choice 409 to a short notice", () => {
    const err = new DuelRequestError("That choice is stale. Refresh the current duel state.", 409);
    expect(duelActionErrorText(err)).toBe(CHOICE_CLOSED_NOTICE);
    expect(duelActionErrorText(err, { seatPick: true })).toBe(CHOICE_CLOSED_NOTICE);
  });

  it.each([true, false])("uses the seat-left code before the 400 fallback (seatPick: %s)", (seatPick) => {
    const err = new DuelRequestError("Invalid answer", 400, "seat_left");
    expect(duelActionErrorText(err, { seatPick })).toBe("That player has left. Pick again.");
  });

  it.each([true, false])("keeps the exact seat-left text without a code (seatPick: %s)", (seatPick) => {
    const err = new DuelRequestError("That player has left. Pick again.", 400);
    expect(duelActionErrorText(err, { seatPick })).toBe("That player has left. Pick again.");
  });

  it("keeps the old seat-pick fallback for an unknown code or a different text", () => {
    expect(duelActionErrorText(new DuelRequestError("Invalid answer", 400, "unknown"), { seatPick: true })).toBe(ANSWER_REJECTED_NOTICE);
    expect(duelActionErrorText(new DuelRequestError("That player has left", 400), { seatPick: true })).toBe(ANSWER_REJECTED_NOTICE);
  });

  it("gives a general notice for a 400 on a seat pick, never a guess about the cause", () => {
    const err = new DuelRequestError("Invalid answer", 400);
    expect(duelActionErrorText(err, { seatPick: true })).toBe(ANSWER_REJECTED_NOTICE);
    expect(ANSWER_REJECTED_NOTICE).not.toMatch(/left/i);
  });

  it("keeps the server text of a 400 on any other request, answers to other prompts included", () => {
    expect(duelActionErrorText(new DuelRequestError("Invalid answer", 400))).toBe("Invalid answer");
    expect(duelActionErrorText(new DuelRequestError("Invalid answer", 400), { seatPick: false })).toBe("Invalid answer");
  });

  it("keeps the text of a 400 that is not an answer", () => {
    expect(duelActionErrorText(new DuelRequestError("Seed must be 4 decimal strings", 400))).toBe("Seed must be 4 decimal strings");
  });

  it("keeps the text of other errors", () => {
    expect(duelActionErrorText(new DuelRequestError("You surrendered this duel", 409), { seatPick: true })).toBe("You surrendered this duel");
    expect(duelActionErrorText(new DuelRequestError("Worker down", 503))).toBe("Worker down");
    expect(duelActionErrorText(new Error("boom"))).toBe("boom");
    expect(duelActionErrorText("nope")).toBe("Action failed");
  });
});
