import { describe, expect, it, vi } from "vitest";
import {
  LobbyRequestError,
  clockOffset,
  countdownSeconds,
  createLobbyApi,
  fallbackLobby,
  lobbyErrorMessage,
  lobbyStartBlocker,
  lobbyStartLine,
  nameList,
  newerLobby,
  normalizePlayers,
  notReadyPlayers,
  nudgeWaitSeconds,
  AUTO_START_SECONDS,
  seatSlots,
  startFractionLeft,
  startRemainingMs,
  initialOf,
  packsOf,
  parsePreflight,
  mainShortfallSummary,
  mainShortfallFix,
  extraShortfallSummary,
  plural,
  setupRows,
  splitPreflight,
  startBlocker,
  startSummary,
} from "../../src/components/draft/lobby/lobby-model";

describe("startBlocker", () => {
  const base = { isTheme: false, themeCount: 0, uniqueThemes: true };

  it("needs two players", () => {
    expect(startBlocker({ ...base, playerCount: 1 })).toBe("Need 1 more player to start.");
    expect(startBlocker({ ...base, playerCount: 0 })).toBe("Need 2 more players to start.");
  });

  it("lets a cube draft with two players start", () => {
    expect(startBlocker({ ...base, playerCount: 2 })).toBeNull();
  });

  it("needs a theme in a theme draft", () => {
    expect(startBlocker({ ...base, isTheme: true, playerCount: 2, themeCount: 0 })).toBe("Add a theme first.");
  });

  it("needs one theme per player when themes are unique", () => {
    expect(startBlocker({ ...base, isTheme: true, playerCount: 4, themeCount: 3 })).toBe("Add 1 more theme. Each of the 4 players needs their own.");
    expect(startBlocker({ ...base, isTheme: true, playerCount: 4, themeCount: 1 })).toBe("Add 3 more themes. Each of the 4 players needs their own.");
    expect(startBlocker({ ...base, isTheme: true, playerCount: 4, themeCount: 4 })).toBeNull();
  });

  it("allows fewer themes than players when themes can repeat", () => {
    expect(startBlocker({ ...base, isTheme: true, uniqueThemes: false, playerCount: 4, themeCount: 1 })).toBeNull();
  });

  it("reports the player shortage before the theme shortage", () => {
    expect(startBlocker({ ...base, isTheme: true, playerCount: 1, themeCount: 0 })).toBe("Need 1 more player to start.");
  });
});

describe("startSummary", () => {
  it("describes the packs a cube draft deals", () => {
    expect(startSummary({ packsPerPlayer: 3, packSize: 15, randomizeSeats: true }, 4)).toEqual({
      before: "Deals ",
      strong: "3 packs of 15",
      after: " to each of the 4 players. Seats are shuffled. Nobody can join after this.",
    });
  });

  it("leaves out the shuffle sentence when seats are not shuffled", () => {
    expect(startSummary({ packsPerPlayer: 1, packSize: 40, randomizeSeats: false }, 2).after).toBe(" to each of the 2 players. Nobody can join after this.");
  });

  it("leaves out the shuffle sentence for an older draft with no seat setting", () => {
    expect(startSummary({ packsPerPlayer: 1, packSize: 40 }, 2).after).toBe(" to each of the 2 players. Nobody can join after this.");
  });

  it("derives the pack count when the config has none", () => {
    expect(packsOf({ cardsPerPlayer: 45, packSize: 15 })).toBe(3);
  });

  it("gives real main and Extra numbers for a theme draft", () => {
    const s = startSummary({ mode: "theme", cardsPerPlayer: 40, extraDeckEnabled: true, extraDeckSize: 15, themeSelection: "player_pick" }, 3);
    expect(s.before).toContain("Gives each of the 3 players a theme. Anyone without one gets one at random.");
    expect(s.strong).toBe("40 main deck and 15 Extra deck cards");
  });

  it("drops the Extra part when it is off", () => {
    expect(startSummary({ mode: "theme", cardsPerPlayer: 44, extraDeckEnabled: false }, 3).strong).toBe("44 main deck cards");
  });

  it("says every theme is random in random mode", () => {
    expect(startSummary({ mode: "theme", themeSelection: "random" }, 3).before).toContain("a random theme");
  });

  it("promises the host's own picks, not a random fallback, when the host assigns themes", () => {
    const s = startSummary({ mode: "theme", themeSelection: "host_assigned" }, 3);
    expect(s.before).toContain("the theme the host set for them");
    expect(s.before).not.toContain("random");
  });
});

