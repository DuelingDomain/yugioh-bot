// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReplayController } from "@/components/duel/replay-controller";

// The router says ?frame=f3 while the address bar still shows the previous page or frame.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("frame=f3") }));

afterEach(cleanup);

describe("useReplayController on a client-side move", () => {
  it.each(["/duels/fork-1", "/duels/game-1/replay?frame=f1"])("starts on the routed frame when the old address is %s", address => {
    window.history.replaceState(null, "", address);
    const frames = Array.from({ length: 6 }, (_, i) => ({ frameId: `f${i}` }));
    const { result } = renderHook(() => useReplayController({ slug: "game-1", frames, seatCount: 2, mySeat: 0 }));
    expect(result.current.index).toBe(3);
    expect(result.current.frameId).toBe("f3");
  });
});
