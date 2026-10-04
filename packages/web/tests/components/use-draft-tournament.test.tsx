// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDraftTournament } from "../../src/components/draft/use-draft-tournament";

function reply(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

afterEach(() => vi.unstubAllGlobals());

describe("useDraftTournament", () => {
  it("starts as round robin, best of 3, with no tournament", () => {
    const { result } = renderHook(() => useDraftTournament("d1", {}));
    expect(result.current).toMatchObject({ format: "round_robin", bestOf: 3, linked: null, creating: false, error: null });
  });

  it("reports the tournament the draft already has", () => {
    const { result } = renderHook(() => useDraftTournament("d1", { tournamentId: 4, tournamentName: "Cup", tournamentSlug: "cup" }));
    expect(result.current.linked).toEqual({ name: "Cup", webSlug: "cup" });
  });

  it("posts the chosen format and match length, then links the new tournament", async () => {
    const fetchMock = reply(201, { id: 5, name: "Draft Cup", webSlug: "draft-cup", format: "single_elim" });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDraftTournament("d1", {}));
    act(() => {
      result.current.setFormat("single_elim");
      result.current.setBestOf(1);
    });
    await act(() => result.current.create());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/drafts/d1/tournament");
    expect(JSON.parse(init.body)).toEqual({ format: "single_elim", bestOf: 1 });
    expect(result.current.linked).toEqual({ name: "Draft Cup", webSlug: "draft-cup" });
  });

  it("links the existing tournament on a 409", async () => {
    vi.stubGlobal("fetch", reply(409, { id: 3, name: "Old Cup", webSlug: "old-cup", format: "round_robin" }));
    const { result } = renderHook(() => useDraftTournament("d1", {}));
    await act(() => result.current.create());
    expect(result.current.linked).toEqual({ name: "Old Cup", webSlug: "old-cup" });
    expect(result.current.error).toBeNull();
  });

  it("keeps the server message when only the host may create (403)", async () => {
    vi.stubGlobal("fetch", reply(403, { error: "Only the draft creator can create a tournament from this draft" }));
    const { result } = renderHook(() => useDraftTournament("d1", {}));
    await act(() => result.current.create());
    expect(result.current.linked).toBeNull();
    expect(result.current.error).toBe("Only the draft creator can create a tournament from this draft");
    expect(result.current.creating).toBe(false);
  });
});