describe("setupRows", () => {
  it.each([
    [45, "45 s"], [60, "1 min"], [90, "1 min 30 s"], [600, "10 min"],
  ])("formats %i seconds as %s for both kinds of lobby", (seconds, text) => {
    for (const mode of ["booster", "theme"] as const) {
      expect(setupRows({ mode, pickSeconds: seconds }).find((row) => row.label === "Pick duration")?.value).toBe(text);
    }
  });
  it("lists the cube setup, with passing only when it alternates", () => {
    const rows = setupRows({ cardsPerPlayer: 40, packsPerPlayer: 3, packSize: 15, pickSeconds: 45, alternatePassDirection: true, randomizeSeats: true });
    expect(rows).toEqual([
      { label: "Each player", value: "40 cards" },
      { label: "Packs", value: "3 packs of 15" },
      { label: "Pick duration", value: "45 s" },
      { label: "Passing", value: "Left, then right" },
      { label: "Copy limit", value: "3 per card" },
      { label: "Seats", value: "Shuffled at the start" },
    ]);
    expect(setupRows({ packSize: 15, packsPerPlayer: 3 }).some((r) => r.label === "Passing")).toBe(false);
  });

  it("says the seats are in join order unless the config shuffles them", () => {
    const seats = (config: Parameters<typeof setupRows>[0]) => setupRows(config).find((row) => row.label === "Seats")?.value;
    expect(seats({ packSize: 15, packsPerPlayer: 3 })).toBe("In join order");
    expect(seats({ packSize: 15, packsPerPlayer: 3, randomizeSeats: false })).toBe("In join order");
    expect(seats({ packSize: 15, packsPerPlayer: 3, randomizeSeats: true })).toBe("Shuffled at the start");
  });

  it("lists the theme setup", () => {
    expect(setupRows({ mode: "theme", cardsPerPlayer: 40, extraDeckSize: 15, themePackSize: 3, pickSeconds: 45, themeSelection: "player_pick", uniqueThemes: true })).toEqual([
      { label: "Themes", value: "Players pick, all different" },
      { label: "Main deck", value: "40 picks" },
      { label: "Extra deck", value: "15 picks" },
      { label: "Each pick", value: "3 choices" },
      { label: "Pick duration", value: "45 s" },
      { label: "Copy limit", value: "3 per card" },
      { label: "Passed cards", value: "Can come back" },
    ]);
  });

  it("covers random themes, no Extra deck and burned cards", () => {
    const rows = setupRows({ mode: "theme", themeSelection: "random", uniqueThemes: false, extraDeckEnabled: false, burnUnpicked: true });
    expect(rows.find((r) => r.label === "Themes")?.value).toBe("Random");
    expect(rows.find((r) => r.label === "Extra deck")?.value).toBe("Off");
    expect(rows.find((r) => r.label === "Passed cards")?.value).toBe("Burned");
  });
});

