// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { CubeLobbyPanel } from "../../src/components/cubes/cube-lobby-panel";

const cubes = ["Gaia knights", "Toon", "Mind: Control"].map((name, i) => ({
  id: i + 1, name, archetype: null, mainCount: 60, extraCount: 4, sampleImages: [],
}));
const main = (name: string) => `${name}: Main pool has 12 cards but needs at least 42 for a 40-card main deck (3 choices/pick).`;
const extra = (name: string) => `${name}: Extra pool has 3 cards but needs 17 for a full 15-card Extra Deck; players may end with fewer Extra cards.`;
const renderPanel = (errors: string[], warnings: string[]) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ errors, warnings }) }));
  return render(<CubeLobbyPanel slug="s" allowedCubes={cubes} themeSelection="random" />);
};
afterEach(() => vi.unstubAllGlobals());

describe("theme lobby preflight", () => {
  it("moves main and Extra shortfall counts onto their matching tiles below the tally", async () => {
    renderPanel([main("Gaia knights")], [extra("Toon")]);
    const mainLine = await screen.findByText("Main pool too small: 12 of 42 cards");
    const extraLine = screen.getByText("Extra may run short: 3 of 17 cards");
    expect(mainLine).toHaveAttribute("data-kind", "main");
    expect(extraLine).toHaveAttribute("data-kind", "extra");
    const mainTile = screen.getByText("Gaia knights").closest("li")!;
    const extraTile = screen.getByText("Toon").closest("li")!;
    expect(mainTile).toHaveAttribute("data-bad");
    expect(mainTile).not.toHaveAttribute("data-warn");
    expect(extraTile).toHaveAttribute("data-warn");
    expect(extraTile).not.toHaveAttribute("data-bad");
    expect(screen.getByText("Mind: Control").closest("li")).not.toHaveAttribute("data-bad");
    expect(mainTile).toContainElement(mainLine);
    expect(extraTile).toContainElement(extraLine);
    expect(mainLine.parentElement!.previousElementSibling).toHaveTextContent("60 main, 4 extra");
    expect(extraLine.parentElement!.previousElementSibling).toHaveTextContent("60 main, 4 extra");
    expect(within(mainTile).queryByText(/Extra may run short/)).not.toBeInTheDocument();
    expect(within(extraTile).queryByText(/Main pool too small/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Gaia knights can't be drafted yet. Its main pool is too small.");
    expect(screen.getByRole("alert")).toHaveTextContent("Add cards to the cube, or remove the theme.");
    expect(screen.getByRole("status")).toHaveTextContent("1 theme may run short on Extra deck cards, so that player could end with fewer. You can start anyway.");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/12|42|choices/);
    expect(screen.getByRole("status")).not.toHaveTextContent(/3 cards|17|full 15/);
  });

  it.each([
    [2, "Gaia knights and Toon"], [3, "Gaia knights, Toon and Mind: Control"],
  ])("summarizes %i errors by name and warnings by theme count", async (count, names) => {
    const selected = cubes.slice(0, count);
    renderPanel(selected.map((cube) => main(cube.name)), selected.map((cube) => extra(cube.name)));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`${names} can't be drafted yet. Their main pools are too small.`);
    expect(alert).toHaveTextContent("Add cards to those cubes, or remove those themes.");
    expect(screen.getByRole("status")).toHaveTextContent(`${count} themes may run short on Extra deck cards, so those players could end with fewer. You can start anyway.`);
    expect(screen.getAllByText("Main pool too small: 12 of 42 cards")).toHaveLength(count);
    expect(screen.getAllByText("Extra may run short: 3 of 17 cards")).toHaveLength(count);
  });

  it("marks a theme with both main and Extra shortfalls as bad and warned", async () => {
    renderPanel([main("Gaia knights")], [extra("Gaia knights")]);
    await screen.findByRole("alert");
    const tile = screen.getByText("Gaia knights").closest("li")!;
    expect(tile).toHaveAttribute("data-bad");
    expect(tile).toHaveAttribute("data-warn");
  });

  it("preserves unknown errors and warnings as raw paragraphs following their summary", async () => {
    const rawError = "Mind: Control: Unknown main check.";
    const rawWarning = "Server: Unknown warning.";
    renderPanel([main("Gaia knights"), rawError], [extra("Toon"), rawWarning]);
    await screen.findByRole("alert");
    const paragraphs = screen.getByRole("alert").querySelectorAll("p");
    expect(paragraphs[0]).toHaveTextContent("Gaia knights can't be drafted yet. Its main pool is too small.");
    expect(paragraphs[1]).toHaveTextContent("Add cards to the cube, or remove the theme.");
    expect(paragraphs[2].textContent).toBe(rawError);
    const warningParagraphs = screen.getByRole("status").querySelectorAll("p");
    expect(warningParagraphs[1].textContent).toBe(rawWarning);
  });

  it("does not infer numeric shortfalls from unknown messages", async () => {
    renderPanel(["Gaia knights: Main pool is too small."], ["Toon: Something else."]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Gaia knights: Main pool is too small.");
    expect(screen.getByRole("status")).toHaveTextContent("Toon: Something else.");
    expect(screen.queryByText(/Main pool too small:|Extra may run short:/)).not.toBeInTheDocument();
    expect(screen.getByText("Gaia knights").closest("li")).not.toHaveAttribute("data-bad");
  });

  it("counts each warned theme once", async () => {
    renderPanel([main("Gaia knights"), main("Gaia knights")], [extra("Toon"), extra("Toon")]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Gaia knights can't be drafted yet. Its main pool is too small.");
    expect(screen.getByRole("status")).toHaveTextContent("1 theme may run short");
    expect(screen.getAllByText("Main pool too small: 12 of 42 cards")).toHaveLength(1);
  });

  it("has no banners when preflight passes", async () => {
    renderPanel([], []);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/drafts/s/preflight"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
