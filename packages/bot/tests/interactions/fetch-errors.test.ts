import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { CardFetchError } from "@yugidraft/shared/services";
import { reportInteractionError } from "../../src/interactions/errors.js";

describe("bot card fetch error replies", () => {
  it.each(["network", "timeout", "429"])("replies after a %s failure and contains a reply failure", async (failure) => {
    vi.resetModules();
    const { createCardCatalogService } = await import("@yugidraft/shared/services");
    const db = new Database(":memory:"); migrate(db);
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch: async () => {
      if (failure === "network") throw new TypeError("offline");
      if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
      return new Response("", { status: 429, headers: { "Retry-After": "2" } });
    } });
    const error = await catalog.syncDraftPool({ setNames: ["Missing"], includeNames: [], excludeNames: [] }).catch((error: unknown) => error);
    db.close();
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = { isAutocomplete: () => false, isRepliable: () => true, deferred: false, replied: false,
      reply, followUp: vi.fn(), respond: vi.fn() };
    await reportInteractionError(interaction, error);
    expect(reply).toHaveBeenCalledWith({ content: "Card database is unavailable. Try again shortly.", ephemeral: true });
    reply.mockRejectedValueOnce(new Error("Discord offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { await expect(reportInteractionError(interaction, new CardFetchError())).resolves.toBeUndefined(); }
    finally { log.mockRestore(); }
  });
  it("contains failures from deferred replies and autocomplete replies", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const interaction = { isAutocomplete: () => false, isRepliable: () => true, deferred: true, replied: false,
      reply: vi.fn(), followUp: vi.fn().mockRejectedValue(new Error("offline")), respond: vi.fn().mockRejectedValue(new Error("offline")) };
    try {
      await expect(reportInteractionError(interaction, new CardFetchError())).resolves.toBeUndefined();
      interaction.isAutocomplete = () => true;
      await expect(reportInteractionError(interaction, new CardFetchError())).resolves.toBeUndefined();
    } finally { log.mockRestore(); }
  });
});
