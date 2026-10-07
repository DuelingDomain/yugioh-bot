// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { LinkStub, fontMock, stubFetch } from "./helpers";
import { ROOM_COLLAPSE_QUERY } from "../../../src/components/layout/shell-model";

vi.mock("next/font/google", () => fontMock());
vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));
vi.mock("next/link", () => ({ default: LinkStub }));
vi.mock("@/lib/actions", () => ({ handleSignOut: vi.fn() }));

import { usePathname } from "next/navigation";
import { AppShell } from "../../../src/components/layout/app-shell";

const mockUsePathname = vi.mocked(usePathname);
const KEY = "yugidraft:sidebar-collapsed";

describe("AppShell bypass routes", () => {
  beforeEach(() => {
    stubFetch();
  });

  it.each(["/duels/abc", "/decks/new", "/decks/42"])("%s renders without the shell", (path) => {
    mockUsePathname.mockReturnValue(path);
    const { container } = render(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );
    expect(screen.getByText("page")).toBeTruthy();
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("header")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(vi.mocked(global.fetch).mock.calls.some(([u]) => String(u).includes("/api/live"))).toBe(false);
  });

  it("keeps the exact main wrappers", () => {
    mockUsePathname.mockReturnValue("/duels/abc");
    const a = render(<AppShell><p>x</p></AppShell>);
    expect(a.container.firstElementChild?.className).toBe("min-h-screen bg-bg-deep p-4 text-text-primary sm:p-6 lg:p-8");
    a.unmount();
    mockUsePathname.mockReturnValue("/decks/new");
    const b = render(<AppShell><p>x</p></AppShell>);
    expect(b.container.firstElementChild?.className).toBe("min-h-screen bg-bg-deep text-text-primary");
  });

  it("/decks (the library) and /decks/draft/x keep the shell", () => {
    mockUsePathname.mockReturnValue("/decks");
    const { container } = render(<AppShell><p>x</p></AppShell>);
    expect(container.querySelector("aside")).not.toBeNull();
  });
});

describe("AppShell frame", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockUsePathname.mockReturnValue("/tournaments");
    stubFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders sidebar, phone top bar and page; the page is not inside .ms", () => {
    const { container } = render(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );
    expect(container.querySelector("header")).not.toBeNull();
    expect(container.querySelector("aside")).not.toBeNull();
    const main = container.querySelector("main") as HTMLElement;
    expect(main.closest(".ms")).toBeNull();
    expect(screen.getByText("page").closest(".ms")).toBeNull();
    expect(within(container.querySelector("header") as HTMLElement).getByText("Tournaments")).toBeTruthy();
  });

  it("falls back to Dueling Domain for the phone title", () => {
    mockUsePathname.mockReturnValue("/nowhere");
    const { container } = render(<AppShell><p>x</p></AppShell>);
    expect(within(container.querySelector("header") as HTMLElement).getByText("Dueling Domain")).toBeTruthy();
  });

  it("names the sidebar and the phone menu Dueling Domain", async () => {
    render(<AppShell><p>x</p></AppShell>);
    expect(within(screen.getByRole("complementary", { name: "Sidebar" })).getByText("Dueling")).toHaveTextContent(/^Dueling Domain$/);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    expect(within(dialog).getByText("Dueling")).toHaveTextContent(/^Dueling Domain$/);
  });

  it("restores the collapsed state from storage after mount", async () => {
    window.localStorage.setItem(KEY, "1");
    const { container } = render(<AppShell><p>x</p></AppShell>);
    await waitFor(() => expect(container.querySelector("aside")).toHaveAttribute("data-rail"));
    expect(container.firstElementChild).toHaveAttribute("data-sidebar-collapsed", "true");
  });

  it("remembers a toggle", async () => {
    const { container } = render(<AppShell><p>x</p></AppShell>);
    expect(container.querySelector("aside")).not.toHaveAttribute("data-rail");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(container.querySelector("aside")).toHaveAttribute("data-rail");
    expect(window.localStorage.getItem(KEY)).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(window.localStorage.getItem(KEY)).toBe("0");
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { container } = render(<AppShell><p>x</p></AppShell>);
    expect(container.querySelector("aside")).not.toHaveAttribute("data-rail");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(container.querySelector("aside")).toHaveAttribute("data-rail");
  });

  it("phone menu: opens as a dialog, page goes inert, Escape closes and focus returns", async () => {
    const { container } = render(<AppShell><p>x</p></AppShell>);
    const menuBtn = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(menuBtn);
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    expect(menuBtn).toHaveAttribute("aria-expanded", "true");
    expect((container.firstElementChild as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close menu" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    // The page is live again and focus is back before the slide-out ends.
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "closed");
    expect((container.firstElementChild as HTMLElement & { inert: boolean }).inert).toBe(false);
    expect(document.activeElement).toBe(menuBtn);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(menuBtn);
  });

  it("closes the phone menu when the window grows past phone width", async () => {
    const listeners: Array<() => void> = [];
    const mq = {
      matches: false,
      addEventListener: (_: string, cb: () => void) => {
        listeners.push(cb);
      },
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn().mockReturnValue(mq) as unknown as typeof window.matchMedia;
    render(<AppShell><p>x</p></AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");
    mq.matches = true;
    listeners.forEach((cb) => cb());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("never shows a Sign in button, even when the session fails", async () => {
    stubFetch("fail");
    render(<AppShell><p>x</p></AppShell>);
    await waitFor(() => expect(screen.queryByLabelText("Loading your account")).toBeNull());
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });

  it.each([401, 500, "network"] as const)("keeps profile availability unknown after a %s lookup failure", async (failure) => {
    mockUsePathname.mockReturnValue("/player/7");
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (input === "/api/auth/session") return Response.json({ user: { name: "Imran" } });
      if (failure === "network") throw new Error("Network failure");
      return new Response(null, { status: failure });
    });
    await act(async () => {
      render(<AppShell><p>x</p></AppShell>);
    });

    expect(screen.queryByText("No profile yet")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getByRole("link", { name: "Leaderboard" })).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getAllByRole("button", { name: "Account menu, Imran" })[0]);
    expect(screen.queryByText(/you get a profile after your first match/i)).toBeNull();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(within(drawer).getByRole("link", { name: "Leaderboard" })).not.toHaveAttribute("aria-current");
  });

  it("shows no profile only after a confirmed 404", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => input === "/api/auth/session"
      ? Response.json({ user: { name: "Imran" } })
      : new Response(null, { status: 404 }));
    await act(async () => {
      render(<AppShell><p>x</p></AppShell>);
    });

    expect(screen.getByText("No profile yet")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Account menu, Imran" })[0]);
    expect(screen.getByRole("menuitem", { name: "Your profile" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/you get a profile after your first match/i)).toBeTruthy();
  });

  it("links and highlights your profile after a successful lookup", async () => {
    mockUsePathname.mockReturnValue("/player/7");
    await act(async () => {
      render(<AppShell><p>x</p></AppShell>);
    });

    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getByRole("link", { name: "Leaderboard" })).not.toHaveAttribute("aria-current");
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    const accountButton = within(sidebar).getByRole("button", { name: "Account menu, Imran" });
    expect(accountButton).toHaveAttribute("data-on");
    fireEvent.click(accountButton);
    expect(screen.getByRole("menuitem", { name: "Your profile" })).toHaveAttribute("href", "/player/7");
  });
});

