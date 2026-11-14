// @vitest-environment jsdom
import { voiceBatchSchema } from "@/lib/remote/voice-diagnostics-schema";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RemoteEvent } from "@yugidraft/shared/remote";
import { VoiceControls } from "@/components/remote/ui/voice-controls";
import { useVoiceDiagnostics } from "@/components/remote/ui/use-voice-diagnostics";
import { utteranceRecord } from "@/lib/remote/voice-diagnostics";
const utterance = (id: string) => utteranceRecord({ id, method: "kws", text: "battle", canonical: "battle phase", context: { turn: 3, phase: "main1", turnSeat: 0, ownSeat: 0 },
  decision: { outcome: "acted", reason: null, actionId: `action-${id}` }, utterance: { hits: [{ keyword: "F1" }], busyMs: 10, audioMs: 900, speechMs: 500 } });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("binds a wrong label to the selected result while newer utterances arrive, and a miss to no utterance plus recent context", () => {
  const onMark = vi.fn(), props = { method: "kws" as const, onMethod: vi.fn(), logging: true, last: utterance("u1"), recentIds: ["u1"], onMark };
  const view = render(<VoiceControls {...props} />);
  expect(screen.getByText("VOICE LOG · text only")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Wrong" }));
  view.rerender(<VoiceControls {...props} last={utterance("u2")} recentIds={["u1", "u2"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Save label" }));
  expect(onMark).toHaveBeenLastCalledWith({ label: "wrong", intended: "nothing", note: "", method: "kws", utteranceId: "u1", contextIds: ["u1"] });
  fireEvent.click(screen.getByRole("button", { name: "It missed me" }));
  fireEvent.change(screen.getByLabelText("Intended command"), { target: { value: "free-text" } });
  fireEvent.change(screen.getByLabelText("Intended words"), { target: { value: "I said main two" } });
  fireEvent.click(screen.getByRole("button", { name: "Save label" }));
  expect(onMark).toHaveBeenLastCalledWith({ label: "missed", intended: "free-text", note: "I said main two", method: "kws", utteranceId: null, contextIds: ["u1", "u2"] });
  view.rerender(<VoiceControls {...props} logging={false} />);
  expect(screen.queryByRole("button", { name: "Wrong" })).toBeNull();
  expect(screen.queryByText("VOICE LOG · text only")).toBeNull();
});
it("never sends for a disabled viewer; sends a later linked undo once, and flushes marks on page hide", async () => {
  vi.useFakeTimers(); vi.setSystemTime(10_000);
  const sent: string[] = [], fetch = vi.fn((_url, options) => { sent.push(options.body); return Promise.resolve(new Response()); });
  vi.stubGlobal("fetch", fetch);
  const hook = renderHook(({ enabled, events }: { enabled: boolean; events: RemoteEvent[] }) => useVoiceDiagnostics(enabled, "table-one", events), { initialProps: { enabled: false, events: [] as RemoteEvent[] } });
  act(() => { hook.result.current.record(utterance("off")); vi.advanceTimersByTime(5000); });
  expect(fetch).not.toHaveBeenCalled();
  hook.rerender({ enabled: true, events: [] });
  act(() => hook.result.current.record(utterance("on")));
  act(() => vi.advanceTimersByTime(5000));
  const undo: RemoteEvent = { id: "undo-on", seq: 2, actorSeat: 0, userId: 101, at: 20000, action: { type: "undo", actorSeat: 0, idempotencyKey: "undo-on", targetActionId: "action-on" } };
  hook.rerender({ enabled: true, events: [undo] });
  hook.rerender({ enabled: true, events: [undo] });
  act(() => { hook.result.current.mark({ method: "kws", label: "missed", utteranceId: null, contextIds: ["on"], intended: "end turn", note: "" }); window.dispatchEvent(new Event("pagehide")); });
  const records = sent.flatMap(body => voiceBatchSchema.parse(JSON.parse(body)).records);
  expect(records.filter(record => record.kind === "undo")).toEqual([{ kind: "undo", method: "kws", at: 20000, utteranceId: "on", actionId: "action-on", msSinceAction: 5000 }]);
  expect(records.filter(record => record.kind === "mark")).toHaveLength(1);
  expect(records.some(record => record.kind === "utterance" && record.utteranceId === "off")).toBe(false);
});