describe("preflight presentation", () => {
  it("parses the server's main pool shortfall, including names containing colons", () => {
    const raw = "Mind: Control: Main pool has 12 cards but needs at least 42 for a 40-card main deck (3 choices/pick).";
    expect(parsePreflight(raw, ["Mind: Control"])).toEqual({
      name: "Mind: Control", shortfall: { kind: "main", have: 12, need: 42 }, raw,
    });
  });

  it("parses the server's Extra pool shortfall", () => {
    const raw = "Toon: Extra pool has 3 cards but needs 17 for a full 15-card Extra Deck; players may end with fewer Extra cards.";
    expect(parsePreflight(raw, ["Toon"])).toEqual({ name: "Toon", shortfall: { kind: "extra", have: 3, need: 17 }, raw });
  });

  it.each(["Main", "Extra"])("parses a singular card and an empty %s pool", (pool) => {
    const kind = pool.toLowerCase();
    const atLeast = pool === "Main" ? "at least " : "";
    expect(parsePreflight(`Toon: ${pool} pool has 1 card but needs ${atLeast}17`, ["Toon"]).shortfall).toEqual({ kind, have: 1, need: 17 });
    expect(parsePreflight(`Toon: ${pool} pool has 0 cards but needs ${atLeast}17`, ["Toon"]).shortfall).toEqual({ kind, have: 0, need: 17 });
  });

  it.each([
    "Unknown check: Something changed.",
    "Toon: Main pool is too small.",
    "Toon: Extra pool has many cards but needs 17",
    "Toon: Prefix Main pool has 1 card but needs at least 42",
    "Main pool has 1 card but needs at least 42",
  ])("preserves unmatched text: %s", (raw) => {
    const issue = parsePreflight(raw, ["Toon"]);
    expect(issue.shortfall).toBeNull();
    expect(issue.raw).toBe(raw);
  });

  it("uses the existing fallback name split", () => {
    expect(parsePreflight("Toon: Main pool has 1 card but needs at least 42", []).shortfall).toEqual({ kind: "main", have: 1, need: 42 });
  });

  it("summarizes one, two or three small main pools", () => {
    expect(mainShortfallSummary([])).toBeNull();
    expect(mainShortfallSummary(["Gaia knights"])).toBe("Gaia knights can't be drafted yet. Its main pool is too small.");
    expect(mainShortfallSummary(["Gaia knights", "Toon"])).toBe("Gaia knights and Toon can't be drafted yet. Their main pools are too small.");
    expect(mainShortfallSummary(["Gaia knights", "Toon", "Despia"])).toBe("Gaia knights, Toon and Despia can't be drafted yet. Their main pools are too small.");
  });

  it.each([
    [1, "Add cards to the cube, or remove the theme."],
    [2, "Add cards to those cubes, or remove those themes."],
    [3, "Add cards to those cubes, or remove those themes."],
  ])("offers a repair for %i small main pools", (count, text) => {
    expect(mainShortfallFix(count)).toBe(text);
  });

  it("summarizes singular and plural Extra pool warnings", () => {
    expect(extraShortfallSummary(0)).toBeNull();
    expect(extraShortfallSummary(1)).toBe("1 theme may run short on Extra deck cards, so that player could end with fewer. You can start anyway.");
    expect(extraShortfallSummary(3)).toBe("3 themes may run short on Extra deck cards, so those players could end with fewer. You can start anyway.");
  });
});

describe("small helpers", () => {
  it("pluralises", () => {
    expect(plural(1, "player")).toBe("1 player");
    expect(plural(2, "player")).toBe("2 players");
    expect(plural(1, "more theme")).toBe("1 more theme");
  });

  it("takes the first letter for the seat monogram", () => {
    expect(initialOf("duelist.josh")).toBe("D");
    expect(initialOf("  kestrel")).toBe("K");
    expect(initialOf("")).toBe("?");
  });

  it("splits a preflight line at the cube name", () => {
    expect(splitPreflight("Blue-Eyes: needs 42", ["Blue-Eyes"])).toEqual({ name: "Blue-Eyes", rest: "needs 42" });
    expect(splitPreflight("Mind: Control: bad", ["Mind: Control"])).toEqual({ name: "Mind: Control", rest: "bad" });
    expect(splitPreflight("Sky Striker: low", [])).toEqual({ name: "Sky Striker", rest: "low" });
    expect(splitPreflight("No prefix here", [])).toEqual({ name: null, rest: "No prefix here" });
  });
});

describe("normalizePlayers", () => {
  const rows = [
    { playerId: 1, displayName: "Ann" },
    { playerId: 2, displayName: "Bo" },
  ];

  it("marks you and the host from the seats response for a legacy roster", () => {
    const out = normalizePlayers(rows, { youIds: new Set([1]), isCreator: true });
    expect(out[0]).toMatchObject({ isYou: true, isHost: true, isBot: false, ready: false, readyAt: null, cubeId: null });
    expect(out[1]).toMatchObject({ isYou: false, isHost: false });
  });

  it("never marks the host for a viewer who is not the host", () => {
    const out = normalizePlayers(rows, { youIds: new Set([1]), isCreator: false });
    expect(out.every((p) => !p.isHost)).toBe(true);
  });

  it("keeps the server fields when they exist", () => {
    const out = normalizePlayers(
      [{ playerId: 3, displayName: "Cy", isHost: true, isYou: false, isBot: true, ready: true, readyAt: "2026-10-07T00:00:00Z", cubeId: 9 }],
      { youIds: new Set([3]), isCreator: false },
    );
    expect(out[0]).toMatchObject({ isHost: true, isYou: false, isBot: true, ready: true, cubeId: 9 });
  });
});

