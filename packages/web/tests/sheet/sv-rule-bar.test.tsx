// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LightRule } from "@/components/sheet/sv-rule";
import { PageBar, SectionHead } from "@/components/sheet/sv-bar";

describe("LightRule", () => {
  it("renders an hr, with data-beam only when asked", () => {
    expect(render(<LightRule />).container.innerHTML).toBe('<hr class="sv-rule">');
    expect(render(<LightRule beam className="x" />).container.innerHTML).toBe('<hr class="sv-rule x" data-beam="true">');
  });
});

describe("PageBar", () => {
  it("renders the back link, an h1 title, the sub line and actions", () => {
    render(<PageBar back={{ href: "/tournaments", label: "All tournaments" }} title="Cube cup 4" sub="The duels" actions={<button type="button">Animations</button>} />);
    const back = screen.getByRole("link", { name: "All tournaments" });
    expect(back).toHaveAttribute("href", "/tournaments");
    expect(back).toHaveClass("sv-bar-back");
    expect(screen.getByRole("heading", { level: 1, name: "Cube cup 4" })).toHaveClass("sv-bar-title");
    expect(screen.getByText("The duels")).toHaveClass("sv-bar-sub");
    expect(screen.getByRole("button", { name: "Animations" }).parentElement).toHaveClass("sv-bar-actions");
  });

  it("leaves out the back link, sub and actions when not given, and can use another title element", () => {
    const { container } = render(<PageBar title="Decks" titleAs="h2" />);
    expect(container.querySelector(".sv-bar-back")).toBeNull();
    expect(container.querySelector(".sv-bar-sub")).toBeNull();
    expect(container.querySelector(".sv-bar-actions")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Decks" })).toBeInTheDocument();
  });
});

describe("SectionHead", () => {
  it("renders an h2 by default with a note and an action", () => {
    const { container } = render(<SectionHead title="Standings" note="Round 3 of 5" action={<a href="/x">All</a>} />);
    expect(screen.getByRole("heading", { level: 2, name: "Standings" })).toHaveClass("sv-head-t");
    expect(container.querySelector(".sv-head-note")?.textContent).toBe("Round 3 of 5");
    expect(container.querySelector(".sv-head-act a")).not.toBeNull();
    expect(container.firstElementChild).toHaveClass("sv-head");
    expect(container.firstElementChild).not.toHaveClass("sm");
  });

  it("uses h3 and the small modifier", () => {
    const { container } = render(<SectionHead as="h3" title="Rules" />);
    expect(screen.getByRole("heading", { level: 3, name: "Rules" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("sm");
    expect(container.querySelector(".sv-head-note")).toBeNull();
  });
});
