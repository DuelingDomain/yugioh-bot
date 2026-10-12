// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const TOGGLE = "First player draws on turn 1";

async function submitBody(fetchMock: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole("button", { name: /Create game/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

function renderCreator() {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ session: { slug: "abc" } }, { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<DuelCreator multiplayerTables multiCoreReady multiDomainCoreReady />);
  return fetchMock;
}

describe("DuelCreator first-turn draw setting", () => {
  it.each(["ffa3", "ffa4"])("offers the toggle, on by default, at a Domain %s table", async (format) => {
    const fetchMock = renderCreator();
    fireEvent.click(screen.getByLabelText("Domain"));
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: format } });
    const group = screen.getByRole("radiogroup", { name: TOGGLE });
    expect((group.querySelector('input[type="radio"]:checked') as HTMLInputElement).closest("label")?.textContent).toBe("On");
    expect((await submitBody(fetchMock)).settings.firstTurnDraw).toBe(true);
  });

  it("sends false when the toggle is off", async () => {
    const fetchMock = renderCreator();
    fireEvent.click(screen.getByLabelText("Domain"));
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "ffa3" } });
    fireEvent.click(screen.getByRole("radiogroup", { name: TOGGLE }).querySelectorAll("label")[1].querySelector("input")!);
    expect((await submitBody(fetchMock)).settings.firstTurnDraw).toBe(false);
  });

  it("does not offer the toggle at Standard, Tag or 1v1 Domain tables", () => {
    renderCreator();
    expect(screen.queryByRole("radiogroup", { name: TOGGLE })).toBeNull();
    fireEvent.click(screen.getByLabelText("Domain"));
    expect(screen.queryByRole("radiogroup", { name: TOGGLE })).toBeNull();
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "tag" } });
    expect(screen.queryByRole("radiogroup", { name: TOGGLE })).toBeNull();
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "ffa3" } });
    expect(screen.queryByRole("radiogroup", { name: TOGGLE })).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Standard duel"));
    expect(screen.queryByRole("radiogroup", { name: TOGGLE })).toBeNull();
  });

  it.each(["1v1", "tag"])("sends no firstTurnDraw after ffa3 -> Domain -> %s", async (end) => {
    const fetchMock = renderCreator();
    fireEvent.click(screen.getByLabelText("Domain"));
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "ffa3" } });
    expect(screen.queryByRole("radiogroup", { name: TOGGLE })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: end } });
    expect(screen.queryByRole("radiogroup", { name: TOGGLE })).toBeNull();
    const body = await submitBody(fetchMock);
    expect(body.settings).not.toHaveProperty("firstTurnDraw");
  });

  it("sends no firstTurnDraw after ffa3 Domain is switched to Standard", async () => {
    const fetchMock = renderCreator();
    fireEvent.click(screen.getByLabelText("Domain"));
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "ffa3" } });
    fireEvent.click(screen.getByLabelText("Standard duel"));
    expect((await submitBody(fetchMock)).settings).not.toHaveProperty("firstTurnDraw");
  });
});
