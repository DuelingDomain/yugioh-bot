// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostInviteControls } from "../../src/components/draft/visibility/host-invite-controls";
import { VisibilityBadge } from "../../src/components/draft/visibility/visibility-badge";
import { VisibilityChoice } from "../../src/components/draft/visibility/visibility-choice";

interface Call { url: string; method: string; body: unknown }

/** A fetch that answers by "METHOD /path"; every call is recorded. */
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

const URL_A = "https://app.test/draft/night?invite=AAA";
const URL_B = "https://app.test/draft/night?invite=BBB";

beforeEach(() => stubClipboard(vi.fn(async () => {})));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("HostInviteControls switch", () => {
  it("shows the current choice pressed and its one-line meaning", () => {
    render(<HostInviteControls slug="night" visibility="private" pending />);
    expect(screen.getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Only people with your invite link can see and join.")).toBeInTheDocument();
  });

  it("sends PATCH /visibility with the new value and tells the page to read the draft again", async () => {
    const calls = mockFetch({ "PATCH /api/drafts/night/visibility": () => ({ visibility: "open" }) });
    const onChanged = vi.fn();
    render(<HostInviteControls slug="night" visibility="private" pending onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ url: "/api/drafts/night/visibility", method: "PATCH", body: { visibility: "open" } }]);
  });

  it("does nothing when the pressed choice is already current", () => {
    const calls = mockFetch({});
    render(<HostInviteControls slug="night" visibility="private" pending />);
    fireEvent.click(screen.getByRole("button", { name: "Private" }));
    expect(calls).toHaveLength(0);
  });

  it("is disabled once the draft is not pending, and says why", () => {
    const calls = mockFetch({});
    render(<HostInviteControls slug="night" visibility="open" pending={false} />);
    expect(screen.getByRole("button", { name: "Private" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(screen.getByText(/locked once the draft starts/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Private" }));
    expect(calls).toHaveLength(0);
    // The link is still the host's after the start.
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset link" })).toBeEnabled();
  });

  it("shows the server's refusal and keeps the old choice", async () => {
    mockFetch({ "PATCH /api/drafts/night/visibility": () => Response.json({ error: "The draft already started." }, { status: 409 }) });
    const onChanged = vi.fn();
    render(<HostInviteControls slug="night" visibility="private" pending onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The draft already started.");
    expect(screen.getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "true");
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("HostInviteControls copy", () => {
  it("asks for the link, copies inviteUrl and confirms with Copied, then goes back", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const calls = mockFetch({ "GET /api/drafts/night/invite": () => ({ inviteCode: "AAA", inviteUrl: URL_A }) });
    render(<HostInviteControls slug="night" visibility="private" pending />);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(URL_A);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/drafts/night/invite"]);
    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeInTheDocument();
  });

  it("shows the link to copy by hand when the clipboard is blocked", async () => {
    stubClipboard(vi.fn(async () => { throw new Error("denied"); }));
    mockFetch({ "GET /api/drafts/night/invite": () => ({ inviteCode: "AAA", inviteUrl: URL_A }) });
    render(<HostInviteControls slug="night" visibility="private" pending />);
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    const field = await screen.findByRole("textbox", { name: "Invite link" });
    expect(field).toHaveValue(URL_A);
    expect(field).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    expect(screen.getByText(/blocked copying/i)).toBeInTheDocument();
  });

  it("shows an error when the link cannot be fetched, and does not claim it copied", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    mockFetch({ "GET /api/drafts/night/invite": () => Response.json({ error: "Draft not found" }, { status: 404 }) });
    render(<HostInviteControls slug="night" visibility="private" pending />);
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Draft not found");
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });
});

describe("HostInviteControls reset", () => {
  it("explains the effect in one line before any click", () => {
    render(<HostInviteControls slug="night" visibility="private" pending />);
    expect(screen.getByText("Reset makes a new link. People already invited keep access.")).toBeInTheDocument();
  });

  it("asks inline first (no browser dialog) and sends nothing until confirmed", () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const calls = mockFetch({});
    render(<HostInviteControls slug="night" visibility="private" pending />);
    fireEvent.click(screen.getByRole("button", { name: "Reset link" }));
    const group = screen.getByRole("group", { name: "Reset invite link" });
    expect(group).toHaveTextContent("People already invited keep access");
    expect(calls).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
    // Backing out keeps the link and returns the buttons.
    fireEvent.click(screen.getByRole("button", { name: "Keep current link" }));
    expect(screen.queryByRole("group", { name: "Reset invite link" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("Escape backs out of the confirm", () => {
    mockFetch({});
    render(<HostInviteControls slug="night" visibility="private" pending />);
    fireEvent.click(screen.getByRole("button", { name: "Reset link" }));
    fireEvent.keyDown(screen.getByRole("group", { name: "Reset invite link" }), { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Reset invite link" })).toBeNull();
  });

  it("posts the reset, copies the new link and says the old one stopped", async () => {
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    const calls = mockFetch({ "POST /api/drafts/night/invite/reset": () => ({ inviteCode: "BBB", inviteUrl: URL_B }) });
    render(<HostInviteControls slug="night" visibility="private" pending />);
    fireEvent.click(screen.getByRole("button", { name: "Reset link" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Reset invite link" })).getByRole("button", { name: "Reset link" }));
    expect(await screen.findByText(/new link copied/i)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(URL_B);
    expect(calls).toEqual([{ url: "/api/drafts/night/invite/reset", method: "POST", body: undefined }]);
    expect(screen.queryByRole("group", { name: "Reset invite link" })).toBeNull();
  });

  it("keeps the confirm open and shows the error when the reset fails", async () => {
    mockFetch({ "POST /api/drafts/night/invite/reset": () => Response.json({ error: "Draft not found" }, { status: 404 }) });
    render(<HostInviteControls slug="night" visibility="private" pending />);
    fireEvent.click(screen.getByRole("button", { name: "Reset link" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Reset invite link" })).getByRole("button", { name: "Reset link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Draft not found");
    expect(screen.getByRole("group", { name: "Reset invite link" })).toBeInTheDocument();
  });
});

describe("VisibilityChoice and VisibilityBadge", () => {
  it("offers Private and Open with their one-line meanings", () => {
    render(<VisibilityChoice value="private" onChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Who can join" });
    expect(group.tagName).toBe("FIELDSET");
    expect(screen.getByRole("radio", { name: /private/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /open/i })).not.toBeChecked();
    expect(screen.getByText("Only people with your invite link can see and join")).toBeInTheDocument();
    expect(screen.getByText("Listed in Open right now for everyone")).toBeInTheDocument();
  });

  it("reports the choice", () => {
    const onChange = vi.fn();
    render(<VisibilityChoice value="private" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /open/i }));
    expect(onChange).toHaveBeenCalledWith("open");
  });

  it("draws the badge for a visibility and nothing without one", () => {
    const { rerender, container } = render(<VisibilityBadge visibility="private" />);
    expect(screen.getByText("Private")).toBeInTheDocument();
    rerender(<VisibilityBadge visibility="open" />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    rerender(<VisibilityBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});
