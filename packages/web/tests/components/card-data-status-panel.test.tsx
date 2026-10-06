// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardDataStatusPanel } from "@/components/card-data/card-data-status-panel";
import type { CardDataStatus } from "@yugidraft/shared/types";
import { resetImageQueue } from "@/lib/image-queue";
import { behindStatus, completeSet, freshStatus, gapCards, missingSet, unknownSet, unknownSource } from "../fixtures/card-data-status";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...rest}>{children}</a> }));

const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  fetchMock.mockReset();
  resetImageQueue();
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
    for (const name of ["Engine data", "Card catalog", "New TCG cards", "Weekly engine data update", "Cards our site has loaded that the engine lacks"]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
    expect(screen.getAllByText("Same as upstream HEAD")).toHaveLength(3);
    expect(screen.getByText("bundle-2026-09-29")).toBeTruthy();
    expect(screen.getByText("13,012")).toBeTruthy();
    expect(screen.getAllByText("RA05")).toHaveLength(2); // catalog newest sets and the recent set row
    expect(screen.getByText("Complete, 60 cards")).toBeTruthy();
    expect(screen.getAllByText("Rage of the Abyss")).toHaveLength(2);
    expect(screen.getByText("No open update pull request.")).toBeTruthy();
    const link = screen.getAllByRole("link", { name: "d123456 (opens in a new tab)" })[0];
    expect(link.getAttribute("href")).toBe("https://github.com/ProjectIgnis/BabelCDB/commit/d1234567890abcdef");
    expect(screen.getByRole("link", { name: "View run (opens in a new tab)" }).getAttribute("href")).toContain("/actions/runs/1");
  });

  it("shows Behind with the key reason, the gap and an open update PR", async () => {
    const status = behindStatus();
    status.gap.recentSets = [missingSet("Rage of the Abyss", "RA05", "2026-09-26", 60, 42)];
    status.gap.recentSetsMissingFromEngineCount = 42;
    status.upstream.babelCdbFiles.files.push("release-new.cdb");
    status.updateWorkflow.openPullRequest = { number: 77, title: "chore: bump Ignis data", url: "https://github.com/DuelingDomain/yugioh-bot/pull/77", updatedAt: "2026-10-05T04:00:00Z" };
    await renderWith(status);
    expect(screen.getByText("Behind")).toBeTruthy();
    expect(screen.getByText("Engine data 3 days behind Project Ignis")).toBeTruthy();
    expect(screen.getByText("42 new TCG cards not in the engine yet in 1 recent set")).toBeTruthy();
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

  it("shows Behind for a missing set even when everything else is current", async () => {
    const status = freshStatus();
    status.gap.recentSets = [missingSet("Rage of the Abyss", "RA05", "2026-09-26", 60, 3)];
    status.gap.recentSetsMissingFromEngineCount = 3;
    await renderWith(status);
    expect(screen.getByRole("heading", { name: "Behind" })).toBeTruthy();
    expect(screen.getByText("3 missing of 60")).toBeTruthy();
  });

  it("does not show Behind for cached catalog cards the engine lacks", async () => {
    const status = freshStatus();
    status.gap.cachedCatalogMissingCount = 12;
    status.gap.cachedCatalogMissing = gapCards(12);
    await renderWith(status);
    expect(screen.getByRole("heading", { name: "Up to date" })).toBeTruthy();
    expect(screen.getByText(/12 cached catalog cards not in the engine\./)).toBeTruthy();
  });

  it("lists sets newest first and shows unknown sets as unknown, not complete", async () => {
    const status = freshStatus();
    status.gap.recentSets = [
      completeSet("Older Set", "OL01", "2026-03-01", 50),
      unknownSet("Newest Set", "NW01", "2026-09-26"),
      missingSet("Middle Set", "MD01", "2026-06-01", 40, 2),
    ];
    status.gap.recentSetsMissingFromEngineCount = 2;
    status.gap.recentSetsUnknownCount = 1;
    await renderWith(status);
    const list = screen.getByRole("list", { name: "Recent TCG sets" });
    const names = within(list).getAllByRole("listitem").map((item) => item.querySelector("span")?.textContent);
    expect(names).toEqual(["Newest Set", "Middle Set", "Older Set"]);
    const newest = within(list).getAllByRole("listitem")[0];
    expect(within(newest).getByText("Unknown")).toBeTruthy();
    expect(within(newest).getByText("never checked")).toBeTruthy();
    expect(within(newest).queryByText(/Complete/)).toBeNull();
    expect(screen.getByText(/1 set not checked yet\. They are not counted as complete/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Behind" })).toBeTruthy();
    expect(screen.getByText(/At least 2 new TCG cards/)).toBeTruthy();
  });

  it("says GitHub has not been checked on a cold read", async () => {
    const status = freshStatus();
    status.upstream.checkedAt = null;
    await renderWith(status);
    expect(screen.getByRole("heading", { name: "Unknown" })).toBeTruthy();
    expect(screen.getByText(/GitHub has not been checked yet\./)).toBeTruthy();
  });

  it("shows Unknown when no recent sets are synced", async () => {
    const status = freshStatus();
    status.gap.recentSets = [];
    status.gap.recentSetsMissingFromEngineCount = null;
    await renderWith(status);
    expect(screen.getByRole("heading", { name: "Unknown" })).toBeTruthy();
    expect(screen.getByText(/recent set list is not synced yet/)).toBeTruthy();
  });

  it("opens a set to its missing cards, 25 at a time, and filters them", async () => {
    const status = freshStatus();
    status.gap.recentSets = [missingSet("Rage of the Abyss", "RA05", "2026-09-26", 90, 80)];
    status.gap.recentSetsMissingFromEngineCount = 80;
    await renderWith(status);
    expect(screen.queryByRole("region", { name: /Cards missing/ })).toBeNull();

    const toggle = screen.getByRole("button", { name: /Rage of the Abyss/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const region = screen.getByRole("region", { name: "Cards missing from the engine in Rage of the Abyss" });
    expect(within(region).getAllByRole("row")).toHaveLength(26); // header + 25
    fireEvent.click(screen.getByRole("button", { name: /Show more \(55 left\)/ }));
    expect(within(region).getAllByRole("row")).toHaveLength(51);
    fireEvent.click(screen.getByRole("button", { name: /Show more \(30 left\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Show more \(5 left\)/ }));
    expect(screen.queryByRole("button", { name: /Show more/ })).toBeNull();
    expect(within(region).getAllByRole("row")).toHaveLength(81);

    fireEvent.change(screen.getByLabelText("Filter missing cards by name, passcode or set code"), { target: { value: "gap card 7" } });
    expect(within(region).getAllByRole("row")).toHaveLength(81); // waits for a pause in typing
    expect(await screen.findByText("1 of 1 sets have a match")).toBeTruthy();
    expect(within(region).getAllByRole("row")).toHaveLength(12); // "Gap Card 7" and 70 to 79

    fireEvent.change(screen.getByLabelText("Filter missing cards by name, passcode or set code"), { target: { value: "zzzz" } });
    expect(await screen.findByText("0 of 1 sets have a match")).toBeTruthy();
  });

  it("loads card art about six images at a time", async () => {
    const status = freshStatus();
    status.gap.recentSets = [missingSet("Rage of the Abyss", "RA05", "2026-09-26", 90, 40)];
    status.gap.recentSetsMissingFromEngineCount = 40;
    await renderWith(status);
    fireEvent.click(screen.getByRole("button", { name: /Rage of the Abyss/ }));
    const region = screen.getByRole("region", { name: /Cards missing from the engine/ });
    const images = () => region.querySelectorAll("img");
    expect(images()).toHaveLength(6);
    expect(images()[0].getAttribute("src")).toBe("/api/cards/10000/image?variant=small");
    fireEvent.load(images()[0]);
    expect(images()).toHaveLength(7);
    fireEvent.error(images()[1]);
    expect(images()).toHaveLength(8);
  });

  it("shows a same-card-different-ID note quietly, without making the page Behind", async () => {
    const status = freshStatus();
    status.gap.recentSets = [{ ...completeSet("Rage of the Abyss", "RA05", "2026-09-26", 60), idMismatch: gapCards(2) }];
    await renderWith(status);
    expect(screen.getByRole("heading", { name: "Up to date" })).toBeTruthy();
    expect(screen.getByText(/2 cards have the same name in the engine under a different ID \(same card, different ID\)/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Same card, different ID" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Show" })[0]);
    expect(within(screen.getByRole("list", { name: "Same card, different ID" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("keeps the cached catalog list collapsed, labeled and paged", async () => {
    const status = freshStatus();
    status.gap.cachedCatalogMissingCount = 500;
    status.gap.cachedCatalogMissing = gapCards(60);
    await renderWith(status);
    expect(screen.getByText(/Catalog cards only/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Cached catalog cards missing from the engine" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show the list" }));
    const region = screen.getByRole("region", { name: "Cached catalog cards missing from the engine" });
    expect(within(region).getAllByRole("row")).toHaveLength(26);
    expect(screen.getByText(/The server listed 60 of 500\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show more \(35 left\)/ }));
    expect(within(region).getAllByRole("row")).toHaveLength(51);
  });

  it("shows data as of the pinned commit date when the bundle has no prepared time", async () => {
    const status = freshStatus();
    status.engine.preparedAt = null;
    status.engine.preparedAtSource = "unknown";
    await renderWith(status);
    expect(screen.queryByText("Prepared")).toBeNull();
    expect(screen.getByText("Data as of")).toBeTruthy();
    expect(screen.getByText(/the bundle records no preparation time/)).toBeTruthy();
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
