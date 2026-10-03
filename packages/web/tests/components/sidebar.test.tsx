// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LinkStub, fontMock, ready, loading } from "./shell/helpers";

vi.mock("next/font/google", () => fontMock());
vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));
vi.mock("next/link", () => ({ default: LinkStub }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

import { usePathname } from "next/navigation";
import { Sidebar } from "../../src/components/layout/sidebar";

const mockUsePathname = vi.mocked(usePathname);

function current() {
  return screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
}

describe("Sidebar current page", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["/dashboard", "Dashboard"],
    ["/tournaments", "Tournaments"],
    ["/tournament/friday-night", "Tournaments"],
    ["/drafts", "Drafts"],
    ["/drafts/123", "Drafts"],
    ["/draft/some-slug", "Drafts"],
    ["/leaderboard", "Leaderboard"],
    ["/settings", "Settings"],
    ["/themes", "Cubes"],
    ["/player/9", "Leaderboard"],
  ])("%s lights %s and nothing else", (path, label) => {
    mockUsePathname.mockReturnValue(path);
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    const lit = current();
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveAccessibleName(label);
  });

  it("lights your name, not a link, on your own profile", () => {
    mockUsePathname.mockReturnValue("/player/7");
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    expect(current()).toHaveLength(0);
    expect(screen.getByRole("button", { name: /account menu, imran/i })).toHaveAttribute("data-on");
  });

  it("does not light Drafts on /dashboard", () => {
    mockUsePathname.mockReturnValue("/dashboard");
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    expect(screen.getByRole("link", { name: /drafts/i })).not.toHaveAttribute("aria-current");
  });
});

describe("Sidebar structure", () => {
  beforeEach(() => mockUsePathname.mockReturnValue("/dashboard"));

  it("groups Leaderboard under Compete and Decks and Cubes under Build", () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    const nav = screen.getByRole("navigation", { name: /main navigation/i });
    const kids = Array.from(nav.querySelectorAll("p, a")).map((n) => n.textContent);
    expect(kids).toEqual([
      "Dashboard",
      "Compete",
      "Tournaments",
      "Drafts",
      "Duels",
      "Leaderboard",
      "Build",
      "Decks",
      "Cubes",
    ]);
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
  });

  it("writes group labels in sentence case", () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    expect(screen.getByText("Compete").textContent).toBe("Compete");
    expect(screen.getByText("Build").textContent).toBe("Build");
  });

  it("has a labelled navigation and no sign in button", () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    expect(screen.getByRole("navigation", { name: /main navigation/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /sign in/i })).toBeNull();
  });

  it("collapse button reports and toggles", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Sidebar collapsed={false} onToggle={onToggle} account={ready} live={null} />);
    const btn = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(btn).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<Sidebar collapsed={true} onToggle={onToggle} account={ready} live={null} />);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-expanded", "false");
  });

  it("collapsed: marks the rail, keeps every link's name and drops the labels", () => {
    const { container } = render(<Sidebar collapsed={true} onToggle={vi.fn()} account={ready} live={null} />);
    expect(container.querySelector("aside")).toHaveAttribute("data-rail", "true");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-label", "Dashboard");
    expect(screen.queryByText("Compete")).toBeNull();
    expect(screen.queryByText("Duelists Kingdom")).toBeNull();
  });

  it("collapsed: each link has a tooltip; expanded has none for links", () => {
    const { container, rerender } = render(<Sidebar collapsed={true} onToggle={vi.fn()} account={ready} live={null} />);
    expect(Array.from(container.querySelectorAll(".sv-tip")).map((t) => t.textContent)).toContain("Tournaments");
    rerender(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    expect(container.querySelector(".sv-tip")).toBeNull();
  });

  it("expanded: no rail marker", () => {
    const { container } = render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    expect(container.querySelector("aside")).not.toHaveAttribute("data-rail");
  });

  it("shows the seat with the tier and Elo", () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={ready} live={null} />);
    const seat = screen.getByRole("button", { name: /account menu, imran/i });
    expect(seat).toHaveTextContent("Imran");
    expect(seat).toHaveTextContent("Gold");
    expect(seat).toHaveTextContent("1432");
  });

  it("collapsed: the seat is the ring alone", () => {
    render(<Sidebar collapsed={true} onToggle={vi.fn()} account={ready} live={null} />);
    const seat = screen.getByRole("button", { name: /account menu, imran/i });
    expect(seat).not.toHaveTextContent("Gold");
  });

  it("shows a placeholder while the session loads", () => {
    render(<Sidebar collapsed={false} onToggle={vi.fn()} account={loading} live={null} />);
    expect(screen.getByLabelText("Loading your account")).toHaveAttribute("aria-busy", "true");
  });
});
