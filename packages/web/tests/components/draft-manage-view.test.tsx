// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DraftManageView } from "../../src/components/draft/draft-manage-view";
import type { CardSummary } from "../../src/lib/card-types";
import { installVirtualizerJsdomEnv } from "../helpers/virtualizer-jsdom";
import { CATALOG, GOAT, stubFetch } from "../helpers/pool-fixtures";

vi.mock("next/image", () => ({
  default: ({ alt, fill: _fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));

const baseDraft = {
  id: 1,
  name: "Legendary Draft",
  status: "pending",
  createdByUserId: "creator-1",
  createdAt: "2026-05-06T12:00:00.000Z",
  config: {
    packSize: 5,
    packsPerPlayer: 3,
    cardsPerPlayer: 45,
    pickSeconds: 60,
    setNames: ["Legend of Blue Eyes White Dragon"],
  },
  players: [],
  playerCount: 0,
};

const baseProps = {
  draft: baseDraft,
  isCreator: true,
  isParticipant: true,
  onStart: vi.fn().mockResolvedValue(undefined),
  onCancel: vi.fn().mockResolvedValue(undefined),
  onUpdate: vi.fn().mockResolvedValue(undefined),
  onJoin: vi.fn().mockResolvedValue(undefined),
};

describe("DraftManageView — setup rail", () => {
  it("shows booster reachability errors on entering the lobby and refreshes them after edits", async () => {
    let errors = ["This pool can give one player at most 24 cards (at most 3 copies of each card), but the deck needs 40."];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/preflight")
      ? Response.json({ errors, warnings: [] })
      : Response.json({ cards: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<DraftManageView {...baseProps} slug="narrow" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("at most 3 copies");
    errors = [];
    rerender(<DraftManageView {...baseProps} slug="narrow" draft={{
      ...baseDraft, config: { ...baseDraft.config, cardsPerPlayer: 20 },
    }} />);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/preflight"))).toHaveLength(2);
  });

  it("shows the configured cards-per-player in the read-only setup", () => {
    render(<DraftManageView {...baseProps} />);
    expect(screen.getByText("Each player")).toBeInTheDocument();
    expect(screen.getByText("45 cards")).toBeInTheDocument();
    expect(screen.getByText("Pick duration")).toBeInTheDocument();
    expect(screen.getByText("1 min")).toBeInTheDocument();
  });

  it("lists the sets as chips", () => {
    render(<DraftManageView {...baseProps} />);
    expect(screen.getByText("Legend of Blue Eyes White Dragon")).toBeInTheDocument();
  });

  it.each([
    [45, "45 s"], [90, "1 min 30 s"], [600, "10 min"],
  ])("formats a %i-second pick in the lobby Setup panel as %s", (seconds, text) => {
    render(<DraftManageView {...baseProps} draft={{ ...baseDraft, config: { ...baseDraft.config, pickSeconds: seconds } }} />);
    const setup = screen.getByRole("heading", { name: "Setup" }).closest("section")!;
    expect(within(setup).getByText("Pick duration").nextElementSibling).toHaveTextContent(text);
  });

  it("shows the theme setup, not the cube defaults, for a theme draft", () => {
    const theme = { ...baseDraft, config: { mode: "theme" as const, cardsPerPlayer: 40, extraDeckEnabled: true, extraDeckSize: 15, themePackSize: 3, pickSeconds: 45, themeSelection: "player_pick" as const, uniqueThemes: true } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ errors: [], warnings: [] })));
    render(<DraftManageView {...baseProps} slug="s" draft={theme} />);
    expect(screen.getByText("Players pick, all different")).toBeInTheDocument();
    expect(screen.getByText("3 choices")).toBeInTheDocument();
    expect(screen.getByText("Can come back")).toBeInTheDocument();
    expect(screen.queryByText("Packs")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit setup/i })).not.toBeInTheDocument();
  });
});

