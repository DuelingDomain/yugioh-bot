// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkStub, fontMock, ready } from "./components/shell/helpers";

vi.mock("next/font/google", () => fontMock());
vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/dashboard") }));
vi.mock("next/link", () => ({ default: LinkStub }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import { navItems } from "../src/lib/nav-items";
import { activeNavHref, groupedNav, pageTitle } from "../src/components/layout/shell-model";
import { Sidebar } from "../src/components/layout/sidebar";
import { resetSandboxAccessCache } from "../src/components/layout/use-sandbox-access";

function stubAccess(admin: boolean | "fail") {
  global.fetch = vi.fn((url: string) => {
    if (url.includes("/api/sandbox/access")) {
      return admin === "fail" ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: true, json: async () => ({ admin }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => null });
  }) as unknown as typeof fetch;
}

beforeEach(() => resetSandboxAccessCache());
afterEach(() => cleanup());

describe("Sandbox nav item", () => {
  it("is admin only and sits before Settings", () => {
    const item = navItems.find((i) => i.href === "/sandbox");
    expect(item).toMatchObject({ label: "Sandbox", match: "prefix", adminOnly: true });
    expect(navItems.filter((i) => i.adminOnly).map((i) => i.href)).toEqual(["/sandbox"]);
  });

  it("stays out of the grouped nav unless the person is an admin", () => {
    const hrefs = (admin?: boolean) => groupedNav(admin).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs()).not.toContain("/sandbox");
    expect(hrefs(false)).not.toContain("/sandbox");
    expect(hrefs(true)).toContain("/sandbox");
    expect(groupedNav(true).find((g) => g.label === "Build")?.items.map((i) => i.href)).toEqual(["/decks", "/cubes", "/sandbox"]);
  });

  it("lights and titles the section for every sandbox page", () => {
    for (const path of ["/sandbox", "/sandbox/new", "/sandbox/12"]) {
      expect(activeNavHref(path)).toBe("/sandbox");
      expect(pageTitle(path)).toBe("Sandbox");
    }
  });
});

describe("Sidebar Sandbox link", () => {
  it("shows for an admin", async () => {
    stubAccess(true);
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    expect(await screen.findByRole("link", { name: "Sandbox" })).toHaveAttribute("href", "/sandbox");
  });

  it.each([[false], ["fail" as const]])("stays hidden when access is %s", async (admin) => {
    stubAccess(admin);
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/sandbox/access", expect.anything()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("link", { name: "Sandbox" })).toBeNull();
  });
});
