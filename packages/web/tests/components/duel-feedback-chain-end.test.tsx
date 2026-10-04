// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

const play = vi.fn();
vi.mock("@/components/duel/feedback-audio", () => ({
  createDuelFeedbackAudio: () => ({
    unlock: async () => true,
    setMuted: () => undefined,
    setVolume: () => undefined,
    play,
    playBattle: () => undefined,
    stopAll: () => undefined,
    dispose: () => undefined,
  }),
}));

import { DuelFeedback } from "@/components/duel/feedback";
import { planChainBeats, resetChainBeats } from "@/components/duel/chain-beats";
import { chainStepDelay } from "@/components/duel/chain-state";

let id = 100;
const ev = (kind: DuelEvent["kind"], text: string, chainIndex?: number): DuelEvent => ({
  id: id++, kind, text, ...(chainIndex != null ? { chainIndex } : {}),
});

const view = (events: DuelEvent[]) => (
  <DuelFeedback events={events} duelKey="t" soundEnabled reducedMotion={false} />
);

const confirmation = (location: number, extra: Partial<DuelEvent> = {}): DuelEvent => ({
  ...ev("confirm", "Confirmed Kojikocy"), seat: 0,
  zone: { controller: 0, location, sequence: 0 },
  card: { code: 1184620, name: "Kojikocy", description: "", type: 17,
    attack: 1500, defense: 1200, level: 4, attribute: 1, race: "warrior" },
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  play.mockClear();
  resetChainBeats("t");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DuelFeedback chain end", () => {
  it.each([false, true])("keeps target updates out of banners and sound queues (reduced motion %s)", (reducedMotion) => {
    const feedback = (events: DuelEvent[]) => <DuelFeedback events={events} duelKey="t" soundEnabled reducedMotion={reducedMotion} />;
    const { container, rerender } = render(feedback([]));
    const activate = ev("activate", "Mystical Space Typhoon", 1);
    const target = { ...ev("target", "Chain Link 1 targets 1 card", 1), targets: [{ controller: 1, location: 8, sequence: 0 }] };
    rerender(feedback([activate, target]));
    expect(container.querySelector('[data-kind="activate"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2100); });
    expect(container.querySelector("[data-kind]")).toBeNull();
    act(() => { vi.runAllTimers(); });
    expect(container.textContent).toBe("");
    expect(play).not.toHaveBeenCalledWith("target");
  });

  it("shows no centre banner when the chain ends, but still plays its quiet cue", () => {
    const { container, rerender } = render(view([]));
    const end = ev("chain-end", "Chain ended");
    rerender(view([end]));
    expect(container.querySelector('[data-kind="chain-end"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Chain end/i);
    expect(play).toHaveBeenCalledWith("chain-end");
  });

  it("shows no banner for a link resolving or resolved, but keeps their quiet cues", () => {
    const { container, rerender } = render(view([]));
    const resolving = ev("chain-resolving", "chain-resolving", 1);
    const resolved = ev("chain-resolved", "chain-resolved", 1);
    rerender(view([resolving, resolved]));
    act(() => { vi.advanceTimersByTime(50); });
    expect(container.querySelector('[data-kind="chain-resolving"]')).toBeNull();
    expect(container.querySelector('[data-kind="chain-resolved"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Resolving|Resolved/);
    expect(play).toHaveBeenCalledWith("chain-resolving");
    expect(play).toHaveBeenCalledWith("chain-resolved");
  });

  it("does not let a resolving or resolved link queue up behind or in front of other banners", () => {
    const { container, rerender } = render(view([]));
    const events = [ev("chain-resolving", "chain-resolving", 2), ev("chain-resolved", "chain-resolved", 2), ev("chain-resolving", "chain-resolving", 1), ev("chain-negated", "chain-negated", 1)];
    rerender(view(events));
    act(() => { vi.advanceTimersByTime(0); });
    // The Negated banner is the first and only banner: nothing waits behind a resolving banner.
    expect(container.querySelector('[data-kind="chain-negated"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(container.querySelector("[data-kind]")).toBeNull();
  });

  it("makes no toast for a recover event: the chain panel says it", () => {
    const { container, rerender } = render(view([]));
    rerender(view([{ ...ev("recover", "Gained 800 LP"), amount: 800, seat: 0 }]));
    act(() => { vi.advanceTimersByTime(50); });
    expect(container.querySelector('[data-kind="recover"]')).toBeNull();
    expect(container.querySelector("[data-kind]")).toBeNull();
    expect(container.textContent).not.toMatch(/800/);
  });

  it("still shows the Activate banner, with the link number", () => {
    const { container, rerender } = render(view([]));
    const activate = ev("activate", "Mirror Force", 2);
    rerender(view([activate]));
    const cue = container.querySelector('[data-kind="activate"]');
    expect(cue).not.toBeNull();
    expect(cue?.textContent).toContain("Activate");
    expect(cue?.textContent).toContain("Chain 2");
    expect(cue?.textContent).toContain("Mirror Force");
  });

  it("still shows the Negated banner", () => {
    const { container, rerender } = render(view([]));
    rerender(view([ev("chain-negated", "chain-negated", 1)]));
    const cue = container.querySelector('[data-kind="chain-negated"]');
    expect(cue).not.toBeNull();
    expect(cue?.textContent).toContain("Negated");
  });

  it("holds the Negated banner and the resolve sounds until the board plays their beat", () => {
    const { container, rerender } = render(view([]));
    const events = [ev("chain-resolving", "chain-resolving", 1), ev("chain-negated", "chain-negated", 1), ev("chain-resolved", "chain-resolved", 1)];
    planChainBeats(events, { now: performance.now(), reduced: false, duelKey: "t" });
    rerender(view(events));
    act(() => { vi.advanceTimersByTime(0); });
    // Beat one (resolving) is due now; the negated beat is one step later, the resolved beat after that.
    expect(play).toHaveBeenCalledWith("chain-resolving");
    expect(play).not.toHaveBeenCalledWith("chain-resolved");
    expect(container.querySelector('[data-kind="chain-negated"]')).toBeNull();
    act(() => { vi.advanceTimersByTime(chainStepDelay("chain-resolving", 2, false) + 10); });
    expect(container.querySelector('[data-kind="chain-negated"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(chainStepDelay("chain-negated", 1, false) + 10); });
    expect(play).toHaveBeenCalledWith("chain-resolved");
  });
});

describe("DuelFeedback confirmations", () => {
  it.each([
    { location: 2, reducedMotion: false },
    { location: 2, reducedMotion: true },
    { location: 8, reducedMotion: false },
    { location: 8, reducedMotion: true },
  ])("leaves confirmations to MoveFx without delaying other banners (location=$location, reduced=$reducedMotion)", ({ location, reducedMotion }) => {
    const feedback = (events: DuelEvent[]) => <DuelFeedback events={events} duelKey="t" soundEnabled reducedMotion={reducedMotion} />;
    const { container, rerender, getByRole } = render(feedback([]));
    const confirm = confirmation(location, location === 2 ? { moveId: 17 } : {});
    const activate = ev("activate", "Mirror Force", 1);
    rerender(feedback([confirm, activate]));
    expect(container.querySelector('[data-kind="confirm"]')).toBeNull();
    expect(container.querySelector('[data-kind="activate"]')).not.toBeNull();
    act(() => { vi.runAllTimers(); });
    expect(container.querySelector("[data-kind]")).toBeNull();
    expect(getByRole("log", { name: "Card confirmations" }).textContent).toBe("Confirmed Kojikocy");
    expect(play).not.toHaveBeenCalledWith("confirm");
  });

  it("announces each public confirmation once, including a batch and repeated rolling windows", () => {
    const feedback = render(view([]));
    const live = feedback.getByRole("log", { name: "Card confirmations" });
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.getAttribute("aria-relevant")).toBe("additions");
    expect(live.textContent).toBe("");
    const first = confirmation(2, { moveId: 17 });
    const second = confirmation(8, { text: "Confirmed Majespecter Tempest",
      card: { ...first.card!, code: 2572890, name: "Majespecter Tempest" } });
    feedback.rerender(view([first, second]));
    const announcements = [...live.children];
    expect(announcements.map((entry) => entry.textContent)).toEqual(["Confirmed Kojikocy", "Confirmed Majespecter Tempest"]);
    feedback.rerender(view([{ ...first }, { ...second }, ev("move", "A card moved")]));
    act(() => { vi.runAllTimers(); });
    expect([...live.children]).toEqual(announcements);
    expect(live.children).toHaveLength(2);
    expect(feedback.container.querySelector('[data-kind="confirm"]')).toBeNull();
  });

  it("does not announce confirmation history or redacted identities", () => {
    const historical = confirmation(2);
    const feedback = render(view([historical]));
    const live = feedback.getByRole("log", { name: "Card confirmations" });
    expect(live.textContent).toBe("");
    feedback.rerender(view([historical, confirmation(8, { card: undefined, text: "A card was confirmed" })]));
    expect(live.textContent).toBe("");
    expect(play).not.toHaveBeenCalledWith("confirm");
  });

  it("announces replay confirmations once and clears them when the duel changes", () => {
    const confirm = confirmation(8);
    const feedback = render(<DuelFeedback events={[confirm]} duelKey="t" soundEnabled reducedMotion replayFrom={0} />);
    const live = feedback.getByRole("log", { name: "Card confirmations" });
    expect(live.children).toHaveLength(1);
    expect(live.textContent).toBe("Confirmed Kojikocy");
    feedback.rerender(<DuelFeedback events={[confirm]} duelKey="t" soundEnabled reducedMotion replayFrom={0} />);
    expect(live.children).toHaveLength(1);
    feedback.rerender(<DuelFeedback events={[]} duelKey="next" soundEnabled reducedMotion />);
    expect(live.textContent).toBe("");
  });

  it("does not repeat a replay confirmation when Strict Mode replays the effects", () => {
    const confirm = confirmation(2, { moveId: 17 });
    const feedback = render(<React.StrictMode>
      <DuelFeedback events={[confirm]} duelKey="t" soundEnabled reducedMotion replayFrom={0} />
    </React.StrictMode>);
    const live = feedback.getByRole("log", { name: "Card confirmations" });
    expect(live.children).toHaveLength(1);
    expect(live.textContent).toBe("Confirmed Kojikocy");
  });
});
