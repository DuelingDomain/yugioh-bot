// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SheetRoot } from "@/components/sheet";
import { PoolHead } from "@/components/draft/lobby/pool-head";

describe("PoolHead", () => {
  it("joins the count and the sources with a comma, never a middle dot", () => {
    render(<SheetRoot><PoolHead cards={[{ qty: 2 }, {}, {}]} detail="1 set" /></SheetRoot>);
    expect(screen.getByRole("heading", { name: "Card pool" })).toBeInTheDocument();
    expect(screen.getByText("3 cards, 4 copies, 1 set")).toBeInTheDocument();
  });
  it("says it is resolving while the pool loads", () => {
    render(<SheetRoot><PoolHead cards={[]} loading /></SheetRoot>);
    expect(screen.getByText("0 cards, resolving…")).toBeInTheDocument();
  });
});
