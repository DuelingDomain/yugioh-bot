// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LinkStub } from "./helpers";

vi.mock("next/link", () => ({ default: LinkStub }));

import { LiveNowRow } from "../../../src/components/layout/live-now";

const YOURS = { yourDuel: { href: "/duels/abc", opponent: "Kestrel", state: "live" as const }, liveCount: 2 };
const COUNT = { yourDuel: null, liveCount: 3 };

describe("LiveNowRow", () => {
  it("renders nothing when nothing is live", () => {
    const { container } = render(<LiveNowRow live={{ yourDuel: null, liveCount: 0 }} size="side" />);
    expect(container.firstChild).toBeNull();
    const again = render(<LiveNowRow live={null} size="side" />);
    expect(again.container.firstChild).toBeNull();
  });

  it("your duel: title, opponent, Open duel, a violet dot, linking to the duel", () => {
    const { container } = render(<LiveNowRow live={YOURS} size="side" />);
    const link = screen.getByRole("link", { name: "Your duel against Kestrel. Open duel" });
    expect(link).toHaveAttribute("href", "/duels/abc");
    expect(link).toHaveTextContent("Your duel");
    expect(link).toHaveTextContent("Kestrel");
    expect(link).toHaveTextContent("Open duel");
    expect(container.querySelector(".sv-ldot")).toHaveAttribute("data-you", "true");
  });

  it("the count: Live now with the number of duels, linking to /duels, with a plain dot", () => {
    const { container } = render(<LiveNowRow live={COUNT} size="side" />);
    const link = screen.getByRole("link", { name: "Live now, 3 duels" });
    expect(link).toHaveAttribute("href", "/duels");
    expect(link).toHaveTextContent("3 duels");
    expect(container.querySelector(".sv-ldot")).not.toHaveAttribute("data-you");
  });

  it("has a light line above and below", () => {
    const { container } = render(<LiveNowRow live={COUNT} size="side" />);
    expect(container.querySelectorAll("hr.sv-rule")).toHaveLength(2);
  });

  it("rail: keeps only the top line, so the next group's divider is the only other line", () => {
    const { container } = render(<LiveNowRow live={COUNT} size="rail" />);
    expect(container.querySelectorAll("hr.sv-rule")).toHaveLength(1);
  });

  it("rail: the dot alone with a tooltip, and the full name on the link", () => {
    const { container } = render(<LiveNowRow live={YOURS} size="rail" />);
    const link = screen.getByRole("link", { name: "Your duel against Kestrel. Open duel" });
    expect(link).not.toHaveTextContent("Open duel");
    expect(container.querySelector(".sv-tip")?.textContent).toBe("Your duel against Kestrel");
  });

  it("phone: the same row, closes the menu when followed", () => {
    const onNavigate = vi.fn();
    render(<LiveNowRow live={COUNT} size="phone" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("link", { name: "Live now, 3 duels" }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("says the state for a duel between games", () => {
    render(<LiveNowRow live={{ yourDuel: { href: "/duels/x", opponent: "Kestrel", state: "between" }, liveCount: 1 }} size="side" />);
    expect(screen.getByRole("link")).toHaveTextContent("Kestrel, between games");
  });
});
