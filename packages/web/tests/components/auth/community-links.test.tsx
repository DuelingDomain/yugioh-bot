// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  TRAILER_SANDBOX,
  TRAILER_TITLE,
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
      <DiscordButton onClick={() => {}} pending={false} fineId="fine" />
      <SignInFootLinks marketingUrl="https://duelingdomain.com" />
    </section>
  </SignInShell>
);

describe("sign-in community links", () => {
  it("keeps the ids in one place and in step with the marketing site", () => {
    expect(DISCORD_INVITE_URL).toBe("https://discord.gg/sUSmbRbBUm");
    expect(TRAILER_YOUTUBE_ID).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(TRAILER_WATCH_URL).toBe(`https://www.youtube.com/watch?v=${TRAILER_YOUTUBE_ID}`);
    expect(TRAILER_EMBED_URL).toBe(`https://www.youtube-nocookie.com/embed/${TRAILER_YOUTUBE_ID}?autoplay=1&rel=0&playsinline=1`);
    const site = readFileSync(resolve(__dirname, "../../../../../site/public/index.html"), "utf8");
    expect(site.match(/data-youtube-id="([^"]*)"/)?.[1]).toBe(TRAILER_YOUTUBE_ID);
    expect(site).toContain(`https://www.youtube.com/watch?v=${TRAILER_YOUTUBE_ID}`);
    const invites = new Set(site.match(/https:\/\/discord\.gg\/[A-Za-z0-9]+/g));
    expect([...invites]).toEqual([DISCORD_INVITE_URL]);
  });

  it("offers a Discord invite that opens in a new tab and says so", () => {
    render(shell());
    const link = screen.getByRole("link", { name: /Join the Dueling Domain Discord server/ });
    expect(link).toHaveAttribute("href", DISCORD_INVITE_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("Join the Dueling Domain Discord server (opens in a new tab)");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("puts the community link after the form and outside any OAuth control", () => {
    const { container } = render(shell());
    const oauth = screen.getByRole("button", { name: "Continue with Discord" });
    const community = screen.getByRole("link", { name: /Join the Dueling Domain Discord server/ });
    expect(oauth.compareDocumentPosition(community) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sign in" }).compareDocumentPosition(community) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(community.closest("button, form, [data-clerk], [data-slot=\"form\"]")).toBeNull();
    expect(community.closest("section")).toBeNull();
    expect(community).not.toHaveAttribute("data-clerk");
    expect(container.querySelectorAll("[data-clerk]")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /Join the Dueling Domain Discord server/ })).toHaveLength(1);
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
    expect(container.querySelector(`img[src="${TRAILER_POSTER_SRC}"]`)).not.toBeNull();
    expect(screen.getByRole("button", { name: /Watch trailer/ })).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("opens the privacy-enhanced iframe in a large dialog on click", () => {
    const { container } = render(shell());
    const opener = screen.getByRole("button", { name: /Watch trailer/ });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: TRAILER_TITLE });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(container.querySelector("iframe")).toBeNull();
    const frame = dialog.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/9CahDbFr0jA?autoplay=1&rel=0&playsinline=1");
    expect(frame).toHaveAttribute("title", "Dueling Domain launch trailer (YouTube)");
    expect(TRAILER_TITLE).toBe("Dueling Domain launch trailer (YouTube)");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox");
    expect(TRAILER_SANDBOX).not.toContain("allow-top-navigation");
    expect(frame).toHaveAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
    expect(frame).toHaveAttribute("allowfullscreen");
    expect(frame).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close the trailer" }));
  });

  it("closes with the button, Escape and the backdrop, removes the iframe and returns focus", () => {
    render(shell());
    const opener = screen.getByRole("button", { name: /Watch trailer/ });
    const closers: Array<() => void> = [
      () => fireEvent.click(screen.getByRole("button", { name: "Close the trailer" })),
      () => fireEvent.keyDown(document, { key: "Escape" }),
      () => fireEvent.click(screen.getByRole("dialog").firstElementChild as Element),
    ];
    for (const close of closers) {
      opener.focus();
      fireEvent.click(opener);
      expect(document.querySelector("iframe")).not.toBeNull();
      close();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.querySelector("iframe")).toBeNull();
      expect(document.body.style.overflow).toBe("");
      expect(document.activeElement).toBe(opener);
    }
  });

  it("opens the same dialog from the phone link on a plain click only", () => {
    render(shell());
    const link = screen.getByRole("link", { name: /Watch the trailer/ });
    fireEvent.click(link, { ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(link);
    expect(screen.getByRole("dialog", { name: TRAILER_TITLE })).toBeInTheDocument();
  });
});
