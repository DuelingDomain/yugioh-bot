import { afterEach, describe, expect, it, vi } from "vitest";
import { getDuelRoom } from "../src/components/duel/api";

afterEach(() => vi.unstubAllGlobals());

describe("duel room authentication responses", () => {
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
