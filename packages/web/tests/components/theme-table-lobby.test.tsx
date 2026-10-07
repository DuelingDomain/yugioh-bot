// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DraftAllowedCube, LobbyPlayer, LobbySnapshot } from "@yugidraft/shared/types";
import { ThemeTableLobby, type ThemeTableLobbyProps } from "../../src/components/draft/theme/theme-table-lobby";
import type { ThemeTableConfig } from "../../src/components/draft/theme/use-theme-table";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function cube(id: number, name: string, over: Partial<DraftAllowedCube> = {}): DraftAllowedCube {
  return {
    id,
    name,
    archetype: name,
    mainCount: 60,
    extraCount: 15,
    mainDistinct: 30,
    extraDistinct: 8,
    mainCopies: 60,
    extraCopies: 15,
    sampleImages: [],
    ...over,
  };
}

function person(id: number, name: string, over: Partial<LobbyPlayer> = {}): LobbyPlayer {
  return {
    playerId: id,
    displayName: name,
    pickCount: 0,
    joinedAt: "2026-10-07T11:00:00.000Z",
    isHost: false,
    isYou: false,
    isBot: false,
    ready: false,
    readyAt: null,
    cubeId: null,
    ...over,
  };
}

function snapshot(over: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    revision: 5,
    serverNow: new Date(NOW).toISOString(),
    targetSeats: 4,
    joined: 2,
    ready: 0,
    allReady: false,
    autoStart: { enabled: false, held: false, eligible: false },
    start: null,
    errors: [],
    warnings: [],
    lastStartError: null,
    ...over,
  };
}

const FIRE = cube(10, "Blue-Eyes");
const WATER = cube(11, "Mermail");
const EARTH = cube(12, "Gravekeeper");

const BASE_CONFIG: ThemeTableConfig = {
  themeSelection: "player_pick",
  uniqueThemes: true,
  cardsPerPlayer: 40,
  themePackSize: 3,
  extraDeckEnabled: true,
  extraDeckSize: 15,
  pickSeconds: 45,
  lobbySeats: 4,
  copyLimit: true,
  burnUnpicked: false,
};

interface Call { url: string; method: string; body: unknown }

/** A fetch that answers by "METHOD /path". Unknown routes answer an empty 200 list so side loads stay quiet. */
function mockFetch(routes: Record<string, (body: unknown) => Response | object>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const route = routes[`${method} ${url.split("?")[0]}`];
    if (!route) return Response.json({ cubes: [], archetypes: [], errors: [], warnings: [] });
    const out = route(body);
    return out instanceof Response ? out : Response.json(out);
  });
  vi.stubGlobal("fetch", impl);
  return calls;
}

function table(over: Partial<Omit<ThemeTableLobbyProps, "draft">> & { draft?: Partial<ThemeTableLobbyProps["draft"]> } = {}) {
  const { draft, ...rest } = over;
  const props: ThemeTableLobbyProps = {
    slug: "theme-night",
    isCreator: false,
    isParticipant: true,
    onChanged: vi.fn(),
    ...rest,
    draft: {
      name: "Theme night",
      config: BASE_CONFIG,
      lobby: snapshot(),
      players: [
        person(1, "Imran", { isHost: true }),
        person(2, "Ana", { isYou: true }),
      ],
      allowedCubes: [FIRE, WATER, EARTH],
      ...draft,
    },
  };
  return props;
}

