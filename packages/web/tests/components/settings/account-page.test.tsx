// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replace, searchParams, signOut, isE2E, resolveIdentity, redirect } = vi.hoisted(() => ({
  replace: vi.fn(),
  searchParams: { value: "" },
  signOut: vi.fn(async () => {}),
  isE2E: vi.fn(() => false),
  resolveIdentity: vi.fn(),
  redirect: vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(searchParams.value),
  redirect,
}));
vi.mock("@clerk/nextjs", () => ({
  UserProfile: (props: { path: string; routing: string }) => (
    <div data-testid="clerk-user-profile" data-path={props.path} data-routing={props.routing} />
  ),
}));
vi.mock("@/components/account/sign-out", () => ({ useSignOut: () => signOut }));
vi.mock("@/lib/e2e-auth", () => ({ isE2EAuthEnabled: isE2E }));
vi.mock("@/lib/session-identity", () => ({ resolveSessionIdentity: resolveIdentity }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@yugidraft/shared/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@yugidraft/shared/services")>()),
  createUserService: () => ({ findById: (id: number) => (id === 7 ? { id: 7, username: "sam_duels" } : undefined) }),
}));
vi.mock("@/components/settings/duel-view-toggle", () => ({ DuelViewToggle: () => <div data-testid="duel-view-toggle" /> }));

import { AccountPanel } from "../../../app/(app)/settings/account/[[...account]]/account-panel";
import AccountPage from "../../../app/(app)/settings/account/[[...account]]/page";
import SettingsPage from "../../../app/(app)/settings/page";
import { SignOutRow } from "../../../src/components/account/sign-out-row";
import { CONFLICT_MESSAGES } from "../../../src/components/account/account-messages";

const refreshReply = (conflict: string | null, status = 200) =>
  new Response(JSON.stringify({ user: { id: "1" }, conflict }), { status });

let fetchMock: ReturnType<typeof vi.fn>;
const refreshCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/api/account/refresh");

beforeEach(() => {
  searchParams.value = "";
  fetchMock = vi.fn(async () => refreshReply(null));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AccountPanel with Clerk", () => {
  it("renders the Clerk profile on the account path and refreshes once on mount", async () => {
    render(<AccountPanel e2e={false} displayName="Sam" email="sam@example.com" />);
    const profile = screen.getByTestId("clerk-user-profile");
    expect(profile).toHaveAttribute("data-path", "/settings/account");
    expect(profile).toHaveAttribute("data-routing", "path");
    await waitFor(() => expect(refreshCalls()).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/account/refresh", expect.objectContaining({ method: "POST" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refreshes again when the window regains focus, but not in a burst", async () => {
    render(<AccountPanel e2e={false} displayName="Sam" email={null} />);
    await waitFor(() => expect(refreshCalls()).toHaveLength(1));
    fireEvent.focus(window);
    expect(refreshCalls()).toHaveLength(1);
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now + 5000);
    await act(async () => { fireEvent.focus(window); });
    spy.mockRestore();
    await waitFor(() => expect(refreshCalls()).toHaveLength(2));
  });

  it("refreshes on ?refresh=1 and drops the param from the address", async () => {
    searchParams.value = "refresh=1";
    render(<AccountPanel e2e={false} displayName="Sam" email={null} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(window.location.pathname));
    await waitFor(() => expect(refreshCalls().length).toBeGreaterThanOrEqual(1));
  });

  it.each(Object.entries(CONFLICT_MESSAGES))("shows the exact message for the %s conflict", async (conflict, message) => {
    fetchMock.mockResolvedValue(refreshReply(conflict));
    render(<AccountPanel e2e={false} displayName="Sam" email={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("says the Discord history was not merged when both accounts have activity", async () => {
    fetchMock.mockResolvedValue(refreshReply("both_have_history"));
    render(<AccountPanel e2e={false} displayName="Sam" email={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Both accounts have activity. Nothing was merged. Email support@duelingdomain.com and we can merge them.");
  });

  it("tells the person when the refresh failed", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    render(<AccountPanel e2e={false} displayName="Sam" email={null} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't check your connected accounts just now.");
  });
});

describe("AccountPanel in E2E offline mode", () => {
  it("shows the offline details, no Clerk profile and no refresh", async () => {
    render(<AccountPanel e2e displayName="Offline Sam" email="sam@example.com" />);
    const offline = screen.getByTestId("offline-account");
    expect(offline).toHaveTextContent("Offline Sam");
    expect(offline).toHaveTextContent("sam@example.com");
    expect(screen.queryByTestId("clerk-user-profile")).toBeNull();
    fireEvent.focus(window);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SignOutRow", () => {
  it("runs the shared sign-out", () => {
    render(<SignOutRow />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe("AccountPage", () => {
  it("lays out the sections, the duel view toggle, and the legal links", async () => {
    resolveIdentity.mockResolvedValue({ ok: true, identity: { name: "Sam", email: "sam@example.com" } });
    render(await AccountPage());
    screen.getByRole("heading", { level: 1, name: "Account" });
    screen.getByRole("heading", { name: "Sign-in and connected accounts" });
    screen.getByTestId("duel-view-toggle");
    screen.getByRole("heading", { name: "This session" });
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByTestId("clerk-user-profile")).toBeTruthy();
  });

  it("passes the E2E flag so the offline controls render", async () => {
    isE2E.mockReturnValue(true);
    resolveIdentity.mockResolvedValue({ ok: true, identity: { name: "Sam", email: "sam@example.com" } });
    render(await AccountPage());
    expect(screen.getByTestId("offline-account")).toHaveTextContent("Sam");
    expect(screen.queryByTestId("clerk-user-profile")).toBeNull();
    isE2E.mockReturnValue(false);
  });

  it("shows the delete-account section with the signed-in username", async () => {
    isE2E.mockReturnValue(true);
    resolveIdentity.mockResolvedValue({ ok: true, identity: { userId: 7, name: "Sam", email: "sam@example.com" } });
    render(await AccountPage());
    screen.getByRole("heading", { name: "Delete account" });
    expect(screen.getByText("sam_duels")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeDisabled();
    isE2E.mockReturnValue(false);
  });

  it("leaves the delete-account section out when the account can't be found", async () => {
    resolveIdentity.mockResolvedValue({ ok: true, identity: { userId: 99, name: "Sam", email: "sam@example.com" } });
    render(await AccountPage());
    expect(screen.queryByRole("heading", { name: "Delete account" })).toBeNull();
  });
});

describe("/settings", () => {
  it("redirects to the account page", () => {
    expect(() => SettingsPage()).toThrow();
    expect(redirect).toHaveBeenCalledWith("/settings/account");
  });
});
