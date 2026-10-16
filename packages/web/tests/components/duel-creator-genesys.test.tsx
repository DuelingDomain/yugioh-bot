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

vi.mock("@/components/duel/api", async original => ({
  ...await original<object>(), getHostedWaitingTable: vi.fn(async () => ({ table: null })),
}));

import { DuelCreator } from "@/components/duel/creator";

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

async function create() {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ session: { slug: "abc" } }, { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function submitBody(fetchMock: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole("button", { name: /Create game/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe("DuelCreator Genesys", () => {
  it("sends no Genesys setting while the toggle is off", async () => {
    const fetchMock = await create();
    render(<DuelCreator multiplayerTables multiCoreReady />);
    expect(screen.queryByTestId("genesys-cap")).toBeNull();
    const body = await submitBody(fetchMock);
    expect(body.settings.genesys ?? null).toBeNull();
  });

  it("sends the default cap of 100, no banlist and Standard mode", async () => {
    const fetchMock = await create();
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.click(screen.getByTestId("genesys-toggle"));
    expect((screen.getByTestId("genesys-cap") as HTMLInputElement).value).toBe("100");
    const body = await submitBody(fetchMock);
    expect(body.mode).toBe("normal");
    expect(body.settings.genesys).toEqual({ pointCap: 100 });
    expect(body.settings.banlist).toBe("none");
  });

  it("sends the typed cap with Domain", async () => {
    const fetchMock = await create();
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.click(screen.getByLabelText("Domain"));
    fireEvent.click(screen.getByTestId("genesys-toggle"));
    fireEvent.change(screen.getByTestId("genesys-cap"), { target: { value: "250" } });
    const body = await submitBody(fetchMock);
    expect(body.mode).toBe("domain");
    expect(body.settings.genesys).toEqual({ pointCap: 250 });
  });

  it("keeps Genesys and the cap when the duel type changes", async () => {
    const fetchMock = await create();
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.click(screen.getByTestId("genesys-toggle"));
    fireEvent.change(screen.getByTestId("genesys-cap"), { target: { value: "80" } });
    fireEvent.click(screen.getByLabelText("Domain"));
    expect((screen.getByTestId("genesys-toggle") as HTMLInputElement).checked).toBe(true);
    const body = await submitBody(fetchMock);
    expect(body.mode).toBe("domain");
    expect(body.settings.genesys).toEqual({ pointCap: 80 });
  });

  it.each(["tag", "ffa3", "ffa4"])("works at a %s table", async (format) => {
    const fetchMock = await create();
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: format } });
    fireEvent.click(screen.getByTestId("genesys-toggle"));
    const body = await submitBody(fetchMock);
    expect(body.format).toBe(format);
    expect(body.settings.genesys).toEqual({ pointCap: 100 });
  });

  it("keeps Genesys when the table type changes", async () => {
    const fetchMock = await create();
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.click(screen.getByLabelText("Domain"));
    fireEvent.click(screen.getByTestId("genesys-toggle"));
    fireEvent.change(screen.getByLabelText("Table type"), { target: { value: "ffa3" } });
    const body = await submitBody(fetchMock);
    expect(body.mode).toBe("normal");
    expect(body.settings.genesys).toEqual({ pointCap: 100 });
  });

  it("turns Genesys off again and restores the banlist", async () => {
    const fetchMock = await create();
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.click(screen.getByTestId("genesys-toggle"));
    fireEvent.click(screen.getByTestId("genesys-toggle"));
    const body = await submitBody(fetchMock);
    expect(body.settings.genesys ?? null).toBeNull();
    expect(body.settings.banlist).not.toBe("none");
  });

  it.each(["", "abc", "-1", "1001", "1.5"])("blocks the cap %j", (value) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.click(screen.getByTestId("genesys-toggle"));
    fireEvent.change(screen.getByTestId("genesys-cap"), { target: { value } });
    expect(screen.getByTestId("genesys-cap").getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: /Create game/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Create game/ }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["0", "1000"])("accepts the cap %s", (value) => {
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.click(screen.getByTestId("genesys-toggle"));
    fireEvent.change(screen.getByTestId("genesys-cap"), { target: { value } });
    expect(screen.getByTestId("genesys-cap").getAttribute("aria-invalid")).toBe("false");
  });

  it("names the mode and the cap in the summary", () => {
    render(<DuelCreator multiplayerTables multiCoreReady />);
    fireEvent.click(screen.getByTestId("genesys-toggle"));
    expect(screen.getAllByText("Genesys").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText("Domain"));
    expect(screen.getAllByText("Genesys Domain").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/100 pts/).length).toBeGreaterThan(0);
  });
});
