// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readRegistration } from "../../src/components/decks/api";
import { RegistrationMark, lockedNote, tournamentHref } from "../../src/components/decks/registration";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const mark = (over: Partial<{ slug: string | null; locked: boolean }> = {}) => ({
  tournament: { id: 12, slug: "autumn-cup" as string | null, name: "Autumn cup", status: "active" },
  locked: false,
  ...over,
});

describe("deck registration helpers", () => {
  it("links to the tournament by its slug, or by id when it has none", () => {
    expect(tournamentHref(mark())).toBe("/tournament/autumn-cup");
    expect(tournamentHref({ ...mark(), tournament: { ...mark().tournament, slug: null } })).toBe("/tournament/12");
  });

  it("has a locked sentence only for a locked deck", () => {
    expect(lockedNote(null)).toBeNull();
    expect(lockedNote(mark())).toBeNull();
    expect(lockedNote(mark({ locked: true }))).toBe("Locked since your first game started. Changes to this deck will not reach Autumn cup.");
  });

  it("renders nothing without a registration and the tournament link with one", () => {
    const { container, rerender } = render(<RegistrationMark registration={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<RegistrationMark registration={mark({ locked: true })} />);
    expect(screen.getByRole("link", { name: "Autumn cup" })).toHaveAttribute("href", "/tournament/autumn-cup");
    expect(screen.getByText("Locked")).toBeInTheDocument();
  });

  it("reads a registration from the API and treats anything partial as none", () => {
    expect(readRegistration(null)).toBeNull();
    expect(readRegistration({ locked: true })).toBeNull();
    expect(readRegistration({ tournament: { id: "x", name: "A", status: "s" }, locked: true })).toBeNull();
    expect(readRegistration({ tournament: { id: 3, slug: "cup", name: "Cup", status: "active" }, locked: true }))
      .toEqual({ tournament: { id: 3, slug: "cup", name: "Cup", status: "active" }, locked: true });
    expect(readRegistration({ tournament: { id: 3, name: "Cup", status: "active" } }))
      .toEqual({ tournament: { id: 3, slug: null, name: "Cup", status: "active" }, locked: false });
  });
});
