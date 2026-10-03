// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { LinkStub, fontMock } from "./shell/helpers";

vi.mock("next/font/google", () => fontMock());
vi.mock("next/link", () => ({ default: LinkStub }));

import { EmptyField } from "../../src/components/layout/empty-field";
import AppNotFound from "../../app/(app)/not-found";
import RootNotFound from "../../app/not-found";
import AppError from "../../app/(app)/error";

afterEach(cleanup);

describe("EmptyField", () => {
  it("draws a dashed unlit field with a centre line and one empty slot", () => {
    const { container } = render(<EmptyField code="404" title="Nothing here">Words.</EmptyField>);
    const field = container.querySelector(".sv-field");
    expect(field).toHaveAttribute("data-lit", "false");
    expect(field).toHaveAttribute("data-centre", "true");
    expect(container.querySelectorAll(".sv-zone")).toHaveLength(1);
    expect(container.querySelector(".sv-zone")).toHaveAttribute("data-state", "empty");
  });

  it("has one h1, the sentence, an optional address, buttons and a reference", () => {
    render(
      <EmptyField code="Error" title="Hit a problem" address="/tournament/x" reference="abc123" actions={<button type="button">Go</button>}>
        Try again.
      </EmptyField>,
    );
    screen.getByRole("heading", { level: 1, name: "Hit a problem" });
    screen.getByText("Try again.");
    screen.getByText("/tournament/x");
    screen.getByRole("button", { name: "Go" });
    screen.getByText("Reference abc123");
  });
});

describe("404 and error pages", () => {
  it("(app) 404 keeps its copy and has a flat primary Back to dashboard link", () => {
    render(<AppNotFound />);
    screen.getByRole("heading", { level: 1, name: "Nothing at this address" });
    screen.getByText("This page does not exist, or it was deleted. The link may have a typo.");
    const link = screen.getByRole("link", { name: "Back to dashboard" });
    expect(link).toHaveAttribute("href", "/dashboard");
    expect(link).toHaveClass("sv-btn", "primary");
  });

  it("root 404 keeps the centring container fix", () => {
    const { container } = render(<RootNotFound />);
    expect(container.querySelector(".ms")?.className).toContain("w-full max-w-xl");
    screen.getByRole("link", { name: "Back to dashboard" });
  });

  it("error page: Try again calls reset, Back to dashboard is a ghost link, the reference shows", () => {
    const reset = vi.fn();
    render(<AppError error={Object.assign(new Error("x"), { digest: "d-42" })} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveClass("ghost");
    screen.getByText("Reference d-42");
  });

  it("error page: no reference line without a digest", () => {
    render(<AppError error={new Error("x")} reset={vi.fn()} />);
    expect(screen.queryByText(/^Reference/)).toBeNull();
  });
});
