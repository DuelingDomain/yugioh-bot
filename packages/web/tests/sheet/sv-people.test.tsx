// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Mono, Seat, YouPill } from "@/components/sheet/sv-people";

describe("Mono", () => {
  it("defaults to two initials from the name, md size, and is decorative", () => {
    const { container } = render(<Mono name="duel.josh" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe("Du");
    expect(el.getAttribute("data-size")).toBe("md");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.getAttribute("role")).toBeNull();
  });

  it("takes explicit initials, size and ring colour", () => {
    const { container } = render(<Mono name="Marik_Mains" initials="MM" size="big" ring="#3fb8af" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe("MM");
    expect(el.getAttribute("data-size")).toBe("big");
    expect(el.style.getPropertyValue("--sv-ring")).toBe("#3fb8af");
  });

  it("flags you, champion and dashed, and drops the initials when dashed", () => {
    const you = render(<Mono name="Imran" you champion />).container.firstElementChild as HTMLElement;
    expect(you.getAttribute("data-you")).toBe("true");
    expect(you.getAttribute("data-champion")).toBe("true");
    const dashed = render(<Mono name="Imran" dashed />).container.firstElementChild as HTMLElement;
    expect(dashed.getAttribute("data-dashed")).toBe("true");
    expect(dashed.textContent).toBe("");
  });

  it("gets an image role when labelled and handles an empty name", () => {
    render(<Mono name="" label="Empty seat" />);
    expect(screen.getByRole("img", { name: "Empty seat" })).toBeInTheDocument();
  });
});

describe("YouPill", () => {
  it("says You", () => {
    expect(render(<YouPill />).container.innerHTML).toBe('<span class="sv-pill">You</span>');
  });
});

describe("Seat", () => {
  it("shows the name, the tier word and Elo", () => {
    const { container } = render(<Seat name="Kestrel" tier="Platinum" elo={1402} ring="#e0679c" />);
    expect(screen.getByText("Kestrel")).toBeInTheDocument();
    expect(container.querySelector(".sv-seat-line .tier")?.textContent).toBe("Platinum");
    expect(container.querySelector(".sv-seat-line .gem")).not.toBeNull();
    expect(container.querySelector(".sv-elo")?.textContent).toBe("1402");
    expect(container.querySelector(".sv-pill")).toBeNull();
    expect(container.querySelector(".sv-mono")?.getAttribute("data-size")).toBe("md");
  });

  it("adds the You pill and the violet ring for you", () => {
    const { container } = render(<Seat name="Imran" you tier="Gold" elo={1186} />);
    expect(container.querySelector(".sv-pill")?.textContent).toBe("You");
    expect(container.querySelector(".sv-mono")?.getAttribute("data-you")).toBe("true");
    expect(container.firstElementChild?.getAttribute("data-you")).toBe("true");
  });

  it("links the name, renders trailing content, and skips the line without tier or Elo", () => {
    const { container } = render(<Seat name="Kestrel" href="/player/ke" size="sm" trailing={<b>2–0</b>} />);
    expect(screen.getByRole("link", { name: "Kestrel" })).toHaveAttribute("href", "/player/ke");
    expect(container.querySelector(".sv-seat-line")).toBeNull();
    expect(container.querySelector(".sv-seat-trail")?.textContent).toBe("2–0");
    expect(container.querySelector(".sv-mono")?.getAttribute("data-size")).toBe("sm");
  });
});
