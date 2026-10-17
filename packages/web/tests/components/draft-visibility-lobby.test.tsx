// @vitest-environment jsdom
import { fixtureUserId } from "../fixtures/identity";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DraftManageView } from "../../src/components/draft/draft-manage-view";
import { ThemeTableLobby, type ThemeTableLobbyProps } from "../../src/components/draft/theme/theme-table-lobby";
import { installVirtualizerJsdomEnv } from "../helpers/virtualizer-jsdom";
import { stubFetch } from "../helpers/pool-fixtures";

vi.mock("next/image", () => ({
  default: ({ alt, fill: _fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => <img alt={alt} {...props} />,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const noop = vi.fn().mockResolvedValue(undefined);
const NOW = Date.now();
const lobby = (over: Record<string, unknown> = {}) => ({
  revision: 5, serverNow: new Date(NOW).toISOString(), targetSeats: 4, joined: 2, ready: 0, allReady: false,
  autoStart: { enabled: false, held: false, eligible: false }, start: null,
  errors: [] as string[], warnings: [] as string[], lastStartError: null, ...over,
});
const row = (playerId: number, displayName: string, over: Record<string, unknown> = {}) => ({
  playerId, displayName, pickCount: 0, joinedAt: "2026-10-07T11:00:00.000Z",
  isHost: false, isYou: false, isBot: false, ready: false, readyAt: null, cubeId: null, ...over,
});
const draftOf = (over: Record<string, unknown> = {}, players = [row(1, "Imran", { isHost: true }), row(2, "Ana", { isYou: true })]) => ({
  id: 1, name: "Night draft", status: "pending", createdByUserId: fixtureUserId("creator-1"), createdAt: "2026-05-06T12:00:00.000Z",
  config: { packSize: 5, packsPerPlayer: 3, cardsPerPlayer: 45, pickSeconds: 60, setNames: [], lobbySeats: 4 },
  players, playerCount: players.length, lobby: lobby({ joined: players.length }),
  seats: players.filter((p) => p.isYou).map((p) => ({ playerId: p.playerId, isCurrentPlayer: true })),
  ...over,
});
const view = (props: Record<string, unknown> = {}) => (
  <DraftManageView draft={draftOf() as never} slug="night" isCreator={false} isParticipant onStart={noop} onCancel={noop} onUpdate={noop} onJoin={noop} {...props} />
);

beforeEach(() => installVirtualizerJsdomEnv());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("cube lobby: host controls", () => {
  it("shows the switch, Copy invite link and Reset link to the host only", () => {
    stubFetch();
    const { unmount } = render(view({
      isCreator: true,
      draft: draftOf({ visibility: "private", canManageInvite: true, canJoin: false }, [row(1, "Imran", { isHost: true, isYou: true }), row(2, "Ana")]),
    }));
    const card = screen.getByRole("heading", { name: "Invite" }).closest("li")!;
    expect(within(card).getByRole("group", { name: "Who can join" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Copy invite link" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Reset link" })).toBeInTheDocument();
    unmount();

    // A seated player of the same draft: no controls anywhere.
    stubFetch();
    render(view({ draft: draftOf({ visibility: "private", canJoin: false }) }));
    expect(screen.queryByRole("group", { name: "Who can join" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy invite link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset link" })).toBeNull();
  });

  it("keeps the switch enabled in the pending lobby and locks it for a draft that is no longer pending", () => {
    stubFetch();
    const { rerender } = render(view({
      isCreator: true,
      draft: draftOf({ visibility: "open", canManageInvite: true }),
    }));
    expect(screen.getByRole("button", { name: "Private" })).toBeEnabled();
    rerender(view({ isCreator: true, draft: draftOf({ visibility: "open", canManageInvite: true, status: "active" }) }));
    expect(screen.getByRole("button", { name: "Private" })).toBeDisabled();
  });

  it("shows the badge in the page bar for the host and for a player", () => {
    stubFetch();
    const { unmount } = render(view({ isCreator: true, draft: draftOf({ visibility: "private", canManageInvite: true }) }));
    expect(document.querySelector(".sv-bar-sub")).toHaveTextContent("Private");
    unmount();
    render(view({ draft: draftOf({ visibility: "open" }) }));
    expect(document.querySelector(".sv-bar-sub")).toHaveTextContent("Open");
  });
});

describe("cube lobby: a non-host", () => {
  it("sees only the badge on a private draft: no Invite card, no Invite button, no controls", () => {
    stubFetch();
    render(view({ draft: draftOf({ visibility: "private", canJoin: false }) }));
    expect(document.querySelector(".sv-bar-sub")).toHaveTextContent("Private");
    expect(screen.queryByRole("heading", { name: "Invite" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite players" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy invite link|reset link/i })).toBeNull();
    expect(screen.queryByRole("group", { name: "Who can join" })).toBeNull();
  });

  it("still gets the plain link to share on an open draft", () => {
    stubFetch();
    render(view({ draft: draftOf({ visibility: "open" }) }));
    expect(screen.getByRole("button", { name: "Invite players" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy invite link" })).toBeNull();
  });
});

describe("cube lobby: Join only when canJoin", () => {
  const guest = (over: Record<string, unknown>) => view({
    isParticipant: false,
    draft: draftOf({ visibility: "private", ...over }, [row(1, "Imran", { isHost: true }), row(2, "Ana")]),
  });

  it("shows Join draft when the server says canJoin", () => {
    stubFetch();
    render(guest({ canJoin: true }));
    expect(screen.getByRole("button", { name: /join draft/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /join night draft/i })).toBeInTheDocument();
  });

  it("shows no Join button when canJoin is false", () => {
    stubFetch();
    render(guest({ canJoin: false }));
    expect(screen.queryByRole("button", { name: /join draft/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /join night draft/i })).toBeNull();
  });

  it("tells a guest without canJoin that no seat is open to them, and offers Join draft when canJoin is true", () => {
    stubFetch();
    const { rerender } = render(guest({ canJoin: true }));
    expect(screen.getAllByRole("button", { name: /join draft/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText("You can't take a seat in this draft.")).toBeNull();
    rerender(guest({ canJoin: false }));
    expect(screen.queryByRole("button", { name: /join draft/i })).toBeNull();
    expect(screen.getByText("You can't take a seat in this draft.")).toBeInTheDocument();
  });
});

describe("host who left their own seat", () => {
  const others = [row(1, "Imran", { isHost: true }), row(2, "Ana")];
  const seated = [row(1, "Imran", { isHost: true, isYou: true }), row(2, "Ana")];

  it("shows Take a seat when the host is not seated and canJoin is true, and pressing it runs join", async () => {
    stubFetch();
    const onJoin = vi.fn().mockResolvedValue(undefined);
    render(view({ isCreator: true, isParticipant: false, onJoin, draft: draftOf({ visibility: "private", canManageInvite: true, canJoin: true }, others) }));
    const take = screen.getByRole("button", { name: /take a seat/i });
    expect(screen.getByRole("button", { name: /^start draft/i })).toBeInTheDocument();
    fireEvent.click(take);
    await waitFor(() => expect(onJoin).toHaveBeenCalledTimes(1));
  });

  it("shows no Take a seat when the host is not seated and canJoin is false", () => {
    stubFetch();
    render(view({ isCreator: true, isParticipant: false, draft: draftOf({ visibility: "private", canManageInvite: true, canJoin: false }, others) }));
    expect(screen.queryByRole("button", { name: /take a seat/i })).toBeNull();
  });

  it("a seated host sees Leave and no Take a seat", () => {
    stubFetch();
    render(view({ isCreator: true, isParticipant: true, draft: draftOf({ visibility: "private", canManageInvite: true, canJoin: true }, seated) }));
    expect(screen.getByRole("button", { name: /leave/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /take a seat/i })).toBeNull();
  });
});

describe("legacy list lobby", () => {
  it("gives the host the controls in the Invite players section and hides the section from a private draft's players", () => {
    stubFetch();
    const legacy = (over: Record<string, unknown>) => ({ ...draftOf(over), lobby: undefined });
    const { unmount } = render(view({ isCreator: true, draft: legacy({ visibility: "private", canManageInvite: true }) }));
    const section = screen.getByRole("heading", { name: "Invite players" }).closest("section")!;
    expect(within(section).getByRole("button", { name: "Copy invite link" })).toBeInTheDocument();
    unmount();
    render(view({ draft: legacy({ visibility: "private" }) }));
    expect(screen.queryByRole("heading", { name: "Invite players" })).toBeNull();
  });
});

describe("theme table lobby", () => {
  const config = { themeSelection: "player_pick" as const, uniqueThemes: true, cardsPerPlayer: 40, themePackSize: 3, extraDeckEnabled: true, extraDeckSize: 15, pickSeconds: 45, lobbySeats: 4, copyLimit: true, burnUnpicked: false };
  const props = (over: Partial<ThemeTableLobbyProps["draft"]> = {}, rest: Partial<ThemeTableLobbyProps> = {}): ThemeTableLobbyProps => ({
    slug: "night",
    isCreator: false,
    isParticipant: true,
    onChanged: vi.fn(),
    draft: {
      name: "Theme night",
      config,
      lobby: lobby() as never,
      players: [row(1, "Imran", { isHost: true }), row(2, "Ana", { isYou: true })] as never,
      allowedCubes: [],
      ...over,
    },
    ...rest,
  });
  const quiet = () => vi.stubGlobal("fetch", vi.fn(async () => Response.json({ cubes: [], archetypes: [], errors: [], warnings: [] })));

  it("opens the host's Invite dialog on the real controls", () => {
    quiet();
    render(<ThemeTableLobby {...props({ visibility: "private", canManageInvite: true }, { isCreator: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Invite players" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Copy invite link" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Who can join" })).toBeInTheDocument();
  });

  it("gives a player of a private draft no Invite button", () => {
    quiet();
    render(<ThemeTableLobby {...props({ visibility: "private" })} />);
    expect(screen.queryByRole("button", { name: "Invite players" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
  });

  it("keeps the plain invite on an open draft", () => {
    quiet();
    render(<ThemeTableLobby {...props({ visibility: "open" })} />);
    fireEvent.click(screen.getByRole("button", { name: "Invite players" }));
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Invite link" })).toBeInTheDocument();
  });

  it("offers no Join to a guest without canJoin", () => {
    quiet();
    const guest = [row(1, "Imran", { isHost: true }), row(2, "Ana")] as never;
    const { rerender } = render(<ThemeTableLobby {...props({ visibility: "open", canJoin: true, players: guest }, { isParticipant: false, onJoin: noop })} />);
    expect(screen.getByRole("button", { name: /join draft/i })).toBeInTheDocument();
    rerender(<ThemeTableLobby {...props({ visibility: "open", canJoin: false, players: guest }, { isParticipant: false, onJoin: noop })} />);
    expect(screen.queryByRole("button", { name: /join draft/i })).toBeNull();
  });

  it("gives the host a Take a seat that runs join when not seated, and Leave instead when seated", async () => {
    quiet();
    const onJoin = vi.fn().mockResolvedValue(undefined);
    const away = [row(1, "Imran", { isHost: true }), row(2, "Ana")] as never;
    const { unmount } = render(<ThemeTableLobby {...props({ visibility: "private", canManageInvite: true, canJoin: true, players: away }, { isCreator: true, isParticipant: false, onJoin })} />);
    fireEvent.click(screen.getByRole("button", { name: /take a seat/i }));
    await waitFor(() => expect(onJoin).toHaveBeenCalledTimes(1));
    unmount();

    const here = [row(1, "Imran", { isHost: true, isYou: true }), row(2, "Ana")] as never;
    render(<ThemeTableLobby {...props({ visibility: "private", canManageInvite: true, canJoin: true, players: here }, { isCreator: true, isParticipant: true, onJoin })} />);
    expect(screen.getByRole("button", { name: /leave/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /take a seat/i })).toBeNull();
  });
});
