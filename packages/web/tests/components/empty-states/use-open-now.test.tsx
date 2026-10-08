// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyDrafts } from "@/components/empty-states/empty-drafts";
import { useOpenNow } from "@/lib/hooks/use-open-now";
import { EMPTY_OPEN_NOW } from "@/lib/open-now";
import { stubOpenNow } from "../../fixtures/open-now";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

/** The empty page settles as "nothing is open": the ghost, and one primary button. */
async function expectGhostFallback(waitForIt = true) {
  const primary = waitForIt ? await screen.findByRole("link", { name: "New draft" }) : screen.getByRole("link", { name: "New draft" });
  expect(primary.className).toMatch(/primary/);
  expect(document.querySelectorAll("a[class*='primary'], button[class*='primary']")).toHaveLength(1);
  screen.getByText("Once you join one");
}

describe("useOpenNow failure paths", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("settles as nothing open when fetch rejects", async () => {
    stubOpenNow("throw");
    render(<EmptyDrafts />);
    await expectGhostFallback();
  });

  it("settles as nothing open on a 500", async () => {
    stubOpenNow(500);
    render(<EmptyDrafts />);
    await expectGhostFallback();
  });

  it("settles as nothing open when the answer has the wrong shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ tournaments: [{ slug: 4 }], drafts: [], duelsInProgress: 0 })));
    render(<EmptyDrafts />);
    await expectGhostFallback();
  });

  it("settles as nothing open when the answer is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    const { result } = renderHook(() => useOpenNow());
    await vi.waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.data).toEqual(EMPTY_OPEN_NOW);
  });

  it("shows nothing until it settles, then gives up on a hang after 6 seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<EmptyDrafts />);
    expect(screen.queryByRole("link", { name: "New draft" })).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(5999); });
    expect(screen.queryByRole("link", { name: "New draft" })).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await expectGhostFallback(false); // findBy polls on real timers, and these are faked.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not update state when the response lands after unmount", async () => {
    let resolve: (res: Response) => void = () => {};
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>((r) => { resolve = r; });
    }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const renders = vi.fn();
    const { result, unmount } = renderHook(() => {
      const state = useOpenNow();
      renders(state.settled);
      return state;
    });
    const before = renders.mock.calls.length;
    unmount();
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      resolve(Response.json(EMPTY_OPEN_NOW));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.settled).toBe(false);
    expect(renders).toHaveBeenCalledTimes(before);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