describe("AppShell Live now", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // An earlier test leaves a matchMedia that reports a wide window, which would close the menu.
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
    mockUsePathname.mockReturnValue("/dashboard");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows nothing when nothing is live", async () => {
    stubFetch();
    await act(async () => {
      render(<AppShell><p>x</p></AppShell>);
    });
    expect(screen.queryByText("Live now")).toBeNull();
    expect(screen.queryByText("Your duel")).toBeNull();
    expect(screen.getByRole("button", { name: "Open menu" })).toBeTruthy();
  });

  it("puts your duel under Dashboard and puts a dot on the menu button", async () => {
    stubFetch(undefined, undefined, { yourDuel: { href: "/duels/abc", opponent: "Kestrel", state: "live" }, liveCount: 3 });
    await act(async () => {
      render(<AppShell><p>x</p></AppShell>);
    });
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    const row = within(sidebar).getByRole("link", { name: /your duel against kestrel/i });
    expect(row).toHaveAttribute("href", "/duels/abc");
    expect(row).toHaveTextContent("Open duel");
    expect(screen.getByRole("button", { name: "Open menu, live now" })).toBeTruthy();
  });

  it("falls back to the count, linking to /duels", async () => {
    stubFetch(undefined, undefined, { yourDuel: null, liveCount: 2 });
    await act(async () => {
      render(<AppShell><p>x</p></AppShell>);
    });
    const row = within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("link", { name: "Live now, 2 duels" });
    expect(row).toHaveAttribute("href", "/duels");
  });

  it("shows the phone menu's live row too", async () => {
    stubFetch(undefined, undefined, { yourDuel: null, liveCount: 1 });
    await act(async () => {
      render(<AppShell><p>x</p></AppShell>);
    });
    fireEvent.click(screen.getByRole("button", { name: "Open menu, live now" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    expect(within(drawer).getByRole("link", { name: "Live now, 1 duel" })).toHaveAttribute("href", "/duels");
  });
});

describe("AppShell tournament rail", () => {
  function matchWidth(roomWidth: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === ROOM_COLLAPSE_QUERY ? roomWidth : false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
  beforeEach(() => {
    window.localStorage.clear();
    stubFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error jsdom has no matchMedia by default
    delete window.matchMedia;
  });

  it("starts collapsed on /tournament/* between 1024 and 1360px, without writing storage", async () => {
    matchWidth(true);
    mockUsePathname.mockReturnValue("/tournament/friday");
    const { container } = render(<AppShell><p>x</p></AppShell>);
    await waitFor(() => expect(container.querySelector("aside")).toHaveAttribute("data-rail", "true"));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("the toggle there is for this visit only", async () => {
    matchWidth(true);
    mockUsePathname.mockReturnValue("/tournament/friday");
    const { container } = render(<AppShell><p>x</p></AppShell>);
    await waitFor(() => expect(container.querySelector("aside")).toHaveAttribute("data-rail"));
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(container.querySelector("aside")).not.toHaveAttribute("data-rail");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("other pages and other widths are not auto-collapsed", async () => {
    matchWidth(true);
    mockUsePathname.mockReturnValue("/tournaments");
    const a = render(<AppShell><p>x</p></AppShell>);
    expect(a.container.querySelector("aside")).not.toHaveAttribute("data-rail");
    a.unmount();
    matchWidth(false);
    mockUsePathname.mockReturnValue("/tournament/friday");
    const b = render(<AppShell><p>x</p></AppShell>);
    expect(b.container.querySelector("aside")).not.toHaveAttribute("data-rail");
  });

  it("stored collapse still applies when the room width rule does not", async () => {
    matchWidth(false);
    window.localStorage.setItem(KEY, "1");
    mockUsePathname.mockReturnValue("/tournament/friday");
    const { container } = render(<AppShell><p>x</p></AppShell>);
    await waitFor(() => expect(container.querySelector("aside")).toHaveAttribute("data-rail"));
  });
});
