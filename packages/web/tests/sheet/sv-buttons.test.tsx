// @vitest-environment jsdom
import { fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DUEL_ACTION_LABELS, DuelAction, Segmented, SvButton, svButtonClass } from "@/components/sheet/sv-buttons";
import { CopyLinkRow } from "@/components/sheet/sv-copy";

describe("SvButton", () => {
  it("defaults to a ghost type=button", () => {
    render(<SvButton>Cancel</SvButton>);
    const b = screen.getByRole("button", { name: "Cancel" });
    expect(b.className).toBe("sv-btn ghost");
    expect(b).toHaveAttribute("type", "button");
  });
  it("applies variant, big and wide, and forwards props", () => {
    const onClick = vi.fn();
    render(<SvButton variant="primary" big wide className="x" onClick={onClick} type="submit">Create</SvButton>);
    const b = screen.getByRole("button", { name: "Create" });
    expect(b.className).toBe("sv-btn primary big wide x");
    expect(b).toHaveAttribute("type", "submit");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("renders a link with as=a", () => {
    render(<SvButton as="a" href="/drafts/new" variant="primary">New draft</SvButton>);
    const a = screen.getByRole("link", { name: "New draft" });
    expect(a).toHaveAttribute("href", "/drafts/new");
    expect(a.className).toBe("sv-btn primary");
  });
  it("is disabled when told to be", () => {
    render(<SvButton variant="danger" disabled>Delete</SvButton>);
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
  it("svButtonClass builds the class list", () => {
    expect(svButtonClass("quiet")).toBe("sv-btn quiet");
    expect(svButtonClass("primary", { big: true, wide: true })).toBe("sv-btn primary big wide");
  });
});

describe("DuelAction", () => {
  it("has fixed labels and styles", () => {
    expect(DUEL_ACTION_LABELS).toEqual({ start: "Start duel", open: "Open duel", watch: "Watch" });
    const { rerender } = render(<DuelAction kind="start" href="/duels/a" />);
    expect(screen.getByRole("link", { name: "Start duel" }).className).toBe("sv-btn primary");
    rerender(<DuelAction kind="open" href="/duels/a" />);
    expect(screen.getByRole("link", { name: "Open duel" }).className).toBe("sv-btn primary");
    rerender(<DuelAction kind="watch" href="/duels/a" />);
    expect(screen.getByRole("link", { name: "Watch" }).className).toBe("sv-btn ghost");
  });
  it("is a button with onClick when there is no href", () => {
    const onClick = vi.fn();
    render(<DuelAction kind="watch" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Segmented", () => {
  it("is a group of aria-pressed buttons", () => {
    const onChange = vi.fn();
    render(<Segmented label="Scope" value="season" options={[{ value: "season", label: "This season" }, { value: "all", label: "All-time" }]} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Scope" })).toHaveClass("seg");
    expect(screen.getByRole("button", { name: "This season" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All-time" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "All-time" }));
    expect(onChange).toHaveBeenCalledWith("all");
  });
  it("disables every button", () => {
    render(<Segmented label="Scope" value="a" disabled options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
    expect(screen.getByRole("button", { name: "A" })).toBeDisabled();
  });
});

describe("CopyLinkRow", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("shows a read-only field and a Copy link button", () => {
    render(<CopyLinkRow value="https://x.test/t/abc" label="Invite link" />);
    const field = screen.getByRole("textbox", { name: "Invite link" });
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveValue("https://x.test/t/abc");
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("copies, says Copied, and goes back after 2 seconds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyLinkRow value="https://x.test/t/abc" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy link" })); });
    expect(writeText).toHaveBeenCalledWith("https://x.test/t/abc");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Link copied");
    act(() => { vi.advanceTimersByTime(1999); });
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2); });
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("does not throw or claim success when the clipboard fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(document, "execCommand", { value: vi.fn(() => false), configurable: true });
    render(<CopyLinkRow value="https://x.test/t/abc" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy link" })); });
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("copes with no clipboard at all", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    Object.defineProperty(document, "execCommand", { value: undefined, configurable: true });
    render(<CopyLinkRow value="v" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy link" })); });
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });
});
