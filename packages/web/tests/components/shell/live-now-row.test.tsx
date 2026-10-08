// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LinkStub } from "./helpers";

vi.mock("next/link", () => ({ default: LinkStub }));

import { LiveNowRow } from "../../../src/components/layout/live-now";

const YOURS = { yourDuel: { href: "/duels/abc", opponent: "Kestrel", state: "live" as const, opponents: [{ seat: 1, name: "Kestrel", isBot: false }] }, liveCount: 2, presence: { onlineSeats: [1], spectatorCount: 0 } };
const COUNT = { yourDuel: null, liveCount: 3 };

describe("LiveNowRow", () => {
  it("dims the dot and shows away as soon as the opponent leaves the room", () => {
    const { rerender } = render(<LiveNowRow live={YOURS} size="side" />);
    rerender(<LiveNowRow live={{ ...YOURS, presence: { onlineSeats: [], spectatorCount: 0 } }} size="side" />);
    expect(screen.getByRole("link")).toHaveTextContent("Kestrel · away");
    expect(screen.getByRole("img", { name: "Opponent away or presence unavailable" })).toHaveAttribute("data-present", "false");
  });
  it("renders nothing when nothing is live", () => {
    const { container } = render(<LiveNowRow live={{ yourDuel: null, liveCount: 0 }} size="side" />);
    expect(container.firstChild).toBeNull();
    const again = render(<LiveNowRow live={null} size="side" />);
    expect(again.container.firstChild).toBeNull();
  });

  it("your duel: title, opponent, Open duel, a live presence dot, linking to the duel", () => {
    const { container } = render(<LiveNowRow live={YOURS} size="side" />);
    const link = screen.getByRole("link", { name: "Your duel against Kestrel · in the room. Open duel" });
    expect(link).toHaveAttribute("href", "/duels/abc");
    expect(link).toHaveTextContent("Your duel");
    expect(link).toHaveTextContent("Kestrel");
    expect(link).toHaveTextContent("Open duel");
    expect(screen.getByRole("img", { name: "Opponent in the room" })).toHaveAttribute("data-present", "true");
  });

  it("the count: Live now with the number of duels, linking to /duels, with a plain dot", () => {
    const { container } = render(<LiveNowRow live={COUNT} size="side" />);
    const link = screen.getByRole("link", { name: "Live now, 3 duels" });
    expect(link).toHaveAttribute("href", "/duels");
    expect(link).toHaveTextContent("3 duels");
    expect(container.querySelector(".sv-ldot")).not.toHaveAttribute("data-you");
  });

  it("grows open when something goes live and collapses, still showing its text, when it ends", async () => {
    const { container, rerender } = render(<LiveNowRow live={null} size="side" />);
    expect(container.firstChild).toBeNull();
    rerender(<LiveNowRow live={COUNT} size="side" />);
    const grow = container.querySelector("[data-mo=grow]") as HTMLElement;
    expect(grow).toHaveAttribute("data-state", "open");
    rerender(<LiveNowRow live={{ yourDuel: null, liveCount: 0 }} size="side" />);
    expect(container.querySelector("[data-mo=grow]")).toBe(grow);
    expect(grow).toHaveAttribute("data-state", "closed");
    expect(grow).toHaveAttribute("inert");
    expect(screen.getByRole("link", { name: "Live now, 3 duels", hidden: true })).toBeInTheDocument();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("has a light line above and below", () => {
    const { container } = render(<LiveNowRow live={COUNT} size="side" />);
    expect(container.querySelectorAll("hr.sv-rule")).toHaveLength(2);
  });

  it("side: the same row in the collapsed rail, with a tooltip for when its text is faded out", () => {
    const { container } = render(<LiveNowRow live={YOURS} size="side" />);
    const link = screen.getByRole("link", { name: "Your duel against Kestrel · in the room. Open duel" });
    expect(link).toHaveTextContent("Open duel");
    expect(container.querySelector(".sv-tip")?.textContent).toBe("Your duel against Kestrel · in the room");
  });

  it("phone: the same row, closes the menu when followed", () => {
    const onNavigate = vi.fn();
    render(<LiveNowRow live={COUNT} size="phone" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "Live now, 3 duels" }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("keeps the opponent muted when presence is unavailable between games", () => {
    render(<LiveNowRow live={{ yourDuel: { href: "/duels/x", opponent: "Kestrel", state: "between" }, liveCount: 1 }} size="side" />);
    expect(screen.getByRole("link")).toHaveTextContent("Kestrel · presence unavailable");
  });
});
