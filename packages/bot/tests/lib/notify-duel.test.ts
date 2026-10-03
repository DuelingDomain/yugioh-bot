import { describe, expect, it, vi } from "vitest";
import { recordingTransport } from "@yugidraft/shared/notify";
import { createNotifyDuelChange } from "../../src/lib/notify-duel.js";

describe("createNotifyDuelChange", () => {
  it("POSTs the slug and guild to /internal/duel/changed", async () => {
    const rec = recordingTransport();
    await createNotifyDuelChange(rec.transport)("duel-a", "g1");
    expect(rec.calls).toEqual([
      { path: "/internal/duel/changed", body: JSON.stringify({ slug: "duel-a", guildId: "g1" }) },
    ]);
  });

  it("never throws when the transport fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = { post: vi.fn(async () => { throw new Error("down"); }) };
    await expect(createNotifyDuelChange(failing)("duel-a", "g1")).resolves.toBeUndefined();
    const notOk = { post: vi.fn(async () => ({ ok: false, status: 500, text: "bad" })) };
    await expect(createNotifyDuelChange(notOk)("duel-a", "g1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
