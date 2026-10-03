// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldOutline, LocatorStrip, Tip, Zone } from "@/components/sheet/sv-zone";

describe("Zone", () => {
  it.each(["won", "lost", "empty", "dashed", "now", "pending"] as const)("renders the %s state", (state) => {
    const { container } = render(<Zone state={state} />);
    const zone = container.firstElementChild as HTMLElement;
    expect(zone).toHaveClass("sv-zone");
    expect(zone.getAttribute("data-state")).toBe(state);
    expect(zone.getAttribute("data-size")).toBe("md");
    expect(container.querySelector(".sv-zone-card") !== null).toBe(state === "won" || state === "lost" || state === "pending");
    expect(container.querySelector(".sv-zone-star") !== null).toBe(state === "won");
    expect(container.querySelector(".sv-zone-clock") !== null).toBe(state === "pending");
  });

  it("is decorative without a label", () => {
    const { container } = render(<Zone state="empty" />);
    const zone = container.firstElementChild as HTMLElement;
    expect(zone.getAttribute("aria-hidden")).toBe("true");
    expect(zone.getAttribute("role")).toBeNull();
    expect(container.querySelector(".sv-tip")).toBeNull();
  });

  it("with a label is an image with that name and a hidden tooltip", () => {
    const { container } = render(<Zone state="won" size="sm" label="Round 1, beat DJ">DJ</Zone>);
    const zone = screen.getByRole("img", { name: "Round 1, beat DJ" });
    expect(zone).toHaveClass("sv-tipped");
    expect(zone.getAttribute("tabindex")).toBeNull();
    expect(zone.getAttribute("data-size")).toBe("sm");
    expect(container.querySelector(".sv-tip")?.textContent).toBe("Round 1, beat DJ");
    expect(container.querySelector(".sv-tip")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".sv-zone-fm")?.textContent).toBe("DJ");
  });

  it("can be a tab stop", () => {
    render(<Zone state="now" label="Round 3" focusable />);
    expect(screen.getByRole("img", { name: "Round 3" })).toHaveAttribute("tabindex", "0");
  });
});

describe("LocatorStrip", () => {
  const slots = [
    { state: "won" as const, label: "Round 1, won" },
    { state: "lost" as const, label: "Round 2, lost" },
    { state: "now" as const, label: "Round 3, now" },
    { state: "dashed" as const, label: "Bye" },
    { state: "empty" as const, label: "Round 5, not played" },
  ];

  it("renders one labelled zone per slot in a named list", () => {
    const { container } = render(<LocatorStrip slots={slots} />);
    expect(screen.getByRole("list", { name: "Round results" })).toHaveClass("sv-locs");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("img", { name: "Bye" })).toHaveAttribute("data-state", "dashed");
    expect(container.querySelector(".sv-locs")?.getAttribute("data-size")).toBe("sm");
    expect(Array.from(container.querySelectorAll(".sv-zone")).map((z) => z.getAttribute("data-size"))).toEqual(["sm", "sm", "sm", "sm", "sm"]);
  });

  it("aligns the first and last tips to the strip edges and leaves slots unfocusable by default", () => {
    render(<LocatorStrip slots={slots} size="xs" label="Last five" />);
    const zones = screen.getAllByRole("img");
    expect(zones[0].getAttribute("data-align")).toBe("start");
    expect(zones[2].getAttribute("data-align")).toBe("center");
    expect(zones[4].getAttribute("data-align")).toBe("end");
    expect(zones.every((z) => !z.hasAttribute("tabindex"))).toBe(true);
    expect(screen.getByRole("list", { name: "Last five" })).toHaveAttribute("data-size", "xs");
  });

  it("makes slots tab stops with focusable, and supports a three-slot strip", () => {
    render(<LocatorStrip slots={slots.slice(0, 3)} focusable />);
    expect(screen.getAllByRole("img").every((z) => z.getAttribute("tabindex") === "0")).toBe(true);
  });
});

describe("Tip", () => {
  it("wraps its child with a visual-only tooltip", () => {
    const { container } = render(<Tip label="Decks" side="right" align="start"><a href="/decks" aria-label="Decks">D</a></Tip>);
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap).toHaveClass("sv-tipped");
    expect(wrap.getAttribute("data-side")).toBe("right");
    expect(wrap.getAttribute("data-align")).toBe("start");
    expect(wrap.querySelector(".sv-tip")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("link", { name: "Decks" })).toBeInTheDocument();
  });
});

describe("FieldOutline", () => {
  it("is lit by default; unlit is flagged; the centre line is opt-in", () => {
    const lit = render(<FieldOutline centreLine><p>Body</p></FieldOutline>).container.firstElementChild as HTMLElement;
    expect(lit).toHaveClass("sv-field");
    expect(lit.getAttribute("data-lit")).toBe("true");
    expect(lit.getAttribute("data-centre")).toBe("true");
    expect(lit.querySelector(".sv-field-body p")?.textContent).toBe("Body");
    const unlit = render(<FieldOutline lit={false}>x</FieldOutline>).container.firstElementChild as HTMLElement;
    expect(unlit.getAttribute("data-lit")).toBe("false");
    expect(unlit.getAttribute("data-centre")).toBeNull();
  });
});
