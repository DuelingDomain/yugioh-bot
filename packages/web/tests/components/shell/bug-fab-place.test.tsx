// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LinkStub, fontMock, stubFetch } from "./helpers";

vi.mock("next/font/google", () => fontMock());
const nav = vi.hoisted(() => ({ path: "/leaderboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
vi.mock("next/link", () => ({ default: LinkStub }));
vi.mock("@/components/account/sign-out", () => ({ useSignOut: () => vi.fn() }));

import { AppShell } from "../../../src/components/layout/app-shell";

afterEach(cleanup);

describe("Report bug button on a normal app page", () => {
  it("is one quiet chip at the bottom-right, clear of the sidebar, not a red button", () => {
    stubFetch();
    nav.path = "/leaderboard";
    render(<AppShell><p>page</p></AppShell>);
    const fab = document.querySelectorAll("[data-bug-fab]");
    expect(fab).toHaveLength(1);
    expect(fab[0]!.className).toMatch(/fab/);
    expect(fab[0]!.className).toContain("bottom-3 right-3");
    expect(fab[0]!.className).not.toContain("left-");
    expect(fab[0]!.className).not.toContain("bg-accent-cta");
  });

  it("keeps the page content clear of it at the bottom", () => {
    stubFetch();
    nav.path = "/leaderboard";
    const { container } = render(<AppShell><p>page</p></AppShell>);
    expect(container.querySelector("main > div")!.className).toContain("lg:pb-16");
  });

  it("is also on a duel page (until a live header takes over)", () => {
    stubFetch();
    nav.path = "/duels/abc";
    render(<AppShell><p>page</p></AppShell>);
    expect(screen.getByRole("button", { name: "Report bug" })).toBeTruthy();
  });
});
