// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { LIVE_POLL_MS, useLiveNow } from "../../../src/components/layout/use-live-now";

const LIVE = { yourDuel: null, liveCount: 3 };

function answer(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

const calls = () => vi.mocked(fetch).mock.calls.length;

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
  global.fetch = vi.fn(() => answer(LIVE)) as unknown as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("useLiveNow", () => {
  it("fetches /api/live on mount without caching", async () => {
    const { result } = renderHook(() => useLiveNow("/dashboard"));
    await act(async () => {});
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/live");
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(result.current).toEqual(LIVE);
  });

  it("refetches when the route changes", async () => {
    const { rerender } = renderHook(({ path }) => useLiveNow(path), { initialProps: { path: "/dashboard" } });
    await act(async () => {});
    expect(calls()).toBe(1);
    rerender({ path: "/drafts" });
    await act(async () => {});
    expect(calls()).toBe(2);
  });

  it("polls every 30 seconds while the tab is visible", async () => {
    renderHook(() => useLiveNow("/dashboard"));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    });
    expect(calls()).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    });
    expect(calls()).toBe(3);
  });

  it("does not poll while the tab is hidden, and refetches when it comes back", async () => {
    renderHook(() => useLiveNow("/dashboard"));
    await act(async () => {});
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 3);
    });
    expect(calls()).toBe(1);
    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls()).toBe(2);
  });

  it("skips the refetch when the tab returns within five seconds of the last one", async () => {
    renderHook(() => useLiveNow("/dashboard"));
    await act(async () => {});
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls()).toBe(1);
  });

  it("keeps the last good value after a failed or odd answer", async () => {
    const { result } = renderHook(() => useLiveNow("/dashboard"));
    await act(async () => {});
    expect(result.current).toEqual(LIVE);

    vi.mocked(fetch).mockImplementationOnce(() => answer({ nope: true }, 500));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    });
    expect(result.current).toEqual(LIVE);

    vi.mocked(fetch).mockImplementationOnce(() => Promise.reject(new Error("offline")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    });
    expect(result.current).toEqual(LIVE);

    vi.mocked(fetch).mockImplementationOnce(() => answer({ yourDuel: "bad", liveCount: 1 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    });
    expect(result.current).toEqual(LIVE);
  });

  it("clears the value when signed out (401)", async () => {
    const { result } = renderHook(() => useLiveNow("/dashboard"));
    await act(async () => {});
    vi.mocked(fetch).mockImplementationOnce(() => answer({ error: "no" }, 401));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);
    });
    expect(result.current).toBeNull();
  });

  it("aborts the request in flight on unmount and stops polling", async () => {
    let signal: AbortSignal | undefined;
    global.fetch = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    }) as unknown as typeof fetch;
    const { unmount } = renderHook(() => useLiveNow("/dashboard"));
    await act(async () => {});
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2);
    expect(vi.mocked(fetch).mock.calls.length).toBe(1);
  });

  it("aborts the older request when a newer one starts", async () => {
    const signals: AbortSignal[] = [];
    global.fetch = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise(() => {});
    }) as unknown as typeof fetch;
    const { rerender } = renderHook(({ path }) => useLiveNow(path), { initialProps: { path: "/a" } });
    await act(async () => {});
    rerender({ path: "/b" });
    await act(async () => {});
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});
