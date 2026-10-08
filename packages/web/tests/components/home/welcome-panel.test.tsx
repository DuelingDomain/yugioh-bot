// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomePanel } from "@/components/dashboard/welcome-panel";
import { OPEN_DRAFT, OPEN_TOURNAMENT, stubOpenNow } from "../../fixtures/open-now";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const standing = <section aria-label="standing">standing block</section>;
const hrefs = (links: HTMLElement[]) => links.map((a) => a.getAttribute("href"));

describe("WelcomePanel", () => {
  it("with nothing open: one primary, Challenge someone, over faded rows", async () => {
    stubOpenNow();
    const { container } = render(<WelcomePanel standing={standing} />);
    const primary = await screen.findByRole("link", { name: "Challenge someone" });
    expect(container.querySelectorAll(".sv-btn.primary")).toHaveLength(1);
    expect(primary).toHaveClass("primary");
    expect(primary).toHaveAttribute("href", "/duels/new?challenge=1");
    expect(hrefs(screen.getAllByRole("link", { name: /new (tournament|draft)/i }))).toEqual(["/tournaments/new", "/drafts/new"]);
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByText("Open right now")).toBeNull();
    expect(container.textContent).toContain("Everyone starts at 1000 Elo, which is Silver. Gold starts at 1100.");
  });

  it("names no slash command or Discord", async () => {
    stubOpenNow();
    const { container } = render(<WelcomePanel standing={standing} />);
    await screen.findByRole("link", { name: "Challenge someone" });
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).not.toMatch(/\/(event|draft|duel)\b|discord/i);
    expect(container.textContent).not.toContain("—");
  });

  it("with something open: the list leads, the top row holds the only primary, links go to the slugs", async () => {
    stubOpenNow({ tournaments: [OPEN_TOURNAMENT], drafts: [OPEN_DRAFT], duelsInProgress: 2 });
    const { container } = render(<WelcomePanel standing={standing} />);
    await screen.findByText("Open right now");
    expect(container.querySelectorAll(".sv-btn.primary")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Join tournament" })).toHaveClass("primary");
    expect(screen.getByRole("link", { name: "Join draft" })).not.toHaveClass("primary");
    expect(screen.getByRole("link", { name: "Spring Cup" })).toHaveAttribute("href", "/tournament/spring-cup");
    expect(screen.getByRole("link", { name: "Cube night" })).toHaveAttribute("href", "/draft/cube-night");
    expect(screen.getByText("2 duels in progress")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Challenge someone" })).toHaveAttribute("href", "/duels/new?challenge=1");
    expect(screen.queryByRole("link", { name: /^New (tournament|draft)$/ })).toBeNull();
  });

  it.each([["a failed status", 503], ["a network error", "throw" as const], ["a 401", 401]])("falls back to the empty version on %s", async (_name, answer) => {
    stubOpenNow(answer);
    const { container } = render(<WelcomePanel standing={standing} />);
    await screen.findByRole("link", { name: "Challenge someone" });
    expect(container.querySelectorAll(".sv-btn.primary")).toHaveLength(1);
    expect(screen.queryByText("Open right now")).toBeNull();
  });

  it("shows the standing block before the fetch settles", () => {
    stubOpenNow();
    render(<WelcomePanel standing={standing} />);
    expect(screen.getByText("standing block")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Challenge someone" })).toBeNull();
  });
});
