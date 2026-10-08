// @vitest-environment jsdom
import { fixtureUserId } from "../fixtures/identity";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { SheetRoot } from "@/components/sheet";
import { HostInviteControls } from "../../src/components/draft/visibility/host-invite-controls";
import { TournamentLobby } from "../../src/components/tournament/tournament-lobby";
import { TournamentSheet } from "../../src/components/tournament/sheet/tournament-sheet";
import { HostDrawer } from "../../src/components/tournament/sheet/host-drawer";
import { tournamentInviteApi } from "../../src/lib/invite-link";
import type { TournamentDetail } from "../../src/components/tournament/types";
import { sheetTournament } from "../fixtures/tournament-sheet";

const pending: TournamentDetail = {
  id: 1, name: "Friday", format: "round_robin", status: "pending", createdByUserId: fixtureUserId("host"),
  isParticipant: false, currentUserPlayerId: null, startedAt: null, createdAt: "2026-01-01T00:00:00Z",
  participants: [{ playerId: 1, displayName: "Ann" }], matches: [],
  visibility: "private", canJoin: true,
};
const asHost: TournamentDetail = { ...pending, canManageInvite: true, isParticipant: false };

const URL_A = "https://app.test/tournament/slug1?invite=AAA";
const URL_B = "https://app.test/tournament/slug1?invite=BBB";

interface Call { url: string; method: string; body: unknown }
function mockFetch(routes: Record<string, (body: unknown) => Response | object>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[`${method} ${url}`];
    if (!route) return Response.json({ error: "no route" }, { status: 500 });
    const out = route(undefined);
    return out instanceof Response ? out : Response.json(out);
  }));
  return calls;
}
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

function lobby(tournament: TournamentDetail, isCreator: boolean, onChanged = () => {}) {
  return render(
    <SheetRoot><TournamentLobby tournament={tournament} tournamentSlug="slug1" isCreator={isCreator} currentUserId={null} onChanged={onChanged} /></SheetRoot>,
  );
}

