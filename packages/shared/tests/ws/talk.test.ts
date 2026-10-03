import { describe, expect, it } from "vitest";
import { DRAFT_BROADCAST_KINDS } from "../../src/ws/events.js";
import { TALK_COOLDOWN_MS, TALK_LINES, createTalkLimiter, isTalkLine, talkText } from "../../src/ws/talk.js";

describe("table talk lines", () => {
  it("has the six fixed lines of the design, with their words", () => {
    expect(TALK_LINES.map((l) => l.text)).toEqual(["gg", "lol", "nice", "hurry up", "no way", "gl"]);
  });

  it("accepts a known id and nothing else", () => {
    for (const line of TALK_LINES) expect(isTalkLine(line.id)).toBe(true);
    for (const bad of ["", "hurry up", "GG", "gg ", "__proto__", "constructor", "<b>x</b>", 1, null, undefined, {}, ["gg"]]) {
      expect(isTalkLine(bad)).toBe(false);
    }
  });

  it("turns an id into its words", () => {
    expect(talkText("hurry")).toBe("hurry up");
    expect(talkText("noway")).toBe("no way");
  });

  it("is a kind of draft broadcast", () => {
    expect(DRAFT_BROADCAST_KINDS).toContain("talk");
  });
});

describe("table talk cooldown", () => {
  it("lets a sender talk, then makes them wait", () => {
    let t = 10_000;
    const limiter = createTalkLimiter({ now: () => t });
    expect(limiter.take("d:1")).toEqual({ ok: true });
    t += 1000;
    expect(limiter.take("d:1")).toEqual({ ok: false, retryAfterMs: TALK_COOLDOWN_MS - 1000 });
    t += TALK_COOLDOWN_MS - 1000;
    expect(limiter.take("d:1")).toEqual({ ok: true });
  });

  it("does not restart the wait on a refused attempt", () => {
    let t = 0;
    const limiter = createTalkLimiter({ cooldownMs: 3000, now: () => t });
    limiter.take("a");
    t = 2900;
    expect(limiter.take("a").ok).toBe(false);
    t = 3000;
    expect(limiter.take("a").ok).toBe(true);
  });

  it("keeps senders apart", () => {
    const limiter = createTalkLimiter({ now: () => 5 });
    expect(limiter.take("a").ok).toBe(true);
    expect(limiter.take("b").ok).toBe(true);
    expect(limiter.take("a").ok).toBe(false);
  });
});
