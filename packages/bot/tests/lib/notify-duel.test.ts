import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordingTransport } from "@yugidraft/shared/notify";
import { useRecordingObservability } from "../../../shared/tests/helpers/recording-observability.mjs";
import { createHttpNotifyDuelChange, createNotifyDuelChange } from "../../src/lib/notify-duel.js";
import { forkEventFixture } from "../helpers/replay-fork-events.js";

const recording = useRecordingObservability();
const warnings: string[] = [];
beforeEach(() => {
  warnings.length = 0;
  recording.log.mockImplementation((level, message) => { if (level === "warn") warnings.push(message); });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

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
    const failing = { post: async () => { throw new Error("down"); } };
    await expect(createNotifyDuelChange(failing, resolveTarget)("duel-a", "g1")).resolves.toBeUndefined();
    const notOk = { post: async () => ({ ok: false, status: 500, text: "bad" }) };
    await expect(createNotifyDuelChange(notOk, resolveTarget)("duel-a", "g1")).resolves.toBeUndefined();
  });
});

it("resolves HTTP change events from the bot's existing DB", async () => {
  const app = forkEventFixture();
  vi.stubEnv("DATABASE_PATH", "/missing-other-db/test.sqlite");
  const requests: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  });
  try {
    const notify = createHttpNotifyDuelChange(app.db, { url: "https://ws.example", secret: "test" });
    await notify(app.source.slug, app.guildId);
    await notify(app.forkSlug, app.guildId);
    expect(requests).toEqual([{ url: "https://ws.example/internal/duel/changed", body: { slug: app.source.slug, guildId: app.guildId } }]);
  } finally { app.db.close(); }
});
it("logs a missing change target", async () => {
  const rec = recordingTransport();
  await createNotifyDuelChange(rec.transport, () => null)("missing", "g1");
  expect(rec.calls).toEqual([]);
  expect(warnings).toEqual(["[notify-duel] target missing"]);
});
