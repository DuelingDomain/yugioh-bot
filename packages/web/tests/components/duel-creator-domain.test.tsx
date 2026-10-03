// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MULTI_DOMAIN_UNAVAILABLE_MESSAGE } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DuelCreator } from "@/components/duel/creator";

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("DuelCreator Domain rule", () => {
  it.each(["tag", "ffa3", "ffa4"])("describes only MR5 without promising every duelist a first-turn draw at a Standard %s table", (format) => {
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: format } });
    const note = screen.getByText(/Tag and free-for-all duels use Master Rule 5/);
    expect(note.textContent).not.toContain("every duelist draws");
    expect(note.textContent).toContain("First-turn draws follow Master Rule 5.");
    expect(note.textContent).toContain("current card catalog");
  });

  it("keeps the selected-rule draw text at a Standard 1v1 table", () => {
    render(<DuelCreator />);
    expect(screen.getByText(/Master Rules use the current card catalog/).textContent)
      .toContain("First-turn draws follow the selected Master Rule.");
  });

  it.each([1, 2, 3, 4, 5].map((masterRule) => ({ masterRule })))("uses engine-neutral draw text for 1v1 Domain MR$masterRule", ({ masterRule }) => {
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.click(screen.getByLabelText("Domain"));
    fireEvent.change(screen.getByLabelText("Master Rules"), { target: { value: String(masterRule) } });
    expect(screen.getByRole("status").textContent).not.toContain("every duelist draws");
    expect(screen.getByRole("status").textContent).not.toContain("First-turn draws follow the selected Master Rule.");
    expect(screen.getByRole("status").textContent).toContain("In 1v1 Domain, the duelist who goes first draws at Master Rule 1 and 2; at Master Rule 3 to 5 this depends on the server engine. The second duelist always draws.");
  });

  it("offers Standard and Domain at a 1v1 table", () => {
    render(<DuelCreator multiplayerTables multiCoreReady />);
    expect(screen.getByLabelText("Domain")).toBeTruthy();
    expect(screen.queryByTestId("domain-blocked")).toBeNull();
  });

  it.each(["tag", "ffa3", "ffa4"])("hides Domain and says why at a %s table", (format) => {
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: format } });
    expect(screen.queryByLabelText("Domain")).toBeNull();
    expect(screen.getByLabelText("Standard duel")).toBeTruthy();
    expect(screen.getByTestId("domain-blocked").textContent).toBe(MULTI_DOMAIN_UNAVAILABLE_MESSAGE);
  });

  it("goes back to Standard when the table type changes while Domain is chosen", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ session: { slug: "abc" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.click(screen.getByLabelText("Domain"));
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "ffa3" } });
    fireEvent.click(screen.getByRole("button", { name: /Create game/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.format).toBe("ffa3");
    expect(body.mode).toBe("normal");
    expect(body.settings.stopAtEveryWindow).toBe(true);
  });

  it("brings Domain back when the table type is 1v1 again", () => {
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "tag" } });
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "1v1" } });
    expect(screen.getByLabelText("Domain")).toBeTruthy();
  });

  it.each(["ffa3", "ffa4", "tag"])("offers Domain at %s when the host has its core", async (format) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ session: { slug: "abc" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DuelCreator multiplayerTables multiCoreReady multiDomainCoreReady />);
    fireEvent.click(screen.getByLabelText("Domain"));
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: format } });
    expect(screen.getByLabelText("Domain")).toBeTruthy();
    expect(screen.queryByTestId("domain-blocked")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Tag and free-for-all duels use Master Rule 5.");
    expect(screen.getByRole("status").textContent).toContain("In Domain, every duelist draws on their first turn.");
    fireEvent.click(screen.getByRole("button", { name: /Create game/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ format, mode: "domain", settings: { validateDeck: true, startingLP: 8000, stopAtEveryWindow: true } });
  });

  it("offers only 1v1 when multiplayer tables are off, even if the core is present", () => {
    render(<DuelCreator multiDomainCoreReady />);
    expect(screen.queryByLabelText("Table type")).toBeNull();
    expect(screen.queryByTestId("format-rule")).toBeNull();
    expect(screen.getByLabelText("Domain")).toBeTruthy();
  });
});
