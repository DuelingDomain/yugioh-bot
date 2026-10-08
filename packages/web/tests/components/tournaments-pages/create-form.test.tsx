// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { CreateTournamentForm } from "../../../src/components/tournament/create-tournament-form";

function mockFetch(response: () => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const postBody = (fetchMock: ReturnType<typeof mockFetch>) => {
  const call = fetchMock.mock.calls.find(([url]) => String(url) === "/api/tournaments")!;
  return JSON.parse(String((call[1] as RequestInit).body));
};

describe("CreateTournamentForm", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 1, 15, 0));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("starts on the defaults and no longer fetches channels", async () => {
    const fetchMock = mockFetch(() => Response.json({ webSlug: "cup" }));
    render(<CreateTournamentForm />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/channel/i)).toBeNull();
    expect((screen.getByRole("radio", { name: /round robin/i }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("radio", { name: /best of 3/i })).toHaveAttribute("aria-checked", "true");
    expect((screen.getByLabelText(/duel mode/i) as HTMLSelectElement).value).toBe("normal");
    expect((screen.getByLabelText(/banlist/i) as HTMLSelectElement).value).toBe("tcg-2026-09");
    expect((screen.getByLabelText(/turn time/i) as HTMLSelectElement).value).toBe("240");
    expect(screen.getByRole("button", { name: /no deadline, add one/i })).toBeTruthy();
    const summary = screen.getByRole("complementary", { name: /tournament summary/i });
    expect(within(summary).getByText("Round robin, best of 3")).toBeTruthy();
    expect(within(summary).getByText("Untitled tournament")).toBeTruthy();
  });

  it("POSTs the unchanged body with defaults and null deadline, then goes to the slug", async () => {
    const fetchMock = mockFetch(() => Response.json({ webSlug: "new-cup" }));
    render(<CreateTournamentForm />);
    fireEvent.change(screen.getByLabelText(/tournament name/i), { target: { value: "  New Cup " } });
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tournament/new-cup"));
    expect(postBody(fetchMock)).toEqual({
      name: "New Cup",
      format: "round_robin",
      visibility: "private",
      deadlineAt: null,
      reportConfirmWindowHours: null,
      bestOf: 3,
      duelRules: { mode: "normal", masterRule: 5, settings: { banlist: "tcg-2026-09", turnSeconds: 240 } },
    });
  });

  it("falls back to the list when no slug comes back", async () => {
    mockFetch(() => Response.json({}));
    render(<CreateTournamentForm />);
    fireEvent.change(screen.getByLabelText(/tournament name/i), { target: { value: "Cup" } });
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tournaments"));
  });

  it("sends single elimination, the confirm window and the deadline as ISO", async () => {
    const fetchMock = mockFetch(() => Response.json({ webSlug: "ko" }));
    render(<CreateTournamentForm />);
    fireEvent.change(screen.getByLabelText(/tournament name/i), { target: { value: "KO" } });
    fireEvent.click(screen.getByRole("radio", { name: /single elimination/i }));
    expect(screen.getByText(/join order sets round 1/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/confirm window/i), { target: { value: "48" } });
    // Pick Oct 9 from the date picker: the time defaults to 11:59 PM local.
    fireEvent.click(screen.getByRole("button", { name: /no deadline, add one/i }));
    fireEvent.click(within(screen.getByRole("dialog", { name: /choose a date/i })).getByRole("button", { name: /october 9, 2026/i }));
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tournament/ko"));
    const body = postBody(fetchMock);
    expect(body.format).toBe("single_elim");
    expect(body.reportConfirmWindowHours).toBe(48);
    expect(body.deadlineAt).toBe(new Date(2026, 9, 9, 23, 59).toISOString());
  });

  it("moves the banlist to None when the mode becomes Domain", async () => {
    const fetchMock = mockFetch(() => Response.json({ webSlug: "d" }));
    render(<CreateTournamentForm />);
    fireEvent.change(screen.getByLabelText(/tournament name/i), { target: { value: "D" } });
    fireEvent.change(screen.getByLabelText(/duel mode/i), { target: { value: "domain" } });
    expect((screen.getByLabelText(/banlist/i) as HTMLSelectElement).value).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(postBody(fetchMock).duelRules).toEqual({ mode: "domain", masterRule: 5, settings: { banlist: "none", turnSeconds: 240 } });
  });

  it("shows a missing name inline, under the field, and does not post", () => {
    const fetchMock = mockFetch(() => Response.json({}));
    render(<CreateTournamentForm />);
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    const input = screen.getByLabelText(/tournament name/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Give the tournament a name.")).toBeTruthy();
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByText("Give the tournament a name.").id);
    expect(document.activeElement).toBe(input);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "x" } });
    expect(screen.queryByText("Give the tournament a name.")).toBeNull();
  });

  it("shows a server error in the summary beside the button", async () => {
    mockFetch(() => Response.json({ error: "Turn time must be between 30 and 3600 seconds." }, { status: 400 }));
    render(<CreateTournamentForm />);
    fireEvent.change(screen.getByLabelText(/tournament name/i), { target: { value: "Cup" } });
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't create the tournament.");
    expect(alert.textContent).toContain("Turn time must be between 30 and 3600 seconds.");
    expect(screen.getByRole("complementary", { name: /tournament summary/i }).contains(alert)).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("CreateTournamentForm visibility", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("offers Private and Open with Private selected, and their one-line meanings", () => {
    mockFetch(() => Response.json({}));
    render(<CreateTournamentForm />);
    const group = screen.getByRole("group", { name: "Who can join" });
    expect(within(group).getByRole("radio", { name: /private/i })).toBeChecked();
    expect(within(group).getByRole("radio", { name: /open/i })).not.toBeChecked();
    expect(within(group).getByText("Only people with your invite link can see and join")).toBeInTheDocument();
    expect(within(group).getByText("Listed in Open right now for everyone")).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: /tournament summary/i })).getByText("Private")).toBeInTheDocument();
  });

  it("sends visibility private by default", async () => {
    const fetchMock = mockFetch(() => Response.json({ webSlug: "cup" }));
    render(<CreateTournamentForm />);
    fireEvent.change(screen.getByLabelText(/tournament name/i), { target: { value: "Cup" } });
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tournament/cup"));
    expect(postBody(fetchMock).visibility).toBe("private");
  });

  it("sends visibility open when Open is chosen", async () => {
    const fetchMock = mockFetch(() => Response.json({ webSlug: "cup" }));
    render(<CreateTournamentForm />);
    fireEvent.change(screen.getByLabelText(/tournament name/i), { target: { value: "Cup" } });
    fireEvent.click(screen.getByRole("radio", { name: /open/i }));
    expect(within(screen.getByRole("complementary", { name: /tournament summary/i })).getByText("Open")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /create tournament/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/tournament/cup"));
    expect(postBody(fetchMock).visibility).toBe("open");
  });
});
