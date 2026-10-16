import { describe, expect, it, vi } from "vitest";
import {
  activeGameRedirect, activeRoomPath, createActiveGameChecker, duelSlugFromPath, parseActiveDuel, type ActiveDuel,
} from "@/lib/active-game";

const playing: ActiveDuel = { slug: "abc-123", state: "playing", role: "guest", format: "1v1" };

describe("parseActiveDuel", () => {
  it("reads an active duel and treats anything else as none", () => {
    expect(parseActiveDuel({ active: playing })).toEqual(playing);
    expect(parseActiveDuel({ active: null })).toBeNull();
    expect(parseActiveDuel(null)).toBeNull();
    expect(parseActiveDuel({ active: { ...playing, state: "done" } })).toBeNull();
    expect(parseActiveDuel({ active: { ...playing, format: "2v2" } })).toBeNull();
    expect(parseActiveDuel({ active: { ...playing, slug: "" } })).toBeNull();
  });
});

describe("duelSlugFromPath", () => {
  it("finds the room slug and ignores other duel pages", () => {
    expect(duelSlugFromPath("/duels/abc-123")).toBe("abc-123");
    expect(duelSlugFromPath("/duels/abc-123/")).toBe("abc-123");
    expect(duelSlugFromPath("/duels/abc-123/replay")).toBe("abc-123");
    expect(duelSlugFromPath("/duels")).toBeNull();
    expect(duelSlugFromPath("/duels/new")).toBeNull();
    expect(duelSlugFromPath("/decks")).toBeNull();
  });
});

describe("activeGameRedirect", () => {
  it.each(["/", "/dashboard", "/duels", "/duels/new", "/decks", "/player/me", "/duels/other-room", "/duels/other-room/replay", "/settings"])(
    "sends %s back to the game", (path) => {
      expect(activeGameRedirect(path, playing)).toBe(activeRoomPath("abc-123"));
    },
  );
  it("leaves the game's own room alone", () => {
    expect(activeGameRedirect("/duels/abc-123", playing)).toBeNull();
    expect(activeGameRedirect("/duels/abc-123/", playing)).toBeNull();
    expect(activeGameRedirect("/duels/abc-123/replay", playing)).toBeNull();
  });
  it.each(["/api/duels/active", "/_next/static/x.js", "/sign-in", "/sign-up", "/login", "/access", "/sso-callback", "/welcome-back", "/dev/fx-lab", "/icons/a.png", "/favicon.ico"])(
    "never traps %s", (path) => {
      expect(activeGameRedirect(path, playing)).toBeNull();
    },
  );
  it("does nothing without a game in progress", () => {
    expect(activeGameRedirect("/decks", null)).toBeNull();
    expect(activeGameRedirect("/decks", { ...playing, state: "lobby", role: "host" })).toBeNull();
  });
  it("encodes the slug", () => {
    expect(activeGameRedirect("/decks", { ...playing, slug: "a b" })).toBe("/duels/a%20b");
  });
});

describe("createActiveGameChecker", () => {
  const reply = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

  it("caches the answer for the ttl and shares a request in flight", async () => {
    let time = 0;
    const fetchImpl = vi.fn(() => reply({ active: playing }));
    const checker = createActiveGameChecker({ fetchImpl, now: () => time, ttlMs: 5000 });
    const [a, b] = await Promise.all([checker.get(), checker.get()]);
    expect(a).toEqual(playing);
    expect(b).toEqual(playing);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    time = 4999;
    await checker.get();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    time = 5000;
    await checker.get();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reads fresh on request and after invalidate", async () => {
    const fetchImpl = vi.fn(() => reply({ active: null }));
    const checker = createActiveGameChecker({ fetchImpl });
    await checker.get();
    await checker.get({ fresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    checker.invalidate();
    await checker.get();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails open and does not cache a failure", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => reply({ error: "unauthorized" }, false))
      .mockImplementation(() => reply({ active: playing }));
    const checker = createActiveGameChecker({ fetchImpl });
    expect(await checker.get()).toBeNull();
    expect(await checker.get()).toBeNull();
    expect(await checker.get()).toEqual(playing);
  });

  it("ignores a slow answer that an invalidate overtook", async () => {
    let release: (value: Response) => void = () => {};
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
      .mockImplementation(() => reply({ active: null }));
    const checker = createActiveGameChecker({ fetchImpl });
    const slow = checker.get();
    checker.invalidate();
    expect(await checker.get()).toBeNull();
    release({ ok: true, json: () => Promise.resolve({ active: playing }) } as Response);
    await slow;
    expect(await checker.get()).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
