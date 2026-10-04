// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreviewCard } from "../../../src/components/draft/room/use-preview";
import type { RoomCard } from "../../../src/components/draft/room/room-model";

const mk = (id: number): RoomCard => ({
  id, passcode: id + 1000, name: `Card ${id}`, type: "Effect Monster", frameType: "effect", attribute: "DARK",
  level: 4, atk: 1000, def: 1000, effectText: "", imageUrl: `/c/${id}.jpg`, imageUrlSmall: `/c/${id}s.jpg`,
});
const [a, b] = [mk(1), mk(2)];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const setup = (first: RoomCard | null = null) =>
  renderHook(({ target }: { target: RoomCard | null }) => usePreviewCard(target), { initialProps: { target: first } });

describe("usePreviewCard", () => {
  it("shows after 120ms of rest and not before", () => {
    const h = setup();
    h.rerender({ target: a });
    act(() => vi.advanceTimersByTime(119));
    expect(h.result.current).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(h.result.current?.card.id).toBe(1);
    expect(h.result.current?.instant).toBe(false);
  });

  it("never shows when the pointer leaves before the wait is over", () => {
    const h = setup(a);
    act(() => vi.advanceTimersByTime(80));
    h.rerender({ target: null });
    act(() => vi.advanceTimersByTime(500));
    expect(h.result.current).toBeNull();
  });

  it("hides at once on leave", () => {
    const h = setup(a);
    act(() => vi.advanceTimersByTime(120));
    expect(h.result.current).not.toBeNull();
    h.rerender({ target: null });
    expect(h.result.current).toBeNull();
  });

  it("moves to the next card with no delay, straight or through a gap", () => {
    const h = setup(a);
    act(() => vi.advanceTimersByTime(120));
    h.rerender({ target: b });
    expect(h.result.current?.card.id).toBe(2);
    expect(h.result.current?.instant).toBe(true);

    h.rerender({ target: null });
    expect(h.result.current).toBeNull();
    act(() => vi.advanceTimersByTime(50));
    h.rerender({ target: a });
    expect(h.result.current?.card.id).toBe(1);
    expect(h.result.current?.instant).toBe(true);
  });

  it("waits again once the pointer has been off the cards for a while", () => {
    const h = setup(a);
    act(() => vi.advanceTimersByTime(120));
    h.rerender({ target: null });
    act(() => vi.advanceTimersByTime(400));
    h.rerender({ target: b });
    expect(h.result.current).toBeNull();
    act(() => vi.advanceTimersByTime(120));
    expect(h.result.current?.card.id).toBe(2);
    expect(h.result.current?.instant).toBe(false);
  });
});
