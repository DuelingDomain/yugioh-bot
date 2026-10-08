// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://app.duelingdomain.com/"}
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CookieJar } from "tough-cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({ default: ({ variable }: { variable: string }) => ({ variable, className: "font-class" }) }));

const { signOut, useClerk, hardNavigate } = vi.hoisted(() => {
  const signOut = vi.fn(async () => {});
  return { signOut, useClerk: vi.fn(() => ({ signOut })), hardNavigate: vi.fn() };
});
vi.mock("@clerk/nextjs", () => ({ useClerk }));
vi.mock("@/components/auth/navigate", () => ({ hardNavigate }));

import { DeleteAccountSection, confirmsUsername, errorForStatus } from "@/components/account/delete-account-section";

const fetchMock = vi.fn();
const reply = (status: number, body: unknown = {}) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const button = () => screen.getByRole("button", { name: /delete my account|deleting/i }) as HTMLButtonElement;
const field = () => screen.getByLabelText("Type your username to confirm") as HTMLInputElement;
const environment = globalThis as typeof globalThis & { jsdom: { cookieJar: CookieJar } };
const seedHint = () => { document.cookie = "dd_signed_in=1; Domain=duelingdomain.com; Path=/; Max-Age=2592000; Secure; SameSite=Lax"; };
const marketingCookies = () => environment.jsdom.cookieJar.getCookieStringSync("https://duelingdomain.com/");

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); signOut.mockReset().mockResolvedValue(undefined); useClerk.mockClear(); hardNavigate.mockReset();
  environment.jsdom.cookieJar.removeAllCookiesSync();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("DeleteAccountSection", () => {
  it("shows the approved copy and the username as a hint", () => {
    render(<DeleteAccountSection username="Yugi_1" e2eMode={false} />);
    expect(screen.getByRole("heading", { name: "Delete account" })).toBeTruthy();
    expect(screen.getByText(/This removes your sign-in, email address and saved decks\. Your matches, drafts, tournaments and cubes stay on the site as “Deleted player”, so other players keep their history\. You can't undo this\./)).toBeTruthy();
    expect(screen.getByText("Yugi_1").tagName).toBe("CODE");
    expect(button().textContent).toBe("Delete my account");
  });

  it("keeps the button disabled until the username matches exactly (trimmed, case-sensitive)", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection username="Yugi_1" e2eMode={false} />);
    expect(button().disabled).toBe(true);
    await user.type(field(), "yugi_1");
    expect(button().disabled).toBe(true);
    await user.clear(field()); await user.type(field(), "Yugi_");
    expect(button().disabled).toBe(true);
    await user.type(field(), "1");
    expect(button().disabled).toBe(false);
    await user.type(field(), "  ");
    expect(button().disabled).toBe(false);
    await user.type(field(), "x");
    expect(button().disabled).toBe(true);
  });

  it("does not send anything when Enter is pressed without a match", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountSection username="Yugi_1" e2eMode={false} />);
    await user.type(field(), "nope{Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the trimmed text, shows the pending state, then signs out through Clerk to the marketing site", async () => {
    const user = userEvent.setup();
    let release!: (res: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>(resolve => { release = resolve; }));
    render(<DeleteAccountSection username="Yugi_1" e2eMode={false} marketingUrl="https://marketing.example/?from=account#goodbye" />);
    await user.type(field(), " Yugi_1 ");
    await user.click(button());
    expect(fetchMock).toHaveBeenCalledWith("/api/account/delete", expect.objectContaining({ method: "POST", body: JSON.stringify({ confirm: "Yugi_1" }) }));
    expect(button().textContent).toBe("Deleting…");
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");
    expect(field().disabled).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
    release(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(signOut).toHaveBeenCalledExactlyOnceWith({ redirectUrl: "https://marketing.example/?from=account&home=1#goodbye" }));
    expect(button().disabled).toBe(true); // stays locked while the page leaves
  });

  it("falls back to a full navigation to the marketing site if Clerk's sign-out fails", async () => {
    const user = userEvent.setup();
    signOut.mockRejectedValueOnce(new Error("clerk down")); reply(200, { ok: true });
    render(<DeleteAccountSection username="a" e2eMode={false} />);
    await user.type(field(), "a"); await user.click(button());
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith("https://duelingdomain.com/?home=1"));
  });

  it("removes the apex cookie before Clerk sign-out even when sign-out never settles", async () => {
    const user = userEvent.setup();
    seedHint();
    expect(marketingCookies()).toBe("dd_signed_in=1");
    let cookiesAtSignOut: string | undefined;
    signOut.mockImplementationOnce(() => {
      cookiesAtSignOut = marketingCookies();
      return new Promise<void>(() => {});
    });
    reply(200, { ok: true });
    render(<DeleteAccountSection username="a" e2eMode={false} />);
    await user.type(field(), "a"); await user.click(button());
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(cookiesAtSignOut).toBe("");
    expect(marketingCookies()).toBe("");
    expect(signOut).toHaveBeenCalledWith({ redirectUrl: "https://duelingdomain.com/?home=1" });
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("removes the apex cookie again before fallback navigation if Clerk sign-out rejects", async () => {
    const user = userEvent.setup();
    seedHint();
    expect(marketingCookies()).toBe("dd_signed_in=1");
    let cookiesAtSignOut: string | undefined;
    let cookiesAtNavigation: string | undefined;
    signOut.mockImplementationOnce(async () => {
      cookiesAtSignOut = marketingCookies();
      // A late signed-in update during sign-out must not survive the fallback either.
      seedHint();
      throw new Error("clerk down");
    });
    hardNavigate.mockImplementationOnce(() => { cookiesAtNavigation = marketingCookies(); });
    reply(200, { ok: true });
    render(<DeleteAccountSection username="a" e2eMode={false} marketingUrl="https://duelingdomain.com/?from=account#goodbye" />);
    await user.type(field(), "a"); await user.click(button());
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledOnce());
    expect(cookiesAtSignOut).toBe("");
    expect(cookiesAtNavigation).toBe("");
    expect(marketingCookies()).toBe("");
    expect(hardNavigate).toHaveBeenCalledWith("https://duelingdomain.com/?from=account&home=1#goodbye");
  });

  it.each([
    [400, /That doesn't match your username\./],
    [503, /We couldn't delete your account just now\. Try again in a minute\./],
    [500, /Something went wrong\. Email support@duelingdomain\.com and we'll finish it\./],
    [502, /Something went wrong\. Email support@duelingdomain\.com/],
    [401, /Your session has ended\. Sign in again/],
  ])("shows the right inline copy for status %i and unlocks the form", async (status, copy) => {
    const user = userEvent.setup();
    reply(status);
    render(<DeleteAccountSection username="Yugi_1" e2eMode={false} />);
    await user.type(field(), "Yugi_1"); await user.click(button());
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert.textContent).toMatch(copy));
    expect(button().disabled).toBe(false);
    expect(field().disabled).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("links the support address on the 500 error", async () => {
    const user = userEvent.setup();
    reply(500);
    render(<DeleteAccountSection username="a" e2eMode={false} />);
    await user.type(field(), "a"); await user.click(button());
    const link = await screen.findByRole("link", { name: "support@duelingdomain.com" });
    expect(link.getAttribute("href")).toBe("mailto:support@duelingdomain.com");
  });

  it("treats a network failure like a server error and clears the error on the next try", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    render(<DeleteAccountSection username="a" e2eMode={false} />);
    await user.type(field(), "a"); await user.click(button());
    expect((await screen.findByRole("alert")).textContent).toMatch(/Something went wrong/);
    reply(200, { ok: true });
    await user.click(button());
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("in E2E mode never reads Clerk and navigates to /sign-in", async () => {
    const user = userEvent.setup();
    reply(200, { ok: true });
    render(<DeleteAccountSection username="Yugi_1" e2eMode />);
    expect(useClerk).not.toHaveBeenCalled();
    await user.type(field(), "Yugi_1"); await user.click(button());
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledExactlyOnceWith("/sign-in"));
    expect(useClerk).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("in Clerk mode reads Clerk once it renders", () => {
    render(<DeleteAccountSection username="a" e2eMode={false} />);
    expect(useClerk).toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("confirmsUsername follows the server rule", () => {
    expect(confirmsUsername(" abc ", "abc")).toBe(true);
    expect(confirmsUsername("ABC", "abc")).toBe(false);
    expect(confirmsUsername("", "")).toBe(false);
  });
  it("errorForStatus maps statuses", () => {
    expect([400, 401, 503, 500, 413].map(errorForStatus)).toEqual(["mismatch", "signed_out", "retry", "server", "server"]);
  });
});
