// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePick } from "../../../src/components/draft/room/use-pick";
import { useDraftStore, type DraftCardDetail } from "../../../src/lib/stores/draft-store";

const pack: DraftCardDetail[] = [1, 2].map((id) => ({
  id,
  passcode: id + 100000,
  name: `Card ${id}`,
  type: "Effect Monster",
  frameType: "effect",
  effectText: "",
  imageUrl: "",
  imageUrlSmall: "",
}));

describe("usePick", () => {
  beforeEach(() => {
    useDraftStore.setState({
      ...useDraftStore.getInitialState(),
      slug: "d",
      currentPack: pack,
      isMyTurn: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders pending changes and refuses a second request while the first is pending", async () => {
    let finish!: (response: Response) => void;
    const request = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchMock = vi.fn().mockReturnValue(request);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePick("d"));
    expect(result.current.pending).toBe(false);

    let sent!: Promise<boolean>;
    act(() => { sent = result.current.pick(1); });
    expect(result.current.pending).toBe(true);
    act(() => useDraftStore.setState({ isMyTurn: true, currentPack: pack }));
    let skipped!: boolean;
    await act(async () => { skipped = await result.current.pick(2); });
    expect(skipped).toBe(false);
    expect(result.current.pending).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({
        ok: true,
        json: async () => ({
          ...useDraftStore.getInitialState(),
          slug: "d",
          packRound: 1,
          pickStep: 1,
          myPool: [pack[0]],
        }),
      } as Response);
      expect(await sent).toBe(true);
    });
    expect(result.current.pending).toBe(false);
  });

  it("does not mark a stale selection pending or send it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useDraftStore.setState({ isMyTurn: false });
    const { result } = renderHook(() => usePick("d"));
    let sent!: boolean;
    await act(async () => { sent = await result.current.pick(1); });
    expect(sent).toBe(false);
    expect(result.current.pending).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
