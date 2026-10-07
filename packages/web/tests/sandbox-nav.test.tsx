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

function stubAccess(allowed: boolean | "fail" | "denied") {
  global.fetch = vi.fn((url: string) => {
    if (url.includes("/api/sandbox/access")) {
      if (allowed === "denied") return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) });
      return allowed === "fail" ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: true, json: async () => ({ allowed }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => null });
  }) as unknown as typeof fetch;
}

beforeEach(() => resetSandboxAccessCache());
afterEach(() => cleanup());

describe("Sandbox nav item", () => {
  it("requires sandbox access and sits before Settings", () => {
    const item = navItems.find((i) => i.href === "/sandbox");
    expect(item).toMatchObject({ label: "Sandbox", match: "prefix", sandboxOnly: true });
    expect(navItems.filter((i) => i.sandboxOnly).map((i) => i.href)).toEqual(["/sandbox"]);
  });

  it("stays out of the grouped nav unless the person has sandbox access", () => {
    const hrefs = (allowed?: boolean) => groupedNav(false, allowed).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs()).not.toContain("/sandbox");
    expect(hrefs(false)).not.toContain("/sandbox");
    expect(groupedNav(true, false).flatMap((g) => g.items.map((i) => i.href))).not.toContain("/sandbox");
    expect(hrefs(true)).not.toContain("/settings/card-data");
    expect(hrefs(true)).toContain("/sandbox");
    expect(groupedNav(false, true).find((g) => g.label === "Build")?.items.map((i) => i.href)).toEqual(["/decks", "/cubes", "/sandbox"]);
  });

  it("lights and titles the section for every sandbox page", () => {
    for (const path of ["/sandbox", "/sandbox/new", "/sandbox/12"]) {
      expect(activeNavHref(path)).toBe("/sandbox");
      expect(pageTitle(path)).toBe("Sandbox");
    }
  });
});

describe("Sidebar Sandbox link", () => {
  it("shows for a listed developer", async () => {
    stubAccess(true);
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    expect(await screen.findByRole("link", { name: "Sandbox" })).toHaveAttribute("href", "/sandbox");
  });

  it.each([[false], ["fail" as const], ["denied" as const]])("stays hidden when access is %s", async (allowed) => {
    stubAccess(allowed);
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/sandbox/access", expect.anything()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("link", { name: "Sandbox" })).toBeNull();
  });
});