beforeEach(() => stubClipboard(vi.fn(async () => {})));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("host controls in the tournament lobby", () => {
  it("shows the host the switch, Copy invite link and Reset link, with Private pressed", () => {
    lobby(asHost, true);
    const section = screen.getByRole("region", { name: "Invite players" });
    expect(within(section).getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true");
    expect(within(section).getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "false");
    expect(within(section).getByRole("button", { name: "Copy invite link" })).toBeEnabled();
    expect(within(section).getByRole("button", { name: "Reset link" })).toBeEnabled();
    expect(within(section).getByText("Only people with your invite link can see and join.")).toBeInTheDocument();
    // The bare address is not the host's invite: private tournaments are not found without the code.
    expect(screen.queryByRole("textbox", { name: "Invite link" })).toBeNull();
  });

  it("shows nobody else the controls, whether or not the tournament is private", () => {
    for (const visibility of ["private", "open"] as const) {
      const { unmount } = lobby({ ...pending, visibility }, false);
      expect(screen.queryByRole("button", { name: "Copy invite link" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Reset link" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Private" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
      unmount();
    }
  });

  it("does not show a creator without canManageInvite the controls (older payloads keep the plain link)", () => {
    lobby({ ...pending, visibility: undefined }, true);
    expect(screen.queryByRole("button", { name: "Copy invite link" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Invite link" })).toBeInTheDocument();
  });

  it("gives a participant of a private tournament no link to share, and a participant of an open one the plain link", () => {
    const { unmount } = lobby({ ...pending, isParticipant: true, canJoin: false }, false);
    expect(screen.queryByRole("textbox", { name: "Invite link" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Invite link/ })).toBeNull();
    unmount();
    lobby({ ...pending, visibility: "open", isParticipant: true, canJoin: false }, false);
    expect(screen.getByRole("textbox", { name: "Invite link" })).toBeInTheDocument();
  });

  it("sends PATCH /visibility on the tournament and reads the page again", async () => {
    const calls = mockFetch({ "PATCH /api/tournaments/slug1/visibility": () => ({ visibility: "open" }) });
    const onChanged = vi.fn();
    lobby(asHost, true, onChanged);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ url: "/api/tournaments/slug1/visibility", method: "PATCH", body: { visibility: "open" } }]);
  });
});

describe("HostInviteControls for a tournament", () => {
  const props = { slug: "slug1", api: tournamentInviteApi, visibility: "private" as const, lockedNote: "This is locked once the tournament starts." };

  it("disables the switch when the tournament is not pending, and says why", () => {
    const calls = mockFetch({});
    render(<HostInviteControls {...props} visibility="open" pending={false} />);
    expect(screen.getByRole("button", { name: "Private" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(screen.getByText("This is locked once the tournament starts.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Private" }));
    expect(calls).toHaveLength(0);
    // The link stays the host's after the start.
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset link" })).toBeEnabled();
  });

  it("keeps the old choice and shows the server's refusal", async () => {
    mockFetch({ "PATCH /api/tournaments/slug1/visibility": () => Response.json({ error: "Entries are closed." }, { status: 409 }) });
    render(<HostInviteControls {...props} pending />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Entries are closed.");
    expect(screen.getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true");
  });

  it("copy: GETs the invite, copies inviteUrl, says Copied, then goes back", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const calls = mockFetch({ "GET /api/tournaments/slug1/invite": () => ({ inviteCode: "AAA", inviteUrl: URL_A }) });
    render(<HostInviteControls {...props} pending />);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(URL_A);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/tournaments/slug1/invite"]);
    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeInTheDocument();
  });

  it("copy: shows the URL to copy by hand when the clipboard fails", async () => {
    stubClipboard(vi.fn(async () => { throw new Error("denied"); }));
    mockFetch({ "GET /api/tournaments/slug1/invite": () => ({ inviteCode: "AAA", inviteUrl: URL_A }) });
    render(<HostInviteControls {...props} pending />);
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    const field = await screen.findByRole("textbox", { name: "Invite link" });
    expect(field).toHaveValue(URL_A);
    expect(field).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("copy: an error from the server is shown and nothing is claimed copied", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    mockFetch({ "GET /api/tournaments/slug1/invite": () => Response.json({ error: "Tournament not found" }, { status: 404 }) });
    render(<HostInviteControls {...props} pending />);
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tournament not found");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("reset: asks inline first (no browser dialog) and says people already invited keep access", () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const calls = mockFetch({});
    render(<HostInviteControls {...props} pending />);
    expect(screen.getByText("Reset makes a new link. People already invited keep access.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset link" }));
    expect(screen.getByRole("group", { name: "Reset invite link" })).toHaveTextContent("People already invited keep access");
    expect(calls).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep current link" }));
    expect(screen.queryByRole("group", { name: "Reset invite link" })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("reset: POSTs the tournament reset once confirmed, copies the new link and says the old one stopped", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const calls = mockFetch({ "POST /api/tournaments/slug1/invite/reset": () => ({ inviteCode: "BBB", inviteUrl: URL_B }) });
    render(<HostInviteControls {...props} pending />);
    fireEvent.click(screen.getByRole("button", { name: "Reset link" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Reset invite link" })).getByRole("button", { name: "Reset link" }));
    expect(await screen.findByText(/new link copied/i)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(URL_B);
    expect(calls).toEqual([{ url: "/api/tournaments/slug1/invite/reset", method: "POST", body: undefined }]);
  });

  it("reset: keeps the confirm open and shows the error when the reset fails", async () => {
    mockFetch({ "POST /api/tournaments/slug1/invite/reset": () => Response.json({ error: "Tournament not found" }, { status: 404 }) });
    render(<HostInviteControls {...props} pending />);
    fireEvent.click(screen.getByRole("button", { name: "Reset link" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Reset invite link" })).getByRole("button", { name: "Reset link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tournament not found");
    expect(screen.getByRole("group", { name: "Reset invite link" })).toBeInTheDocument();
  });
});

describe("the join button follows canJoin", () => {
  it("offers Join when the server says canJoin", () => {
    lobby({ ...pending, canJoin: true }, false);
    expect(screen.getByRole("button", { name: "Join tournament" })).toBeInTheDocument();
  });

  it("offers nothing when canJoin is false or absent, even for someone who is not in it", () => {
    const { unmount } = lobby({ ...pending, canJoin: false }, false);
    expect(screen.queryByRole("button", { name: "Join tournament" })).toBeNull();
    unmount();
    lobby({ ...pending, canJoin: undefined }, false);
    expect(screen.queryByRole("button", { name: "Join tournament" })).toBeNull();
  });

  it("offers the host Join when the server says so (the host is not seated until they join)", () => {
    lobby({ ...asHost, canJoin: true }, true);
    expect(screen.getByRole("button", { name: "Join tournament" })).toBeInTheDocument();
  });

  it("posts the join when pressed", async () => {
    const calls = mockFetch({ "POST /api/tournaments/slug1/join": () => ({ ok: true }) });
    const onChanged = vi.fn();
    lobby({ ...pending, canJoin: true }, false, onChanged);
    fireEvent.click(screen.getByRole("button", { name: "Join tournament" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/tournaments/slug1/join"]);
  });
});

describe("the visibility badge", () => {
  const sheet = (tournament: TournamentDetail, isHost = false) => render(
    <TournamentSheet tournament={tournament} tournamentSlug="slug1" isHost={isHost} ratings={new Map()} onChanged={() => {}} />,
  );
  beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false }))); });

  it("is in the header for a reader, and the lobby for a non-host has the badge but no controls", () => {
    sheet({ ...pending, canJoin: false, isParticipant: true });
    const header = document.querySelector("header")!;
    expect(within(header).getByText("Private")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy invite link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset link" })).toBeNull();
  });

  it("says Open for an open tournament", () => {
    sheet({ ...pending, visibility: "open" });
    expect(within(document.querySelector("header")!).getByText("Open")).toBeInTheDocument();
  });

  it("draws nothing when the server sent no visibility", () => {
    sheet({ ...pending, visibility: undefined });
    const header = document.querySelector("header")!;
    expect(within(header).queryByText("Private")).toBeNull();
    expect(within(header).queryByText("Open")).toBeNull();
  });
});

describe("the host drawer after the start", () => {
  it("offers the host the locked switch and the link", () => {
    render(
      <SheetRoot>
        <HostDrawer open tournament={{ ...sheetTournament, visibility: "open", canManageInvite: true }} tournamentSlug="slug1" ratings={new Map()} onChanged={() => {}} onClose={() => {}} />
      </SheetRoot>,
    );
    const invite = screen.getByRole("region", { name: "Invite" });
    expect(within(invite).getByRole("button", { name: "Open" })).toBeDisabled();
    expect(within(invite).getByRole("button", { name: "Private" })).toBeDisabled();
    expect(within(invite).getByRole("button", { name: "Copy invite link" })).toBeEnabled();
  });

  it("has no Invite section without canManageInvite", () => {
    render(
      <SheetRoot>
        <HostDrawer open tournament={{ ...sheetTournament, visibility: "open" }} tournamentSlug="slug1" ratings={new Map()} onChanged={() => {}} onClose={() => {}} />
      </SheetRoot>,
    );
    expect(screen.queryByRole("region", { name: "Invite" })).toBeNull();
  });
});
