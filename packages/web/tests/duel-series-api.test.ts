import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelSeries, createDuel, markDuelReady, readySeries, saveSeriesSideDeck, searchPlayers, unreadySeries } from "../src/components/duel/api";
import { defaultDuelSettings } from "@yugidraft/shared/duels";

afterEach(() => vi.unstubAllGlobals());

function stub(body: unknown = {}, status = 200) {
  const fetchMock = vi.fn().mockImplementation(async () => Response.json(body, { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createDuel", () => {
  const settings = defaultDuelSettings("normal");

  it("sends no series fields when none are chosen", async () => {
    const fetchMock = stub({ session: { slug: "t" } }, 201);
    await createDuel("T", "normal", 5, settings);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).not.toHaveProperty("opponentPlayerId");
    expect(body).not.toHaveProperty("bestOf");
    expect(body).not.toHaveProperty("ranked");
  });

  it("sends the opponent, series length and ranked flag", async () => {
    const fetchMock = stub({ session: { slug: "t" }, series: { id: 1 } }, 201);
    const result = await createDuel("T", "normal", 5, settings, { opponentPlayerId: 9, bestOf: 3, ranked: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ opponentPlayerId: 9, bestOf: 3, ranked: true });
    expect(result.series).toEqual({ id: 1 });
  });
});

describe("series requests", () => {
  it("searches players with an encoded query", async () => {
    const fetchMock = stub({ players: [{ id: 1, displayName: "A B" }] });
    await expect(searchPlayers("a b&c")).resolves.toEqual({ players: [{ id: 1, displayName: "A B" }] });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/players?q=a+b%26c");
  });

  it("posts Ready, side deck, series ready, series un-ready and cancel to their routes", async () => {
    const fetchMock = stub({ series: {}, nextSlug: null, session: {} });
    await markDuelReady("a b");
    await saveSeriesSideDeck("t", { main: [1], extra: [], side: [2] });
    await readySeries("t");
    await unreadySeries("t");
    await cancelSeries(7);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/duels/a%20b/ready",
      "/api/duels/t/series/side",
      "/api/duels/t/series/ready",
      "/api/duels/t/series/unready",
      "/api/duels/series/7/cancel",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ deck: { main: [1], extra: [], side: [2] } });
  });

  it("raises the server message when a series request fails", async () => {
    stub({ error: "Not your series" }, 403);
    await expect(readySeries("t")).rejects.toMatchObject({ message: "Not your series", status: 403 });
    stub({ error: "Nope" }, 409);
    await expect(cancelSeries(7)).rejects.toMatchObject({ message: "Nope", status: 409 });
  });
});
