// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ygoModule } from "@yugidraft/shared/remote";
import { useVoice, type MicState } from "@/components/remote/ui/use-voice";
import { decideVoice } from "@/components/remote/ui/voice/decision";
import type { VoiceFinal } from "@/components/remote/ui/voice/live-client";

const context = () => ({ state: ygoModule.initialState({ seatCount: 2 }), players: [], me: 0, trayOpen: false });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
it("requests no voice assets or mic for a non-voice viewer, or until a listed viewer unmutes; mute releases the worker", async () => {
  const terminate = vi.fn();
  const workerUrls: string[] = [];
  class FakeWorker {
    onmessage?: (event: { data: unknown }) => void;
    constructor(url: string) { workerUrls.push(url); }
    postMessage(message: { type: string }) { if (message.type === "init") queueMicrotask(() => this.onmessage?.({ data: { type: "ready", accepted: true, fetchMs: 0, initMs: 0, totalMs: 0, bytes: 1, heapBytes: 1 } })); }
    terminate = terminate;
  }
  vi.stubGlobal("Worker", FakeWorker);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const options = { ptt: false, held: false, onFinal: vi.fn(), context };
  const hook = renderHook(({ enabled, state }: { enabled: boolean; state: MicState }) => useVoice({ ...options, enabled, state }), { initialProps: { enabled: false, state: "listen" as MicState } });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(workerUrls).toEqual([]); expect(fetch).not.toHaveBeenCalled(); expect(getUserMedia).not.toHaveBeenCalled();
  hook.rerender({ enabled: true, state: "muted" });
  expect(workerUrls).toEqual([]); expect(getUserMedia).not.toHaveBeenCalled();
  hook.rerender({ enabled: true, state: "listen" });
  await waitFor(() => expect({ error: hook.result.current.micError, workers: workerUrls.length, mic: getUserMedia.mock.calls.length }).toEqual({ error: "", workers: 1, mic: 1 }), { timeout: 15000 });
  expect(workerUrls).toEqual(["/dev/vision-assets/kws/worker.js"]); // no ASR until a keyword hit
  hook.rerender({ enabled: true, state: "muted" });
  expect(terminate).toHaveBeenCalledTimes(1);
});
it("applies the saved method without a worker until unmuted, and tolerates blocked storage", async () => {
  localStorage.setItem("dd-remote-voice-method", "asr");
  const hook = renderHook(() => useVoice({ enabled: true, state: "muted", ptt: false, held: false, onFinal: vi.fn(), context }));
  expect(hook.result.current.method).toBe("asr");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disabled"); });
  act(() => hook.result.current.pickMethod("kws"));
  expect(hook.result.current.method).toBe("kws");
  vi.restoreAllMocks();
});
it("limits live voice to phase/turn grammar and rejects off-turn, muted and illegal phase words", () => {
  const c = context(); c.state = { ...c.state, turn: 3, phase: "main1" };
  const final = (canonical: string): VoiceFinal => ({ id: "u1", method: "asr", text: canonical, canonical, utterance: { id: 1, hits: [], text: canonical, speechMs: 500, audioMs: 1000, busyMs: 20 } });
  expect(decideVoice(final("battle phase"), c, true)).toEqual({ accepted: true, intent: { kind: "phase", phase: "battle" } });
  expect(decideVoice(final("battle phase"), c, false)).toEqual({ accepted: false, reason: "muted" });
  expect(decideVoice(final("battle phase"), { ...c, me: 1 }, true)).toEqual({ accepted: false, reason: "not-turn-player" });
  expect(decideVoice(final("draw phase"), c, true)).toEqual({ accepted: false, reason: "illegal-phase" });
  for (const text of ["minus 500", "undo", "activate effect", "monster zone two"]) expect(decideVoice(final(text), c, true).accepted).toBe(false);
});
