// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LinkStub, fontMock, stubFetch } from "./helpers";

vi.mock("next/font/google", () => fontMock());
const nav = vi.hoisted(() => ({ path: "/leaderboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
vi.mock("next/link", () => ({ default: LinkStub }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import { AppShell } from "../../../src/components/layout/app-shell";

afterEach(cleanup);

describe("Report bug button on a normal app page", () => {
  it("is one red button placed by the shell module, not at the screen edge", () => {
    stubFetch();
    nav.path = "/leaderboard";
    render(<AppShell><p>page</p></AppShell>);
    const fab = document.querySelectorAll("[data-bug-fab]");
    expect(fab).toHaveLength(1);
    expect(fab[0]!.className).toMatch(/bugFab/);
    expect(fab[0]!.className).toContain("bg-accent-cta");
    expect(fab[0]!.className).not.toContain("left-3");
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
