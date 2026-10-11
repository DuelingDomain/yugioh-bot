import { afterEach, describe, expect, it, vi } from "vitest";
import { recordingTransport } from "@yugidraft/shared/notify";
import { createHttpNotifyDuelChange, createNotifyDuelChange } from "../../src/lib/notify-duel.js";

import { forkEventFixture } from "../helpers/replay-fork-events.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const resolveTarget = (slug: string, guildId: string) => ({ id: 1, slug, guildId, kind: "play" as const, ownerUserId: null });

describe("createNotifyDuelChange", () => {
  it("POSTs the slug and guild to /internal/duel/changed", async () => {
    const rec = recordingTransport();
    await createNotifyDuelChange(rec.transport, resolveTarget)("duel-a", "g1");
    expect(rec.calls).toEqual([
      { path: "/internal/duel/changed", body: JSON.stringify({ slug: "duel-a", guildId: "g1" }) },
    ]);
  });

  it("never throws when the transport fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = { post: vi.fn(async () => { throw new Error("down"); }) };
    await expect(createNotifyDuelChange(failing, resolveTarget)("duel-a", "g1")).resolves.toBeUndefined();
    const notOk = { post: vi.fn(async () => ({ ok: false, status: 500, text: "bad" })) };
    await expect(createNotifyDuelChange(notOk, resolveTarget)("duel-a", "g1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

it("resolves HTTP change events from the bot's existing DB", async () => {
  const app = forkEventFixture();
  vi.stubEnv("DATABASE_PATH", "/missing-other-db/test.sqlite");
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const notify = createHttpNotifyDuelChange(app.db, { url: "https://ws.example", secret: "test" });
    await notify(app.source.slug, app.guildId);
    expect(fetch).toHaveBeenCalledWith("https://ws.example/internal/duel/changed", expect.objectContaining({
      body: JSON.stringify({ slug: app.source.slug, guildId: app.guildId }),
    }));
    fetch.mockClear();
    await notify(app.forkSlug, app.guildId);
    expect(fetch).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    await notify("missing", app.guildId);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("target missing"));
    warn.mockClear();
    app.db.close();
    await expect(notify(app.source.slug, app.guildId)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("failed"), expect.any(Error));
  } finally { app.db.close(); }
});
it("logs a missing change target", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const rec = recordingTransport();
  await createNotifyDuelChange(rec.transport, () => null)("missing", "g1");
  expect(rec.calls).toEqual([]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("target missing"));
});
