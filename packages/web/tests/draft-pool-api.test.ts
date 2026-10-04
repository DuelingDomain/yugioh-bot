import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCubeDetail, fetchSets, resolvePasscodes } from "../src/components/draft/pool/pool-api";

const card = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Card ${id}`,
  type: "Effect Monster",
  frameType: "effect",
  ...extra,
});

/** The resolve route answers 200 with the passcodes it lacks in unknownIds. */
function stubResolve(known: Set<number>, unreachable = false) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (unreachable) return new Response(JSON.stringify({ error: "down" }), { status: 500 });
    const ids = (JSON.parse(String(init?.body)) as { customCardIds: number[] }).customCardIds;
    return new Response(
      JSON.stringify({ cards: ids.filter((id) => known.has(id)).map((id) => card(id)), unknownIds: ids.filter((id) => !known.has(id)) }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("resolvePasscodes", () => {
  it("resolves a clean paste in one request", async () => {
    const fetchMock = stubResolve(new Set([1, 2, 3]));
    const out = await resolvePasscodes([1, 2, 3, 3]);
    expect(out.cards.map((c) => c.id).sort()).toEqual([1, 2, 3]);
    expect(out.unknownIds).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the unknownIds the server returns, in one request", async () => {
    const fetchMock = stubResolve(new Set([1, 2, 4]));
    const out = await resolvePasscodes([1, 2, 3, 4]);
    expect(out.cards.map((c) => c.id).sort()).toEqual([1, 2, 4]);
    expect(out.unknownIds).toEqual([3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the card list is unreachable, so it isn't reported as unknown passcodes", async () => {
    stubResolve(new Set(), true);
    await expect(resolvePasscodes([1, 2, 3])).rejects.toThrow();
  });
});

describe("fetchCubeDetail", () => {
  function stubCube(opts: { main: Array<[number, number]>; sets?: Array<[number, number, Record<string, unknown>?]>; custom?: number[] }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/cubes/5") {
          return Response.json({
            pools: { main: opts.main.map(([catalogCardId, maxCopies]) => ({ catalogCardId, maxCopies })), extra: [] },
            cards: [],
          });
        }
        const body = JSON.parse(String(init?.body)) as { setNames?: string[]; customCardIds?: number[] };
        if (body.setNames) {
          return Response.json({ cards: (opts.sets ?? []).map(([id, qty, extra]) => card(id, { qty, ...extra })), unknownIds: [] });
        }
        return Response.json({ cards: (body.customCardIds ?? []).map((id) => card(id)), unknownIds: [] });
      }),
    );
  }

  it("builds the pool from cube cards, config sets and leftover passcodes, taking the larger count per card", async () => {
    stubCube({
      main: [[1, 3], [2, 1]],
      sets: [[2, 2], [3, 1], [9, 1, { type: "XYZ Monster", frameType: "xyz" }]],
      custom: [],
    });
    const detail = await fetchCubeDetail({ id: 5, setNames: ["Set"], customCardIds: [1, 4, 4, 3] });
    expect(Object.fromEntries(detail.main)).toEqual({ 1: 3, 2: 2, 3: 1, 4: 2 });
  });

  it("reads a config-only cube from its sets and passcodes", async () => {
    stubCube({ main: [], sets: [[7, 1]] });
    const detail = await fetchCubeDetail({ id: 5, setNames: ["Set"], customCardIds: [8, 8] });
    expect(Object.fromEntries(detail.main)).toEqual({ 7: 1, 8: 2 });
  });
});

describe("fetchSets", () => {
  it("passes the search text to the server", async () => {
    const fetchMock = vi.fn(async () => Response.json({ sets: [{ setName: "Metal Raiders", setCode: "MRD", cardCount: 1 }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchSets("  metal ")).map((s) => s.setName)).toEqual(["Metal Raiders"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/sets?q=metal");
    await fetchSets("");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/sets");
  });
});
