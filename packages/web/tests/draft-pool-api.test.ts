import { afterEach, describe, expect, it, vi } from "vitest";
import { configPool, createPoolCube, fetchCubeDetail, fetchDraftPools, fetchSets, resolveCardList } from "../src/components/draft/pool/pool-api";

const card = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Card ${id}`,
  type: "Effect Monster",
  frameType: "effect",
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("resolveCardList", () => {
  it("returns entries with their pool, and the lines it could not read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      cards: [card(1), card(9, { type: "Fusion Monster", frameType: "fusion" })],
      entries: [{ id: 1, copies: 3, pool: "main" }, { id: 9, copies: 2, pool: "extra" }],
      unknown: ["Main Deck"],
      corrected: [{ from: "Dark Hol", to: "Dark Hole" }],
    })));
    const out = await resolveCardList("3 Dark Hole");
    expect(out.entries).toEqual([{ id: 1, copies: 3, pool: "main" }, { id: 9, copies: 2, pool: "extra" }]);
    expect(out.unknown).toEqual(["Main Deck"]);
    expect(out.corrected).toHaveLength(1);
  });

  it("keeps the server message and the Retry-After wait when the card list is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Card database is unavailable. Try again shortly." }), {
      status: 503,
      headers: { "Retry-After": "7" },
    })));
    await expect(resolveCardList("x")).rejects.toMatchObject({
      message: "Card database is unavailable. Try again shortly.",
      retryAfter: 7,
    });
  });

  it("keeps the 400 message and has no wait", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "List is too long." }), { status: 400 })));
    const error = await resolveCardList("x").catch((e: unknown) => e);
    expect(error).toMatchObject({ message: "List is too long." });
    expect((error as { retryAfter?: number }).retryAfter).toBeUndefined();
  });
});

describe("fetchCubeDetail", () => {
  it("keeps the actual extra pool with copies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ pools: { main: [{ catalogCardId: 1, maxCopies: 3 }],
      extra: [{ catalogCardId: 9, maxCopies: 5 }] }, cards: [card(9, { type: "Fusion Monster", frameType: "fusion" })] })));
    const detail = await fetchCubeDetail({ id: 5, setNames: [], customCardIds: [] });
    expect(Object.fromEntries(detail.extra)).toEqual({ 9: 5 });
    expect(detail.extraCount).toBe(1);
  });
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

describe("extra pool transport", () => {
  it("sends main and extra copies in separate draft config fields", () => {
    expect(configPool(new Map([[1, 2]]), null, new Map([[9, 3]]))).toEqual({
      setNames: [], customCardIds: [1, 1], customExtraCardIds: [9, 9, 9], poolSource: null,
    });
  });

  it("sends explicit extra entries when saving as a cube", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ cube: { id: 4, name: "New" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await createPoolCube({ name: "New", cards: [{ id: 1, copies: 2 }], extraCards: [{ id: 9, copies: 3 }], copyExtraFromCubeId: 5 });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      kind: "pool", name: "New", cards: [{ id: 1, copies: 2 }], extraCards: [{ id: 9, copies: 3 }], copyExtraFromCubeId: 5,
    });
  });

  it("loads both draft pools while retaining their authored quantities", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cards: [card(1, { qty: 4 })],
      extraCards: [card(9, { qty: 5, type: "Fusion Monster", frameType: "fusion" })] })));
    const pools = await fetchDraftPools("a-b");
    expect(Object.fromEntries(pools.main)).toEqual({ 1: 4 });
    expect(Object.fromEntries(pools.extra)).toEqual({ 9: 5 });
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