describe("DraftManageView — header, players, start", () => {
  const players = [
    { playerId: 1, displayName: "Imran", pickCount: 0, joinedAt: "2026-05-06T19:02:00.000Z" },
    { playerId: 2, displayName: "Kestrel", pickCount: 0, joinedAt: "2026-05-06T19:05:00.000Z" },
  ];
  const seats = [
    { playerId: 1, isCurrentPlayer: true },
    { playerId: 2, isCurrentPlayer: false },
  ];

  it.each([
    ["booster", ["Lobby", "Draft", "Build deck"]],
    ["theme", ["Lobby", "Main deck", "Extra deck", "Build deck"]],
  ] as const)("shows the %s stage line with Lobby current", (mode, labels) => {
    render(<DraftManageView {...baseProps} draft={{ ...baseDraft, config: { ...baseDraft.config, mode, extraDeckEnabled: true } }} />);
    const stages = screen.getByRole("list", { name: "Draft progress" });
    expect(Array.from(stages.querySelectorAll(".sv-stage-l"), (l) => l.textContent)).toEqual(labels);
    expect(within(stages).getByText("Lobby").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("shows the back link, the name in the bar, short pieces and the host's rename pencil", () => {
    const { container } = render(<DraftManageView {...baseProps} />);
    expect(screen.getByRole("link", { name: /all drafts/i })).toHaveAttribute("href", "/drafts");
    expect(screen.getByRole("heading", { level: 1, name: /legendary draft/i })).toBeInTheDocument();
    expect(screen.getByText("Waiting to start")).toBeInTheDocument();
    expect(screen.getByText("Cube draft")).toBeInTheDocument();
    expect(screen.getByText("Hosted by you")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename draft" })).toBeInTheDocument();
    const pieces = screen.getByText("Waiting to start").closest("ul")!;
    expect(Array.from(pieces.children, (item) => item.textContent)).toEqual([
      "Waiting to start", "Cube draft", "Hosted by you", "Created Wed, May 6",
    ]);
    expect(container.textContent).not.toMatch(/\u00b7/);
  });

  it("hides rename and 'Hosted by you' from a non-host", () => {
    render(<DraftManageView {...baseProps} isCreator={false} />);
    expect(screen.queryByRole("button", { name: "Rename draft" })).not.toBeInTheDocument();
    expect(screen.queryByText("Hosted by you")).not.toBeInTheDocument();
  });

  it("renames inline and saves through onUpdate", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<DraftManageView {...baseProps} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByRole("button", { name: "Rename draft" }));
    const input = screen.getByRole("textbox", { name: "Draft name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Goat format cube");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onUpdate).toHaveBeenCalledWith({ name: "Goat format cube" });
  });

  it("marks your seat 'You' and 'Host' only when you are the host", () => {
    const draft = { ...baseDraft, players, playerCount: 2, seats };
    const { unmount } = render(<DraftManageView {...baseProps} draft={draft} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getAllByText(/^Joined /)).toHaveLength(2);
    unmount();
    render(<DraftManageView {...baseProps} draft={draft} isCreator={false} />);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByText("Host")).not.toBeInTheDocument();
  });

  it.each([
    [0, false], [1, false], [6, false], [7, true], [12, true],
  ] as const)("marks the seats list for the compact layout with %i players: %s", (count, many) => {
    const lobbyPlayers = Array.from({ length: count }, (_, i) => ({
      ...players[0], playerId: i + 1, displayName: `Player ${i + 1}`,
    }));
    render(<DraftManageView {...baseProps} draft={{ ...baseDraft, players: lobbyPlayers, playerCount: count }} />);
    const section = screen.getByRole("heading", { name: "Players" }).closest("section")!;
    const list = within(section).getByRole("list");
    if (many) expect(list).toHaveAttribute("data-many");
    else expect(list).not.toHaveAttribute("data-many");
  });

  it("shows an open seat and a disabled Start with the reason under two players", () => {
    const draft = { ...baseDraft, players: [players[0]], playerCount: 1, seats: [seats[0]] };
    render(<DraftManageView {...baseProps} draft={draft} />);
    expect(screen.getByText("Open seat")).toBeInTheDocument();
    expect(screen.getByText("Needed to start")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start draft" })).toBeDisabled();
    expect(screen.getByText("Need 1 more player to start.")).toBeInTheDocument();
  });

  it("starts the draft and says what it deals", async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const draft = { ...baseDraft, players, playerCount: 2, seats };
    render(<DraftManageView {...baseProps} draft={draft} onStart={onStart} />);
    // The Start sentence and the Setup row both say it.
    expect(screen.getAllByText("3 packs of 5")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Start draft" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows the server's start error", async () => {
    const draft = { ...baseDraft, players, playerCount: 2, seats };
    render(<DraftManageView {...baseProps} draft={draft} onStart={vi.fn().mockRejectedValue(new Error("Draft requires at least two players to start"))} />);
    await userEvent.click(screen.getByRole("button", { name: "Start draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Draft requires at least two players to start");
  });

  it("offers the invite link with the full URL and a copied state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<DraftManageView {...baseProps} slug="goat-night" />);
    const field = screen.getByRole("textbox", { name: "Invite link" }) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe(`${window.location.origin}/draft/goat-night`));
    expect(field).toHaveAttribute("readonly");
    await userEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/draft/goat-night`);
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
    expect(screen.getByText("/draft join")).toBeInTheDocument();
  });

  it("shows a guest the Join card instead of the invite panel, and joins", async () => {
    const onJoin = vi.fn().mockResolvedValue(undefined);
    render(<DraftManageView {...baseProps} slug="s" isCreator={false} isParticipant={false} onJoin={onJoin} />);
    expect(screen.getByRole("heading", { name: "Join Legendary Draft" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Invite link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start draft" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Join draft" }));
    expect(onJoin).toHaveBeenCalledOnce();
  });

  it("tells a joined player to wait for the host", () => {
    render(<DraftManageView {...baseProps} isCreator={false} isParticipant />);
    expect(screen.getByText("You're in. Waiting for the host to start.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start draft" })).not.toBeInTheDocument();
  });

  it("confirms in place before cancelling the draft", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(<DraftManageView {...baseProps} onCancel={onCancel} />);
    expect(screen.getByText(/Ends it for the 0 players who joined/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText("Cancel this draft?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByText("Cancel this draft?")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel draft" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("backs out of the cancel confirm with Escape and refocuses Cancel draft", async () => {
    const onCancel = vi.fn();
    render(<DraftManageView {...baseProps} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(screen.getByRole("button", { name: "Go back" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("Cancel this draft?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel draft" })).toHaveFocus();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("DraftManageView — theme draft", () => {
  const cubes = [
    { id: 7, name: "Despia", archetype: "Despia", mainCount: 52, extraCount: 9, sampleImages: ["a.png", "b.png"] },
    { id: 8, name: "Lightsworn", archetype: null, mainCount: 38, extraCount: 4, sampleImages: [] },
  ];
  const themeDraft = (over: Record<string, unknown> = {}) => ({
    ...baseDraft,
    players: [
      { playerId: 1, displayName: "Imran", pickCount: 0, joinedAt: "2026-05-06T19:02:00.000Z" },
      { playerId: 2, displayName: "Kestrel", pickCount: 0, joinedAt: "2026-05-06T19:05:00.000Z" },
    ],
    playerCount: 2,
    seats: [{ playerId: 1, isCurrentPlayer: true }, { playerId: 2, isCurrentPlayer: false }],
    allowedCubes: cubes,
    config: { mode: "theme" as const, cardsPerPlayer: 40, extraDeckEnabled: true, extraDeckSize: 15, pickSeconds: 45, themeSelection: "player_pick" as const, uniqueThemes: true, ...over },
  });
  const stubFetch = (extra?: (url: string, init?: RequestInit) => Response | undefined) =>
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const hit = extra?.(url, init);
      if (hit) return hit;
      if (url.endsWith("/preflight")) return Response.json({ errors: ["Despia: Main pool is too small."], warnings: ["Lightsworn: 38 cards need 42."] });
      if (url === "/api/cubes") return Response.json({ cubes: [{ id: 9, name: "Branded", archetype: null, mainCount: 40, extraCount: 5 }] });
      return Response.json({}, { status: 404 });
    }));

  it("keeps unknown preflight messages as raw paragraphs", async () => {
    stubFetch();
    render(<DraftManageView {...baseProps} slug="s" draft={themeDraft()} isCreator={false} isParticipant />);
    expect(await screen.findByText(/Main pool is too small/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Despia: Main pool is too small.");
    expect(screen.getAllByRole("status").some((el) => /Lightsworn:\s*38 cards need 42/.test(el.textContent ?? ""))).toBe(true);
    expect(screen.getByText("Despia: Main pool is too small.").tagName).toBe("P");
    expect(screen.getByText("Lightsworn: 38 cards need 42.").tagName).toBe("P");
    expect(screen.queryByText(/re-roll/i)).not.toBeInTheDocument();
  });

  it("shows parsed shortfalls on theme tiles and compact summaries for joined players", async () => {
    stubFetch((url) => url.endsWith("/preflight") ? Response.json({
      errors: ["Despia: Main pool has 12 cards but needs at least 42 for a 40-card main deck (3 choices/pick)."],
      warnings: ["Lightsworn: Extra pool has 3 cards but needs 17 for a full 15-card Extra Deck; players may end with fewer Extra cards."],
    }) : undefined);
    render(<DraftManageView {...baseProps} slug="s" draft={themeDraft()} isCreator={false} isParticipant />);
    expect(await screen.findByText("Main pool too small: 12 of 42 cards")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Despia can't be drafted yet. Its main pool is too small.");
    expect(screen.getByRole("alert")).toHaveTextContent("Add cards to the cube, or remove the theme.");
    expect(screen.getByText("Extra may run short: 3 of 17 cards")).toBeInTheDocument();
    expect(screen.getByText("1 theme may run short on Extra deck cards, so that player could end with fewer. You can start anyway.").closest('[role="status"]')).toBeInTheDocument();
  });

  it("lets a joined player claim a theme and confirms it in a live line", async () => {
    const claim = vi.fn();
    stubFetch((url, init) => {
      if (url.endsWith("/claim-cube")) {
        claim(JSON.parse(String(init?.body)));
        return Response.json({ ok: true, cubeId: 7 });
      }
    });
    const onChanged = vi.fn();
    render(<DraftManageView {...baseProps} slug="s" draft={themeDraft()} isCreator={false} isParticipant onChanged={onChanged} />);
    expect(screen.getByText("You're in. Claim a theme before the host starts.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Claim Despia" }));
    expect(claim).toHaveBeenCalledWith({ cubeId: 7 });
    expect(await screen.findByText("You claimed Despia. Claim another to switch.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByText("Yours")).not.toBeInTheDocument();
  });

  it("drops the claimed line once the host detaches that theme", async () => {
    stubFetch((url) => (url.endsWith("/claim-cube") ? Response.json({ ok: true, cubeId: 7 }) : undefined));
    const { rerender } = render(<DraftManageView {...baseProps} slug="s" draft={themeDraft()} isCreator={false} isParticipant />);
    await userEvent.click(screen.getByRole("button", { name: "Claim Despia" }));
    expect(await screen.findByText("You claimed Despia. Claim another to switch.")).toBeInTheDocument();
    rerender(<DraftManageView {...baseProps} slug="s" draft={{ ...themeDraft(), allowedCubes: [cubes[1]] }} isCreator={false} isParticipant />);
    expect(screen.queryByText(/You claimed Despia/)).not.toBeInTheDocument();
  });

  it("shows no Claim buttons for random themes", async () => {
    stubFetch();
    render(<DraftManageView {...baseProps} slug="s" draft={themeDraft({ themeSelection: "random" })} isCreator={false} isParticipant />);
    expect(screen.getByText("Themes are dealt at random when the host presses Start.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^claim/i })).not.toBeInTheDocument();
    expect(screen.getByText("You're in. Waiting for the host to start.")).toBeInTheDocument();
  });

  it("gives the host theme tools: edit link, a menu with Detach and Delete, and the add panel", async () => {
    stubFetch();
    render(<DraftManageView {...baseProps} slug="s" draft={themeDraft()} isCreator isParticipant />);
    expect(screen.getByRole("link", { name: "Edit cube Despia" })).toHaveAttribute("href", "/cubes/7?from=%2Fdraft%2Fs");
    const more = screen.getByRole("button", { name: "More for Despia" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Detach" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    expect(screen.getByRole("group", { name: "Add a theme" })).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "Attach an existing cube" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a blank cube" })).toBeInTheDocument();
  });

  it("offers theme and Any cubes to attach, but not a cube made for cube drafts", async () => {
    stubFetch((url) =>
      url === "/api/cubes"
        ? Response.json({
            cubes: [
              { id: 9, name: "Branded", archetype: null, mainCount: 40, extraCount: 5, draftType: "theme" },
              { id: 10, name: "Open pool", archetype: null, mainCount: 40, extraCount: 5, draftType: "any" },
              { id: 11, name: "Booster pool", archetype: null, mainCount: 40, extraCount: 5, draftType: "booster" },
              { id: 12, name: "Old pool", archetype: null, mainCount: 40, extraCount: 5 },
            ],
          })
        : undefined,
    );
    render(<DraftManageView {...baseProps} slug="s" draft={themeDraft()} isCreator isParticipant />);
    const picker = await screen.findByRole("combobox", { name: "Attach an existing cube" });
    const names = Array.from(picker.querySelectorAll("option"), (o) => o.textContent ?? "");
    expect(names.some((n) => n.includes("Branded"))).toBe(true);
    expect(names.some((n) => n.includes("Open pool"))).toBe(true);
    expect(names.some((n) => n.includes("Old pool"))).toBe(true);
    expect(names.some((n) => n.includes("Booster pool"))).toBe(false);
  });

  it("detaches a theme through the same endpoint", async () => {
    const detach = vi.fn();
    stubFetch((url, init) => {
      if (url === "/api/drafts/s/cubes" && init?.method === "DELETE") {
        detach(JSON.parse(String(init.body)));
        return Response.json({ ok: true });
      }
    });
    const onChanged = vi.fn();
    render(<DraftManageView {...baseProps} slug="s" draft={themeDraft()} isCreator isParticipant onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: "More for Despia" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Detach" }));
    await waitFor(() => expect(detach).toHaveBeenCalledWith({ cubeId: 7 }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("keeps focus on the menu button when the host backs out of Delete", async () => {
    stubFetch();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DraftManageView {...baseProps} slug="s" draft={themeDraft()} isCreator isParticipant />);
    const more = screen.getByRole("button", { name: "More for Despia" });
    await userEvent.click(more);
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(confirm).toHaveBeenCalled();
    expect(more).toHaveFocus();
    confirm.mockRestore();
  });

  it("disables Start until each player has a theme of their own", () => {
    stubFetch();
    render(<DraftManageView {...baseProps} slug="s" draft={{ ...themeDraft(), allowedCubes: [cubes[0]] }} isCreator isParticipant />);
    expect(screen.getByRole("button", { name: "Start draft" })).toBeDisabled();
    expect(screen.getByText("Add 1 more theme. Each of the 2 players needs their own.")).toBeInTheDocument();
  });
});

describe("DraftManageView — Add Bot button", () => {
  it("shows Add Bot button when botsEnabled=true and isCreator=true", () => {
    const onAddBot = vi.fn().mockResolvedValue(undefined);
    render(<DraftManageView {...baseProps} botsEnabled={true} onAddBot={onAddBot} />);
    expect(screen.getByRole("button", { name: /add bot/i })).toBeInTheDocument();
  });

  it("hides Add Bot button when botsEnabled=false", () => {
    const onAddBot = vi.fn().mockResolvedValue(undefined);
    render(<DraftManageView {...baseProps} botsEnabled={false} onAddBot={onAddBot} />);
    expect(screen.queryByRole("button", { name: /add bot/i })).not.toBeInTheDocument();
  });

  it("hides Add Bot button when botsEnabled=true but isCreator=false", () => {
    const onAddBot = vi.fn().mockResolvedValue(undefined);
    render(
      <DraftManageView {...baseProps} isCreator={false} botsEnabled={true} onAddBot={onAddBot} />
    );
    expect(screen.queryByRole("button", { name: /add bot/i })).not.toBeInTheDocument();
  });

  it("calls onAddBot when the button is clicked", async () => {
    const onAddBot = vi.fn().mockResolvedValue(undefined);
    render(<DraftManageView {...baseProps} botsEnabled={true} onAddBot={onAddBot} />);
    await userEvent.click(screen.getByRole("button", { name: /add bot/i }));
    expect(onAddBot).toHaveBeenCalledOnce();
  });
});

const noop = async () => {};

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("DraftManageView — card pool section", () => {
  beforeEach(() => installVirtualizerJsdomEnv());

  it("fetches and renders the resolved pool", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/drafts/my-slug/pool") {
        return Response.json({ cards: [{ id: 46986414, name: "Dark Magician", type: "Spellcaster / Normal Monster", frameType: "normal", effectText: "", imageUrl: "u", imageUrlSmall: "s" } as CardSummary] });
      }
      return Response.json({}, { status: 404 });
    }));
    render(<DraftManageView draft={baseDraft} slug="my-slug" isCreator isParticipant={false} onStart={noop} onCancel={noop} onUpdate={noop} onJoin={noop} />);
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 2, name: /card pool/i }).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole("button", { name: /preview dark magician/i })).toBeTruthy());
    // The kind tally sits at the top of the pool.
    expect(screen.getByText("Monsters")).toBeTruthy();
  });

  it("shows the empty state when the pool resolves empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/drafts/my-slug/pool") return Response.json({ cards: [] });
      return Response.json({}, { status: 404 });
    }));
    render(<DraftManageView draft={baseDraft} slug="my-slug" isCreator isParticipant={false} onStart={noop} onCancel={noop} onUpdate={noop} onJoin={noop} />);
    await waitFor(() => expect(screen.getByText(/hasn't been resolved yet/i)).toBeTruthy());
  });

  it("shows error UI and Retry button when the pool fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/drafts/my-slug/pool") {
        return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
      }
      return Response.json({}, { status: 404 });
    }));
    render(<DraftManageView draft={baseDraft} slug="my-slug" isCreator isParticipant={false} onStart={noop} onCancel={noop} onUpdate={noop} onJoin={noop} />);
    await waitFor(() => expect(screen.getByText(/couldn't load the pool/i)).toBeTruthy());
  });
});

describe("DraftManageView — editing the setup", () => {
  beforeEach(() => installVirtualizerJsdomEnv());

  const withQty = (id: number, qty: number) => ({ ...CATALOG.find((c) => c.id === id)!, qty });
  const goatPool = GOAT.mainCards.map((c) => withQty(c.id, c.copies));
  const fromGoat = {
    ...baseDraft,
    config: { ...baseDraft.config, setNames: [], customCardIds: [101, 101, 101, 102, 102, 103, 104, 104, 104], poolSource: { cubeId: 1, cubeName: "Goat cube" } },
  };
  const builtHere = { ...baseDraft, config: { ...baseDraft.config, setNames: [], customCardIds: [105, 105, 106] } };

  async function openEdit(draft: typeof fromGoat, onUpdate = vi.fn().mockResolvedValue(undefined)) {
    render(<DraftManageView draft={draft} slug="my-slug" isCreator isParticipant={false} onStart={noop} onCancel={noop} onUpdate={onUpdate} onJoin={noop} />);
    await userEvent.click(screen.getByRole("button", { name: /edit setup/i }));
    await screen.findByRole("heading", { name: "Pool" });
    return onUpdate;
  }

  it("names the cube the draft came from in the setup rail, with its card count", async () => {
    stubFetch({ draftPool: goatPool });
    render(<DraftManageView draft={fromGoat} slug="my-slug" isCreator isParticipant={false} onStart={noop} onCancel={noop} onUpdate={noop} onJoin={noop} />);
    const setup = screen.getByRole("heading", { name: "Setup" }).closest("section")!;
    await waitFor(() => expect(within(setup).getByText("Pool").nextElementSibling).toHaveTextContent("Goat cube9 cards"));
    expect(within(setup).getByText(/Only enough different cards for 0 players/)).toBeInTheDocument();
  });

  it("says Built for this draft when the pool has no cube behind it", async () => {
    stubFetch({ draftPool: [withQty(105, 2), withQty(106, 1)] });
    render(<DraftManageView draft={builtHere} slug="my-slug" isCreator isParticipant={false} onStart={noop} onCancel={noop} onUpdate={noop} onJoin={noop} />);
    const setup = screen.getByRole("heading", { name: "Setup" }).closest("section")!;
    await waitFor(() => expect(within(setup).getByText("Pool").nextElementSibling).toHaveTextContent("Built for this draft3 cards"));
  });

  it("opens the editor on the draft's own pool, with no way to change cube, and shows what differs from the cube", async () => {
    stubFetch({ draftPool: [...goatPool.slice(0, 3), withQty(105, 1)] });
    await openEdit(fromGoat);

    const summary = await screen.findByRole("region", { name: "Chosen cube" });
    expect(summary).toHaveTextContent("From Goat cube, edited");
    expect(summary).toHaveTextContent("Saved with this draft");
    expect(screen.queryByRole("button", { name: "Change cube" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start from scratch" })).toBeNull();
    expect(screen.getByRole("region", { name: "Pool status" })).toHaveTextContent("Edited for this draft. 1 card added, 3 removed.");
    expect(screen.getByLabelText("Search cards by name")).toBeInTheDocument();
    // The pool the host sees is the draft's: the trap taken out of it waits under Removed.
    fireEvent.click(screen.getByRole("button", { name: "Removed (1)" }));
    expect(screen.getByRole("button", { name: "Undo removing Mirror Force" })).toBeInTheDocument();
  });

  it("Reset returns the pool to the cube it came from", async () => {
    stubFetch({ draftPool: [...goatPool.slice(0, 3), withQty(105, 1)] });
    await openEdit(fromGoat);
    fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
    expect(screen.queryByRole("region", { name: "Pool status" })).toBeNull();
    expect(screen.getByRole("region", { name: "Chosen cube" })).toHaveTextContent("From Goat cube");
    expect(screen.getByRole("region", { name: "Chosen cube" })).not.toHaveTextContent("edited");
  });

  it("saves the pool as cards with poolSource, never as sets, and keeps the pack fields", async () => {
    stubFetch({ draftPool: goatPool });
    const onUpdate = await openEdit(fromGoat);
    fireEvent.change(await screen.findByLabelText("Search cards by name"), { target: { value: "cipher" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add one copy of Cipher Soldier" }));
    fireEvent.change(screen.getByLabelText(/pick duration/i), { target: { value: "30" } });
    expect(screen.getByLabelText("Limit 3 copies per card")).toBeChecked();
    await userEvent.click(screen.getByLabelText("Limit 3 copies per card"));
    await userEvent.click(screen.getByRole("button", { name: "Save setup" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    const { config } = onUpdate.mock.calls[0][0] as { config: Record<string, unknown> };
    expect(config).toMatchObject({
      setNames: [],
      customCardIds: [101, 101, 101, 102, 102, 103, 104, 104, 104, 105],
      poolSource: { cubeId: 1, cubeName: "Goat cube" },
      includeNames: [],
      excludeNames: [],
      pickSeconds: 30,
      cardsPerPlayer: 45,
      copyLimit: false,
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save setup" })).toBeNull());
  });

  it("sends poolSource null when the pool has no cube behind it, so a stale source is cleared", async () => {
    stubFetch({ draftPool: [withQty(105, 2), withQty(106, 1)] });
    const onUpdate = await openEdit(builtHere as unknown as typeof fromGoat);
    expect(screen.getByRole("region", { name: "Pool status" })).toHaveTextContent("Not saved as a cube.");
    await userEvent.click(screen.getByRole("button", { name: "Save setup" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect((onUpdate.mock.calls[0][0] as { config: Record<string, unknown> }).config).toMatchObject({
      setNames: [],
      customCardIds: [105, 105, 106],
      poolSource: null,
    });
  });

  it("disables Save setup and reads Loading in the rail until the pool has loaded", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stubFetch({ extra: { "GET /api/drafts/my-slug/pool": () => gate.then(() => Response.json({ cards: goatPool })) } });
    render(<DraftManageView draft={fromGoat} slug="my-slug" isCreator isParticipant={false} onStart={noop} onCancel={noop} onUpdate={noop} onJoin={noop} />);
    await userEvent.click(screen.getByRole("button", { name: /edit setup/i }));
    const save = await screen.findByRole("button", { name: "Save setup" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-busy", "true");
    const setup = screen.getByRole("heading", { name: "Setup" }).closest("section")!;
    expect(within(setup).getByText("Pool").nextElementSibling).toHaveTextContent("Loading…");
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save setup" })).toBeEnabled());
    expect(within(setup).getByText("Pool").nextElementSibling).toHaveTextContent("Goat cube");
  });

  it("will not save an empty pool", async () => {
    stubFetch({ draftPool: [withQty(105, 1)] });
    const onUpdate = await openEdit(builtHere as unknown as typeof fromGoat);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Cipher Soldier from the pool" }));
    await userEvent.click(screen.getByRole("button", { name: "Save setup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add cards to the pool first");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("Cancel drops the edits, and opening again starts from the saved pool", async () => {
    stubFetch({ draftPool: goatPool });
    await openEdit(fromGoat);
    fireEvent.change(await screen.findByLabelText("Search cards by name"), { target: { value: "cipher" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add one copy of Cipher Soldier" }));
    expect(screen.getByRole("region", { name: "Pool status" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: /edit setup/i }));
    await screen.findByRole("heading", { name: "Pool" });
    await waitFor(() => expect(screen.getByRole("region", { name: "Chosen cube" })).toHaveTextContent("From Goat cube"));
    expect(screen.queryByRole("region", { name: "Pool status" })).toBeNull();
  });
});