describe("fallbackLobby", () => {
  it("is a legacy lobby: no target, no auto start, no countdown", () => {
    const players = normalizePlayers([{ playerId: 1, displayName: "Ann", ready: true }], { youIds: new Set(), isCreator: false });
    const lobby = fallbackLobby(players, Date.UTC(2026, 9, 7));
    expect(lobby).toMatchObject({ targetSeats: null, joined: 1, ready: 1, allReady: false, start: null });
    expect(lobby.autoStart).toEqual({ enabled: false, held: false, eligible: false });
    expect(lobby.serverNow).toBe("2026-10-07T00:00:00.000Z");
  });
});

describe("newerLobby", () => {
  const make = (revision: number) => ({ lobby: { ...fallbackLobby([], 0), revision }, players: [] });
  it("keeps the higher revision", () => {
    expect(newerLobby(make(5), make(4)).lobby.revision).toBe(5);
    expect(newerLobby(make(5), make(6)).lobby.revision).toBe(6);
    expect(newerLobby(null, make(1)).lobby.revision).toBe(1);
  });
});

describe("countdown math", () => {
  const start = { token: "t", kind: "manual" as const, startsAt: "2026-10-07T00:00:05.000Z" };

  it("draws the time left from the server clock, not the client clock", () => {
    const serverNow = "2026-10-07T00:00:00.000Z";
    // The client clock is one hour behind.
    const clientNow = Date.parse(serverNow) - 3_600_000;
    const offset = clockOffset(serverNow, clientNow);
    expect(startRemainingMs(start, offset, clientNow)).toBe(5000);
    expect(startRemainingMs(start, offset, clientNow + 4200)).toBe(800);
    expect(countdownSeconds(800)).toBe(1);
  });

  it("stops at zero", () => {
    expect(startRemainingMs(start, 0, Date.parse(start.startsAt) + 9000)).toBe(0);
    expect(countdownSeconds(0)).toBe(0);
  });

  it("drains the ring over 5 s for a manual start and 10 s for auto", () => {
    expect(startFractionLeft(2500, "manual")).toBe(0.5);
    expect(startFractionLeft(5000, "auto")).toBe(0.5);
    expect(startFractionLeft(99_000, "auto")).toBe(1);
  });
});

describe("seatSlots", () => {
  const players = normalizePlayers(
    [{ playerId: 1, displayName: "Ann" }, { playerId: 2, displayName: "Bo" }],
    { youIds: new Set(), isCreator: false },
  );

  it("fills up to the target with open slots", () => {
    const slots = seatSlots(players, 4);
    expect(slots.map((s) => s.type)).toEqual(["player", "player", "open", "open"]);
  });

  it("never hides a player when the target is smaller than the joined count", () => {
    expect(seatSlots(players, 2).map((s) => s.type)).toEqual(["player", "player"]);
    expect(seatSlots(players, 1)).toHaveLength(2);
  });

  it("gives a legacy lobby joined seats and one open slot", () => {
    expect(seatSlots(players, null).map((s) => s.type)).toEqual(["player", "player", "open"]);
  });
});

describe("lobby start text", () => {
  it("blocks under two players and on server errors", () => {
    expect(lobbyStartBlocker({ joined: 1, errors: [] })).toBe("Need 1 more player to start.");
    expect(lobbyStartBlocker({ joined: 2, errors: ["Pool is too small"] })).toBe("Fix the problems above to start.");
    expect(lobbyStartBlocker({ joined: 2, errors: [] })).toBeNull();
  });

  it("says how many seats are filled when the host starts early", () => {
    expect(lobbyStartLine({ joined: 3, targetSeats: 4 })).toBe("Starts with 3 of 4 seats filled. Nobody can join after this.");
    expect(lobbyStartLine({ joined: 4, targetSeats: 4 })).toBe("Starts with 4 players. Nobody can join after this.");
    expect(lobbyStartLine({ joined: 2, targetSeats: null })).toBe("Starts with 2 players. Nobody can join after this.");
  });

  it("lists names and finds the not-ready players", () => {
    expect(nameList(["Ann"])).toBe("Ann");
    expect(nameList(["Ann", "Bo"])).toBe("Ann and Bo");
    expect(nameList(["Ann", "Bo", "Cy"])).toBe("Ann, Bo and Cy");
    const players = normalizePlayers(
      [{ playerId: 1, displayName: "Ann", ready: true }, { playerId: 2, displayName: "Bo" }],
      { youIds: new Set(), isCreator: false },
    );
    expect(notReadyPlayers(players).map((p) => p.displayName)).toEqual(["Bo"]);
  });

  it("counts the Nudge wait down to zero", () => {
    const now = Date.parse("2026-10-07T00:00:00Z");
    expect(nudgeWaitSeconds("2026-10-07T00:00:30Z", now)).toBe(30);
    expect(nudgeWaitSeconds("2026-10-06T00:00:30Z", now)).toBe(0);
    expect(nudgeWaitSeconds(null, now)).toBe(0);
  });

  it("gives the auto-start delay in seconds", () => {
    expect(AUTO_START_SECONDS).toBe(10);
  });
});

