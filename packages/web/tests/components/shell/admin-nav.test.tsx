// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { LinkStub, fontMock, ready, stubFetch } from "./helpers";

vi.mock("next/font/google", () => fontMock());
vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/settings/card-data") }));
vi.mock("next/link", () => ({ default: LinkStub }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import { Sidebar } from "../../../src/components/layout/sidebar";
import { AppShell } from "../../../src/components/layout/app-shell";
import { activeNavHref, groupedNav, pageTitle } from "../../../src/components/layout/shell-model";

afterEach(cleanup);

describe("Card data nav entry", () => {
  it("is hidden from non-admins in the model", () => {
    const hrefs = groupedNav().flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).not.toContain("/settings/card-data");
    expect(groupedNav(true).flatMap((g) => g.items.map((i) => i.href))).toContain("/settings/card-data");
  });

  it("lights its own link and titles the phone bar", () => {
    expect(activeNavHref("/settings/card-data")).toBe("/settings/card-data");
    expect(activeNavHref("/settings")).toBe("/settings");
    expect(pageTitle("/settings/card-data")).toBe("Card data");
  });

  it("shows no Card data link in the sidebar for a non-admin", () => {
    render(<Sidebar collapsed={false} onToggle={() => {}} account={{ ...ready, isAdmin: false }} live={null} />);
    expect(screen.queryByRole("link", { name: "Card data" })).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull();
  });

  it("shows the Card data link in the sidebar for an admin", () => {
    render(<Sidebar collapsed={false} onToggle={() => {}} account={{ ...ready, isAdmin: true }} live={null} />);
    const link = screen.getByRole("link", { name: "Card data" });
    expect(link.getAttribute("href")).toBe("/settings/card-data");
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});

describe("AppShell admin lookup", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("reveals the link only after /api/admin/access says admin", async () => {
    stubFetch(undefined, undefined, undefined, true);
    render(<AppShell><p>page</p></AppShell>);
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Card data" }).length).toBeGreaterThan(0));
  });

  it("keeps the link hidden for a non-admin", async () => {
    stubFetch(undefined, undefined, undefined, false);
    render(<AppShell><p>page</p></AppShell>);
    await waitFor(() => expect(vi.mocked(global.fetch).mock.calls.some(([u]) => String(u).includes("/api/admin/access"))).toBe(true));
    expect(screen.queryByRole("link", { name: "Card data" })).toBeNull();
  });
});
