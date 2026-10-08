// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotInvitedStep } from "@/components/auth/steps/not-invited-step";

const WAITLIST = "https://duelingdomain.com/?home=1#join";
const fetchMock = vi.fn();

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => { cleanup(); fetchMock.mockReset(); vi.unstubAllGlobals(); });

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const join = () => screen.getByRole("button", { name: "Join the waitlist" });
const setup = (props: Partial<Parameters<typeof NotInvitedStep>[0]> = {}) =>
  render(<NotInvitedStep identifier="sam@example.com" waitlistUrl={WAITLIST} onRetry={() => {}} {...props} />);

describe("NotInvitedStep waitlist join", () => {
  it("posts the email once per click and disables the button while pending", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { resolve = r; }));
    setup();
    const user = userEvent.setup();
    await user.dblClick(join());
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/waitlist");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual({ email: "sam@example.com", source: "app-not-invited" });
    expect(join()).toBeDisabled();
    await act(async () => resolve(reply(201, { status: "joined" })));
    await screen.findByRole("heading", { level: 1, name: "You’re on the list" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("shows the joined confirmation and keeps a different-email action", async () => {
    fetchMock.mockResolvedValue(reply(201, { status: "joined" }));
    const onRetry = vi.fn();
    const onJoined = vi.fn();
    setup({ onRetry, onJoined });
    await userEvent.click(join());
    const heading = await screen.findByRole("heading", { level: 1, name: "You’re on the list" });
    expect(heading.querySelector("em")).toHaveTextContent("list");
    expect(screen.getByText("Closed alpha")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="lede"]')).toHaveTextContent("We’ll email sam@example.com when it’s your turn.");
    expect(screen.queryByRole("button", { name: "Join the waitlist" })).toBeNull();
    expect(onJoined).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the already-on-the-list confirmation for an existing entry", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "exists" }));
    const onJoined = vi.fn();
    setup({ onJoined });
    await userEvent.click(join());
    await screen.findByRole("heading", { level: 1, name: "You’re already on the list" });
    expect(document.querySelector('[data-slot="lede"]')).toHaveTextContent("We’ll email sam@example.com when it’s your turn.");
    expect(onJoined).toHaveBeenCalledOnce();
  });

  it("explains a rate limit inline and leaves the button available", async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { error: "rate_limited" })).mockResolvedValueOnce(reply(201, { status: "joined" }));
    setup();
    await userEvent.click(join());
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries. Try again in a few minutes.");
    expect(join()).toBeEnabled();
    await userEvent.click(join());
    await screen.findByRole("heading", { level: 1, name: "You’re on the list" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["503", () => fetchMock.mockResolvedValueOnce(reply(503, { error: "retry_later" }))],
    ["500", () => fetchMock.mockResolvedValueOnce(reply(500, { error: "server_error" }))],
    ["network error", () => fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
  ])("shows a retryable inline error on a %s", async (_name, arrange) => {
    arrange();
    fetchMock.mockResolvedValueOnce(reply(200, { status: "exists" }));
    setup();
    await userEvent.click(join());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t add you just now. Try again.");
    await waitFor(() => expect(join()).toBeEnabled());
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
    await userEvent.click(join());
    await screen.findByRole("heading", { level: 1, name: "You’re already on the list" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the marketing link for a username and never calls fetch", async () => {
    setup({ identifier: "cardshark" });
    const link = screen.getByRole("link", { name: "Join the waitlist" });
    expect(link).toHaveAttribute("href", WAITLIST);
    expect(screen.queryByRole("button", { name: "Join the waitlist" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
