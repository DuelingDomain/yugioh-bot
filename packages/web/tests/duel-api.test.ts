import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckValidationSkippedError, duelReplayKey, getDuelReplay, getDuelRoom, leaveDuel, listDuels, sendDuelAction, takeDuelSeat, validateDuelDeck } from "../src/components/duel/api";

afterEach(() => vi.unstubAllGlobals());

describe("duel answer errors", () => {
  const command = { promptId: "p1", revision: 0, answer: { choice: "opt:0" } };

  it("keeps the seat-left code and text from an HTTP 400 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: "That player has left. Pick again.", code: "seat_left",
    }, { status: 400 })));

    await expect(sendDuelAction("table", command)).rejects.toMatchObject({
      name: "DuelRequestError", status: 400, message: "That player has left. Pick again.", code: "seat_left",
    });
  });

  it.each([undefined, null, 400, { value: "seat_left" }])("ignores a missing or non-string error code: %j", async (code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Invalid answer", code }, { status: 400 })));
    const request = sendDuelAction("table", command);

    await expect(request).rejects.toMatchObject({
      name: "DuelRequestError", status: 400, message: "Invalid answer",
    });
    await expect(request).rejects.not.toHaveProperty("code", expect.anything());
  });
});

describe("duel room authentication responses", () => {
  it("reports a skipped lobby check as a typed room-refresh signal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ skipped: true })));
    await expect(validateDuelDeck("t", { main: [], extra: [], side: [] }, new AbortController().signal)).rejects.toBeInstanceOf(DeckValidationSkippedError);
  });
  it("rejects a followed login redirect instead of caching it as a room", async () => {
    const response = new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "redirected", { value: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(getDuelRoom("table")).rejects.toMatchObject({ name: "DuelRequestError", status: 401 });
  });

  it("rejects an invalid successful body instead of replacing the last valid room", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream unavailable", { status: 200 })));
    await expect(getDuelRoom("table")).rejects.toMatchObject({ name: "DuelRequestError", status: 502 });
  });
});

describe("duel list, leave and replay helpers", () => {
  it("takes a specific seat through the explicit seat endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ session: { slug: "t" } }));
    vi.stubGlobal("fetch", fetchMock);
    await takeDuelSeat("t", 1);
    expect(fetchMock).toHaveBeenCalledWith("/api/duels/t/seat", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seat: 1 }),
    });
  });
  it("lists live tables without query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ duels: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listDuels()).resolves.toEqual({ duels: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/duels", { cache: "no-store" });
  });

  it("requests match history with the chosen scope", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ duels: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listDuels(true);
    await listDuels(true, "all");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/duels?archived=1&scope=mine", { cache: "no-store" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/duels?archived=1&scope=all", { cache: "no-store" });
  });

  it("posts to the leave endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ session: { slug: "t" } }));
    vi.stubGlobal("fetch", fetchMock);
    await leaveDuel("t");
    expect(fetchMock).toHaveBeenCalledWith("/api/duels/t/leave", { method: "POST" });
  });

  it("builds the replay key and surfaces the server message on 409", async () => {
    expect(duelReplayKey("t")).toBe("/api/duels/t/replay");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Replay unavailable" }, { status: 409 })));
    await expect(getDuelReplay("t")).rejects.toMatchObject({ message: "Replay unavailable", status: 409 });
  });
});
