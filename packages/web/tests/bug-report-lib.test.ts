import { describe, expect, it } from "vitest";
import {
  buildIssueBody, fence, issueTitle, parseBugReportRequest, validateBugText, redactText, sanitizeText,
} from "@/lib/bug-report";

const ZW = "​";

describe("sanitizeText", () => {
  it("breaks @mentions and #123 references so nobody is pinged or linked", () => {
    const out = sanitizeText("thanks @octocat, see #12 and fixes #7 @everyone");
    expect(out).not.toMatch(/@[A-Za-z]/);
    expect(out).not.toMatch(/#\d/);
    expect(out.replaceAll(ZW, "")).toBe("thanks @octocat, see #12 and fixes #7 @everyone");
  });
  it("caps the length and strips control characters", () => {
    expect(sanitizeText("a".repeat(9000))).toHaveLength(4000);
    expect(sanitizeText("a\u0000b‮c\r\nd")).toBe("abc\nd");
  });
  it("is stable when applied twice", () => {
    const once = sanitizeText("hi @bob #3");
    expect(sanitizeText(once)).toBe(once);
  });
});

describe("fence", () => {
  it("uses a longer fence than any backtick run in the text", () => {
    const text = "before\n```\n# Injected heading\n```\n````";
    const block = fence(text);
    expect(block.startsWith("`````text\n")).toBe(true);
    expect(block.endsWith("\n`````")).toBe(true);
  });
});

const valid = {
  description: "The turn never ended after my attack",
  expected: "The turn should end normally",
  path: "/duels/abc?x=1#top",
  duelSlug: "abc",
  context: { format: "ffa3", seat: 1, turn: 4, phase: "main1", livingPlayers: 3, log: ["Turn 4"], viewport: { width: 1200, height: 800 }, timestamp: "2026-10-03T10:00:00Z" },
};

describe("parseBugReportRequest", () => {
  it("accepts a full request and drops the query and hash from the path", () => {
    const parsed = parseBugReportRequest(valid);
    expect(parsed).toMatchObject({ ok: true, value: { path: "/duels/abc", duelSlug: "abc", description: "The turn never ended after my attack", expected: "The turn should end normally" } });
  });
  it("keeps a valid duplicateOf and refuses a bad one", () => {
    expect(parseBugReportRequest({ ...valid, duplicateOf: 12 })).toMatchObject({ ok: true, value: { duplicateOf: 12 } });
    expect(parseBugReportRequest(valid)).toMatchObject({ ok: true });
    for (const bad of [0, -1, 1.5, "12", 2_000_000_000]) expect(parseBugReportRequest({ ...valid, duplicateOf: bad }).ok).toBe(false);
  });
  it("refuses unknown fields at every level", () => {
    expect(parseBugReportRequest({ ...valid, playerId: 3 }).ok).toBe(false);
    expect(parseBugReportRequest({ ...valid, context: { ...valid.context, hand: ["Dark Magician"] } }).ok).toBe(false);
    expect(parseBugReportRequest({ ...valid, context: { viewport: { width: 1, height: 2, extra: 3 } } }).ok).toBe(false);
  });
  it.each([
    ["no description", { ...valid, description: "   " }],
    ["a non-string description", { ...valid, description: 5 }],
    ["an absolute path", { ...valid, path: "https://evil.example/x" }],
    ["a protocol-relative path", { ...valid, path: "//evil.example" }],
    ["a bad slug", { ...valid, duelSlug: "a b" }],
    ["a bad format", { ...valid, context: { format: "5v5" } }],
    ["a fractional turn", { ...valid, context: { turn: 1.5 } }],
    ["a non-array log", { ...valid, context: { log: "x" } }],
  ])("refuses %s", (_name, body) => {
    expect(parseBugReportRequest(body).ok).toBe(false);
  });
  it("never keeps a log the browser sent: the server builds the log", () => {
    const log = ["You added Dark Magician to your hand", "Turn 3"];
    const parsed = parseBugReportRequest({ ...valid, context: { log } });
    expect(parsed.ok && parsed.value.context.log).toBeUndefined();
  });
});

describe("validateBugText", () => {
  it("accepts a clear description and expectation", () => {
    expect(validateBugText({ description: "The turn never ended after my attack", expected: "The turn should end" })).toEqual({});
  });
  it("needs 20 characters and 4 words in the description", () => {
    expect(validateBugText({ description: "It broke", expected: "It should work fine" }).description).toMatch(/at least 20 characters and 4 words/);
    expect(validateBugText({ description: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbb", expected: "It should work fine" }).description).toBeDefined();
    expect(validateBugText({ description: "Chain froze on my turn", expected: "It should work fine" })).toEqual({});
    expect(validateBugText({ description: "... ... ... ... ... ... ...", expected: "It should work fine" }).description).toBeDefined();
  });
  it("needs a description and an expectation", () => {
    expect(validateBugText({})).toEqual({ description: "Tell us what went wrong.", expected: "Tell us what you expected to happen." });
    expect(validateBugText({ description: "   ", expected: "   " })).toMatchObject({ description: expect.any(String), expected: expect.any(String) });
  });
  it("needs 10 characters in the expectation", () => {
    expect(validateBugText({ description: "The turn never ended after my attack", expected: "Work" }).expected).toMatch(/at least 10 characters/);
    expect(validateBugText({ description: "The turn never ended after my attack", expected: "Should move on" }).expected).toBeUndefined();
  });
  it("is what the parser returns as field errors", () => {
    const parsed = parseBugReportRequest({ ...valid, description: "short", expected: "x" });
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.fieldErrors).toMatchObject({ description: expect.any(String), expected: expect.any(String) });
  });
});

describe("buildIssueBody", () => {
  const base = {
    reportId: 42,
    description: "Stuck. cc @someone #9\n```\n# fake section\n```",
    expected: "It moves on",
    path: "/duels/abc",
    duelSlug: "abc",
    context: { format: "ffa3" as const, seat: 0, turn: 4, phase: "main1", turnSeat: 2, livingPlayers: 3, animationSpeed: 1.5, log: ["Turn 4", "Player 1 draws 1 card"], viewport: { width: 1200, height: 800 }, userAgent: "Mozilla/5.0 (X11)", timestamp: "2026-10-03T10:00:00.000Z" },
    baseUrl: "https://duel.example.com",
  };
  it("has every section, the replay link and the report id", () => {
    const body = buildIssueBody(base);
    for (const heading of ["## Description", "## Expected", "## Context", "## Recent log", "## Replay"]) expect(body).toContain(heading);
    expect(body).toContain("https://duel.example.com/duels/abc/replay");
    expect(body).toContain("`Report #42`");
    expect(body).toContain("| Reporter seat | `seat 1` |");
    expect(body).toContain("| Format | `3-player FFA` |");
    expect(body).toContain("Player 1 draws 1 card");
  });
  it("neutralizes mentions and keeps user text inside a code fence", () => {
    const body = buildIssueBody(base);
    expect(body).not.toMatch(/@[A-Za-z]/);
    expect(body).not.toContain("#9");
    // The injected closing fence cannot end the block: the opening fence is longer.
    expect(body).toContain("````text\nStuck.");
  });
  it("leaves out the replay link when there is no duel", () => {
    const body = buildIssueBody({ ...base, duelSlug: null, context: {} });
    expect(body).not.toContain("## Replay");
    expect(body).toContain("_No duel log._");
  });
  it("removes private values wherever they appear", () => {
    const body = buildIssueBody({ ...base, description: "I am Alice123 (user 99887766554433221) in guild 5551234" }, ["Alice123", "99887766554433221", "5551234"]);
    expect(body).not.toMatch(/Alice123|99887766554433221|5551234/);
    expect(body).toContain("[removed]");
  });
  it("never prints a long text in full", () => {
    const body = buildIssueBody({ ...base, description: "x".repeat(20000) });
    expect(body.length).toBeLessThan(6000);
  });
});

describe("issueTitle", () => {
  it("adds the mode tag and cuts the text near 70 characters", () => {
    const title = issueTitle(`${"word ".repeat(40)}`, { format: "ffa4" });
    expect(title.startsWith("[Bug] [FFA4] word word")).toBe(true);
    expect(title.length).toBeLessThanOrEqual("[Bug] [FFA4] ".length + 70);
  });
  it("has no tag without a format and flattens markdown and newlines", () => {
    expect(issueTitle("# Big *bold*\n`code` @bob", {})).toBe(`[Bug] # Big bold code @${ZW}bob`);
  });
});

describe("redactText", () => {
  it("skips values shorter than 3 characters", () => {
    expect(redactText("al is here", ["al"])).toBe("al is here");
  });
});
