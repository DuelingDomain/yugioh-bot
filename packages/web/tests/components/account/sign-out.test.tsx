// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { clerkSignOut } = vi.hoisted(() => ({ clerkSignOut: vi.fn(async () => {}) }));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => ({ signOut: clerkSignOut }) }));

import { SignOutProvider, useSignOut } from "../../../src/components/account/sign-out";

function Button() {
  const signOut = useSignOut();
  return <button onClick={() => void signOut().catch(() => {})}>Out</button>;
}

const assign = vi.fn();
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("SignOutProvider", () => {
  it("ends the Clerk session in the browser and lands on /sign-in", async () => {
    render(<SignOutProvider e2e={false}><Button /></SignOutProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Out" }));
    await waitFor(() => expect(clerkSignOut).toHaveBeenCalledWith({ redirectUrl: "/sign-in" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("in E2E mode clears the test cookie on the server, then navigates to /sign-in without touching Clerk", async () => {
    render(<SignOutProvider e2e><Button /></SignOutProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in"));
    expect(fetchMock).toHaveBeenCalledWith("/api/test-auth/sign-out", { method: "POST" });
    expect(clerkSignOut).not.toHaveBeenCalled();
  });

  it("in E2E mode still navigates when the request fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<SignOutProvider e2e><Button /></SignOutProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in"));
  });
});