function asAna(cubeId: number | null, other: number | null = null) {
  return [person(1, "Imran", { isHost: true, cubeId: other }), person(2, "Ana", { isYou: true, cubeId })];
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ThemeTableLobby claims", () => {
  it("shows a claim to two viewers after each refreshes", async () => {
    const calls = mockFetch({ "POST /api/drafts/theme-night/claim-cube": () => ({ ok: true, cubeId: 11 }) });
    const onChanged = vi.fn();
    const first = render(<ThemeTableLobby {...table({ onChanged, draft: { players: asAna(null) } })} />);

    fireEvent.click(screen.getByRole("button", { name: "Take Mermail" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ cubeId: 11 });

    // Ana's page refetches: the claim is now public on her seat.
    first.rerender(<ThemeTableLobby {...table({ onChanged, draft: { players: asAna(11) } })} />);
    expect(screen.getByLabelText("Your theme")).toHaveValue("11");
    first.unmount();

    // Imran's page refetches too and sees it as taken by Ana.
    render(
      <ThemeTableLobby
        {...table({
          isCreator: true,
          draft: { players: [person(1, "Imran", { isHost: true, isYou: true }), person(2, "Ana", { cubeId: 11 })] },
        })}
      />,
    );
    const seats = screen.getByRole("list", { name: "Seats" });
    expect(within(seats).getByText("Mermail")).toBeInTheDocument();
    expect(screen.getByText("Taken by Ana")).toBeInTheDocument();
  });

  it("makes an occupied unique theme unavailable, and available again when themes may repeat", () => {
    mockFetch({});
    const players = asAna(null, 10);
    const { unmount } = render(<ThemeTableLobby {...table({ draft: { players } })} />);
    expect(screen.getByRole("button", { name: "Take Blue-Eyes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Take Mermail" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Blue-Eyes (taken by Imran)" })).toBeDisabled();
    unmount();

    render(<ThemeTableLobby {...table({ draft: { players, config: { ...BASE_CONFIG, uniqueThemes: false } } })} />);
    expect(screen.getByRole("button", { name: "Take Blue-Eyes" })).toBeEnabled();
  });

  it("refetches and says so when the server answers CUBE_TAKEN", async () => {
    mockFetch({
      "POST /api/drafts/theme-night/claim-cube": () => Response.json({ error: "Someone just took that theme.", code: "CUBE_TAKEN" }, { status: 409 }),
    });
    const onChanged = vi.fn();
    render(<ThemeTableLobby {...table({ onChanged, draft: { players: asAna(null) } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Take Mermail" }));
    expect(await screen.findByText("Someone just took that theme.")).toBeInTheDocument();
    expect(screen.getAllByText("Someone just took that theme.")).toHaveLength(1);
    expect(onChanged).toHaveBeenCalled();
  });

  it("clears your own claim with Clear", async () => {
    const calls = mockFetch({ "DELETE /api/drafts/theme-night/claim-cube": () => ({ ok: true, cubeId: null }) });
    render(<ThemeTableLobby {...table({ draft: { players: asAna(11) } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});

describe("ThemeTableLobby host assignment", () => {
  const hostAssigned = { ...BASE_CONFIG, themeSelection: "host_assigned" as const };
  const hostView = [person(1, "Imran", { isHost: true, isYou: true }), person(2, "Ana")];

  it("sends the whole map in one request once every seat has a theme", async () => {
    const calls = mockFetch({ "PUT /api/drafts/theme-night": () => ({ ok: true }) });
    render(<ThemeTableLobby {...table({ isCreator: true, draft: { config: hostAssigned, players: hostView } })} />);

    fireEvent.change(screen.getByLabelText("Theme for Imran"), { target: { value: "10" } });
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(screen.getByRole("option", { name: "Blue-Eyes (taken by Imran)" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Theme for Ana"), { target: { value: "11" } });
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      config: { themeAssignments: { "1": 10, "2": 11 } },
      revision: 5,
    });
  });

  it("does not let a non-host assign themes", () => {
    mockFetch({});
    render(<ThemeTableLobby {...table({ draft: { config: hostAssigned, players: [person(1, "Imran", { isHost: true }), person(2, "Ana", { isYou: true })] } })} />);
    expect(screen.queryByLabelText(/^Theme for/)).toBeNull();
    expect(screen.queryByLabelText("Your theme")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Take / })).toBeNull();
  });

  it("explains the Start block while a seat has no theme", () => {
    mockFetch({});
    render(<ThemeTableLobby {...table({ isCreator: true, draft: { config: hostAssigned, players: hostView } })} />);
    expect(screen.getByText("Give 2 seats a theme.")).toBeInTheDocument();
  });
});

describe("ThemeTableLobby random mode", () => {
  it("shows no pick controls and no names for themes", () => {
    mockFetch({});
    render(<ThemeTableLobby {...table({ draft: { config: { ...BASE_CONFIG, themeSelection: "random" }, players: asAna(null) } })} />);
    expect(screen.getAllByText("Gets a random theme when the draft starts.")).toHaveLength(2);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Take / })).toBeNull();
  });
});

describe("ThemeTableLobby rules and warnings", () => {
  it("states 40 Main and up to 15 Extra, and the thin-Extra warning from the server", async () => {
    mockFetch({
      "GET /api/drafts/theme-night/preflight": () => ({ errors: [], warnings: ["Mermail has only 9 Extra cards. Its Extra round may end early."] }),
    });
    render(<ThemeTableLobby {...table()} />);
    expect(screen.getAllByText(/Main 40 \+ Extra: up to 15/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Its Extra round may end early/)).toBeInTheDocument();
  });

  it("says the Extra deck is not drafted when it is off", () => {
    mockFetch({});
    render(<ThemeTableLobby {...table({ draft: { config: { ...BASE_CONFIG, extraDeckEnabled: false } } })} />);
    expect(screen.getByText("Not drafted")).toBeInTheDocument();
    expect(screen.queryByText(/Extra: up to/)).toBeNull();
  });

  it("shows a preflight error and keeps Start off", async () => {
    mockFetch({
      "GET /api/drafts/theme-night/preflight": () => ({ errors: ["Mermail has only 30 Main cards. It needs 40."], warnings: [] }),
    });
    render(<ThemeTableLobby {...table({ isCreator: true, draft: { players: [person(1, "Imran", { isHost: true, isYou: true }), person(2, "Ana", { ready: true })] } })} />);
    expect((await screen.findAllByText(/needs 40/)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Start draft" })).toBeDisabled();
  });

  it("lets the host save a rule change with the lobby revision and discard another", async () => {
    const calls = mockFetch({ "PUT /api/drafts/theme-night": () => ({ ok: true }) });
    render(<ThemeTableLobby {...table({ isCreator: true, draft: { players: [person(1, "Imran", { isHost: true, isYou: true })] } })} />);
    fireEvent.click(screen.getByRole("button", { name: /edit theme rules/i }));
    const save = screen.getByRole("button", { name: "Save rules" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Main deck size"), { target: { value: "50" } });
    fireEvent.click(save);
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ config: { cardsPerPlayer: 50 }, revision: 5 });
  });

  it("gives a non-host no rule editor and no tools to change the box", () => {
    mockFetch({});
    render(<ThemeTableLobby {...table()} />);
    expect(screen.queryByRole("button", { name: /edit theme rules/i })).toBeNull();
    expect(screen.queryByRole("group", { name: "Add a theme" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Edit cube/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.queryByRole("button", { name: /pass/i })).toBeNull();
  });
});

describe("ThemeTableLobby the box", () => {
  it("keeps the saved cube and offers a retry when adding it to the draft fails", async () => {
    let attempts = 0;
    const calls = mockFetch({
      "POST /api/drafts/theme-night/cubes": () => {
        attempts += 1;
        return attempts === 1
          ? Response.json({ error: "The draft started first.", code: "CUBE_ATTACH_CONFLICT", savedCubeId: 77 }, { status: 409 })
          : Response.json({ cube: cube(77, "Dragon"), allowedCubeIds: [10, 11, 12, 77] }, { status: 201 });
      },
    });
    render(<ThemeTableLobby {...table({ isCreator: true })} />);
    fireEvent.change(screen.getByLabelText("Search an archetype"), { target: { value: "Dragon" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => /saved in your library/.test(a.textContent ?? ""))).toBe(true), { timeout: 2000 });
    const alert = screen.getAllByRole("alert").find((a) => /saved in your library/.test(a.textContent ?? ""))!;
    fireEvent.click(within(alert).getByRole("button", { name: "Try adding it again" }));
    await waitFor(() => expect(attempts).toBe(2));
    expect(calls.filter((c) => c.method === "POST").at(-1)?.body).toEqual({ kind: "existing", cubeId: 77 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Try adding it again" })).toBeNull());
  });

  it("opens the whole pool of a cube read-only", async () => {
    mockFetch({
      "GET /api/cubes/10": () => ({
        cards: [{ id: 1, name: "Blue-Eyes White Dragon", type: "Normal Monster", frameType: "normal", effectText: "", imageUrl: "", imageUrlSmall: "" }],
        pools: { main: [{ catalogCardId: 1, maxCopies: 3 }], extra: [] },
      }),
    });
    render(<ThemeTableLobby {...table()} />);
    fireEvent.click(screen.getByRole("button", { name: "See the cards in Blue-Eyes" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("ThemeTableLobby deleting a theme", () => {
  const libraryRoute = (cubes: object[]) => ({ "GET /api/cubes": () => ({ cubes }) });
  const mine = { id: 10, name: "Blue-Eyes", canEdit: true, createdByUserId: "u1", createdByName: "Imran" };
  const theirs = { id: 11, name: "Mermail", canEdit: false, createdByUserId: "u9", createdByName: "Ana" };
  const host = (extra: Partial<ThemeTableLobbyProps> = {}) => table({ isCreator: true, viewerUserId: "u1", ...extra });

  it("offers Delete only for a cube the viewer may delete, and only Remove for another cube", async () => {
    mockFetch(libraryRoute([mine, theirs]));
    render(<ThemeTableLobby {...host()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "More for Blue-Eyes" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "More for Mermail" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Mermail from the draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Gravekeeper from the draft" })).not.toBeNull();
  });

  it("takes a cube out of the draft without a library call when the viewer cannot delete it", async () => {
    const calls = mockFetch({ ...libraryRoute([theirs]), "DELETE /api/drafts/theme-night/cubes": () => ({ ok: true, allowedCubeIds: [10, 12] }) });
    render(<ThemeTableLobby {...host()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Mermail from the draft" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/drafts/theme-night/cubes")).toBe(true));
    expect(calls.some((c) => c.url.startsWith("/api/cubes/") && c.method === "DELETE")).toBe(false);
  });

  it("takes the cube out of the draft (and its claims) first, then deletes it from the library", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const calls = mockFetch({
      ...libraryRoute([mine]),
      "DELETE /api/cubes/10": () => ({ ok: true }),
      "DELETE /api/drafts/theme-night/cubes": () => ({ ok: true, allowedCubeIds: [11, 12] }),
    });
    render(<ThemeTableLobby {...host()} />);
    fireEvent.click(await screen.findByRole("button", { name: "More for Blue-Eyes" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(2));
    const order = calls.filter((c) => c.method === "DELETE").map((c) => c.url);
    expect(order).toEqual(["/api/drafts/theme-night/cubes", "/api/cubes/10"]);
    expect(String((window.confirm as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain("your library");
  });

  it("does not touch the library when the draft refuses to let the cube go", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const calls = mockFetch({
      ...libraryRoute([mine]),
      "DELETE /api/drafts/theme-night/cubes": () => Response.json({ error: "Forbidden" }, { status: 403 }),
    });
    render(<ThemeTableLobby {...host()} />);
    fireEvent.click(await screen.findByRole("button", { name: "More for Blue-Eyes" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    expect(await screen.findByText(/couldn't delete that theme|forbidden/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/cubes/10")).toBe(false);
  });

  it("names the other member's library when an admin deletes their cube", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    mockFetch(libraryRoute([{ ...theirs, canEdit: true }]));
    render(<ThemeTableLobby {...host()} />);
    fireEvent.click(await screen.findByRole("button", { name: "More for Mermail" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    const text = String((window.confirm as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]);
    expect(text).toContain("Ana's library");
    expect(text).not.toContain("your library");
  });
});

describe("ThemeTableLobby Discord", () => {
  it("hides Nudge and the Discord invite text unless Discord is on", () => {
    mockFetch({});
    const view = render(<ThemeTableLobby {...table({ isCreator: true, draft: { players: [person(1, "Imran", { isHost: true, isYou: true }), person(2, "Ana")] } })} />);
    expect(screen.queryByRole("button", { name: /nudge/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Invite players" }));
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/discord/i);
    expect(screen.getByRole("dialog")).toHaveTextContent(/link/i);
    view.unmount();

    render(<ThemeTableLobby {...table({ isCreator: true, discordEnabled: true, draft: { players: [person(1, "Imran", { isHost: true, isYou: true }), person(2, "Ana")] } })} />);
    expect(screen.getByRole("button", { name: /nudge ana/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Invite players" }));
    expect(screen.getByRole("button", { name: "Post to Discord" })).toBeInTheDocument();
  });
});

describe("ThemeTableLobby layout rules", () => {
  const dir = resolve(__dirname, "../../src/components/draft/theme");
  const css = readFileSync(resolve(dir, "theme-table.module.css"), "utf8");

  it("draws the oval as decoration and keeps every control in the seat list", () => {
    mockFetch({});
    const { container } = render(<ThemeTableLobby {...table()} />);
    const oval = container.querySelector("[data-seats][aria-hidden='true']");
    expect(oval).not.toBeNull();
    expect(oval!.querySelector("button, select, input, a")).toBeNull();
    expect(screen.getByRole("list", { name: "Seats" })).toBeInTheDocument();
  });

  it("has a tablet and a phone layout and no hover zoom", () => {
    // The breakpoints follow the room of the page (the side rail takes 236 px), not the screen.
    expect(css).toMatch(/container: tt \/ inline-size/);
    expect(css).toMatch(/@container tt \(max-width: 1229px\)/);
    expect(css).toMatch(/@container tt \(max-width: 719px\)/);
    expect(css).not.toMatch(/@media \(max-width: 1279px\)/);
    expect(css).toMatch(/prefers-reduced-motion/);
    const hover = css.split("\n").filter((line) => line.includes(":hover"));
    for (const line of hover) expect(line).not.toMatch(/scale|zoom|transform|translate/);
  });

  it("does not pull the active draft room into the table", () => {
    for (const file of ["theme-table-lobby.tsx", "theme-seat.tsx", "theme-box.tsx", "theme-table-card.tsx", "use-theme-table.ts"]) {
      expect(readFileSync(resolve(dir, file), "utf8")).not.toMatch(/from "[^"]*draft-room[^"]*"/);
    }
  });
});
