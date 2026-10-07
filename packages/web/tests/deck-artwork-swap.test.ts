import { beforeEach, expect, it, vi } from "vitest";
const { requireDuelActor, callDuelHost } = vi.hoisted(() => ({ requireDuelActor: vi.fn(), callDuelHost: vi.fn() }));
vi.mock("@/lib/duel-host", () => ({ requireDuelActor, callDuelHost }));
beforeEach(() => {
  vi.clearAllMocks();
  requireDuelActor.mockResolvedValue({ ok: true, guildId: "g", playerId: 1 });
  callDuelHost.mockResolvedValue({ ok: true, data: { passcode: 10, artworks: [{ passcode: 10, isMain: true }, { passcode: 11, isMain: false }] } });
});
const deck = { main: [10, 10], extra: [10], side: [10], deckMaster: 10 };
async function swap(body: unknown) {
  const { POST } = await import("../app/api/decks/artwork/route");
  return POST(new Request("http://localhost/api/decks/artwork", { method: "POST", body: JSON.stringify(body) }));
}
it.each(["main", "extra", "side", "deckMaster"])("swaps only the selected %s occurrence", async section => {
  const response = await swap({ deck, section, index: 0, from: 10, to: 11 });
  expect(response.status).toBe(200);
  const expected = structuredClone(deck);
  if (section === "deckMaster") expected.deckMaster = 11;
  else expected[section as "main" | "extra" | "side"][0] = 11;
  expect(await response.json()).toEqual({ deck: expected });
});
it("rejects another family or an external-only artwork", async () => {
  expect((await swap({ deck, section: "main", index: 0, from: 10, to: 99 })).status).toBe(400);
});
it("rejects stale selection, invalid index and malformed decks", async () => {
  expect((await swap({ deck, section: "main", index: 0, from: 11, to: 10 })).status).toBe(409);
  expect((await swap({ deck, section: "main", index: -1, from: 10, to: 11 })).status).toBe(400);
  expect((await swap({ deck: { main: "bad" }, section: "main", index: 0, from: 10, to: 11 })).status).toBe(400);
});
it("requires membership and passes through host failures", async () => {
  const body = { deck, section: "main", index: 0, from: 10, to: 11 };
  callDuelHost.mockResolvedValue({ ok: false, response: Response.json({ error: "down" }, { status: 503 }) });
  expect((await swap(body)).status).toBe(503);
  requireDuelActor.mockResolvedValue({ ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) });
  expect((await swap(body)).status).toBe(401);
});
