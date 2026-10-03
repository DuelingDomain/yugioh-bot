import assert from "node:assert/strict";
import { test } from "node:test";
import { browserEntries, firstError, journalEntries, lastProgress, mergeTimeline, parseTime, renderTimelineMarkdown, stackEntry, summariseFrame } from "../helpers/timeline.ts";

test("parseTime reads ISO and SQLite UTC times", () => {
  assert.equal(parseTime("2026-09-30T20:19:06.624Z"), Date.parse("2026-09-30T20:19:06.624Z"));
  assert.equal(parseTime("2026-09-30 20:19:06"), Date.parse("2026-09-30T20:19:06Z"));
});

test("summariseFrame names the Socket.IO event and clips", () => {
  assert.match(summariseFrame('42["duel:update",{"slug":"a","revision":4}]'), /^42 duel:update \{"slug":"a","revision":4\}/);
  assert.ok(summariseFrame("x".repeat(1000)).length < 300);
  assert.equal(summariseFrame("0{sid}"), "0{sid}");
});

test("stackEntry parses a log line and flags errors", () => {
  const ok = stackEntry("2026-09-30T20:19:06.624Z ws [ws] client connected: abc");
  assert.equal(ok?.source, "stack:ws");
  assert.equal(ok?.level, "info");
  const bad = stackEntry("2026-09-30T20:19:07.000Z duel TypeError: boom, unhandled rejection");
  assert.equal(bad?.level, "error");
  assert.equal(stackEntry("no time here"), null);
});

test("mergeTimeline orders by time and keeps input order on ties", () => {
  const browser = browserEntries({
    player: "p1",
    console: [{ at: "2026-09-30T10:00:02.000Z", type: "error", text: "boom", page: 1 }],
    pageErrors: [],
    requests: [{ at: "2026-09-30T10:00:03.000Z", kind: "http-error", method: "POST", url: "http://x/api/duels/a/actions", detail: '409 {"error":"stale"}', page: 1 }],
    frames: [{ at: "2026-09-30T10:00:01.000Z", event: "received", payload: '42["e",{}]', socket: 1 }],
  });
  const journal = journalEntries({ slug: "a", commands: [{ seq: 1, seat: 1, at: "2026-09-30 10:00:01", command: { promptId: "p7", revision: 3, answer: { kind: "select" } } }] });
  const stack = [stackEntry("2026-09-30T10:00:02.500Z web GET /x 500")!];
  const merged = mergeTimeline(browser, stack, journal);
  assert.deepEqual(merged.map((entry) => entry.kind), ["ws", "answer", "console", "stack", "request"]);
  assert.equal(firstError(merged)?.kind, "console");
  assert.equal(lastProgress(merged)?.kind, "answer");
  assert.match(journal[0]!.text, /seat 1 prompt p7 revision 3/);
});

test("renderTimelineMarkdown puts first error and last progress first", () => {
  const entries = mergeTimeline(
    journalEntries({ slug: "a", commands: [{ seq: 1, seat: 0, at: "2026-09-30T10:00:00.000Z", command: { promptId: "p1", revision: 1, answer: 1 } }] }),
    [{ t: Date.parse("2026-09-30T10:00:05.000Z"), at: "2026-09-30T10:00:05.000Z", source: "p2", kind: "page-error", level: "error", text: "page error TypeError x" }],
  );
  const md = renderTimelineMarkdown(entries, "a > b", { testError: "expect failed\nmore" });
  const lines = md.split("\n");
  assert.match(lines[2]!, /^First error: .*TypeError x/);
  assert.match(md, /Test error: expect failed/);
  assert.match(md, /Last progress: .*answer #1/);
});

test("renderTimelineMarkdown drops old frames first when long", () => {
  const entries = mergeTimeline(
    Array.from({ length: 50 }, (_, index) => ({ t: index, at: new Date(index).toISOString(), source: "p1", kind: "ws" as const, level: "info" as const, text: `frame ${index}` })),
    [{ t: 100, at: new Date(100).toISOString(), source: "stack:web", kind: "stack", level: "error", text: "kept" }],
  );
  const md = renderTimelineMarkdown(entries, "t", { maxLines: 10 });
  assert.match(md, /41 oldest WebSocket lines left out/);
  assert.match(md, /kept/);
  assert.match(md, /frame 49/);
  assert.doesNotMatch(md, /frame 0\b/);
});
