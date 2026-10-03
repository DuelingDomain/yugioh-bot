// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeckMark, LiveDot, SizeBar, StageLine, StatusLine } from "@/components/sheet/sv-status";

describe("LiveDot", () => {
  it("a bare dot has an accessible name", () => {
    render(<LiveDot />);
    expect(screen.getByRole("img", { name: "Live" })).toHaveClass("sv-ldot");
  });
  it("you is violet and named for the viewer", () => {
    render(<LiveDot you />);
    const dot = screen.getByRole("img", { name: "Live, your duel" });
    expect(dot.getAttribute("data-you")).toBe("true");
  });
  it("with a label renders a span with a hidden dot", () => {
    const { container } = render(<LiveDot label="Game 2 in progress" />);
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap).toHaveClass("sv-live");
    expect(wrap.textContent).toBe("Game 2 in progress");
    expect(wrap.querySelector(".sv-ldot")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("StatusLine", () => {
  it.each(["ready", "warn", "block", "neutral"] as const)("renders the %s tone with a default mark", (tone) => {
    const { container } = render(<StatusLine tone={tone}>Sentence</StatusLine>);
    const line = container.firstElementChild as HTMLElement;
    expect(line).toHaveClass("sv-status");
    expect(line.getAttribute("data-tone")).toBe(tone);
    expect(line.querySelector(".sv-status-mark svg")).not.toBeNull();
    expect(line.querySelector(".sv-status-mark")?.getAttribute("aria-hidden")).toBe("true");
    expect(line.querySelector(".sv-status-text")?.textContent).toBe("Sentence");
  });
  it("takes a custom icon", () => {
    render(<StatusLine tone="warn" icon={<i data-testid="ic" />}>x</StatusLine>);
    expect(screen.getByTestId("ic")).toBeInTheDocument();
  });
});

describe("SizeBar", () => {
  const fill = (c: HTMLElement) => (c.querySelector(".sv-size-fill") as HTMLElement).style.transform;
  it("is in range between min and max", () => {
    const { container } = render(<SizeBar value={45} min={40} max={60} label="Main deck" />);
    const bar = screen.getByRole("meter", { name: "Main deck" });
    expect(bar.getAttribute("data-state")).toBe("in");
    expect(bar.getAttribute("aria-valuenow")).toBe("45");
    expect(bar.getAttribute("aria-valuetext")).toBe("45, within 40 to 60");
    expect(fill(container)).toBe("scaleX(0.75)");
    expect(container.querySelectorAll(".sv-size-tick")).toHaveLength(2);
    expect(container.querySelector(".sv-size-n")?.textContent).toBe("45");
  });
  it("is short below min", () => {
    const bar = render(<SizeBar value={31} min={40} max={60} />).container.firstElementChild as HTMLElement;
    expect(bar.getAttribute("data-state")).toBe("short");
    expect(bar.getAttribute("aria-valuetext")).toBe("31, below the minimum of 40");
    expect(bar.getAttribute("aria-label")).toBe("Size");
  });
  it("is over above max, full width, with the max tick pulled in", () => {
    const { container } = render(<SizeBar value={75} min={40} max={60} />);
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("over");
    expect(fill(container)).toBe("scaleX(1)");
    expect((container.querySelectorAll(".sv-size-tick")[1] as HTMLElement).style.left).toBe("80%");
  });
  it("handles zero and bad values", () => {
    expect(fill(render(<SizeBar value={0} min={0} max={15} />).container)).toBe("scaleX(0)");
    expect(fill(render(<SizeBar value={NaN} min={0} max={15} />).container)).toBe("scaleX(0)");
  });
});

describe("DeckMark", () => {
  it("none says No deck yet", () => {
    const { container } = render(<DeckMark state="none" />);
    expect(container.firstElementChild?.getAttribute("data-state")).toBe("none");
    expect(container.textContent).toBe("No deck yet");
  });
  it("in says Deck in", () => {
    const { container } = render(<DeckMark state="in" />);
    expect(container.textContent).toBe("Deck in");
    expect(container.querySelector("a")).toBeNull();
  });
  it("in with a tournament links it, and locked adds the tail", () => {
    const { container } = render(<DeckMark state="in" locked tournament={{ name: "Cube cup 4", href: "/tournament/cc4" }} />);
    expect(screen.getByRole("link", { name: "Cube cup 4" })).toHaveAttribute("href", "/tournament/cc4");
    expect(container.textContent).toBe("Deck in for Cube cup 4Locked");
    expect(container.querySelector(".sv-deckmark-lock")?.textContent).toBe("Locked");
  });
  it("ignores locked and tournament for none", () => {
    const { container } = render(<DeckMark state="none" locked tournament={{ name: "X", href: "/x" }} />);
    expect(container.textContent).toBe("No deck yet");
  });
});

describe("StageLine", () => {
  it("renders an ordered list with the current step marked", () => {
    const { container } = render(<StageLine label="Draft stages" steps={[
      { label: "Lobby", state: "done" }, { label: "Draft", state: "now" }, { label: "Deck", state: "next" },
    ]} />);
    expect(screen.getByRole("list", { name: "Draft stages" })).toHaveClass("sv-stage");
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["done", "now", "next"]);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[0].textContent).toBe("Lobby, done");
    expect(items[1].textContent).toBe("Draft, current");
    expect(items[2].textContent).toBe("Deck");
    expect(container.querySelectorAll(".sv-stage-node")).toHaveLength(3);
  });
});
