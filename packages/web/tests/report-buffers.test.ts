// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  Ring, clicks, frames, consoleErrors, installReportCapture, isTypingTarget, recordClick, recordFrame, errorSignature,
  MAX_CLICKS, MAX_FRAMES,
} from "@/components/duel/report-buffers";

describe("ring buffers", () => {
  it("keeps only the newest items", () => {
    const r = new Ring<number>(3);
    for (let i = 0; i < 10; i++) r.push(i);
    expect(r.snapshot()).toEqual([7, 8, 9]);
  });
  it("frames keep 200 and clicks keep 20", () => {
    for (let i = 0; i < 300; i++) recordFrame("in", `f${i}`);
    expect(frames.size).toBe(MAX_FRAMES);
    expect(frames.snapshot().at(-1)?.data).toBe("f299");
    document.body.innerHTML = `<button id="b" aria-label="Go">x</button>`;
    for (let i = 0; i < 30; i++) recordClick(document.getElementById("b"));
    expect(clicks.size).toBe(MAX_CLICKS);
    expect(clicks.snapshot()[0]).toMatchObject({ tag: "button", label: "Go" });
  });
  it("detects typing targets", () => {
    document.body.innerHTML = `<input id="i"><textarea id="t"></textarea><div id="d"></div>`;
    expect(isTypingTarget(document.getElementById("i"))).toBe(true);
    expect(isTypingTarget(document.getElementById("t"))).toBe(true);
    expect(isTypingTarget(document.getElementById("d"))).toBe(false);
  });
  it("makes the same signature for the same error", () => {
    expect(errorSignature("boom", "a.js", 3)).toBe(errorSignature("boom", "a.js", 3));
    expect(errorSignature("boom", "a.js", 3)).not.toBe(errorSignature("boom", "a.js", 4));
  });
  it("captures clicks, console errors and WebSocket frames after install", () => {
    const before = frames.size;
    class FakeWS extends EventTarget { send = () => {}; constructor(public url: string) { super(); } }
    (window as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
    installReportCapture();
    installReportCapture();
    const ws = new window.WebSocket("ws://x") as unknown as FakeWS;
    ws.dispatchEvent(new MessageEvent("message", { data: "42[\"duel:changed\"]" }));
    expect(frames.size).toBe(Math.min(MAX_FRAMES, before + 1));
    expect(frames.snapshot().at(-1)?.data).toContain("duel:changed");
    const n = consoleErrors.size;
    console.error("bad thing");
    expect(consoleErrors.size).toBeGreaterThan(n);
  });
});
