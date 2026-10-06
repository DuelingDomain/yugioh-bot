// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardDataStatusPanel } from "@/components/card-data/card-data-status-panel";
import type { CardDataStatus } from "@yugidraft/shared/types";
import { behindStatus, freshStatus, gapCards, unknownSource } from "../fixtures/card-data-status";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...rest}>{children}</a> }));

const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderWith(status: CardDataStatus) {
  fetchMock.mockResolvedValue(json(status));
  render(<CardDataStatusPanel />);
  await screen.findByText("Engine data", { selector: "h2" });
}

describe("CardDataStatusPanel", () => {
  it("shows an up to date summary and every section when all is fresh", async () => {
    await renderWith(freshStatus());
    expect(screen.getByRole("heading", { name: "Up to date" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/card-data-status", { cache: "no-store" });
    for (const name of ["Engine data", "Card catalog", "Gap", "Weekly engine data update"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    expect(screen.getAllByText("Same as upstream HEAD")).toHaveLength(3);
    expect(screen.getByText("bundle-2026-09-29")).toBeTruthy();
    expect(screen.getByText("13,012")).toBeTruthy();
    expect(screen.getByText("RA05")).toBeTruthy();
    expect(screen.getByText("No gap. The engine knows every cached catalog card.")).toBeTruthy();
    expect(screen.getByText("No open update pull request.")).toBeTruthy();
    const link = screen.getAllByRole("link", { name: "d123456 (opens in a new tab)" })[0];
    expect(link.getAttribute("href")).toBe("https://github.com/ProjectIgnis/BabelCDB/commit/d1234567890abcdef");
    expect(screen.getByRole("link", { name: "View run (opens in a new tab)" }).getAttribute("href")).toContain("/actions/runs/1");
  });

  it("shows Behind with the key reason, the gap and an open update PR", async () => {
    const status = behindStatus();
    status.gap = { catalogMissingFromEngineCount: 42, catalogMissingFromEngine: gapCards(3), engineMissingFromCatalogCount: 0 };
    status.upstream.babelCdbFiles.files.push("release-new.cdb");
    status.updateWorkflow.openPullRequest = { number: 77, title: "chore: bump Ignis data", url: "https://github.com/DuelingDomain/yugioh-bot/pull/77", updatedAt: "2026-10-05T04:00:00Z" };
    await renderWith(status);
    expect(screen.getByText("Behind")).toBeTruthy();
    expect(screen.getByText("Engine data 3 days behind Project Ignis")).toBeTruthy();
    expect(screen.getByText("42 TCG cards not in the duel engine")).toBeTruthy();
    expect(screen.getByText("Behind by 12 commits, 3 days")).toBeTruthy();
    expect(screen.getByText(/1 new file upstream, not loaded:/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /#77 chore: bump Ignis data \(opens in a new tab\)/ }).getAttribute("href")).toContain("/pull/77");
  });

  it("labels an upstream HEAD that is older than the pin without calling it behind", async () => {
    const status = freshStatus();
    status.upstream.sources.database = { ...status.upstream.sources.database, comparison: "behind", behindCommits: 0, behindDays: 0 };
    await renderWith(status);
    expect(screen.getByText("Pin is newer than upstream HEAD")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Up to date" })).toBeTruthy();
  });

  it("shows Unknown when the compare failed although HEAD is known", async () => {
    const status = freshStatus();
    status.upstream.sources.scripts = { ...status.upstream.sources.scripts, comparison: "unknown", behindCommits: null, behindDays: null };
    await renderWith(status);
    expect(screen.getByRole("heading", { name: "Unknown" })).toBeTruthy();
    expect(screen.getByText("Comparison unavailable")).toBeTruthy();
  });

  it("flags an estimated prepared-at value", async () => {
    const status = freshStatus();
    status.engine.preparedAtSource = "manifest-mtime";
    await renderWith(status);
    expect(screen.getByText("estimate, from the bundle file date")).toBeTruthy();
  });

  it("shows Unknown calmly when GitHub failed", async () => {
    const status = freshStatus();
    status.upstream.sources = { database: unknownSource("database"), scripts: unknownSource("scripts"), strings: unknownSource("strings") };
    status.upstream.babelCdbFiles = { status: "unknown", files: [] };
    status.updateWorkflow = { lastRunStatus: "unknown", lastRun: null, pullRequestStatus: "unknown", openPullRequest: null };
    await renderWith(status);
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText("Cannot reach GitHub, so engine data age is unknown")).toBeTruthy();
    expect(screen.getAllByText("Not checked, GitHub did not answer")).toHaveLength(3);
    expect(screen.getByText("Upstream release files could not be checked.")).toBeTruthy();
    expect(screen.getByText("Could not read the last run from GitHub.")).toBeTruthy();
    expect(screen.getByText("Could not look up pull requests on GitHub.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("filters the gap list and shows more in steps", async () => {
    const status = freshStatus();
    status.gap = { catalogMissingFromEngineCount: 80, catalogMissingFromEngine: gapCards(80), engineMissingFromCatalogCount: 0 };
    await renderWith(status);
    const region = screen.getByRole("region", { name: "Cards missing from the engine" });
    expect(within(region).getAllByRole("row")).toHaveLength(26); // header + 25
    expect(screen.getByText("Showing 25 of 80")).toBeTruthy();
    expect(region.querySelector("img")?.getAttribute("src")).toBe("/api/cards/10000/image?variant=small");

    fireEvent.click(screen.getByRole("button", { name: /Show more \(55 left\)/ }));
    expect(within(region).getAllByRole("row")).toHaveLength(51); // header + 50
    fireEvent.click(screen.getByRole("button", { name: /Show more \(30 left\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Show more \(5 left\)/ }));
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
    expect(within(region).getAllByRole("row")).toHaveLength(81);

    fireEvent.change(screen.getByLabelText("Filter by name, passcode or set code"), { target: { value: "gap card 7" } });
    // The filter waits for a pause in typing.
    expect(within(region).getAllByRole("row")).toHaveLength(81);
    // "Gap Card 7" and "Gap Card 70" to "Gap Card 79"
    expect(await screen.findByText("11 of 80 listed cards match")).toBeTruthy();
    expect(within(region).getAllByRole("row")).toHaveLength(12);

    fireEvent.change(screen.getByLabelText("Filter by name, passcode or set code"), { target: { value: "zzzz" } });
    expect(await screen.findByText("No card matches this filter.")).toBeTruthy();
  });

  it("says when the server listed fewer cards than the count", async () => {
    const status = freshStatus();
    status.gap = { catalogMissingFromEngineCount: 500, catalogMissingFromEngine: gapCards(10), engineMissingFromCatalogCount: 0 };
    await renderWith(status);
    expect(screen.getByText(/The server listed 10 of 500\./)).toBeTruthy();
  });

  it("shows an admins-only message on 403 and no data", async () => {
    fetchMock.mockResolvedValue(json({ error: "no" }, 403));
    render(<CardDataStatusPanel />);
    expect(await screen.findByText("Admins only.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Engine data" })).toBeNull();
  });

  it("offers Retry when the host is unavailable", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "down" }, 503));
    render(<CardDataStatusPanel />);
    expect(await screen.findByText(/Couldn.t load card data status/)).toBeTruthy();
    fetchMock.mockResolvedValueOnce(json(freshStatus()));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Up to date" })).toBeTruthy();
  });

  it("refreshes with a new request and keeps the last result if it fails", async () => {
    await renderWith(freshStatus());
    fetchMock.mockResolvedValueOnce(json(behindStatus()));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Behind" })).toBeTruthy());
    expect(screen.getByText("Card data status updated")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(json({ error: "down" }, 503));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Refresh failed. This is the last result.")).toBeTruthy();
    expect(screen.getByText("Behind")).toBeTruthy();
  });
});
