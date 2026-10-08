import { afterEach, expect, it, vi } from "vitest";
import { emptyCardQuery } from "@yugidraft/shared/duels";
import { queryDeckCards, getDeckCards } from "../src/components/decks/api";
const host = vi.hoisted(() => ({ call: vi.fn(), actor: vi.fn() }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost: host.call, requireDuelActor: host.actor, duelErrorResponse: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => { throw new Error("No DB needed for complete card metadata"); }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("card search returns Invalid JSON for malformed request bodies", async () => {
  host.actor.mockResolvedValue({ ok: true, guildId: "g", playerId: 1 });
  const { POST } = await import("../app/api/decks/cards/route");
  const result = await POST(new Request("http://local/cards", { method: "POST", body: "{" }));
  expect(result.status).toBe(400);
  expect(await result.json()).toEqual({ error: "Invalid JSON" });
  expect(host.call).not.toHaveBeenCalled();
});

it("passes editor mode and room context through both client card requests", async () => {
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => Response.json({ cards: [], missing: [], total: 0 }));
  vi.stubGlobal("fetch", fetcher);
  const context = { mode: "domain" as const, slug: "table" };
  await queryDeckCards(emptyCardQuery(), undefined, context);
  await getDeckCards([10], context);
  for (const [, options] of fetcher.mock.calls) expect(JSON.parse(options!.body as string)).toMatchObject(context);
});
it.each(["query", "details"] as const)("%s API forwards Domain admission context to the host", async endpoint => {
  host.actor.mockResolvedValue({ ok: true, guildId: "g", playerId: 1 });
  host.call.mockResolvedValue({ ok: true, data: { cards: [], total: 0, missing: [] } });
  const body = { ...(endpoint === "query" ? emptyCardQuery() : { codes: [10] }), mode: "domain", slug: "table" };
  const { POST } = endpoint === "query" ? await import("../app/api/decks/cards/route") : await import("../app/api/duels/cards/route");
  const result = await POST(new Request("http://local/cards", { method: "POST", body: JSON.stringify(body) }));
  expect(result.status).toBe(200);
  expect(host.call).toHaveBeenCalledWith(expect.objectContaining({ mode: "domain", slug: "table" }));
});
