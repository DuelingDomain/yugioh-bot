// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReplayController } from "@/components/duel/replay-controller";

// The router says the page is moving to ?frame=f3 while the address bar still shows the old (fork) page.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("frame=f3") }));

afterEach(cleanup);

describe("useReplayController on a client-side move", () => {
  it("starts on the frame the router was asked for, not the one in the old address", () => {
    window.history.replaceState(null, "", "/duels/fork-1");
    const frames = Array.from({ length: 6 }, (_, i) => ({ frameId: `f${i}` }));
    const { result } = renderHook(() => useReplayController({ slug: "game-1", frames, seatCount: 2, mySeat: 0 }));
    expect(result.current.index).toBe(3);
    expect(result.current.frameId).toBe("f3");
  });
});