describe("LobbyRequestError and lobbyErrorMessage", () => {
  it("reads the code and the NOT_READY lists", () => {
    const err = new LobbyRequestError(409, { error: "x", code: "NOT_READY", notReadyPlayerIds: [2, 3], unclaimedPlayerIds: [3] }, "fallback");
    expect(err.notReady).toEqual({ notReadyPlayerIds: [2, 3], unclaimedPlayerIds: [3] });
    expect(err.stale).toBe(false);
    expect(new LobbyRequestError(409, { error: "x", code: "STALE_LOBBY" }, "f").stale).toBe(true);
  });

  it("gives clear lines for stale and cooldown errors and keeps other server text", () => {
    expect(lobbyErrorMessage(new LobbyRequestError(409, { code: "STALE_LOBBY" }, "f"), "x")).toMatch(/refreshed/);
    expect(lobbyErrorMessage(new LobbyRequestError(429, { code: "NUDGE_COOLDOWN", retryAfterSeconds: 42 }, "f"), "x")).toMatch(/42 s/);
    expect(lobbyErrorMessage(new LobbyRequestError(403, { error: "Only the host can do that." }, "f"), "x")).toBe("Only the host can do that.");
    expect(lobbyErrorMessage(new Error("boom"), "x")).toBe("boom");
    expect(lobbyErrorMessage("nope", "fallback")).toBe("fallback");
  });
});

describe("createLobbyApi", () => {
  function setup(status = 200, body: unknown = { lobby: {}, players: [] }) {
    const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as Response);
    return { fetchMock, api: createLobbyApi("my-slug", fetchMock as unknown as typeof fetch) };
  }

  it("sends each mutation to its route", async () => {
    const { api, fetchMock } = setup();
    await api.ready(true);
    await api.leave();
    await api.removePlayer(7);
    await api.start({ revision: 3, force: true });
    await api.stop("tok");
    await api.autoStart({ enabled: true, held: false, revision: 4 });
    await api.nudge();
    await api.nudge(5);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      "POST /api/drafts/my-slug/ready",
      "DELETE /api/drafts/my-slug/join",
      "DELETE /api/drafts/my-slug/players/7",
      "POST /api/drafts/my-slug/start",
      "DELETE /api/drafts/my-slug/start",
      "PUT /api/drafts/my-slug/auto-start",
      "POST /api/drafts/my-slug/nudge",
      "POST /api/drafts/my-slug/nudge",
    ]);
    expect(JSON.parse(calls[0][1].body as string)).toEqual({ ready: true });
    expect(calls[1][1].body).toBeUndefined();
    expect(JSON.parse(calls[3][1].body as string)).toEqual({ revision: 3, force: true });
    expect(JSON.parse(calls[4][1].body as string)).toEqual({ token: "tok" });
    expect(JSON.parse(calls[5][1].body as string)).toEqual({ enabled: true, held: false, revision: 4 });
    expect(JSON.parse(calls[6][1].body as string)).toEqual({});
    expect(JSON.parse(calls[7][1].body as string)).toEqual({ playerId: 5 });
  });

  it("throws a LobbyRequestError that carries the code and body", async () => {
    const { api } = setup(409, { error: "Changed", code: "STALE_LOBBY" });
    await expect(api.start({ revision: 1 })).rejects.toMatchObject({ status: 409, code: "STALE_LOBBY", message: "Changed" });
  });

  it("survives an error with no JSON body", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error("no body"); } }) as unknown as Response);
    const api = createLobbyApi("s", fetchMock as unknown as typeof fetch);
    await expect(api.ready(true)).rejects.toMatchObject({ status: 502, code: null, message: "Request failed (502)" });
  });
});
