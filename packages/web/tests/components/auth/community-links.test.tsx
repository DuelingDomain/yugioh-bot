// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: ({ variable }: { variable: string }) => ({ variable, className: "font-class" }),
}));

import { DiscordButton } from "@/components/auth/fields";
import { SignInShell } from "@/components/auth/sign-in-shell";
import { SignInFootLinks } from "@/components/auth/sign-in-step";
import {
  DISCORD_INVITE_URL,
  TRAILER_EMBED_URL,
  TRAILER_POSTER_SRC,
  TRAILER_WATCH_URL,
  TRAILER_YOUTUBE_ID,
} from "@/components/auth/community-links";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const shell = () => (
  <SignInShell marketingUrl="https://duelingdomain.com">
    <section>
      <h1>Sign in</h1>
      <div data-testid="oauth"><DiscordButton onClick={() => {}} pending={false} fineId="fine" /></div>
      <SignInFootLinks marketingUrl="https://duelingdomain.com" />
    </section>
  </SignInShell>
);

describe("sign-in community links", () => {
  it("keeps the ids in one place", () => {
    expect(DISCORD_INVITE_URL).toBe("https://discord.gg/sUSmbRbBUm");
    expect(TRAILER_YOUTUBE_ID).toBe("9CahDbFr0jA");
    expect(TRAILER_WATCH_URL).toBe("https://www.youtube.com/watch?v=9CahDbFr0jA");
    expect(TRAILER_EMBED_URL).toBe("https://www.youtube-nocookie.com/embed/9CahDbFr0jA?autoplay=1&rel=0&playsinline=1");
  });

  it("offers a Discord invite that opens in a new tab and says so", () => {
    render(shell());
    const link = screen.getByRole("link", { name: /Join our Discord/ });
    expect(link).toHaveAttribute("href", DISCORD_INVITE_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("Join our Discord (opens in a new tab)");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the community link out of the OAuth group so it does not read as a sign-in route", () => {
    render(shell());
    const oauth = screen.getByTestId("oauth");
    const community = screen.getByRole("link", { name: /Join our Discord/ });
    expect(within(oauth).getByRole("button", { name: "Continue with Discord" })).toBeInTheDocument();
    expect(oauth).not.toContainElement(community);
    expect(community.closest("button")).toBeNull();
    expect(community).not.toHaveAttribute("data-clerk");
    // One "Join our Discord" link only, and it is a link, not a second OAuth button.
    expect(screen.getAllByRole("link", { name: /Join our Discord/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Discord/ })).toHaveLength(1);
  });

  it("gives phones a plain trailer link that opens YouTube in a new tab", () => {
    render(shell());
    const link = screen.getByRole("link", { name: /Watch the trailer/ });
    expect(link).toHaveAttribute("href", TRAILER_WATCH_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("loads nothing from YouTube before the click", () => {
    const html = renderToString(shell());
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("youtube-nocookie");
    const { container } = render(shell());
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("img", { name: /Poster for the launch trailer/ })).toHaveAttribute("src", TRAILER_POSTER_SRC);
  });

  it("swaps the poster for a 16:9 privacy-enhanced iframe on click", () => {
    const { container } = render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Play the launch trailer" }));
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/9CahDbFr0jA?autoplay=1&rel=0&playsinline=1");
    expect(frame).toHaveAttribute("title", "Launch trailer");
    expect(frame).toHaveAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
    expect(frame).toHaveAttribute("allowfullscreen");
    expect(frame).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    expect(screen.queryByRole("button", { name: "Play the launch trailer" })).toBeNull();
    expect(document.activeElement).toBe(frame);
  });
});
